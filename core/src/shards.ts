/**
 * 分库（对应 Java 版 super/sharding-datasource、sharding-all）：同一个 schema 的几个 Db（各连一个库），实体按分片键路由到库。
 * 路由规则复用分表的 ShardingRule——它给出的"表名"就是库的名字：
 *
 * ```ts
 * const sdb = shardDatabases({
 *   shards: { ds0: db0, ds1: db1 },
 *   routes: { Order: byMod('userId', 2, { table: (_, i) => `ds${i}` }) },
 * })
 * await sdb.insert(Order, rows)                                                   // 按行路由
 * await sdb.query(Order, (q) => q.where((o) => o.userId.eq(7))).toList()          // 只查 ds1
 * await sdb.query(Order, (q) => q.orderBy((o) => o.createdAt.desc())).toPage(3, 20) // 各库取前 60 条，按排序归并再切
 * ```
 * 跨库查询：各库并发（concurrency 个）执行同一个查询，按查询自己的 orderBy 在内存里归并；count / sum / min / max 各库算完再合并。
 * 不支持跨库的 groupBy、avg、带 limit / offset 的 toList（用 toPage）。写入只在各自的库里，跨库写入不是分布式事务。
 */
import type { Node } from './ast.ts';
import type { Db } from './db.ts';
import type { Deletable, Updatable } from './mutation.ts';
import type { Page, Queryable } from './query.ts';
import type { AnySchema, EntityKey } from './relations.ts';
import type { Entity, Insert } from './schema.ts';
import { shardFilter, type ShardingRule } from './sharding.ts';

type SchemaEntity<S extends AnySchema> = S['entities'][EntityKey<S>];
type KeyOf<S extends AnySchema, E> = {
  [K in EntityKey<S>]: S['entities'][K] extends E ? K : never;
}[EntityKey<S>];

export interface ShardOptions<S extends AnySchema> {
  /** 各个库：名字 → 连着那个库的 Db（schema 相同） */
  readonly shards: Readonly<Record<string, Db<S>>>;
  /** 实体按什么分库；没写的实体只在 defaultShard 里 */
  readonly routes: { readonly [K in EntityKey<S>]?: ShardingRule };
  /** 没有路由的实体所在的库，默认第一个 */
  readonly defaultShard?: string;
  /** 跨库查询同时执行几个库，默认 4 */
  readonly concurrency?: number;
}

export function shardDatabases<S extends AnySchema>(options: ShardOptions<S>): ShardedDb<S> {
  return new ShardedDb(options);
}

export class ShardedDb<S extends AnySchema> {
  private readonly options: ShardOptions<S>;
  private readonly names: readonly string[];

  constructor(options: ShardOptions<S>) {
    this.names = Object.keys(options.shards);
    if (this.names.length === 0) throw new Error('shardDatabases needs at least one shard');
    this.options = options;
  }

  /** 某个库（直接在一个库里查写、开事务） */
  shard(name: string): Db<S> {
    const db = this.options.shards[name];
    if (!db) throw new Error(`no shard named '${name}' (shards: ${this.names.join(', ')})`);
    return db;
  }

  /** 按分片键把行分到各库插入，返回插入的行数 */
  async insert<E extends SchemaEntity<S>>(entity: E, rows: readonly Insert<E>[]): Promise<number> {
    const groups = new Map<string, Insert<E>[]>();
    for (const row of rows) {
      const name = this.shardOfRow(entity, row as Record<string, unknown>);
      groups.set(name, [...(groups.get(name) ?? []), row]);
    }
    let affected = 0;
    for (const [name, list] of groups)
      affected += await this.shard(name)
        .insert(entity)
        .values(list as never)
        .execute();
    return affected;
  }

  /** 在条件裁剪出的各库上执行同一个更新，返回合计的行数 */
  async update<E extends SchemaEntity<S>>(
    entity: E,
    build: (update: Updatable<S, KeyOf<S, E>>) => Updatable<S, KeyOf<S, E>>,
  ): Promise<number> {
    // 分库按能力最全的 Db 调：各库的能力由各自的 adapter 决定，运行时照常检查
    const run = (db: Db<S>) => build((db as unknown as Db<AnySchema>).update(entity) as never);
    return this.write(
      entity,
      (db) => run(db).conditions(),
      (db) => run(db).execute(),
    );
  }

  /** 在条件裁剪出的各库上执行同一个删除，返回合计的行数 */
  async delete<E extends SchemaEntity<S>>(
    entity: E,
    build: (remove: Deletable<S, KeyOf<S, E>>) => Deletable<S, KeyOf<S, E>>,
  ): Promise<number> {
    const run = (db: Db<S>) => build(db.delete(entity) as never);
    return this.write(
      entity,
      (db) => run(db).conditions(),
      (db) => run(db).execute(),
    );
  }

  /** 跨库查询：build 在每个库上建同一个查询 */
  query<E extends SchemaEntity<S>, Out>(
    entity: E,
    build: (query: Queryable<S, KeyOf<S, E>>) => Queryable<S, KeyOf<S, E>, Out, any>,
  ): ShardedQuery<Out> {
    const queries = (names: readonly string[]) =>
      names.map((name) => build(this.shard(name).queryable(entity) as never));
    const first = queries([this.names[0]!])[0]!;
    const { select } = first.buildTree();
    const names = this.shardsFor(entity, select.where, select.from.alias);
    return new ShardedQuery(queries(names), this.options.concurrency ?? 4);
  }

  private async write(
    entity: Entity,
    conditions: (db: Db<S>) => { alias: string; where: Node[] },
    execute: (db: Db<S>) => Promise<number>,
  ): Promise<number> {
    const { alias, where } = conditions(this.shard(this.names[0]!));
    let affected = 0;
    for (const name of this.shardsFor(entity, where, alias))
      affected += await execute(this.shard(name));
    return affected;
  }

  private rule(entity: Entity): ShardingRule | undefined {
    const db = this.shard(this.names[0]!);
    const routes = this.options.routes as Readonly<Record<string, ShardingRule>>;
    const key = Object.keys(routes).find((k) => db.entity(k as never) === entity);
    return key === undefined ? undefined : routes[key];
  }

  private shardOfRow(entity: Entity, row: Readonly<Record<string, unknown>>): string {
    const rule = this.rule(entity);
    if (!rule) return this.options.defaultShard ?? this.names[0]!;
    const value = row[rule.column];
    if (value === undefined || value === null)
      throw new Error(
        `insert into ${entity.table} across shards needs the sharding column '${rule.column}'`,
      );
    return rule.tableOf(entity.table, value);
  }

  /** 条件裁剪出的库；没有路由的实体在 defaultShard */
  private shardsFor(entity: Entity, where: readonly Node[], alias: string): string[] {
    const rule = this.rule(entity);
    if (!rule) return [this.options.defaultShard ?? this.names[0]!];
    const found = shardFilter(where, alias, entity.columnNames[rule.column]!);
    const all = rule.tables(entity.table).filter((n) => n in this.options.shards);
    if (!found) return all;
    const picked = rule.prune(entity.table, found.filter).filter((n) => all.includes(n));
    return picked.length > 0 ? picked : all.slice(0, 1);
  }
}

/** 跨库的查询：各库执行同一个查询，在内存里归并 */
export class ShardedQuery<Out> {
  private readonly queries: readonly Queryable<any, any, Out, any>[];
  private readonly concurrency: number;

  constructor(queries: readonly Queryable<any, any, Out, any>[], concurrency: number) {
    this.queries = queries;
    this.concurrency = Math.max(1, concurrency);
  }

  /** 各库的结果按查询的 orderBy 归并；查询带了 limit / offset 时报错（跨库分页用 toPage） */
  async toList(): Promise<Out[]> {
    const { select } = this.queries[0]!.buildTree();
    if (select.limit !== undefined || select.offset !== undefined)
      throw new Error('limit / offset across shards: use toPage(page, size)');
    return this.merge(await this.each((q) => q.toList()));
  }

  /** 各库取前 page × size 条，归并后切出这一页；总数是各库之和 */
  async toPage(page: number, size: number): Promise<Page<Out>> {
    const [lists, totals] = await Promise.all([
      this.each((q) => q.limit(page * size).toList()),
      this.each((q) => q.count()),
    ]);
    const rows = this.merge(lists).slice((page - 1) * size, page * size);
    return { rows, total: totals.reduce((a, b) => a + b, 0), page, size };
  }

  async first(): Promise<Out | undefined> {
    return (await this.toPage(1, 1)).rows[0];
  }

  async count(): Promise<number> {
    return (await this.each((q) => q.count())).reduce((a, b) => a + b, 0);
  }

  async sum<V>(value: (...refs: any[]) => any): Promise<V | null> {
    const parts: unknown[] = (await this.each((q) => q.sum(value))).filter((v) => v !== null);
    return parts.length === 0 ? null : (parts.reduce((a, b) => addNumbers(a, b)) as V);
  }

  async min<V>(value: (...refs: any[]) => any): Promise<V | null> {
    return pick(await this.each((q) => q.min(value)), (a, b) => compare(a, b) < 0) as V | null;
  }

  async max<V>(value: (...refs: any[]) => any): Promise<V | null> {
    return pick(await this.each((q) => q.max(value)), (a, b) => compare(a, b) > 0) as V | null;
  }

  /** 各库并发执行（最多 concurrency 个），结果按库的顺序 */
  private async each<T>(run: (q: Queryable<any, any, Out, any>) => Promise<T>): Promise<T[]> {
    const results: T[] = new Array(this.queries.length);
    let next = 0;
    const worker = async () => {
      while (next < this.queries.length) {
        const i = next++;
        results[i] = await run(this.queries[i]!);
      }
    };
    await Promise.all(
      Array.from({ length: Math.min(this.concurrency, this.queries.length) }, worker),
    );
    return results;
  }

  /** 按查询的 orderBy 归并各库的结果（各库已排好序）；没有 orderBy 时按库的顺序拼起来 */
  private merge(lists: readonly Out[][]): Out[] {
    const keys = this.orderKeys();
    const all = lists.flat();
    if (keys.length === 0) return all;
    return all.sort((a, b) => {
      for (const { path, desc } of keys) {
        const c = compare(read(a, path), read(b, path));
        if (c !== 0) return desc ? -c : c;
      }
      return 0;
    });
  }

  /** orderBy 的每一项对应到结果里的哪个字段：必须是 select 出来的列 */
  private orderKeys(): { path: string[]; desc: boolean }[] {
    const { select, shape } = this.queries[0]!.buildTree();
    return select.orderBy.map((o) => {
      const text = JSON.stringify(o.e);
      const column = select.columns.find((c) => JSON.stringify(c.e) === text);
      const name = column && [...shape.named].find(([, v]) => v.alias === column.as)?.[0];
      if (!name)
        throw new Error(
          'ordering across shards needs the ORDER BY expressions in the result (select them)',
        );
      return { path: name.split('.'), desc: o.desc };
    });
  }
}

function read(row: unknown, path: readonly string[]): unknown {
  return path.reduce<unknown>(
    (v, k) => (v === null || v === undefined ? v : (v as Record<string, unknown>)[k]),
    row,
  );
}

/** 比较两个值：null 最小（与 MySQL、SQLite 的升序相同），数字、bigint、日期、文字各按自己的序 */
function compare(a: unknown, b: unknown): number {
  if (a === b) return 0;
  if (a === null || a === undefined) return -1;
  if (b === null || b === undefined) return 1;
  if (a instanceof Date && b instanceof Date) return a.getTime() - b.getTime();
  if (
    (typeof a === 'number' || typeof a === 'bigint') &&
    (typeof b === 'number' || typeof b === 'bigint')
  )
    return a < b ? -1 : a > b ? 1 : 0;
  if (
    typeof a === 'string' &&
    typeof b === 'string' &&
    /^-?\d+(\.\d+)?$/.test(a) &&
    /^-?\d+(\.\d+)?$/.test(b)
  )
    return Number(a) - Number(b) || (a < b ? -1 : a > b ? 1 : 0);
  if (typeof a === 'string' && typeof b === 'string') return a < b ? -1 : 1;
  return JSON.stringify(a) < JSON.stringify(b) ? -1 : 1;
}

function pick(values: readonly unknown[], better: (a: unknown, b: unknown) => boolean): unknown {
  const present = values.filter((v) => v !== null && v !== undefined);
  return present.length === 0 ? null : present.reduce((a, b) => (better(b, a) ? b : a));
}

/** 两个和相加：number、bigint 直接加；decimal 的文字按位精确相加 */
function addNumbers(a: unknown, b: unknown): unknown {
  if (typeof a === 'number' && typeof b === 'number') return a + b;
  if (typeof a === 'bigint' && typeof b === 'bigint') return a + b;
  const [x, y] = [String(a), String(b)];
  const scale = Math.max(fraction(x), fraction(y));
  const total = scaled(x, scale) + scaled(y, scale);
  const negative = total < 0n;
  const digits = (negative ? -total : total).toString().padStart(scale + 1, '0');
  const text = scale === 0 ? digits : `${digits.slice(0, -scale)}.${digits.slice(-scale)}`;
  return negative ? `-${text}` : text;
}

function fraction(text: string): number {
  return text.includes('.') ? text.split('.')[1]!.length : 0;
}

function scaled(text: string, scale: number): bigint {
  const negative = text.startsWith('-');
  const [int = '0', frac = ''] = (negative ? text.slice(1) : text).split('.');
  const value = BigInt(int + frac.padEnd(scale, '0'));
  return negative ? -value : value;
}
