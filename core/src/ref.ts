/**
 * lambda 里拿到的表引用：`u.name` 是列，`u.company` 是多对一导航（第一次访问时加一个 LEFT JOIN），
 * `u.posts` 是一对多导航（any / count / sum 渲染为关联子查询，toList 在结果里拼成数组）。
 */
import type { CteNode, Join, Node, OrderNode, SelectNode, TableRef } from './ast.ts';
import {
  aggregate,
  aggregateCodec,
  codecs,
  condNode,
  Expr,
  orderNodes,
  pred,
  joiningExpr,
  type Cond,
  type JoiningOptions,
  type Numeric,
  type OrderItem,
  type Pred,
} from './expr.ts';
import type {
  AnySchema,
  Computed,
  EntityKey,
  Many,
  Member,
  One,
  Relation,
  RelationFilter,
} from './relations.ts';
import {
  Interceptors,
  refEntity,
  type InterceptorName,
  type InterceptorToggle,
  type StatementKind,
} from './interceptor.ts';
import {
  setPath,
  type AnyColumn,
  type Embedded,
  type Entity,
  type Fields,
  type Row,
  type ValueOf,
} from './schema.ts';
import { shardedFrom } from './sharding.ts';

export const REF: unique symbol = Symbol('eqts.ref');

type Ents<S extends AnySchema> = S['entities'];
type Rels<S extends AnySchema, K extends EntityKey<S>> = S['relations'][K];

/** 表引用上的列：每列一个表达式，值对象是嵌套的对象（`c.address.city`）。N 为 true 时都带上 null */
export type ColumnRefs<F extends Fields, N extends boolean = false> = {
  readonly [C in keyof F]: F[C] extends Embedded<infer G>
    ? ColumnRefs<G, N>
    : Expr<N extends true ? ValueOf<F[C]> | null : ValueOf<F[C]>>;
};

/** 表引用的类型。N 为 true 表示经过了可空的导航，列都带上 null */
export type Ref<
  S extends AnySchema,
  K extends EntityKey<S>,
  N extends boolean = false,
> = ColumnRefs<Ents<S>[K]['fields'], N> & {
  readonly [R in keyof Rels<S, K>]: Rels<S, K>[R] extends Computed<infer V>
    ? Expr<N extends true ? V | null : V>
    : Rels<S, K>[R] extends One<infer T extends EntityKey<S>, infer TN>
      ? Ref<S, T, N extends true ? true : TN>
      : Rels<S, K>[R] extends Many<infer T extends EntityKey<S>>
        ? ManyRef<S, T>
        : never;
} & { readonly [REF]: RefInfo<S, K, N> };

export interface RefInfo<
  S extends AnySchema = AnySchema,
  K extends EntityKey<S> = EntityKey<S>,
  N extends boolean = boolean,
> {
  readonly schema: S;
  readonly key: K;
  readonly alias: string;
  readonly nullable: N;
}

export type AnyRef = { readonly [REF]: RefInfo };

/** 一条 SELECT 的构建现场：别名计数（整条语句共用）与本层的 join */
export class Scope {
  readonly schema: AnySchema;
  readonly joins: Join[] = [];
  readonly allowJoins: boolean;
  /** 这一层生效的拦截器（导航上单独开关时，子查询用的是另一份） */
  readonly interceptors: Interceptors;
  /** 所在语句的种类：拦截器的条件据此区分查询与更新、删除 */
  readonly kind: StatementKind;
  /** 整条语句用到的 CTE（按依赖顺序），父子 Scope 共用同一张表：WITH 只能出现在最外层 */
  readonly ctes: Map<string, CteNode>;
  private readonly counter: { n: number };

  constructor(
    schema: AnySchema,
    counter: { n: number } = { n: 0 },
    allowJoins = true,
    interceptors: Interceptors = Interceptors.none,
    kind: StatementKind = 'select',
    ctes: Map<string, CteNode> = new Map(),
  ) {
    this.schema = schema;
    this.counter = counter;
    this.allowJoins = allowJoins;
    this.interceptors = interceptors;
    this.kind = kind;
    this.ctes = ctes;
  }

  /** 拦截器给这个表引用附加的条件（主表、JOIN、子查询都用）；toggles 是只对这张表的开关（join 的选项） */
  filters(ref: AnyRef, toggles: readonly InterceptorToggle[] = []): Node[] {
    return this.interceptors.configure(...toggles).filters(ref, refEntity(ref), this.kind);
  }

  /** 登记用到的 CTE；它自己依赖的 CTE 先登记，名字相同的只登记一次 */
  useCte(cte: CteNode): void {
    for (const inner of cte.q.ctes ?? []) this.useCte(inner);
    if (!this.ctes.has(cte.name))
      this.ctes.set(cte.name, { ...cte, q: { ...cte.q, ctes: undefined } });
  }

  /**
   * 实体在 FROM / JOIN 里的写法：普通表就是表名；派生表是 `(子查询) 别名`；CTE 是名字，并把它登记到最外层的 WITH。
   * 子查询里用到的 CTE 一并上提，WITH 不能嵌在子查询里。
   */
  tableRef(entity: Entity, alias: string): TableRef {
    // 分表实体经导航、join 进来时查它的全部表（只有查询的主表按条件裁剪）
    if (entity.sharding) return shardedFrom(entity, alias, entity.sharding.tables(entity.table));
    const d = entity.derived;
    if (!d) return { table: entity.table, alias };
    for (const inner of d.q.ctes ?? []) this.useCte(inner);
    if (d.kind === 'subquery') return { table: '', alias, sub: { ...d.q, ctes: undefined } };
    this.useCte({ name: entity.table, recursive: d.recursive, columns: d.columns, q: d.q });
    return { table: entity.table, alias };
  }

  nextAlias(): string {
    return `t${this.counter.n++}`;
  }

  /** 子查询用的现场：别名不与外层重复；toggles 是导航上单独的拦截器开关 */
  child(toggles: readonly InterceptorToggle[] = []): Scope {
    return new Scope(
      this.schema,
      this.counter,
      true,
      this.interceptors.configure(...toggles),
      this.kind,
      this.ctes,
    );
  }

  /** 与本现场共用别名计数、但 CTE 单独统计：toList 的第二条查询是独立的语句，只该带它自己用到的 WITH */
  detached(toggles: readonly InterceptorToggle[] = []): Scope {
    return new Scope(
      this.schema,
      this.counter,
      true,
      this.interceptors.configure(...toggles),
      this.kind,
    );
  }

  /** 实体的根引用 */
  root(key: string): AnyRef {
    return makeRef(this, key, this.nextAlias(), false);
  }
}

export function makeRef(scope: Scope, key: string, alias: string, nullable: boolean): AnyRef {
  const entity = scope.schema.entities[key];
  if (!entity) throw new Error(`entity '${key}' is not part of the schema`);
  const ref: Record<string | symbol, unknown> = {};
  Object.defineProperty(ref, REF, {
    value: { schema: scope.schema, key, alias, nullable } satisfies RefInfo,
  });
  for (const [prop, column] of Object.entries(entity.columns)) {
    const value = columnExpr({ k: 'col', alias, name: entity.columnNames[prop]! }, column);
    // 值对象的列（'address.city'）放进嵌套对象：c.address.city
    if (prop.includes('.')) setPath(ref, prop, value);
    else Object.defineProperty(ref, prop, { enumerable: true, value });
  }
  const relations: Record<string, Member> = scope.schema.relations[key] ?? {};
  for (const [prop, rel] of Object.entries(relations)) {
    let cached: unknown;
    Object.defineProperty(ref, prop, {
      get: () =>
        (cached ??=
          rel.kind === 'computed'
            ? // 计算属性：用这个表引用算出表达式（里面可以再用导航、别的计算属性）
              rel.value(ref)
            : rel.kind === 'one'
              ? rel.path
                ? walkPath(ref as AnyRef, rel.path)
                : joinOne(scope, ref as AnyRef, prop, rel, nullable)
              : new ManyRef(scope, ref as AnyRef, rel, {
                  filters: rel.where ? [rel.where] : [],
                  toggles: rel.interceptors ? [rel.interceptors] : [],
                })),
    });
  }
  return ref as AnyRef;
}

/** 读一列的表达式：列声明了 sqlConvert 的 read 时，用转换后的值（仍按列的类型解码） */
function columnExpr(node: Node, column: AnyColumn): Expr<unknown> {
  const raw = new Expr<unknown>(node, column.codec);
  const read = column.options.sqlRead;
  return read ? new Expr(read(raw).node, column.codec) : raw;
}

/** 多对一的直达关系：等同于一段段访问导航（与直接写 `u.company.city` 共用同样的 JOIN） */
function walkPath(ref: AnyRef, path: readonly string[]): AnyRef {
  return path.reduce((current, name) => (current as unknown as Record<string, AnyRef>)[name]!, ref);
}

function joinOne(
  scope: Scope,
  parent: AnyRef,
  prop: string,
  rel: One,
  parentNullable: boolean,
): AnyRef {
  const info = parent[REF];
  if (!scope.allowJoins) {
    throw new Error(
      `navigation ${info.key}.${prop} needs a JOIN, which is not available here (onConflict / merge take plain columns)`,
    );
  }
  const target = scope.schema.entities[rel.target]!;
  const alias = scope.nextAlias();
  const ref = makeRef(scope, rel.target, alias, parentNullable || rel.nullable);
  // 复合外键：每对列一个等式，用 AND 连起来；任意条件的关系（oneOn）用它的条件
  const custom = rel.on ? condNode(rel.on(parent as never, ref as never)) : undefined;
  if (rel.on && !custom) throw new Error(`relation ${info.key}.${prop} needs a condition`);
  const on =
    custom ??
    allOf(
      rel.to.map((c, i): Node => ({
        k: 'op',
        op: '=',
        l: { k: 'col', alias, name: target.columnNames[c]! },
        r: columnNode(scope, info, rel.from[i]!),
      })),
    );
  // 拦截器的条件与关系上固定的条件放进 ON：LEFT JOIN 不会因此把主表的行过滤掉
  const fixed = rel.where ? condNode(rel.where(ref as never)) : undefined;
  const filters = scope.filters(ref, rel.interceptors ? [rel.interceptors] : []);
  const extra = fixed ? [...filters, fixed] : filters;
  scope.joins.push({
    ...scope.tableRef(target, alias),
    kind: rel.required && !parentNullable ? 'inner' : 'left',
    on: extra.length === 0 ? on : { k: 'and', items: [on, ...extra] },
  });
  return ref;
}

/** 多个条件用 AND 连起来；只有一个时原样返回 */
export function allOf(items: readonly Node[]): Node {
  return items.length === 1 ? items[0]! : { k: 'and', items };
}

/**
 * 一对多 / 多对多里"孩子一侧"用来和父行 from 列比较的列（按位置对应）。
 * 直连时是目标表的 to 列；多对多时先把中间表 inner join 到目标表上，返回中间表引用父表的那几列。
 * 导出给 toList 的第二条查询复用，两处的连接方式必须一致。
 */
export function linkColumns(scope: Scope, relation: Many, targetRoot: AnyRef): Node[] {
  const info = targetRoot[REF];
  const target = scope.schema.entities[relation.target]!;
  const col = (
    alias: string,
    entity: { columnNames: Record<string, string> },
    prop: string,
  ): Node => ({ k: 'col', alias, name: entity.columnNames[prop]! });
  if (relation.hops) return bridgeColumns(scope, relation, targetRoot);
  if (relation.on) return conditionColumns(scope, relation, targetRoot);
  const through = relation.through;
  if (!through) return relation.to.map((c) => col(info.alias, target, c));
  const middle = scope.schema.entities[through.entity]!;
  const alias = scope.nextAlias();
  const on = allOf(
    through.to.map((c, i): Node => ({
      k: 'op',
      op: '=',
      l: col(alias, middle, c),
      r: col(info.alias, target, relation.to[i]!),
    })),
  );
  // 拦截器（租户、逻辑删除等）也要作用在中间表上，条件放进 ON
  const extra = scope.filters(makeRef(scope, through.entity, alias, false));
  scope.joins.push({
    table: middle.table,
    alias,
    kind: 'inner',
    on: extra.length === 0 ? on : { k: 'and', items: [on, ...extra] },
  });
  return through.from.map((c) => col(alias, middle, c));
}

/**
 * 直达关系（r.path）的"孩子一侧"：把各段导航拼成一张去重的桥（父键 → 目标键），inner join 到目标表上，返回桥上的父键列。
 * 桥是 DISTINCT 的：同一个目标经几条路径到达也只出现一次，count、sum、toList 不会重复。
 * 各段的目标表与中间表都带上拦截器条件，中间各段的固定条件也在桥里；最后一段的固定条件由 ManyRef 加在目标上
 */
function bridgeColumns(scope: Scope, relation: Many, targetRoot: AnyRef): Node[] {
  const hops = relation.hops!;
  const first = hops[0]!;
  const last = hops.at(-1)!;
  const inner = scope.child();
  const where: Node[] = [];
  const columnsOf = (ref: AnyRef, props: readonly string[]) =>
    props.map((p) => columnNode(inner, ref[REF], p));
  /** inner join 一张表：props 列等于 keys（按位置），并带上拦截器条件与固定条件 */
  const joinOn = (
    key: string,
    props: readonly string[],
    keys: readonly Node[],
    fixed?: RelationFilter,
  ): AnyRef => {
    const alias = inner.nextAlias();
    const ref = makeRef(inner, key, alias, false);
    const extra = inner.filters(ref);
    const condition = fixed ? condNode(fixed(ref as never)) : undefined;
    if (condition) extra.push(condition);
    const on = columnsOf(ref, props).map((l, i): Node => ({ k: 'op', op: '=', l, r: keys[i]! }));
    inner.joins.push({
      ...inner.tableRef(inner.schema.entities[key]!, alias),
      kind: 'inner',
      on: allOf([...on, ...extra]),
    });
    return ref;
  };
  /** 从 ref 沿一段导航走到下一张表（多对多时经中间表） */
  const step = (ref: AnyRef, hop: Relation): AnyRef => {
    let keys = columnsOf(ref, hop.from);
    if (hop.kind === 'many' && hop.through) {
      const middle = joinOn(hop.through.entity, hop.through.from, keys);
      keys = columnsOf(middle, hop.through.to);
    }
    return joinOn(hop.target, hop.to, keys, hop.where);
  };

  // 桥从第一段的目标表开始（多对多时从中间表开始），父键是第一段"孩子一侧"的列
  let start: AnyRef;
  let current: AnyRef;
  let parentKeys: Node[];
  if (first.kind === 'many' && first.through) {
    start = inner.root(first.through.entity);
    where.push(...inner.filters(start));
    parentKeys = columnsOf(start, first.through.from);
    current = joinOn(first.target, first.to, columnsOf(start, first.through.to), first.where);
  } else {
    start = current = inner.root(first.target);
    where.push(...inner.filters(start));
    const fixed = first.where ? condNode(first.where(start as never)) : undefined;
    if (fixed) where.push(fixed);
    parentKeys = columnsOf(start, first.to);
  }
  for (const hop of hops.slice(1, -1)) current = step(current, hop);
  // 最后一段只走到目标键为止，目标表本身在外层
  let targetKeys = columnsOf(current, last.from);
  if (last.kind === 'many' && last.through) {
    const middle = joinOn(last.through.entity, last.through.from, targetKeys);
    targetKeys = columnsOf(middle, last.through.to);
  }
  const bridge: SelectNode = {
    from: inner.tableRef(inner.schema.entities[start[REF].key]!, start[REF].alias),
    joins: inner.joins,
    where,
    groupBy: [],
    having: [],
    orderBy: [],
    columns: [
      ...parentKeys.map((e, i) => ({ e, as: `p${i}` })),
      ...targetKeys.map((e, i) => ({ e, as: `q${i}` })),
    ],
    distinct: true,
    limit: undefined,
    offset: undefined,
    forUpdate: false,
  };
  const alias = scope.nextAlias();
  const target = scope.schema.entities[relation.target]!;
  scope.joins.push({
    table: '',
    alias,
    sub: bridge,
    kind: 'inner',
    on: allOf(
      last.to.map((c, i): Node => ({
        k: 'op',
        op: '=',
        l: { k: 'col', alias, name: `q${i}` },
        r: { k: 'col', alias: targetRoot[REF].alias, name: target.columnNames[c]! },
      })),
    ),
  });
  return parentKeys.map((_, i): Node => ({ k: 'col', alias, name: `p${i}` }));
}

/**
 * 任意条件的关系（r.manyOn）的"孩子一侧"：再连一份本表（INNER JOIN 本表 ON 条件），返回这份本表的主键列，
 * 与父行的主键比较。any / count / toList / groupJoin 都经这里，所以都支持任意条件
 */
function conditionColumns(scope: Scope, relation: Many, targetRoot: AnyRef): Node[] {
  const alias = scope.nextAlias();
  const self = makeRef(scope, relation.source!, alias, false);
  const on = condNode(relation.on!(self as never, targetRoot as never));
  if (!on) throw new Error(`relation to ${relation.target} needs a condition`);
  scope.joins.push({
    ...scope.tableRef(scope.schema.entities[relation.source!]!, alias),
    kind: 'inner',
    on: allOf([on, ...scope.filters(self)]),
  });
  return relation.from.map((c) => columnNode(scope, self[REF], c));
}

export function columnNode(scope: Scope, info: RefInfo, prop: string): Node {
  return { k: 'col', alias: info.alias, name: scope.schema.entities[info.key]!.columnNames[prop]! };
}

/** 表引用上的一列；prop 可以是值对象里的路径（'address.city'） */
export function refColumn(ref: AnyRef, prop: string): Expr<unknown> {
  return prop
    .split('.')
    .reduce<unknown>(
      (value, part) => (value as Record<string, unknown>)[part],
      ref,
    ) as Expr<unknown>;
}

/** ManyRef 上叠加的东西：条件、排序、每个父行取几条、拦截器开关 */
interface ManyOptions {
  readonly filters: readonly ((r: any) => Cond)[];
  readonly orders: readonly ((r: any) => OrderItem | readonly OrderItem[])[];
  readonly take: number | undefined;
  readonly toggles: readonly InterceptorToggle[];
}

/**
 * 一对多导航。可以先 where / orderBy 再聚合；聚合与 any / none 是关联子查询，toList 只能用在 select 里（第二条查询按 IN 拉取后拼装）。
 */
export class ManyRef<S extends AnySchema, K extends EntityKey<S>> {
  declare readonly __target: K;
  readonly scope: Scope;
  readonly parent: AnyRef;
  readonly relation: Many;
  readonly filters: readonly ((r: any) => Cond)[];
  readonly orders: readonly ((r: any) => OrderItem | readonly OrderItem[])[];
  /** toList / first 时每个父行最多取几条（limit） */
  readonly take: number | undefined;
  /** 只对这个导航的拦截器开关（子查询、toList 的第二条查询、分组 join 都用它） */
  readonly toggles: readonly InterceptorToggle[];
  /** groupJoin() 的结果：同一个导航上的几个聚合共用一个分组 join */
  private grouped: GroupJoin<S, K> | undefined;

  constructor(scope: Scope, parent: AnyRef, relation: Many, options: Partial<ManyOptions> = {}) {
    this.scope = scope;
    this.parent = parent;
    this.relation = relation;
    this.filters = options.filters ?? [];
    this.orders = options.orders ?? [];
    this.take = options.take;
    this.toggles = options.toggles ?? [];
  }

  private copy(patch: Partial<ManyOptions>): ManyRef<S, K> {
    const { filters, orders, take, toggles } = this;
    return new ManyRef(this.scope, this.parent, this.relation, {
      filters,
      orders,
      take,
      toggles,
      ...patch,
    });
  }

  where(filter: (r: Ref<S, K>) => Cond): ManyRef<S, K> {
    return this.copy({ filters: [...this.filters, filter] });
  }

  /** 只影响 toList 的顺序 */
  orderBy(order: (r: Ref<S, K>) => OrderItem | readonly OrderItem[]): ManyRef<S, K> {
    return this.copy({ orders: [...this.orders, order] });
  }

  /** toList 时每个父行最多 n 条（按 orderBy；用 ROW_NUMBER() OVER (PARTITION BY 关联列) 在库里截取） */
  limit(n: number): ManyRef<S, K> {
    if (!Number.isSafeInteger(n) || n <= 0)
      throw new RangeError(`limit must be a positive integer, got ${n}`);
    return this.copy({ take: n });
  }

  /** 只在这个导航上关掉这些拦截器（对应 Java 版的 relationLogicDelete）：`u.roles.noInterceptor('softDelete').any()` */
  noInterceptor(...names: InterceptorName[]): ManyRef<S, K> {
    return this.interceptors({ skip: names });
  }

  /** 只在这个导航上打开这些拦截器（含默认关着的） */
  useInterceptor(...names: InterceptorName[]): ManyRef<S, K> {
    return this.interceptors({ use: names });
  }

  /** 只在这个导航上的拦截器开关，见 InterceptorToggle */
  interceptors(toggle: InterceptorToggle): ManyRef<S, K> {
    return this.copy({ toggles: [...this.toggles, toggle] });
  }

  /** 存在满足条件的行（EXISTS） */
  any(filter?: (r: Ref<S, K>) => Cond): Pred {
    return pred({ k: 'exists', q: this.subquery(filter, () => []), not: false });
  }

  /** 不存在满足条件的行（NOT EXISTS） */
  none(filter?: (r: Ref<S, K>) => Cond): Pred {
    return pred({ k: 'exists', q: this.subquery(filter, () => []), not: true });
  }

  /**
   * 每一行都满足条件（对应 Java 版的 all）：没有子项时为真。条件为 NULL 的行算不满足
   * ```ts
   * db.queryable(User).where((u) => u.posts.all((p) => p.amount.gt('1')))
   * ```
   */
  all(filter: (r: Ref<S, K>) => Cond): Pred {
    const q = this.subquery(
      (r) => {
        const n = condNode(filter(r));
        // CASE 把 NULL 也当成"不满足"，各库都能写
        return n
          ? pred({
              k: 'op',
              op: '=',
              l: { k: 'case', when: [[n, { k: 'lit', sql: '1' }]], else: { k: 'lit', sql: '0' } },
              r: { k: 'lit', sql: '0' },
            })
          : pred({ k: 'lit', sql: '1 = 0' });
      },
      () => [],
    );
    return pred({ k: 'exists', q, not: true });
  }

  /**
   * 按 orderBy 排好后的第 index 行（0 起，对应 Java 版的 element / firstElement），每一列是一条标量子查询，
   * 条件、select 里都能用：`u.posts.orderBy((p) => p.id.desc()).at(0).title.eq('最新的')`。没有这一行时列为 NULL
   */
  at(index: number): ColumnRefs<S['entities'][K]['fields'], true> {
    if (!Number.isSafeInteger(index) || index < 0)
      throw new RangeError(`at() index must be a non-negative integer, got ${index}`);
    const entity = this.scope.schema.entities[this.relation.target]!;
    const ref: Record<string, unknown> = {};
    for (const [prop, column] of Object.entries(entity.columns)) {
      let root: AnyRef | undefined;
      const q = this.subquery(undefined, (r) => {
        root = r;
        return [{ e: refColumn(r, prop).node, as: 'v' }];
      });
      const node: Node = {
        k: 'sub',
        q: {
          ...q,
          orderBy: this.orders.flatMap((o) => orderNodes(o(root))),
          limit: 1,
          offset: index,
        },
      };
      setPath(ref, prop, new Expr(node, column.codec));
    }
    return ref as never;
  }

  /** 去重后的个数（NULL 不计），对应 Java 版的 distinct().count(...) */
  countDistinct(value: (r: Ref<S, K>) => Expr<unknown>): Expr<number> {
    const q = this.subquery(undefined, (r) => [
      { e: { k: 'agg', fn: 'count', arg: value(r as Ref<S, K>).node, distinct: true }, as: 'v' },
    ]);
    return new Expr({ k: 'sub', q }, codecs.int);
  }

  count(filter?: (r: Ref<S, K>) => Cond): Expr<number> {
    return new Expr(
      {
        k: 'sub',
        q: this.subquery(filter, () => [
          { e: { k: 'agg', fn: 'count', arg: undefined, distinct: false }, as: 'v' },
        ]),
      },
      codecs.int,
    );
  }

  sum<V extends Numeric | null>(value: (r: Ref<S, K>) => Expr<V>): Expr<NonNullable<V> | null> {
    return this.aggregate('sum', value);
  }
  avg<V extends Numeric | null>(value: (r: Ref<S, K>) => Expr<V>): Expr<NonNullable<V> | null> {
    return this.aggregate('avg', value);
  }
  max<V>(value: (r: Ref<S, K>) => Expr<V>): Expr<NonNullable<V> | null> {
    return this.aggregate('max', value);
  }
  min<V>(value: (r: Ref<S, K>) => Expr<V>): Expr<NonNullable<V> | null> {
    return this.aggregate('min', value);
  }

  /** 关联的行拼成数组；不传 shape 时是整行 */
  toList(): ListOf<Row<S['entities'][K]>>;
  toList<X>(shape: (r: Ref<S, K>) => X): ListOf<Selected<X>>;
  toList(shape?: (r: any) => unknown): ListOf<unknown> {
    return new ListOf(this, shape, false);
  }

  /** 第一条（按 orderBy），没有时为 null；只能放在 select 的对象里 */
  first(): ListOf<Row<S['entities'][K]>, true>;
  first<X>(shape: (r: Ref<S, K>) => X): ListOf<Selected<X>, true>;
  first(shape?: (r: any) => unknown): ListOf<unknown, true> {
    return new ListOf(this.limit(1), shape, true);
  }

  /** 子项的值拼成一串（对应 Java 版的 joining）：`u.posts.joining((p) => p.title, { separator: '、', orderBy: (p) => p.id })`；没有子项时为 null */
  joining(
    value: (r: Ref<S, K>) => Expr<unknown>,
    options?: JoiningOptions<[Ref<S, K>]>,
  ): Expr<string | null> {
    const q = this.subquery(undefined, (r) => [
      {
        e: joiningExpr(
          value(r as Ref<S, K>),
          options?.separator,
          options?.orderBy ? orderNodes(options.orderBy(r as Ref<S, K>)) : [],
          options?.distinct,
        ).node,
        as: 'v',
      },
    ]);
    return new Expr({ k: 'sub', q }, codecs.string);
  }

  /**
   * 聚合改成分组 join（对应 Java 版的 subQueryToGroupJoin）：count / sum / avg / max / min 不再是每行一个关联子查询，
   * 而是把子表按关联列分组一次、再 LEFT JOIN 回来；列表页每行显示子项数、合计时行多了快得多。
   * 同一个导航（含 where）上的几个聚合共用一个分组 join；没有子项时 count 为 0，其余为 null（与子查询的写法一致）。
   * any / none 仍用 EXISTS。分组 join 是独立的语句：where 里不能引用外层的表
   * ```ts
   * select((u) => ({ name: u.name, posts: u.posts.groupJoin().count(), total: u.posts.groupJoin().sum((p) => p.amount) }))
   * ```
   */
  groupJoin(): GroupJoin<S, K> {
    return (this.grouped ??= new GroupJoin(this));
  }

  private aggregate(
    fn: 'sum' | 'avg' | 'max' | 'min',
    value: (r: any) => Expr<unknown>,
  ): Expr<any> {
    let codec;
    const q = this.subquery(undefined, (r) => {
      const e = value(r);
      codec = aggregateCodec(fn, e);
      return [{ e: aggregate(fn, e, undefined).node, as: 'v' }];
    });
    return new Expr({ k: 'sub', q }, codec);
  }

  private subquery(
    filter: ((r: any) => Cond) | undefined,
    columns: (r: AnyRef) => { e: Node; as: string }[],
  ): SelectNode {
    if (this.take !== undefined)
      throw new Error(
        'limit() on a navigation only applies to toList() / first(); filter with where() before any / count / sum',
      );
    const scope = this.scope.child(this.toggles);
    const target = scope.schema.entities[this.relation.target]!;
    const root = scope.root(this.relation.target);
    const alias = root[REF].alias;
    const link = linkColumns(scope, this.relation, root);
    const where: Node[] = [
      allOf(
        link.map((l, i): Node => ({
          k: 'op',
          op: '=',
          l,
          r: columnNode(scope, this.parent[REF], this.relation.from[i]!),
        })),
      ),
    ];
    where.push(...scope.filters(root));
    for (const f of filter ? [...this.filters, filter] : this.filters) {
      const n = condNode(f(root));
      if (n) where.push(n);
    }
    const cols = columns(root);
    return {
      from: scope.tableRef(target, alias),
      joins: scope.joins,
      where,
      groupBy: [],
      having: [],
      orderBy: [],
      columns: cols,
      distinct: false,
      limit: undefined,
      offset: undefined,
      forUpdate: false,
    };
  }

  /** toList 的子查询用：在新语句里重新求值 filters / orders */
  rebuild(root: AnyRef): { where: Node[]; orderBy: OrderNode[] } {
    const where: Node[] = [];
    for (const f of this.filters) {
      const n = condNode(f(root));
      if (n) where.push(n);
    }
    return { where, orderBy: this.orders.flatMap((o) => orderNodes(o(root))) };
  }
}

/** 一对多导航的分组 join（ManyRef.groupJoin）：第一次用到聚合时把分组的派生表 LEFT JOIN 到父行所在的语句上 */
export class GroupJoin<S extends AnySchema, K extends EntityKey<S>> {
  private readonly many: ManyRef<S, K>;
  private joined:
    | { readonly alias: string; readonly root: AnyRef; readonly columns: { e: Node; as: string }[] }
    | undefined;

  constructor(many: ManyRef<S, K>) {
    this.many = many;
  }

  /** 子项个数（带条件时只数满足的）；没有子项时为 0 */
  count(filter?: (r: Ref<S, K>) => Cond): Expr<number> {
    const n = filter ? condNode(filter(this.join().root as Ref<S, K>)) : undefined;
    const arg: Node | undefined = n && {
      k: 'case',
      when: [[n, { k: 'lit', sql: '1' }]],
      else: undefined,
    };
    const column = this.column({ k: 'agg', fn: 'count', arg, distinct: false });
    return new Expr(
      { k: 'fn', name: 'coalesce', args: [column, { k: 'lit', sql: '0' }] },
      codecs.int,
    );
  }

  sum<V extends Numeric | null>(value: (r: Ref<S, K>) => Expr<V>): Expr<NonNullable<V> | null> {
    return this.aggregate('sum', value);
  }
  avg<V extends Numeric | null>(value: (r: Ref<S, K>) => Expr<V>): Expr<NonNullable<V> | null> {
    return this.aggregate('avg', value);
  }
  max<V>(value: (r: Ref<S, K>) => Expr<V>): Expr<NonNullable<V> | null> {
    return this.aggregate('max', value);
  }
  min<V>(value: (r: Ref<S, K>) => Expr<V>): Expr<NonNullable<V> | null> {
    return this.aggregate('min', value);
  }

  /** 子项的值拼成一串，没有子项时为 null */
  joining(
    value: (r: Ref<S, K>) => Expr<unknown>,
    options?: JoiningOptions<[Ref<S, K>]>,
  ): Expr<string | null> {
    const root = this.join().root as Ref<S, K>;
    const e = joiningExpr(
      value(root),
      options?.separator,
      options?.orderBy ? orderNodes(options.orderBy(root)) : [],
      options?.distinct,
    );
    return new Expr(this.column(e.node), codecs.string);
  }

  private aggregate(
    fn: 'sum' | 'avg' | 'max' | 'min',
    value: (r: any) => Expr<unknown>,
  ): Expr<any> {
    const e = value(this.join().root);
    return new Expr(this.column(aggregate(fn, e, undefined).node), aggregateCodec(fn, e));
  }

  /** 分组的派生表里加一列，返回外层引用它的列 */
  private column(e: Node): Node {
    const { alias, columns } = this.join();
    const as = `a${columns.length}`;
    columns.push({ e, as });
    return { k: 'col', alias, name: as };
  }

  /** SELECT 关联列, 聚合… FROM 子表 WHERE 拦截器条件、导航的条件 GROUP BY 关联列，LEFT JOIN 到父行上 */
  private join() {
    if (this.joined) return this.joined;
    const { scope, relation, parent } = this.many;
    if (!scope.allowJoins) throw new Error('groupJoin() needs a JOIN, which is not available here');
    const inner = scope.child(this.many.toggles);
    const root = inner.root(relation.target);
    const link = linkColumns(inner, relation, root);
    const where = [...inner.filters(root), ...this.many.rebuild(root).where];
    // 关联列占前几列（g0…），聚合在后面按用到的顺序追加（a…）
    const columns = link.map((e, i) => ({ e, as: `g${i}` }));
    const alias = scope.nextAlias();
    scope.joins.push({
      table: '',
      alias,
      sub: {
        from: inner.tableRef(inner.schema.entities[relation.target]!, root[REF].alias),
        joins: inner.joins,
        where,
        groupBy: link,
        having: [],
        orderBy: [],
        columns,
        distinct: false,
        limit: undefined,
        offset: undefined,
        forUpdate: false,
      },
      kind: 'left',
      on: allOf(
        relation.from.map((c, i): Node => ({
          k: 'op',
          op: '=',
          l: { k: 'col', alias, name: `g${i}` },
          r: columnNode(scope, parent[REF], c),
        })),
      ),
    });
    return (this.joined = { alias, root, columns });
  }
}

/** select 里的一对多数组 */
export class ListOf<R, Single extends boolean = false> {
  declare readonly __row: R;
  declare readonly __single: Single;
  readonly many: ManyRef<any, any>;
  readonly shape: ((r: any) => unknown) | undefined;
  /** first()：结果是一项或 null，而不是数组 */
  readonly single: Single;

  constructor(many: ManyRef<any, any>, shape: ((r: any) => unknown) | undefined, single: Single) {
    this.many = many;
    this.shape = shape;
    this.single = single;
  }
}

/**
 * select 里按键从另一条查询填充的值（Queryable.fillMany / fillOne，对应 Java 版的 fillMany / fillOne）：
 * from 是本行的键，fetch 按一批键取回 [键, 行]；主查询读完后统一取，一批键一条查询
 */
export class Fill<R, Single extends boolean = false> {
  declare readonly __row: R;
  declare readonly __single: Single;
  readonly from: Expr<unknown>;
  readonly fetch: (keys: readonly unknown[]) => Promise<readonly (readonly [unknown, R])[]>;
  /** fillOne：结果是一行或 null，而不是数组 */
  readonly single: Single;

  constructor(
    from: Expr<unknown>,
    fetch: (keys: readonly unknown[]) => Promise<readonly (readonly [unknown, R])[]>,
    single: Single,
  ) {
    this.from = from;
    this.fetch = fetch;
    this.single = single;
  }
}

/** select 形状对应的结果类型 */
export type Selected<X> =
  X extends Expr<infer T>
    ? T
    : X extends Fill<infer R, infer Single>
      ? Single extends true
        ? R | null
        : R[]
      : X extends ListOf<infer R, infer Single>
        ? Single extends true
          ? R | null
          : R[]
        : X extends { readonly [REF]: RefInfo<infer S, infer K, infer N> }
          ? N extends true
            ? Row<S['entities'][K]> | null
            : Row<S['entities'][K]>
          : X extends readonly unknown[]
            ? never
            : X extends object
              ? { -readonly [P in keyof X]: Selected<X[P]> }
              : never;
