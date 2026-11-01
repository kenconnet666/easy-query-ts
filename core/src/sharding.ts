/**
 * 单库分表（对应 Java 版 super/sharding-table、sharding-mod、sharding-time）：实体声明分片规则，
 * 查询按 where 里分片键上的条件裁剪出要查的表（一张直接查，几张 UNION ALL 成派生表，排序、分页、聚合都在库里），
 * insert 按行路由到各自的表，update / delete 按裁剪出的表逐张执行。
 *
 * ```ts
 * const Order = entity('t_order', { id: …, createdAt: col.datetime(), … }, { sharding: byMonth('createdAt', { from: '2025-01' }) })
 * const Log = entity('t_log', { id: …, userId: col.bigint(), … }, { sharding: byMod('userId', 4) })   // t_log_0 … t_log_3
 * ```
 * 分库（多个库之间路由、归并）见 16.6.3；按时间的表随时间增长，createTables / syncTables 会建出到 to 为止的全部表。
 */
import type { Node, SelectNode, TableRef } from './ast.ts';
import type { Entity } from './schema.ts';

/** 分片键上的条件：等于其中之一（values），或落在范围里（min / max） */
export interface ShardKeyFilter {
  readonly values?: readonly unknown[];
  readonly min?: { readonly value: unknown; readonly inclusive: boolean };
  readonly max?: { readonly value: unknown; readonly inclusive: boolean };
}

/** 分片规则：C 是分片键的属性名 */
export interface ShardingRule<C extends string = string> {
  readonly column: C;
  /** 全部实际表（base 是实体声明的表名） */
  tables(base: string): string[];
  /** 这个分片键的值在哪张表 */
  tableOf(base: string, value: unknown): string;
  /** 满足条件的值可能在哪些表；分片键上没有条件时不会调用（查全部表） */
  prune(base: string, filter: ShardKeyFilter): string[];
}

/**
 * 按取模分表：表名是 `表名_序号`（0 起）。整数键按值取模，其余按文字的哈希（FNV-1a）取模；
 * 只有 eq / in 能裁剪，范围条件查全部表
 */
export function byMod<C extends string>(
  column: C,
  count: number,
  options: { readonly table?: (base: string, index: number) => string } = {},
): ShardingRule<C> {
  if (!Number.isInteger(count) || count < 1)
    throw new Error(`byMod: count must be a positive integer, got ${count}`);
  const name = options.table ?? ((base, i) => `${base}_${i}`);
  const indexOf = (value: unknown): number => {
    if (typeof value === 'number' && Number.isInteger(value))
      return ((value % count) + count) % count;
    if (typeof value === 'bigint')
      return Number(((value % BigInt(count)) + BigInt(count)) % BigInt(count));
    let h = 0x811c9dc5;
    for (const c of String(value)) h = Math.imul(h ^ c.codePointAt(0)!, 0x01000193);
    return (h >>> 0) % count;
  };
  return {
    column,
    tables: (base) => Array.from({ length: count }, (_, i) => name(base, i)),
    tableOf: (base, value) => name(base, indexOf(value)),
    prune: (base, filter) =>
      filter.values
        ? [...new Set(filter.values.map((v) => name(base, indexOf(v))))]
        : Array.from({ length: count }, (_, i) => name(base, i)),
  };
}

export type TimeUnit = 'year' | 'month' | 'day';

/**
 * 按时间分表：表名是 `表名_yyyy` / `表名_yyyyMM` / `表名_yyyyMMdd`（UTC）。from 是第一张表的时间，to 默认现在；
 * eq / in / 范围都能裁剪（按 UTC 的年、月、日算）
 */
export function byTime<C extends string>(
  column: C,
  unit: TimeUnit,
  options: {
    readonly from: Date | string;
    readonly to?: () => Date;
    readonly table?: (base: string, start: Date) => string;
  },
): ShardingRule<C> {
  const toDate = (value: unknown): Date => {
    const d = value instanceof Date ? value : new Date(String(value));
    if (Number.isNaN(d.getTime())) throw new Error(`byTime: '${String(value)}' is not a date`);
    return d;
  };
  const start = (value: unknown): Date => {
    const d = toDate(value);
    return new Date(
      Date.UTC(
        d.getUTCFullYear(),
        unit === 'year' ? 0 : d.getUTCMonth(),
        unit === 'day' ? d.getUTCDate() : 1,
      ),
    );
  };
  const next = (d: Date): Date =>
    new Date(
      Date.UTC(
        d.getUTCFullYear() + (unit === 'year' ? 1 : 0),
        d.getUTCMonth() + (unit === 'month' ? 1 : 0),
        d.getUTCDate() + (unit === 'day' ? 1 : 0),
      ),
    );
  const previous = (d: Date): Date =>
    new Date(
      Date.UTC(
        d.getUTCFullYear() - (unit === 'year' ? 1 : 0),
        d.getUTCMonth() - (unit === 'month' ? 1 : 0),
        d.getUTCDate() - (unit === 'day' ? 1 : 0),
      ),
    );
  const pad = (n: number) => String(n).padStart(2, '0');
  const name =
    options.table ??
    ((base: string, d: Date) =>
      `${base}_${d.getUTCFullYear()}${unit === 'year' ? '' : pad(d.getUTCMonth() + 1)}${unit === 'day' ? pad(d.getUTCDate()) : ''}`);
  const first = start(options.from);
  const last = () => start(options.to?.() ?? new Date());
  const between = (base: string, from: Date, to: Date): string[] => {
    const out: string[] = [];
    for (let d = from < first ? first : from; d <= to && d <= last(); d = next(d))
      out.push(name(base, d));
    return out;
  };
  return {
    column,
    tables: (base) => between(base, first, last()),
    tableOf: (base, value) => name(base, start(value)),
    prune: (base, filter) => {
      if (filter.values) return [...new Set(filter.values.map((v) => name(base, start(v))))];
      const from = filter.min ? start(filter.min.value) : first;
      let to = filter.max ? start(filter.max.value) : last();
      // 上界不含、又正好落在一张表的开头（< 3 月 1 日）：那张表一行都不会命中
      if (
        filter.max &&
        !filter.max.inclusive &&
        to.getTime() === toDate(filter.max.value).getTime()
      )
        to = previous(to);
      return between(base, from, to);
    },
  };
}

/** 按年 / 月 / 日分表的简写 */
export const byYear = <C extends string>(column: C, options: Parameters<typeof byTime>[2]) =>
  byTime(column, 'year', options);
export const byMonth = <C extends string>(column: C, options: Parameters<typeof byTime>[2]) =>
  byTime(column, 'month', options);
export const byDay = <C extends string>(column: C, options: Parameters<typeof byTime>[2]) =>
  byTime(column, 'day', options);

/** where 的顶层 AND 里，分片键列（alias.name）上能用来裁剪的条件；没有时 undefined。还返回这些条件本身（放进 UNION 的各成员） */
export function shardFilter(
  where: readonly Node[],
  alias: string,
  name: string,
): { filter: ShardKeyFilter; conds: Node[] } | undefined {
  const isKey = (n: Node) => n.k === 'col' && n.alias === alias && n.name === name;
  const valueOf = (n: Node): { value: unknown } | undefined =>
    n.k === 'param' ? { value: n.value } : undefined;
  let values: unknown[] | undefined;
  let min: ShardKeyFilter['min'];
  let max: ShardKeyFilter['max'];
  const conds: Node[] = [];
  const flip: Record<string, string> = { '<': '>', '<=': '>=', '>': '<', '>=': '<=', '=': '=' };
  const visit = (n: Node) => {
    if (n.k === 'and') return n.items.forEach(visit);
    if (n.k === 'in' && !n.not && isKey(n.e) && n.list.every((x) => x.k === 'param')) {
      const list = n.list.map((x) => valueOf(x)!.value);
      values = values ? values.filter((v) => list.some((x) => sameKey(x, v))) : list;
      conds.push(n);
      return;
    }
    if (n.k === 'between' && isKey(n.e) && n.lo.k === 'param' && n.hi.k === 'param') {
      min = { value: n.lo.value, inclusive: true };
      max = { value: n.hi.value, inclusive: true };
      conds.push(n);
      return;
    }
    if (n.k !== 'op' || !(n.op in flip)) return;
    const [op, other] = isKey(n.l)
      ? [n.op, n.r]
      : isKey(n.r)
        ? [flip[n.op]!, n.l]
        : [undefined, undefined];
    const v = other && valueOf(other);
    if (!op || !v) return;
    conds.push(n);
    if (op === '=') values = values ? values.filter((x) => sameKey(x, v.value)) : [v.value];
    else if (op === '>' || op === '>=') min = { value: v.value, inclusive: op === '>=' };
    else max = { value: v.value, inclusive: op === '<=' };
  };
  where.forEach(visit);
  if (values === undefined && min === undefined && max === undefined) return undefined;
  return {
    filter: { ...(values ? { values } : {}), ...(min ? { min } : {}), ...(max ? { max } : {}) },
    conds,
  };
}

function sameKey(a: unknown, b: unknown): boolean {
  if (a instanceof Date && b instanceof Date) return a.getTime() === b.getTime();
  return String(a) === String(b);
}

/** 分表实体在 FROM 里的样子：几张表就是 UNION ALL 的派生表（成员都带上分片键条件）；一张就是它本身 */
export function shardedFrom(
  entity: Entity,
  alias: string,
  tables: readonly string[],
  conds: readonly Node[] = [],
): TableRef {
  if (tables.length === 0)
    throw new Error(`no table of ${entity.table} matches the sharding condition`);
  if (tables.length === 1) return { table: tables[0]!, alias };
  const columns = Object.keys(entity.columns).map((p) => {
    const name = entity.columnNames[p]!;
    return { e: { k: 'col', alias, name } as Node, as: name };
  });
  const member = (table: string): SelectNode => ({
    from: { table, alias },
    joins: [],
    where: [...conds],
    groupBy: [],
    having: [],
    orderBy: [],
    columns,
    distinct: false,
    limit: undefined,
    offset: undefined,
    forUpdate: false,
  });
  const [head, ...rest] = tables;
  return {
    table: entity.table,
    alias,
    sub: { ...member(head!), unions: rest.map((t) => ({ all: true, q: member(t) })) },
  };
}

/** 一张分表实体在 where 条件下要碰的表 */
export function shardTables(
  entity: Entity,
  where: readonly Node[],
  alias: string,
): { tables: string[]; conds: Node[] } {
  const rule = entity.sharding!;
  const found = shardFilter(where, alias, entity.columnNames[rule.column]!);
  if (!found) return { tables: rule.tables(entity.table), conds: [] };
  const all = new Set(rule.tables(entity.table));
  // 规则算出的表可能超出已有的范围（按时间分表的未来月份）：只查存在的；一张都没有时查第一张，
  // 条件本身（分片键落在别的表）让结果为空，不必另造一条恒假的语句
  const tables = rule.prune(entity.table, found.filter).filter((t) => all.has(t));
  return { tables: tables.length > 0 ? tables : [...all].slice(0, 1), conds: found.conds };
}
