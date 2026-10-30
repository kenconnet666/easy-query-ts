/**
 * 查询构建器。方法只记下 lambda，执行（toList、count …）时才在新的构建现场里求值、生成语法树，
 * 所以构建器不可变、可以复用：`const base = db.queryable(User).where(...)`，再分别 `base.count()`、`base.limit(10).toList()`。
 */
import {
  checkAliases,
  type CteNode,
  type JoinKind,
  type Node,
  type OrderNode,
  type SelectNode,
  type TableRef,
} from './ast.ts';
import { SqlWriter, type Statement } from './dialect.ts';
import {
  aggregate,
  aggregateCodec,
  joiningExpr,
  type JoiningOptions,
  codecs,
  condNode,
  or,
  Expr,
  orderNodes,
  SUBQUERY,
  type Cond,
  type Numeric,
  type OrderItem,
  type Subquery,
} from './expr.ts';
import {
  columnNode,
  Fill,
  linkColumns,
  ListOf,
  makeRef,
  REF,
  refColumn,
  Scope,
  type AnyRef,
  type Ref,
  type RefInfo,
  type Selected,
} from './ref.ts';
import type { Requires } from './capabilities.ts';
import type { ColumnScope, HasColumns } from './scope.ts';
import { placeholders, PreparedParam } from './placeholder.ts';
import type { AnySchema, EntityKey, Schema } from './relations.ts';
import type { KeyOf } from './db.ts';
import {
  Column,
  setPath,
  type Codec,
  type DerivedEntity,
  type Entity,
  type Row,
  type VariantsOf,
  type VariantTypes,
} from './schema.ts';
import type { InterceptorName, InterceptorToggle } from './interceptor.ts';
import {
  blankValue,
  compareColumn,
  conditionFields,
  conditionOf,
  parseColumnText,
  parseSort,
  resultColumn,
  type DayOptions,
  type FilterOp,
  type TableRequest,
} from './table.ts';
import { assembleTree, type TreeNode } from './tree.ts';
import { query, streamRows, type Context } from './session.ts';
import { shardedFrom, shardTables } from './sharding.ts';

/** 构建时求值的 lambda：单表查询收到一个表引用，join 之后按 join 顺序收到多个 */
type Fn<R> = (...refs: any[]) => R;
type Orders = OrderItem | readonly OrderItem[];

/** 一次显式 join：目标实体、种类、ON 条件（收到此前所有表引用加上新表引用；cross 没有） */
interface JoinSpec {
  readonly key: string;
  readonly kind: JoinKind;
  readonly on: Fn<Cond> | undefined;
  /** 只对这张表的拦截器开关（join 的第三个参数，如 `{ skip: ['softDelete'] }`） */
  readonly toggles: readonly InterceptorToggle[];
  /** 没写 select 时这张表的整行放在哪个键下；省略为实体名（join 子查询时是 'derived'） */
  readonly label?: string;
  /** 跟在别名后面的片段（tableHint） */
  readonly hint?: string;
}

interface State {
  readonly key: string;
  /** 显式 join，按调用顺序 */
  readonly joins: readonly JoinSpec[];
  readonly where: readonly Fn<Cond>[];
  readonly orderBy: readonly Fn<Orders>[];
  readonly select: Fn<unknown> | undefined;
  readonly group: Fn<Record<string, Expr<unknown>>> | undefined;
  readonly having: readonly Fn<Cond>[];
  readonly groupOrderBy: readonly Fn<Orders>[];
  readonly groupSelect: Fn<unknown> | undefined;
  readonly limit: number | undefined;
  readonly offset: number | undefined;
  readonly distinct: boolean;
  readonly forUpdate: boolean;
  readonly lockWait: 'nowait' | 'skip' | undefined;
  readonly groupMode: 'rollup' | 'cube' | undefined;
  /** 主表别名后面的片段（tableHint） */
  readonly hint?: string;
  /** 排序全部反过来（深分页倒序取） */
  readonly reverse?: boolean;
}

/**
 * join 之后没写 select 时的结果类型：第一次 join 把主表的整行包成 `{ 主表: Row }`，之后每次加一张表。
 * nullable 为 true（left join）时新表的整行可空；previousNullable 为 true（right join）时此前各表的整行可空。
 */
export type JoinedRows<
  S extends AnySchema,
  K extends string,
  Out,
  Refs extends readonly unknown[],
  T extends EntityKey<S>,
  Nullable extends boolean,
  PreviousNullable extends boolean = false,
> = Flatten<
  (Refs extends readonly [unknown]
    ? { [Q in K]: PreviousNullable extends true ? Out | null : Out }
    : PreviousNullable extends true
      ? { [P in keyof Out]: Out[P] | null }
      : Out) & {
    [Q in T]: Nullable extends true ? Row<S['entities'][T]> | null : Row<S['entities'][T]>;
  }
>;

/** join 一条子查询时它的表引用：列就是子查询 select 的键；N 为 true（left join）时列都可空 */
export type SubqueryRef<R, N extends boolean = false> = Ref<
  DerivedSchema<'derived', R>,
  'derived',
  N
>;

/** join 子查询之后没写 select 时的结果：子查询的行放在 derived 键下 */
export type JoinedQueryRows<
  K extends string,
  Out,
  Refs extends readonly unknown[],
  R,
  Nullable extends boolean,
  PreviousNullable extends boolean = false,
> = Flatten<
  (Refs extends readonly [unknown]
    ? { [Q in K]: PreviousNullable extends true ? Out | null : Out }
    : PreviousNullable extends true
      ? { [P in keyof Out]: Out[P] | null }
      : Out) & { derived: Nullable extends true ? R | null : R }
>;

/** right join 之后：此前的表都可能没匹配到，它们的表引用变成可空（列都带上 null） */
export type NullableRefs<S extends AnySchema, Refs extends readonly unknown[]> = {
  [I in keyof Refs]: Refs[I] extends { readonly [REF]: RefInfo<any, infer T extends EntityKey<S>> }
    ? Ref<S, T, true>
    : Refs[I];
};

/** 把交叉类型摊平成一个对象类型，提示和比较都更直观 */
type Flatten<T> = { [P in keyof T]: T[P] };

/** rollup / cube 之后分组键可空 */
export type NullableKeys<G> = {
  [P in keyof G]: G[P] extends Expr<infer T> ? Expr<T | null> : G[P];
};

export interface Page<T> {
  readonly rows: T[];
  readonly total: number;
  readonly page: number;
  readonly size: number;
}

/** 所有查询（普通的、分组的）共用的类型：Db.with、union 等接受它 */
export type Query<Out> = Executable<Out>;

/** table() 的选项：整天的时区、能筛选与能排序的列（白名单，键是结果里的名字） */
export interface TableOptions<Out> extends DayOptions {
  readonly filterable?: readonly (keyof Out & string)[];
  readonly sortable?: readonly (keyof Out & string)[];
}

/** filterBy 的一条规则：比较方式，或 { op, column（一列或几列，几列时任一满足）, allowEmpty（空串也算填了） } */
export type FilterRule<Refs extends readonly unknown[]> =
  | FilterOp
  | {
      readonly op: FilterOp;
      readonly column?: (...refs: Refs) => Expr<any> | readonly Expr<any>[];
      readonly allowEmpty?: boolean;
    };

/** filterBy 的规则表：键是输入的键；与主表列同名时可以只写比较方式，否则要写 column */
export type FilterRules<I, Refs extends readonly unknown[]> = {
  readonly [P in keyof I]?: P extends keyof Refs[0]
    ? FilterRule<Refs>
    : {
        readonly op: FilterOp;
        readonly column: (...refs: Refs) => Expr<any> | readonly Expr<any>[];
        readonly allowEmpty?: boolean;
      };
};

/** 查不到要的行（firstOrThrow、findOrThrow）：接口层据此回 404 */
export class NotFoundError extends Error {
  override readonly name = 'NotFoundError';
}

/**
 * 主键的写法：单列主键是那一列的值，复合主键是 `{ 列: 值 }`。
 * 列定义的类型上没有标出哪些是主键，所以类型只约束到"某一列的值或部分行"，少列、多给了值在运行时报错
 */
/** 多态实体的子类型名；普通实体是 never */
type VariantName<E> = [VariantsOf<E>] extends [never]
  ? never
  : VariantsOf<E> extends VariantTypes<any, any, infer V>
    ? keyof V & string
    : never;

/** 结果收窄到子类型 N（结果是整行时） */
type NarrowVariant<Out, E, N extends string> =
  VariantsOf<E> extends VariantTypes<any, infer D, any>
    ? Extract<Out, { readonly [P in D]: N }>
    : Out;

/** apply 的实体缺列时，scope 参数多出这个必填属性：错误信息里写出依赖的列 */
interface MissingColumns<C> {
  readonly 'error: the entity lacks columns this scope needs': keyof C;
}

export type KeyInput<E extends Entity> = Row<E>[keyof Row<E>] | Partial<Row<E>>;

type Columns = Record<string, Expr<unknown>>;

/** 普通对象（复合主键的 `{ 列: 值 }`），不是 Date、Decimal 这类值对象 */
function isKeyObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

/** 主键等于给定值的条件（按主键筛选、Db.lock 共用） */
export function keyCondition(entity: Entity, key: unknown, row: Columns): Cond {
  const columns = entity.primaryKey;
  if (columns.length === 0) throw new Error(`${entity.table} has no primary key`);
  if (!isKeyObject(key)) {
    if (columns.length > 1)
      throw new Error(
        `${entity.table} has a composite primary key; pass { ${columns.join(', ')} } instead of a single value`,
      );
    return row[columns[0]!]!.eq(key as never);
  }
  return columns.map((column) => {
    if (!(column in key)) throw new Error(`primary key of ${entity.table} is missing '${column}'`);
    return row[column]!.eq(key[column] as never);
  });
}

/** 终结方法：各种查询共用 */
abstract class Executable<Out> implements Subquery<Out> {
  /** 类型标记：每行产生的值的类型（Subquery 用它推导 in(...) 能接受什么） */
  declare readonly __row: Out;
  protected readonly ctx: Context;
  protected readonly state: State;

  constructor(ctx: Context, state: State) {
    this.ctx = ctx;
    this.state = state;
  }

  protected abstract with(patch: Partial<State>): this;

  /** 作为子查询的语法树：in(...) 要求只选一列 */
  [SUBQUERY](): SelectNode {
    const { select } = build(this.ctx, this.state);
    if (select.columns.length !== 1) {
      throw new Error(
        `a subquery used as a value or in in(...) must select exactly one column, got ${select.columns.length}`,
      );
    }
    return select;
  }

  /**
   * 把这条查询的结果当作一张派生表继续查询（`FROM (子查询) 别名`）：对窗口函数的结果再过滤（对应 QUALIFY）、
   * 对分组结果再分页、先 limit 再排序，都靠它。select 必须只由表达式组成（或不写 select，即整行）。
   * 派生表只有它自己的列，不能再 join 别的实体。
   * ```ts
   * db.queryable(Post).select(p => ({ id: p.id, rn: win.rowNumber(w => w.partitionBy(p.userId).orderBy(p.id.desc())) }))
   *   .asTable().where(t => t.rn.le(1)).toList()
   * ```
   */
  asTable(): Queryable<DerivedSchema<'derived', Out>, 'derived'> {
    const built = build(this.ctx, this.state);
    assertDerivable(built.shape, 'asTable()');
    return queryOver(
      this.ctx,
      makeDerived('derived', 'subquery', built.select, built.shape.named, false),
    ) as never;
  }

  /** UNION（去重）。两边选出的列名必须一致（顺序可以不同）；结果是一张派生表，可以继续 where / orderBy / limit / toPage */
  union(other: Executable<Out>): Queryable<DerivedSchema<'derived', Out>, 'derived'> {
    return this.compound(false, other);
  }

  /** UNION ALL（不去重） */
  unionAll(other: Executable<Out>): Queryable<DerivedSchema<'derived', Out>, 'derived'> {
    return this.compound(true, other);
  }

  private compound(all: boolean, other: Executable<Out>): never {
    const a = build(this.ctx, this.state);
    const b = other.buildTree();
    assertDerivable(a.shape, 'union()');
    const keys = [...a.shape.named.keys()];
    const first = alignMember(a, keys, 'union() first query');
    const second = alignMember(b, keys, 'union() second query');
    const q: SelectNode = {
      ...first,
      ctes: mergeCtes(a.select.ctes, b.select.ctes),
      unions: [...(a.select.unions ?? []), { all, q: { ...second, ctes: undefined } }],
    };
    return queryOver(
      this.ctx,
      makeDerived('derived', 'subquery', q, a.shape.named, false),
    ) as never;
  }

  /** 内部：构建语法树与形状（Db.with / withRecursive、union 用） */
  buildTree(): Built {
    return build(this.ctx, this.state);
  }

  limit(n: number): this {
    return this.with({ limit: n });
  }
  offset(n: number): this {
    return this.with({ offset: n });
  }
  distinct(): this {
    return this.with({ distinct: true });
  }

  /**
   * 流式读取：`for await (const row of query.stream())`，不把整个结果集读进内存。
   * MySQL（mysql2 流）、PG（游标）、SQLite（iterate）是真正的流式；驱动不支持的库退化成一次读完再产出。
   * 不能和 toList() 导航（对象树）一起用——对象树需要先拿到所有父行。想要边读边处理时，注意中途 break 会释放连接。
   */
  async *stream(options: { batchSize?: number } = {}): AsyncGenerator<Out> {
    const built = build(this.ctx, this.state);
    if (built.shape.lists.length > 0 || built.shape.fills.length > 0)
      throw new Error(
        'stream() cannot be combined with toList() navigations or fills; use toList() to build object trees',
      );
    for await (const batch of streamRows(
      this.ctx,
      render(this.ctx, built.select),
      options.batchSize ?? 500,
    )) {
      for (const row of batch) yield built.shape.read(row) as Out;
    }
  }

  async toList(): Promise<Out[]> {
    // maxRows：没写 limit 时多读一行，读到了就说明超了
    const max = this.ctx.guards.maxRows;
    const capped = max !== undefined && this.state.limit === undefined;
    const built = build(this.ctx, capped ? { ...this.state, limit: max + 1 } : this.state);
    const rows = (await run(this.ctx, built.select, built.shape)) as Out[];
    if (capped && rows.length > max)
      throw new Error(
        `the query returned more than ${max} rows (maxRows); page it with toPage() / limit(), or read it with stream()`,
      );
    return rows;
  }

  /** 第一行；没有时 undefined */
  async first(): Promise<Out | undefined> {
    return (await this.limit(1).toList())[0];
  }

  /** 第一行；没有时抛 NotFoundError（接口层"查不到就 404"用它；对应 Java 版的 firstNotNull），message 写给人看 */
  async firstOrThrow(message?: string): Promise<Out> {
    const rows = await this.limit(1).toList();
    if (rows.length === 0) throw new NotFoundError(message ?? 'no row matched the query');
    return rows[0]!;
  }

  /**
   * 自关联的行拼成树（对应 Java 版的 toTreeList）：按 id 与 parent 两个字段把行挂到父节点的子节点下，
   * 父节点不在结果里的行是根，兄弟之间保持查询的顺序；节点是 select 的形状再加上 children（名字可以换）。
   * ```ts
   * await db.queryable(Dept).orderBy(d => d.sort).select(d => ({ id: d.id, parentId: d.parentId, label: d.name }))
   *   .toTree({ id: 'id', parent: 'parentId' })
   * ```
   */
  async toTree<C extends string = 'children'>(options: {
    id: keyof Out;
    parent: keyof Out;
    children?: C;
  }): Promise<TreeNode<Out, C>[]> {
    return assembleTree(
      await this.toList(),
      options.id,
      options.parent,
      options.children ?? ('children' as C),
    );
  }

  /** 恰好一行，否则抛错 */
  async single(): Promise<Out> {
    const rows = await this.limit(2).toList();
    if (rows.length !== 1)
      throw new Error(
        `expected exactly one row, got ${rows.length === 0 ? 'none' : 'more than one'}`,
      );
    return rows[0]!;
  }

  async count(): Promise<number> {
    const rows = await query(this.ctx, this.countStatement());
    return Number(rows[0]?.['n'] ?? 0);
  }

  async any(): Promise<boolean> {
    const built = build(this.ctx, { ...this.state, limit: 1, offset: undefined }, true);
    return (await query(this.ctx, render(this.ctx, built.select))).length > 0;
  }

  /** page 从 1 开始 */
  async toPage(page: number, size: number): Promise<Page<Out>> {
    const total = await this.count();
    return { rows: await this.pageRows(total, page, size), total, page, size };
  }

  /**
   * 已知总数时取一页。偏移量过了 reversePageAfter、且超过总数一半时，按相反的排序取（偏移量变小、库里少跳过很多行），再翻回来
   */
  protected async pageRows(total: number, page: number, size: number): Promise<Out[]> {
    const offset = (page - 1) * size;
    if (total === 0 || offset >= total) return [];
    const after = this.ctx.guards.reversePageAfter;
    const ordered = this.state.orderBy.length > 0 || this.state.groupOrderBy.length > 0;
    if (after !== undefined && ordered && offset > after && offset > total / 2) {
      const count = Math.min(size, total - offset);
      const rows = await this.with({
        reverse: true,
        offset: total - offset - count,
        limit: count,
      }).toList();
      return rows.reverse();
    }
    return this.offset(offset).limit(size).toList();
  }

  toSQL(): Statement {
    return render(this.ctx, build(this.ctx, this.state).select);
  }

  private countStatement(): Statement {
    const plain = {
      ...this.state,
      orderBy: [],
      groupOrderBy: [],
      limit: undefined,
      offset: undefined,
    };
    const grouped = this.state.group !== undefined || this.state.distinct;
    const built = build(this.ctx, plain, !grouped);
    const n = this.ctx.dialect.quote('n');
    if (!grouped) {
      return render(this.ctx, {
        ...built.select,
        columns: [{ e: { k: 'agg', fn: 'count', arg: undefined, distinct: false }, as: 'n' }],
      });
    }
    const w = new SqlWriter();
    checkAliases(built.select);
    const sql = `SELECT COUNT(*) AS ${n} FROM (${this.ctx.dialect.select(built.select, w)}) eq_count`;
    return { sql, params: w.params };
  }
}

/**
 * 单实体出发的查询；导航在 lambda 里随用随 join。
 * ```ts
 * await db.queryable(User)
 *   .where(u => [u.name.like('ts'), age != null && u.age.ge(age), u.posts.any(p => p.title.startsWith('orm'))])
 *   .orderBy(u => [u.createdAt.desc(), u.id])
 *   .select(u => ({ id: u.id, company: u.company.name, posts: u.posts.toList(p => ({ title: p.title })) }))
 *   .toList()
 * ```
 */
export class Queryable<
  S extends AnySchema,
  K extends EntityKey<S>,
  Out = Row<S['entities'][K]>,
  Refs extends readonly unknown[] = [Ref<S, K>],
> extends Executable<Out> {
  protected with(patch: Partial<State>): this {
    return new Queryable(this.ctx, { ...this.state, ...patch }) as this;
  }

  where(filter: (...refs: Refs) => Cond): Queryable<S, K, Out, Refs> {
    return this.with({ where: [...this.state.where, filter] });
  }

  /**
   * 加上一个可复用的条件（defineScope）：实体要有它依赖的列，否则类型错误；参数跟在后面：
   * `db.queryable(Order).apply(ofTenant, 7)`
   */
  apply<C, A extends readonly unknown[]>(
    scope: ColumnScope<C, A> & (Refs[0] extends HasColumns<C> ? unknown : MissingColumns<C>),
    ...args: A
  ): Queryable<S, K, Out, Refs> {
    return this.where(((root: HasColumns<C>) => scope.condition(root, ...args)) as never);
  }

  /**
   * 多态实体（entity.union）只查一种子类型：加上判别列的条件，结果类型收窄到这一种（在 select 之前用）：
   * `db.queryable(Payment).variant('card').toList()` 的每一行都有 cardNo
   */
  variant<const N extends VariantName<S['entities'][K]>>(
    name: N,
  ): Queryable<S, K, NarrowVariant<Out, S['entities'][K], N>, Refs> {
    const entity = this.ctx.schema.entities[this.state.key]!;
    const spec = entity.variants;
    if (!spec) throw new Error(`${entity.table} is not a polymorphic entity (entity.union)`);
    if (!(name in spec.members)) throw new Error(`${entity.table} has no variant '${name}'`);
    return this.with({
      where: [
        ...this.state.where,
        (root: Record<string, Expr<unknown>>) => root[spec.discriminator]!.eq(name),
      ],
    }) as never;
  }

  orderBy(order: (...refs: Refs) => Orders): Queryable<S, K, Out, Refs> {
    return this.with({ orderBy: [...this.state.orderBy, order] });
  }

  /** 结果的形状：表达式、导航到的整行、toList 数组、嵌套对象都可以；结果类型据此推导 */
  select<X>(shape: (...refs: Refs) => X): Queryable<S, K, Selected<X>, Refs> {
    return new Queryable(this.ctx, { ...this.state, select: shape });
  }

  /**
   * 按主键筛选（对应 Java 版的 whereById）：单列主键传值，复合主键传 `{ 列: 值 }`。
   * ```ts
   * db.queryable(User).whereKey(1)
   * db.queryable(Member).whereKey({ tenantId: 1, id: 7 })
   * ```
   */
  whereKey(key: KeyInput<S['entities'][K]>): Queryable<S, K, Out, Refs> {
    const entity = this.ctx.schema.entities[this.state.key]!;
    return this.with({
      where: [...this.state.where, (root) => keyCondition(entity, key, root as Columns)],
    });
  }

  /** 主键在这一组里（对应 whereByIds）：单列主键渲染成 IN，复合主键是几组条件的 OR；空数组时一行都不匹配 */
  whereKeys(keys: readonly KeyInput<S['entities'][K]>[]): Queryable<S, K, Out, Refs> {
    const entity = this.ctx.schema.entities[this.state.key]!;
    return this.with({
      where: [
        ...this.state.where,
        (root) => {
          const row = root as Columns;
          const [only, ...rest] = entity.primaryKey;
          if (only !== undefined && rest.length === 0 && !keys.some(isKeyObject))
            return keys.length ? row[only]!.in(keys as never) : or();
          return or(...keys.map((key) => keyCondition(entity, key, row)));
        },
      ],
    });
  }

  /** 按主键取一行（对应 findOrNull）；没有时 undefined。之前的 select、where 照样生效 */
  find(key: KeyInput<S['entities'][K]>): Promise<Out | undefined> {
    return this.whereKey(key).first();
  }

  /** 按主键取一行，没有时抛 NotFoundError（对应 findNotNull） */
  findOrThrow(key: KeyInput<S['entities'][K]>, message?: string): Promise<Out> {
    return this.whereKey(key).firstOrThrow(message);
  }

  /**
   * 按列表请求（`parseTableRequest`）筛选、排序、分页，返回一页（对应 Java 版的 whereObject / orderByObject，见 table.ts）。
   * 表头筛选、关键字筛选、条件树与排序只认结果里的列；请求的排序排在查询自己的排序前面；带了 total 时不再数行数。
   * options.timeZone：日期时间列上只写了日期的区间按哪个时区算整天
   */
  async table(request: TableRequest, options: TableOptions<Out> = {}): Promise<Page<Out>> {
    // 白名单：请求里用到的列必须在 filterable / sortable 里（没写时结果里的列都行）
    const check = (
      keys: readonly string[],
      allowed: readonly string[] | undefined,
      what: string,
    ) => {
      const bad = allowed ? keys.filter((key) => !allowed.includes(key)) : [];
      if (bad.length > 0)
        throw new Error(`cannot ${what} by ${bad.join(', ')} (allowed: ${allowed!.join(', ')})`);
    };
    check(
      [
        ...Object.keys(request.filters),
        ...Object.keys(request.searches),
        ...(request.condition ? conditionFields(request.condition) : []),
      ],
      options.filterable,
      'filter',
    );
    check(
      request.sorts.map((s) => s.key),
      options.sortable,
      'sort',
    );
    const select = this.state.select;
    const shapeOf = (refs: readonly unknown[]) => (select ? select(...refs) : refs[0]);
    const filters = Object.entries(request.filters);
    const searches = Object.entries(request.searches);
    let query = this as Queryable<S, K, Out, Refs>;
    if (filters.length || searches.length || request.condition) {
      query = query.with({
        where: [
          ...query.state.where,
          (...refs) => {
            const shape = shapeOf(refs);
            return [
              ...filters.map(([key, values]) => {
                const column = resultColumn(shape, key, 'filter');
                return column.in(values.map((text) => parseColumnText(column, text, key)) as never);
              }),
              ...searches.map(([key, text]) => {
                const column = resultColumn(shape, key, 'search');
                if ((column.codec?.kind ?? 'string') !== 'string')
                  throw new Error(`cannot search by '${key}': only text columns can be searched`);
                return (column as Expr<string>).like(text);
              }),
              request.condition && conditionOf(request.condition, shape, options),
            ];
          },
        ],
      });
    }
    if (request.sorts.length) {
      query = query.with({
        orderBy: [
          (...refs) => {
            const shape = shapeOf(refs);
            return request.sorts.map(({ key, descending }) => {
              const column = resultColumn(shape, key, 'sort');
              return descending ? column.desc() : column;
            });
          },
          ...query.state.orderBy,
        ],
      });
    }
    const { page, pageSize: size } = request;
    if (request.total === undefined) return query.toPage(page, size);
    return {
      rows: await query.pageRows(request.total, page, size),
      total: request.total,
      page,
      size,
    };
  }

  /**
   * 按键填充（对应 Java 版的 fillMany）：放在另一条查询的 select 里，把这条查询里 key 等于那一行 from 的行拼成数组。
   * 不需要声明关系：外部表、只按编码关联的表、另一个库（这条查询来自别的 Db）都行。主查询读完后按一批键各查一次，
   * 这条查询的 where、orderBy、select（含嵌套的 toList）照常生效；不能带 limit / offset（那是对整批的，不是每行的）
   * ```ts
   * const logs = logDb.queryable(Log).orderBy((l) => l.at).select((l) => ({ at: l.at, text: l.text }));
   * db.queryable(Order).select((o) => ({ no: o.no, logs: logs.fillMany((l) => l.orderNo, o.no) }))
   * ```
   */
  fillMany<V>(
    key: (...refs: Refs) => Expr<V>,
    from: Expr<NonNullable<V>> | Expr<NonNullable<V> | null>,
  ): Fill<Out> {
    return new Fill(from as Expr<unknown>, (keys) => this.byKeys(key, keys), false);
  }

  /** 按键填充一行（对应 fillOne）：多行时取第一行（按 orderBy），没有时为 null。其余同 fillMany */
  fillOne<V>(
    key: (...refs: Refs) => Expr<V>,
    from: Expr<NonNullable<V>> | Expr<NonNullable<V> | null>,
  ): Fill<Out, true> {
    return new Fill(from as Expr<unknown>, (keys) => this.byKeys(key, keys), true);
  }

  /** 取 key 在 keys 里的行，连同各自的键 */
  private async byKeys(
    key: (...refs: Refs) => Expr<unknown>,
    keys: readonly unknown[],
  ): Promise<(readonly [unknown, Out])[]> {
    if (this.state.limit !== undefined || this.state.offset !== undefined)
      throw new Error(
        'fillMany() / fillOne() cannot use limit() / offset(): they would cut the whole batch, not each row',
      );
    const state = this.state;
    const rows = await new Queryable<S, K, { k: unknown; v: Out }, Refs>(this.ctx, {
      ...state,
      where: [...state.where, (...refs: Refs) => key(...refs).in(keys as never)],
      select: (...refs: Refs) => ({ k: key(...refs), v: shapeOf(state, refs) }),
    }).toList();
    return rows.map((row) => [row.k, row.v] as const);
  }

  /**
   * 按一个输入对象筛选（对应 Java 版的 whereObject + @EasyWhereCondition）：rules 按输入的键写规则，没填的值（undefined、null、空串、空数组）跳过。
   * 与实体列同名的键直接写比较方式；不同名、要比多列（任一满足）或经过导航时写 `{ op, column }`：
   * ```ts
   * db.queryable(Blog).filterBy(form, {
   *   title: 'like',
   *   star: 'eq',
   *   publishTime: { op: 'between', column: (b) => b.publishTime },     // [起, 止]，任一端为空不限
   *   keyword: { op: 'like', column: (b) => [b.title, b.content] },    // 任一列包含
   *   author: { op: 'eq', column: (b) => b.user.name },                // 经过导航
   * })
   * ```
   */
  filterBy<I extends object>(input: I, rules: FilterRules<I, Refs>): Queryable<S, K, Out, Refs> {
    return this.with({
      where: [
        ...this.state.where,
        (...refs) =>
          (Object.entries(rules) as [string, FilterRule<Refs> | undefined][]).map(([key, rule]) => {
            if (!rule) return undefined;
            const spec = typeof rule === 'string' ? { op: rule } : rule;
            const value = (input as Record<string, unknown>)[key];
            if (blankValue(value, spec.allowEmpty)) return undefined;
            const picked =
              'column' in spec && spec.column
                ? spec.column(...(refs as unknown as Refs))
                : refColumn(refs[0] as AnyRef, key);
            if (!picked) throw new Error(`filterBy: '${key}' is not a column; give { op, column }`);
            const columns = Array.isArray(picked) ? picked : [picked];
            return or(...columns.map((c: Expr<unknown>) => compareColumn(c, spec.op, value, key)));
          }),
      ],
    });
  }

  /**
   * 动态排序（对应 Java 版的 orderByObject / ObjectSort）：sort 是 '-amount,name' 或 [{ key, descending }]，
   * 只认 columns 里登记的名字（白名单），其余报错。排在已有的 orderBy 前面
   * ```ts
   * db.queryable(Order).sortBy(query.sort, { amount: (o) => o.amount, customer: (o) => o.customer.name })
   * ```
   */
  sortBy(
    sort: string | readonly { readonly key: string; readonly descending: boolean }[] | undefined,
    columns: Readonly<Record<string, (...refs: Refs) => Expr<unknown>>>,
  ): Queryable<S, K, Out, Refs> {
    const sorts = typeof sort === 'string' ? parseSort(sort) : (sort ?? []);
    if (sorts.length === 0) return this;
    for (const { key } of sorts)
      if (!Object.hasOwn(columns, key))
        throw new Error(`cannot sort by '${key}' (allowed: ${Object.keys(columns).join(', ')})`);
    return this.with({
      orderBy: [
        (...refs) =>
          sorts.map(({ key, descending }) => {
            const e = columns[key]!(...(refs as unknown as Refs));
            return descending ? e.desc() : e;
          }),
        ...this.state.orderBy,
      ],
    });
  }

  /** 整行之外再带上导航：一对多是数组，多对一是对象（可空导航为 null） */
  include<
    X extends Record<
      string,
      ListOf<unknown, boolean> | Fill<unknown, boolean> | AnyRef | Expr<unknown>
    >,
  >(navigations: (...refs: Refs) => X): Queryable<S, K, Out & Selected<X>, Refs> {
    const previous = this.state.select;
    return new Queryable(this.ctx, {
      ...this.state,
      select: (...refs: unknown[]) => ({
        ...spreadShape(previous ? previous(...refs) : refs[0]),
        ...navigations(...(refs as unknown as Refs)),
      }),
    });
  }

  /** 行锁（SELECT … FOR UPDATE），在事务里用 */
  forUpdate(this: Requires<S, 'forUpdate', Queryable<S, K, Out, Refs>>): Queryable<S, K, Out, Refs>;
  forUpdate(): Queryable<S, K, Out, Refs> {
    return this.with({ forUpdate: true });
  }

  /** 拿不到锁立即报错，不在锁上排队（FOR UPDATE NOWAIT）；在事务里用。SQLite 没有行锁，是空操作 */
  forUpdateNoWait(
    this: Requires<S, 'noWait', Queryable<S, K, Out, Refs>>,
  ): Queryable<S, K, Out, Refs>;
  forUpdateNoWait(): Queryable<S, K, Out, Refs> {
    return this.with({ forUpdate: true, lockWait: 'nowait' });
  }

  /** 跳过被别人锁住的行（FOR UPDATE SKIP LOCKED）：多个消费者抢任务，各拿各的。在事务里用 */
  forUpdateSkipLocked(
    this: Requires<S, 'skipLocked', Queryable<S, K, Out, Refs>>,
  ): Queryable<S, K, Out, Refs>;
  forUpdateSkipLocked(): Queryable<S, K, Out, Refs> {
    return this.with({ forUpdate: true, lockWait: 'skip' });
  }

  /** 这条查询不用这些拦截器（按名字，如 'tenant'；名字见 InterceptorNames） */
  noInterceptor(...names: InterceptorName[]): Queryable<S, K, Out, Refs> {
    return this.interceptors({ skip: names });
  }

  /** 这条查询打开这些拦截器（含默认关着的，如只在某些接口生效的数据范围） */
  useInterceptor(...names: InterceptorName[]): Queryable<S, K, Out, Refs> {
    return this.interceptors({ use: names });
  }

  /**
   * 这条查询的拦截器开关（对应 Java 版的 noInterceptor() / useInterceptor()）：`{ skip: 'all' }` 全关（受保护的租户除外），
   * `{ skip: 'all', use: ['tenant'] }` 只留租户。导航上单独开关用 `u.roles.noInterceptor(…)`，join 的表用 join 的第三个参数
   */
  interceptors(toggle: InterceptorToggle): Queryable<S, K, Out, Refs> {
    return new Queryable(
      { ...this.ctx, interceptors: this.ctx.interceptors.configure(toggle) },
      this.state,
    );
  }

  /**
   * 给最近加入的表（主表，或上一个 join 的表）后面追加一段 SQL（对应 Java 版的 asTableSegment）：
   * `.tableHint('WITH (NOLOCK)')`（SQL Server）、`.tableHint('FINAL')`（ClickHouse）、`.tableHint('USE INDEX (idx_time)')`（MySQL）。
   * 片段原样写进 SQL，只能用受信任的文字
   */
  tableHint(hint: string): Queryable<S, K, Out, Refs> {
    const joins = this.state.joins;
    if (joins.length === 0) return this.with({ hint });
    return this.with({ joins: [...joins.slice(0, -1), { ...joins.at(-1)!, hint }] });
  }

  /**
   * 内连接另一张表（INNER JOIN）。on 收到此前所有表引用加上新表引用；之后的 where / orderBy / select 也按这个顺序收到它们。
   * 没写 select 时结果是每张表的整行，按实体名分组：`{ User: Row, Post: Row }`。必须在 select 之前调用。
   * ```ts
   * db.queryable(User).innerJoin(Post, (u, p) => p.userId.eq(u.id)).where((u, p) => p.amount.gt('5')).select((u, p) => ({ name: u.name, title: p.title }))
   * ```
   */
  innerJoin<E extends S['entities'][EntityKey<S>]>(
    entity: E,
    on: (...refs: [...Refs, Ref<S, KeyOf<S, E>>]) => Cond,
    toggle?: InterceptorToggle,
  ): Queryable<
    S,
    K,
    JoinedRows<S, K, Out, Refs, KeyOf<S, E>, false>,
    [...Refs, Ref<S, KeyOf<S, E>>]
  >;
  innerJoin<R>(
    query: Query<R>,
    on: (...refs: [...Refs, SubqueryRef<R>]) => Cond,
  ): Queryable<S, K, JoinedQueryRows<K, Out, Refs, R, false>, [...Refs, SubqueryRef<R>]>;
  innerJoin(target: Entity | Query<unknown>, on: Fn<Cond>, toggle?: InterceptorToggle): never {
    return this.join('inner', target, on, toggle);
  }

  /** 左连接另一张表（LEFT JOIN）：新表在 select 里的列都可空，没匹配到时整行为 null。其余同 innerJoin */
  leftJoin<E extends S['entities'][EntityKey<S>]>(
    entity: E,
    on: (...refs: [...Refs, Ref<S, KeyOf<S, E>, true>]) => Cond,
    toggle?: InterceptorToggle,
  ): Queryable<
    S,
    K,
    JoinedRows<S, K, Out, Refs, KeyOf<S, E>, true>,
    [...Refs, Ref<S, KeyOf<S, E>, true>]
  >;
  leftJoin<R>(
    query: Query<R>,
    on: (...refs: [...Refs, SubqueryRef<R, true>]) => Cond,
  ): Queryable<S, K, JoinedQueryRows<K, Out, Refs, R, true>, [...Refs, SubqueryRef<R, true>]>;
  leftJoin(target: Entity | Query<unknown>, on: Fn<Cond>, toggle?: InterceptorToggle): never {
    return this.join('left', target, on, toggle);
  }

  /**
   * 右连接另一张表（RIGHT JOIN）：新表的行都保留，此前各表没匹配到时整行为 null（它们的列在之后的 lambda 里都可空）。
   * 此前各表的拦截器条件（租户、逻辑删除）放进这个 ON，不会把只有新表的行过滤掉。其余同 innerJoin
   */
  rightJoin<E extends S['entities'][EntityKey<S>]>(
    entity: E,
    on: (...refs: [...NullableRefs<S, Refs>, Ref<S, KeyOf<S, E>>]) => Cond,
    toggle?: InterceptorToggle,
  ): Queryable<
    S,
    K,
    JoinedRows<S, K, Out, Refs, KeyOf<S, E>, false, true>,
    [...NullableRefs<S, Refs>, Ref<S, KeyOf<S, E>>]
  >;
  rightJoin<R>(
    query: Query<R>,
    on: (...refs: [...NullableRefs<S, Refs>, SubqueryRef<R>]) => Cond,
  ): Queryable<
    S,
    K,
    JoinedQueryRows<K, Out, Refs, R, false, true>,
    [...NullableRefs<S, Refs>, SubqueryRef<R>]
  >;
  rightJoin(target: Entity | Query<unknown>, on: Fn<Cond>, toggle?: InterceptorToggle): never {
    return this.join('right', target, on, toggle);
  }

  /** 笛卡尔积（CROSS JOIN）：没有 ON，条件写在 where 里。其余同 innerJoin */
  crossJoin<E extends S['entities'][EntityKey<S>]>(
    entity: E,
    toggle?: InterceptorToggle,
  ): Queryable<
    S,
    K,
    JoinedRows<S, K, Out, Refs, KeyOf<S, E>, false>,
    [...Refs, Ref<S, KeyOf<S, E>>]
  >;
  crossJoin<R>(
    query: Query<R>,
  ): Queryable<S, K, JoinedQueryRows<K, Out, Refs, R, false>, [...Refs, SubqueryRef<R>]>;
  crossJoin(target: Entity | Query<unknown>, toggle?: InterceptorToggle): never {
    return this.join('cross', target, undefined, toggle);
  }

  private join(
    kind: JoinKind,
    target: Entity | Query<unknown>,
    on: Fn<Cond> | undefined,
    toggle: InterceptorToggle | undefined,
  ): never {
    if (this.state.select)
      throw new Error(
        `${kind}Join() must be called before select(): the selected shape is already fixed`,
      );
    const toggles = toggle ? [toggle] : [];
    if (target instanceof Executable) {
      // 子查询当作一张派生表：登记进这条查询的 schema（名字不与已有的重复），没写 select 时整行放在 derived 键下
      const built = target.buildTree();
      assertDerivable(built.shape, `${kind}Join(query)`);
      const entities = this.ctx.schema.entities;
      let n = 0;
      while (`derived${n}` in entities) n++;
      const key = `derived${n}`;
      const derived = makeDerived(key, 'subquery', built.select, built.shape.named, false);
      const schema: AnySchema = {
        entities: { ...entities, [key]: derived },
        relations: { ...this.ctx.schema.relations, [key]: {} },
      };
      return new Queryable(
        { ...this.ctx, schema },
        {
          ...this.state,
          joins: [...this.state.joins, { key, kind, on, toggles, label: 'derived' }],
        },
      ) as never;
    }
    const key = Object.keys(this.ctx.schema.entities).find(
      (k) => this.ctx.schema.entities[k] === target,
    );
    if (key === undefined)
      throw new Error(`entity for table '${target.table}' is not part of the schema`);
    return new Queryable(this.ctx, {
      ...this.state,
      joins: [...this.state.joins, { key, kind, on, toggles }],
    }) as never;
  }

  /** 满足条件的行里该值的和；没有行（或全为 NULL）时为 null。decimal 列得到数值文字，不经过浮点 */
  sum<V extends Numeric | null>(value: (...refs: Refs) => Expr<V>): Promise<NonNullable<V> | null> {
    return this.scalar('sum', value);
  }

  /** 平均值；没有行时为 null。整数列得到 number，decimal 列保持 decimal */
  avg<V extends Numeric | null>(value: (...refs: Refs) => Expr<V>): Promise<NonNullable<V> | null> {
    return this.scalar('avg', value);
  }

  /** 最大值；没有行时为 null */
  max<V>(value: (...refs: Refs) => Expr<V>): Promise<NonNullable<V> | null> {
    return this.scalar('max', value);
  }

  /** 最小值；没有行时为 null */
  min<V>(value: (...refs: Refs) => Expr<V>): Promise<NonNullable<V> | null> {
    return this.scalar('min', value);
  }

  /** 去重后的个数（NULL 不计） */
  async countDistinct(value: (...refs: Refs) => Expr<unknown>): Promise<number> {
    const rows = await this.aggregateQuery((...refs) => ({
      v: aggregate<number>('count', value(...refs), codecs.int, true),
    })).toList();
    return Number(rows[0]?.v ?? 0);
  }

  /**
   * 整个查询折成一个聚合值：沿用 where 与拦截器条件，丢掉 orderBy。
   * limit / offset 作用在聚合之后的单行上没有意义，直接报错，免得悄悄返回错误的数字。
   */
  private async scalar(
    fn: 'sum' | 'avg' | 'max' | 'min',
    value: (...refs: Refs) => Expr<any>,
  ): Promise<any> {
    if (this.state.limit !== undefined || this.state.offset !== undefined) {
      throw new Error(
        `${fn}() cannot be combined with limit() / offset(); aggregate a paged subquery explicitly instead`,
      );
    }
    const rows = await this.aggregateQuery((...refs) => {
      const e = value(...refs);
      return { v: aggregate<unknown>(fn, e, aggregateCodec(fn, e)) };
    }).toList();
    return rows[0]?.v ?? null;
  }

  /** 把 select 换成一个聚合列，并清掉排序 / 分页 / distinct */
  private aggregateQuery<X>(shape: (...refs: Refs) => X): Queryable<S, K, Selected<X>, Refs> {
    return new Queryable(this.ctx, {
      ...this.state,
      select: shape,
      orderBy: [],
      limit: undefined,
      offset: undefined,
      distinct: false,
    });
  }

  /** 分组；不调 select 时结果就是分组键 */
  groupBy<G extends Record<string, Expr<any>>>(
    keys: (...refs: Refs) => G,
  ): GroupedQueryable<S, K, G, Selected<G>, Refs> {
    return new GroupedQueryable(this.ctx, { ...this.state, group: keys as never });
  }
}

/** 分组里的聚合；`g.sum(p => p.amount)`、`g.count(p => p.amount.gt('1000'))` */
export interface Group<
  S extends AnySchema,
  K extends EntityKey<S>,
  G,
  Refs extends readonly unknown[] = [Ref<S, K>],
> {
  readonly key: G;
  /** 不带条件是 COUNT(*)；带条件只数满足的行 */
  count(filter?: (...refs: Refs) => Cond): Expr<number>;
  countDistinct(value: (...refs: Refs) => Expr<unknown>): Expr<number>;
  /**
   * 组里的值拼成一串（对应 Java 版的 joining，GROUP_CONCAT / STRING_AGG）：`g.joining((p) => p.title, { separator: '、', orderBy: (p) => p.id })`
   */
  joining(
    value: (...refs: Refs) => Expr<unknown>,
    options?: JoiningOptions<Refs>,
  ): Expr<string | null>;
  /** rollup / cube 里这一行是不是这个键的小计行：是为 1，否则 0（区分"小计行的 NULL"和"数据本身的 NULL"） */
  grouping(value: (...refs: Refs) => Expr<unknown>): Expr<number>;
  sum<V extends Numeric | null>(value: (...refs: Refs) => Expr<V>): Expr<NonNullable<V> | null>;
  avg<V extends Numeric | null>(value: (...refs: Refs) => Expr<V>): Expr<NonNullable<V> | null>;
  max<V>(value: (...refs: Refs) => Expr<V>): Expr<NonNullable<V> | null>;
  min<V>(value: (...refs: Refs) => Expr<V>): Expr<NonNullable<V> | null>;
}

export class GroupedQueryable<
  S extends AnySchema,
  K extends EntityKey<S>,
  G,
  Out,
  Refs extends readonly unknown[] = [Ref<S, K>],
> extends Executable<Out> {
  protected with(patch: Partial<State>): this {
    return new GroupedQueryable(this.ctx, { ...this.state, ...patch }) as this;
  }

  /**
   * 逐级小计加总计：按 (a, b) 分组时，除了每个 (a, b) 一行，还有每个 a 的小计行（b 为 NULL）和总计行（a、b 都为 NULL）。
   * 键在结果里变成可空；用 `g.grouping(...)` 区分"真的是 NULL"还是"小计行"。MySQL 为 WITH ROLLUP，SQLite 不支持。
   */
  rollup(): GroupedQueryable<S, K, NullableKeys<G>, Selected<NullableKeys<G>>, Refs> {
    return new GroupedQueryable(this.ctx, { ...this.state, groupMode: 'rollup' });
  }

  /** 所有键组合的小计（2 的 n 次方种）。MySQL、SQLite 不支持 */
  cube(): GroupedQueryable<S, K, NullableKeys<G>, Selected<NullableKeys<G>>, Refs> {
    return new GroupedQueryable(this.ctx, { ...this.state, groupMode: 'cube' });
  }

  having(filter: (g: Group<S, K, G, Refs>) => Cond): GroupedQueryable<S, K, G, Out, Refs> {
    return this.with({ having: [...this.state.having, filter] });
  }

  orderBy(order: (g: Group<S, K, G, Refs>) => Orders): GroupedQueryable<S, K, G, Out, Refs> {
    return this.with({ groupOrderBy: [...this.state.groupOrderBy, order] });
  }

  select<X>(shape: (g: Group<S, K, G, Refs>) => X): GroupedQueryable<S, K, G, Selected<X>, Refs> {
    return new GroupedQueryable(this.ctx, { ...this.state, groupSelect: shape });
  }
}

/** 一条查询的结果对应的单实体 schema：外层查询靠它拿到类型化的列 */
export type DerivedSchema<Name extends string, Out> = Schema<
  { [P in Name]: DerivedEntity<Name, Out> },
  { [P in Name]: {} }
>;

/** 子查询里没有列编码的表达式（原生片段等）：原样读 */
const rawCodec: Codec<any> = { kind: 'raw', decode: (v) => v, encode: (v) => v };

/** 把一条查询的输出列变成一个派生实体：列名取 select 的键，列在 SQL 里的名字是子查询的输出别名 */
function makeDerived(
  name: string,
  kind: 'subquery' | 'cte',
  q: SelectNode,
  named: ReadonlyMap<string, { readonly alias: string; readonly codec: Codec<any> | undefined }>,
  recursive: boolean,
): Entity {
  const columns: Record<string, Column<any, boolean, boolean>> = {};
  const columnNames: Record<string, string> = {};
  for (const [key, { alias, codec }] of named) {
    columns[key] = new Column(codec ?? rawCodec, {
      nullable: false,
      primaryKey: false,
      generated: false,
      hasDefault: false,
    });
    columnNames[key] = alias;
  }
  return {
    kind: 'entity',
    name,
    table: kind === 'cte' ? name : '',
    fields: columns,
    columns,
    columnNames,
    primaryKey: [],
    derived: { kind, q, recursive, columns: [...named.values()].map((v) => v.alias) },
  };
}

/** 在一个只含派生实体的 schema 上开始查询 */
function queryOver(ctx: Context, entity: Entity): Queryable<AnySchema, string> {
  const schema: AnySchema = {
    entities: { [entity.name]: entity },
    relations: { [entity.name]: {} },
  };
  return newQueryable({ ...ctx, schema }, entity.name);
}

function assertDerivable(shape: ShapeCompiler, what: string): void {
  if (!shape.flat || shape.named.size === 0) {
    throw new Error(
      `${what} needs a select made of plain expressions (or no select, i.e. whole rows); toList(), nested objects and joined rows cannot become a table`,
    );
  }
}

/**
 * 复合查询 / 递归 CTE 的一个成员：按第一个成员的列名对齐（顺序可以不同），输出别名统一成 c0、c1 …。
 * 成员不能带 orderBy / limit / offset（要的话先 asTable()），否则 SQL 的语义含糊且 SQLite 不允许成员加括号。
 */
function alignMember(built: Built, keys: readonly string[], what: string): SelectNode {
  assertDerivable(built.shape, what);
  const named = built.shape.named;
  if (named.size !== keys.length || keys.some((k) => !named.has(k))) {
    throw new Error(`${what} must select the same columns as the first query: ${keys.join(', ')}`);
  }
  const q = built.select;
  if (q.orderBy.length > 0 || q.limit !== undefined || q.offset !== undefined) {
    throw new Error(`${what} cannot use orderBy / limit / offset; wrap it with asTable() first`);
  }
  return {
    ...q,
    columns: keys.map((k, i) => ({
      e: q.columns.find((c) => c.as === named.get(k)!.alias)!.e,
      as: `c${i}`,
    })),
  };
}

/** 合并两组 CTE，名字相同的只留第一个 */
function mergeCtes(
  a: readonly CteNode[] | undefined,
  b: readonly CteNode[] | undefined,
): CteNode[] | undefined {
  const all = [...(a ?? []), ...(b ?? [])];
  const unique = all.filter((c, i) => all.findIndex((x) => x.name === c.name) === i);
  return unique.length > 0 ? unique : undefined;
}

/** 非递归 CTE：`WITH name AS (query)`，之后的查询把 name 当作一个实体 */
export function cteEntity(query: Query<any>, name: string): Entity {
  const built = query.buildTree();
  assertDerivable(built.shape, `with('${name}')`);
  return makeDerived(name, 'cte', built.select, built.shape.named, false);
}

/**
 * 递归 CTE：`WITH RECURSIVE name AS (anchor UNION [ALL] step)`。step 通过回调拿到 name 对应的实体，
 * 用它构建递归的那一部分；两部分按列名对齐。
 */
export function recursiveCteEntity(
  anchor: Query<any>,
  name: string,
  all: boolean,
  step: (self: Entity) => Query<any>,
): Entity {
  const a = anchor.buildTree();
  assertDerivable(a.shape, `withRecursive('${name}') anchor`);
  const keys = [...a.shape.named.keys()];
  // 先用锚点占位，递归部分要引用这个实体；构建完再换成完整的 anchor UNION step
  const entity = makeDerived(name, 'cte', a.select, a.shape.named, true);
  const b = step(entity).buildTree();
  const member = alignMember(b, keys, `withRecursive('${name}') recursive part`);
  entity.derived!.q = {
    ...alignMember(a, keys, `withRecursive('${name}') anchor`),
    // 递归部分构建时登记的"自己"只是占位，不能当成依赖带出去
    ctes: mergeCtes(
      a.select.ctes,
      b.select.ctes?.filter((c) => c.name !== name),
    ),
    unions: [{ all, q: { ...member, ctes: undefined } }],
  };
  return entity;
}

export function newQueryable<S extends AnySchema, K extends EntityKey<S>>(
  ctx: Context,
  key: K,
): Queryable<S, K> {
  return new Queryable(ctx, {
    key,
    joins: [],
    where: [],
    orderBy: [],
    select: undefined,
    group: undefined,
    having: [],
    groupOrderBy: [],
    groupSelect: undefined,
    limit: undefined,
    offset: undefined,
    distinct: false,
    forUpdate: false,
    lockWait: undefined,
    groupMode: undefined,
  });
}

function spreadShape(shape: unknown): Record<string, unknown> {
  if (shape && typeof shape === 'object' && REF in shape) return refColumns(shape as AnyRef);
  return shape as Record<string, unknown>;
}

function refColumns(ref: AnyRef): Record<string, unknown> {
  return Object.fromEntries(
    Object.keys(ref).map((k) => [k, (ref as unknown as Record<string, unknown>)[k]]),
  );
}

/** 构建结果：语法树 + 读取结果行的形状。导出给 Db.with / withRecursive 内部使用 */
export interface Built {
  readonly select: SelectNode;
  readonly shape: ShapeCompiler;
}

/** 在新的构建现场里求值所有 lambda；bare 为 true 时不求值 select（count / any 用） */
function build(ctx: Context, state: State, bare = false): Built {
  const scope = new Scope(ctx.schema, { n: 0 }, true, ctx.interceptors, 'select');
  // right join 之前的表都可能没匹配到：主表的引用也可空
  const rightJoined = state.joins.some((j) => j.kind === 'right');
  const root = makeRef(scope, state.key, scope.nextAlias(), rightJoined);
  // 所有 lambda 按"主表、第一个 join 的表、……"的顺序收到这些表引用
  const { refs, filters } = joinTables(ctx, scope, root, state.joins);
  const where = [...conds(state.where.map((f) => f(...refs))), ...filters];
  const shape = new ShapeCompiler(ctx);
  let groupBy: Node[] = [];
  let having: Node[] = [];
  let orderBy: OrderNode[] = state.orderBy.flatMap((o) => orderNodes(o(...refs)));

  if (state.group) {
    const keys = state.group(...refs);
    groupBy = Object.values(keys).map((e) => e.node);
    const g = groupHandle(refs, keys);
    having = conds(state.having.map((f) => f(g)));
    orderBy = [...orderBy, ...state.groupOrderBy.flatMap((o) => orderNodes(o(g)))];
    if (!bare) shape.compile(state.groupSelect ? state.groupSelect(g) : keys);
  } else if (!bare) {
    shape.compile(shapeOf(state, refs));
  }

  if (state.reverse) orderBy = orderBy.map((o) => ({ ...o, desc: !o.desc }));

  const entity = ctx.schema.entities[state.key]!;
  const alias = root[REF].alias;
  // 分表：按 where 里分片键上的条件裁剪出要查的表
  const table = entity.sharding
    ? (({ tables, conds }) => shardedFrom(entity, alias, tables, conds))(
        shardTables(entity, where, alias),
      )
    : scope.tableRef(entity, alias);
  const from = pushDown({ ...table, hint: state.hint }, where, scope.joins.length);
  const select: SelectNode = {
    from: from.table,
    joins: scope.joins,
    where: from.where,
    groupBy,
    having,
    orderBy,
    columns: shape.columns,
    distinct: state.distinct,
    limit: state.limit,
    offset: state.offset,
    forUpdate: state.forUpdate,
    lockWait: state.lockWait,
    groupMode: state.group ? state.groupMode : undefined,
    ctes: scope.ctes.size > 0 ? [...scope.ctes.values()] : undefined,
  };
  return { select, shape };
}

/**
 * 派生表条件穿透（对应 Java 版的 SMART_PREDICATE）：外层只对派生表（asTable、union 的结果）加的条件，
 * 换成子查询里的表达式推进子查询的 WHERE，库里先过滤再出派生表。只在结果不变时推：子查询没有分组、去重、分页、union，
 * 条件用到的列在子查询里不是聚合、窗口；外层没有 join；条件里没有子查询
 */
function pushDown(
  table: TableRef,
  where: readonly Node[],
  joins: number,
): { table: TableRef; where: Node[] } {
  const sub = table.sub;
  const simple =
    sub &&
    joins === 0 &&
    sub.groupBy.length === 0 &&
    sub.having.length === 0 &&
    !sub.distinct &&
    sub.limit === undefined &&
    sub.offset === undefined &&
    !sub.unions?.length &&
    // 有窗口函数时先过滤会改变编号、累计值，一条都不能推
    sub.columns.every((c) => pushable(c.e));
  if (!simple) return { table, where: [...where] };
  const columns = new Map(sub.columns.map((c) => [c.as, c.e]));
  const kept: Node[] = [];
  const pushed: Node[] = [];
  // 顶层的 AND 拆开，一个个看能不能推
  const conjuncts = where.flatMap(function flat(n: Node): Node[] {
    return n.k === 'and' ? n.items.flatMap(flat) : [n];
  });
  for (const n of conjuncts) {
    const mapped = mapColumns(n, table.alias, columns);
    if (mapped) pushed.push(mapped);
    else kept.push(n);
  }
  if (pushed.length === 0) return { table, where: kept };
  return { table: { ...table, sub: { ...sub, where: [...sub.where, ...pushed] } }, where: kept };
}

/** 把条件里派生表的列换成子查询里的表达式；遇到推不下去的（聚合、窗口、子查询、别的表）返回 undefined */
function mapColumns(n: Node, alias: string, columns: ReadonlyMap<string, Node>): Node | undefined {
  const all = (items: readonly Node[]): Node[] | undefined => {
    const out: Node[] = [];
    for (const item of items) {
      const m = mapColumns(item, alias, columns);
      if (!m) return undefined;
      out.push(m);
    }
    return out;
  };
  switch (n.k) {
    case 'col': {
      if (n.alias !== alias) return undefined;
      const e = columns.get(n.name);
      return e && pushable(e) ? e : undefined;
    }
    case 'param':
    case 'lit':
      return n;
    case 'raw': {
      const args = all(n.args);
      return args && { ...n, args };
    }
    case 'op': {
      const [l, r] = all([n.l, n.r]) ?? [];
      return l && r && { ...n, l, r };
    }
    case 'and':
    case 'or': {
      const items = all(n.items);
      return items && { ...n, items };
    }
    case 'not':
    case 'null': {
      const e = mapColumns(n.e, alias, columns);
      return e && { ...n, e };
    }
    case 'in': {
      const [e, ...list] = all([n.e, ...n.list]) ?? [];
      return e && { ...n, e, list };
    }
    case 'eq_ns': {
      const [l, r] = all([n.l, n.r]) ?? [];
      return l && r && { ...n, l, r };
    }
    case 'between': {
      const [e, lo, hi] = all([n.e, n.lo, n.hi]) ?? [];
      return e && lo && hi && { ...n, e, lo, hi };
    }
    case 'like': {
      const [e, pattern] = all([n.e, n.pattern]) ?? [];
      return e && pattern && { ...n, e, pattern };
    }
    case 'fn': {
      const args = all(n.args);
      return args && { ...n, args };
    }
    case 'case': {
      const flat = all(n.when.flat());
      const otherwise = n.else ? mapColumns(n.else, alias, columns) : undefined;
      if (!flat || (n.else && !otherwise)) return undefined;
      const when = n.when.map((_, i) => [flat[i * 2]!, flat[i * 2 + 1]!] as const);
      return { ...n, when, else: otherwise };
    }
    default:
      // 聚合、窗口、子查询、字符串聚合：不推
      return undefined;
  }
}

/** 子查询里的表达式能不能放进 WHERE：不含聚合、窗口、字符串聚合 */
function pushable(n: Node): boolean {
  switch (n.k) {
    case 'agg':
    case 'over':
    case 'string_agg':
      return false;
    case 'col':
    case 'param':
    case 'lit':
      return true;
    case 'raw':
      return n.args.every(pushable);
    case 'fn':
      return n.args.every(pushable);
    case 'op':
    case 'eq_ns':
      return pushable(n.l) && pushable(n.r);
    case 'and':
    case 'or':
      return n.items.every(pushable);
    case 'not':
    case 'null':
      return pushable(n.e);
    case 'case':
      return n.when.every(([w, t]) => pushable(w) && pushable(t)) && (!n.else || pushable(n.else));
    default:
      return false;
  }
}

function conds(list: Cond[]): Node[] {
  return list.map(condNode).filter((n): n is Node => n !== undefined);
}

/**
 * 把显式 join 的表加进语句，返回所有表引用（主表在前）与要放进 WHERE 的拦截器条件。
 * ON 条件收到此前所有表引用加上新表引用；拦截器给新表的条件也放进 ON，LEFT JOIN 不会因此丢掉主表的行。
 * 主表与 cross join 的表的拦截器条件本该在 WHERE；但遇到 right join 时改放进它的 ON，只有右表的行才不会被过滤掉。
 */
function joinTables(
  ctx: Context,
  scope: Scope,
  root: AnyRef,
  joins: readonly JoinSpec[],
): { refs: AnyRef[]; filters: Node[] } {
  const refs = [root];
  let pending = scope.filters(root);
  const lastRight = joins.findLastIndex((j) => j.kind === 'right');
  joins.forEach((spec, i) => {
    const target = ctx.schema.entities[spec.key]!;
    const alias = scope.nextAlias();
    const ref = makeRef(scope, spec.key, alias, spec.kind === 'left' || i < lastRight);
    refs.push(ref);
    if (!spec.on) {
      scope.joins.push({
        ...scope.tableRef(target, alias),
        hint: spec.hint,
        kind: spec.kind,
        on: undefined,
      });
      pending = [...pending, ...scope.filters(ref, spec.toggles)];
      return;
    }
    // 先登记再求值 ON：ON 里用导航产生的隐式 join 会排在它后面，引用到的别名已经声明
    const index =
      scope.joins.push({
        ...scope.tableRef(target, alias),
        kind: spec.kind,
        on: { k: 'lit', sql: '1 = 1' },
      }) - 1;
    const on = condNode(spec.on(...refs));
    if (!on) throw new Error(`${spec.kind}Join(${target.table}) needs an ON condition`);
    const extra = scope.filters(ref, spec.toggles);
    if (spec.kind === 'right') {
      extra.push(...pending);
      pending = [];
    }
    scope.joins[index] = {
      ...scope.tableRef(target, alias),
      hint: spec.hint,
      kind: spec.kind,
      on: extra.length === 0 ? on : { k: 'and', items: [on, ...extra] },
    };
  });
  return { refs, filters: pending };
}

/** select 的形状；没写 select 时是主表的整行，join 之后是各表的整行 */
function shapeOf(state: State, refs: readonly unknown[]): unknown {
  if (state.select) return state.select(...refs);
  return state.joins.length === 0 ? refs[0] : joinedRows(state, refs as readonly AnyRef[]);
}

/** 没写 select 的 join 查询：每张表的整行，按实体名分组；left join 的那张表没匹配时为 null */
function joinedRows(state: State, refs: readonly AnyRef[]): Record<string, AnyRef> {
  const keys = [state.key, ...state.joins.map((j) => j.label ?? j.key)];
  if (new Set(keys).size !== keys.length) {
    throw new Error(
      'the same entity is joined more than once; call select() to name the columns you want',
    );
  }
  return Object.fromEntries(keys.map((k, i) => [k, refs[i]!]));
}

function groupHandle(refs: readonly AnyRef[], key: unknown): Group<any, any, unknown, any> {
  const agg = (fn: 'sum' | 'avg' | 'max' | 'min') => (value: (...refs: any[]) => Expr<unknown>) => {
    const e = value(...refs);
    return aggregate<any>(fn, e, aggregateCodec(fn, e));
  };
  return {
    key,
    count: (filter) => {
      const n = filter ? condNode(filter(...(refs as never[]))) : undefined;
      if (!n) return aggregate<number>('count', undefined, codecs.int);
      return new Expr<number>(
        {
          k: 'agg',
          fn: 'count',
          arg: { k: 'case', when: [[n, { k: 'lit', sql: '1' }]], else: undefined },
          distinct: false,
        },
        codecs.int,
      );
    },
    countDistinct: (value) =>
      aggregate<number>('count', value(...(refs as never[])), codecs.int, true),
    joining: (value, options) =>
      joiningExpr(
        value(...(refs as never[])),
        options?.separator,
        options?.orderBy ? orderNodes(options.orderBy(...(refs as never[]))) : [],
        options?.distinct,
      ),
    grouping: (value) =>
      new Expr<number>(
        { k: 'fn', name: 'grouping', args: [value(...(refs as never[])).node] },
        codecs.int,
      ),
    sum: agg('sum'),
    avg: agg('avg'),
    max: agg('max'),
    min: agg('min'),
  };
}

type Reader = (row: Record<string, unknown>) => unknown;

/** toList 等待第二条查询填充的数组：父行的键 → 这些父行上的数组 */
interface PendingList {
  readonly list: ListOf<unknown, boolean>;
  /** 父行的关联键（复合外键是多列，id 是各列拼成的文字）→ 这些父行上的数组 */
  readonly slots: Map<string, { readonly keys: readonly unknown[]; readonly arrays: unknown[][] }>;
}

/** fillMany / fillOne 等待填充的数组：键 → 这些行上的数组 */
interface PendingFill {
  readonly fill: Fill<unknown, boolean>;
  readonly slots: Map<string, { readonly keys: readonly unknown[]; readonly arrays: unknown[][] }>;
}

/** 把 select 形状拆成扁平的列，同时生成按行重组对象的读取函数 */
class ShapeCompiler {
  readonly columns: { e: Node; as: string }[] = [];
  readonly lists: PendingList[] = [];
  /** fillMany / fillOne 等着按键填充的数组 */
  readonly fills: PendingFill[] = [];
  /** first() 的数组在第二条查询填完后换成第一项或 null */
  readonly fixups: (() => void)[] = [];
  read: Reader = () => undefined;
  /** 顶层 select 形状里"列名 → 输出别名与解码"，派生表（子查询 / CTE / union）靠它给外层查询提供列 */
  readonly named = new Map<
    string,
    { readonly alias: string; readonly codec: Codec<any> | undefined }
  >();
  /** 顶层形状是不是只由表达式（或一整行）组成；含 toList、嵌套对象的形状没法当成一张表 */
  flat = true;
  private root: unknown;
  private readonly ctx: Context;

  constructor(ctx: Context) {
    this.ctx = ctx;
  }

  compile(shape: unknown): void {
    if (shape instanceof ListOf && shape.single)
      throw new TypeError('first() must be a property of a select object');
    this.root = shape;
    this.read = this.reader(shape);
  }

  /** 不出现在结果里、只给拼装用的列 */
  hidden(e: Node): string {
    const as = `k${this.columns.length}`;
    this.columns.push({ e, as });
    return as;
  }

  private reader(x: unknown): Reader {
    if (x instanceof Expr) return this.expr(x);
    if (x instanceof ListOf) return this.list(x);
    if (x instanceof Fill) return this.fill(x);
    if (x && typeof x === 'object' && REF in x) return this.ref(x as AnyRef);
    if (Array.isArray(x) || x === null || typeof x !== 'object') {
      throw new TypeError(
        `select values must be expressions, navigations, toList() or nested objects; got ${Array.isArray(x) ? 'an array' : String(x)}`,
      );
    }
    const isRoot = x === this.root;
    const entries = Object.entries(x).map(([k, v]) => {
      const read = this.reader(v);
      if (isRoot) {
        if (v instanceof Expr)
          this.named.set(k, { alias: this.columns.at(-1)!.as, codec: v.codec });
        else this.flat = false;
      }
      return [k, read, (v instanceof ListOf || v instanceof Fill) && v.single] as const;
    });
    return (row) => {
      const obj: Record<string, unknown> = {};
      for (const [k, read, single] of entries) {
        obj[k] = read(row);
        if (single)
          this.fixups.push(() => {
            obj[k] = (obj[k] as unknown[])[0] ?? null;
          });
      }
      return obj;
    };
  }

  private expr(e: Expr<unknown>): Reader {
    const as = `c${this.columns.length}`;
    this.columns.push({ e: e.node, as });
    return decoder(as, e.codec);
  }

  /** 导航到的整行；可空导航在主键（无主键时所有列）都为 NULL 时整体为 null */
  private ref(ref: AnyRef): Reader {
    const info = ref[REF];
    const entity = this.ctx.schema.entities[info.key]!;
    const props = Object.keys(entity.columns);
    const isRoot = ref === this.root;
    const readers = props.map((p) => {
      const e = refColumn(ref, p);
      const read = this.expr(e);
      // 值对象的列（'address.city'）没法当成派生表的一列
      if (isRoot && p.includes('.')) this.flat = false;
      else if (isRoot) this.named.set(p, { alias: this.columns.at(-1)!.as, codec: e.codec });
      return [p, read] as const;
    });
    const probe = entity.primaryKey.length > 0 ? entity.primaryKey : props;
    return (row) => {
      const values = new Map(readers.map(([p, read]) => [p, read(row)]));
      if (info.nullable && probe.every((p) => values.get(p) === null)) return null;
      const obj: Record<string, unknown> = {};
      for (const [p, value] of values) setPath(obj, p, value);
      return obj;
    };
  }

  private fill(fill: Fill<unknown, boolean>): Reader {
    const as = this.hidden(fill.from.node);
    const pending: PendingFill = { fill, slots: new Map() };
    this.fills.push(pending);
    return (row) => {
      const array: unknown[] = [];
      const raw = row[as];
      // 键为 NULL 或空串的行填不到任何东西
      if (present(raw)) {
        const key = fill.from.codec ? fill.from.codec.decode(raw) : raw;
        const id = slotId([key]);
        let slot = pending.slots.get(id);
        if (!slot) pending.slots.set(id, (slot = { keys: [key], arrays: [] }));
        slot.arrays.push(array);
      }
      return array;
    };
  }

  private list(list: ListOf<unknown, boolean>): Reader {
    // 父行上关联键的每一列都要带出来（复合外键有多列）
    const keyAs = list.many.relation.from.map((c) =>
      this.hidden(columnNode(list.many.scope, list.many.parent[REF], c)),
    );
    const pending: PendingList = { list, slots: new Map() };
    this.lists.push(pending);
    return (row) => {
      const array: unknown[] = [];
      const keys = keyAs.map((as) => row[as]);
      // 关联键里有 NULL 或空串的父行不会有孩子，不去查
      if (keys.every(present)) {
        const id = slotId(keys);
        let slot = pending.slots.get(id);
        if (!slot) pending.slots.set(id, (slot = { keys, arrays: [] }));
        slot.arrays.push(array);
      }
      return array;
    };
  }
}

/** 关联键有值：不是 NULL，也不是空串、全空白（"没填"的外键常写成空串） */
function present(key: unknown): boolean {
  if (key === null || key === undefined) return false;
  return typeof key !== 'string' || key.trim() !== '';
}

/** 关联键 → Map 的键：各列转成文字再用不会出现在数据里的分隔符拼起来 */
function slotId(keys: readonly unknown[]): string {
  return keys.map(String).join('\u0001');
}

function decoder(as: string, codec: Codec<any> | undefined): Reader {
  return (row) => {
    const raw = row[as];
    if (raw === null || raw === undefined) return null;
    return codec ? codec.decode(raw) : raw;
  };
}

/**
 * 预编译好的查询（ROADMAP 18.3.2）：SQL 只渲染一次，每次执行只换参数。由 db.prepare 得到：
 * ```ts
 * const byName = db.prepare((p: { name: string }) => db.queryable(User).where((u) => u.name.eq(p.name)).select((u) => u.id))
 * await byName.toList({ name: 'alice' })
 * ```
 * 占位值只能当标量用（条件、set 里的值），不能参与构建时的判断或展开成 in 列表；要带出 toList 导航、fill 的查询不能预编译
 */
export class PreparedQuery<P, Out> {
  /** 渲染好的 SQL */
  readonly sql: string;
  private readonly ctx: Context;
  private readonly params: readonly unknown[];
  private readonly read: (row: Record<string, unknown>) => unknown;

  constructor(ctx: Context, state: State) {
    const built = build(ctx, state);
    if (built.shape.lists.length > 0 || built.shape.fills.length > 0)
      throw new Error(
        'prepare() cannot be used with toList() navigations or fills (they run more queries)',
      );
    const statement = render(ctx, built.select);
    this.ctx = ctx;
    this.sql = statement.sql;
    this.params = statement.params;
    this.read = built.shape.read;
  }

  async toList(values: P): Promise<Out[]> {
    const params = this.params.map((p) => (p instanceof PreparedParam ? this.value(p, values) : p));
    const rows = await query(this.ctx, { sql: this.sql, params });
    return rows.map(this.read) as Out[];
  }

  /** 第一行；没有时 undefined（查询自己要带 limit） */
  async first(values: P): Promise<Out | undefined> {
    return (await this.toList(values))[0];
  }

  private value(param: PreparedParam, values: P): unknown {
    const { name, transform } = param.placeholder;
    const given = (values as Record<string, unknown>)[name];
    if (given === undefined) throw new Error(`prepared query: no value for '${name}'`);
    const value = given === null || !transform ? given : transform(given);
    if (value === null) return null;
    return this.ctx.dialect.encodeParam(param.codec ? param.codec.encode(value as never) : value);
  }
}

/** db.prepare 的实现：用占位值跑一遍构建函数，拿到查询再预编译 */
export function prepareQuery<P, Out>(make: (p: P) => Query<Out>): PreparedQuery<P, Out> {
  const query = make(placeholders<P>()) as unknown as { ctx: Context; state: State };
  if (!(query.state && query.ctx))
    throw new Error('prepare() expects the callback to return db.queryable(…) …');
  return new PreparedQuery(query.ctx, query.state);
}

function render(ctx: Context, select: SelectNode): Statement {
  checkAliases(select);
  const w = new SqlWriter();
  const sql = ctx.dialect.select(select, w);
  return { sql, params: w.params };
}

async function run(ctx: Context, select: SelectNode, shape: ShapeCompiler): Promise<unknown[]> {
  const rows = await query(ctx, render(ctx, select));
  const out = rows.map(shape.read);
  await complete(ctx, shape);
  return out;
}

/** 读完一批行之后：填 toList 的数组与 fill 的值，再把 first() / fillOne 的数组换成一项 */
async function complete(ctx: Context, shape: ShapeCompiler): Promise<void> {
  await fillLists(ctx, shape.lists);
  for (const { fill, slots } of shape.fills) {
    const all = [...slots.values()];
    for (let i = 0; i < all.length; i += IN_CHUNK) {
      const keys = all.slice(i, i + IN_CHUNK).map((slot) => slot.keys[0]);
      for (const [key, row] of await fill.fetch(keys))
        for (const array of slots.get(slotId([key]))?.arrays ?? []) array.push(row);
    }
  }
  shape.fixups.forEach((f) => f());
}

/** 一次 IN 查询带的键个数上限 */
const IN_CHUNK = 500;

async function fillLists(ctx: Context, lists: readonly PendingList[]): Promise<void> {
  for (const pending of lists) {
    if (pending.slots.size === 0) continue;
    const many = pending.list.many;
    // 与父查询共用别名计数：filters 里误用父查询的导航时别名对不上，checkAliases 能报出来
    // CTE 单独统计：第二条查询是独立的语句，只带它自己用到的 WITH
    const scope = many.scope.detached(many.toggles);
    const root = scope.root(many.relation.target);
    const { where, orderBy } = many.rebuild(root);
    where.push(...scope.filters(root));
    const shape = new ShapeCompiler(ctx);
    shape.compile(pending.list.shape ? pending.list.shape(root) : root);
    // 孩子一侧的关联列（多对多时已经把中间表 join 进 scope）
    const toNodes = linkColumns(scope, many.relation, root);
    const keyAs = toNodes.map((n) => shape.hidden(n));
    const target = ctx.schema.entities[many.relation.target]!;
    const slots = [...pending.slots.values()];
    // 参数个数 = 键个数 × 列数，复合外键时每块少放一些
    const chunk = Math.max(1, Math.floor(IN_CHUNK / toNodes.length));
    for (let i = 0; i < slots.length; i += chunk) {
      const select: SelectNode = {
        from: scope.tableRef(target, root[REF].alias),
        ctes: scope.ctes.size > 0 ? [...scope.ctes.values()] : undefined,
        joins: scope.joins,
        where: [
          matchKeys(
            toNodes,
            slots.slice(i, i + chunk).map((s) => s.keys),
          ),
          ...where,
        ],
        groupBy: [],
        having: [],
        orderBy,
        columns: shape.columns,
        distinct: false,
        limit: undefined,
        offset: undefined,
        forUpdate: false,
      };
      for (const row of await query(
        ctx,
        render(ctx, many.take === undefined ? select : perParent(select, toNodes, many.take)),
      )) {
        const item = shape.read(row);
        for (const array of pending.slots.get(slotId(keyAs.map((as) => row[as])))?.arrays ?? [])
          array.push(item);
      }
    }
    await complete(ctx, shape);
  }
}

/**
 * 孩子的关联列等于其中某组父键：单列用 IN；复合外键写成 (a = ? AND b = ?) OR …（行值 IN 各库支持不一，这样处处可用）。
 */
function matchKeys(columns: readonly Node[], keys: readonly (readonly unknown[])[]): Node {
  const param = (value: unknown): Node => ({ k: 'param', value, codec: undefined });
  if (columns.length === 1)
    return { k: 'in', e: columns[0]!, list: keys.map((key) => param(key[0])), not: false };
  const one = (key: readonly unknown[]): Node => ({
    k: 'and',
    items: columns.map((l, i): Node => ({ k: 'op', op: '=', l, r: param(key[i]) })),
  });
  return { k: 'or', items: keys.map(one) };
}

/**
 * 每个父行只取前 take 条：内层按关联列分区编号，外层只留编号 <= take 的行。
 * SELECT eq_w.c0, … FROM (SELECT …, ROW_NUMBER() OVER (PARTITION BY 关联列 ORDER BY …) AS eq_rn FROM … WHERE …) eq_w WHERE eq_w.eq_rn <= take
 */
function perParent(select: SelectNode, keys: readonly Node[], take: number): SelectNode {
  const rn: Node = {
    k: 'over',
    fn: { k: 'lit', sql: 'ROW_NUMBER()' },
    partition: keys,
    order: select.orderBy,
    frame: undefined,
  };
  const inner: SelectNode = {
    ...select,
    orderBy: [],
    columns: [...select.columns, { e: rn, as: 'eq_rn' }],
  };
  const col = (name: string): Node => ({ k: 'col', alias: 'eq_w', name });
  return {
    from: { table: '', alias: 'eq_w', sub: inner },
    joins: [],
    where: [{ k: 'op', op: '<=', l: col('eq_rn'), r: { k: 'lit', sql: String(take) } }],
    groupBy: [],
    having: [],
    orderBy: [{ e: col('eq_rn'), desc: false }],
    columns: select.columns.map((c) => ({ e: col(c.as), as: c.as })),
    distinct: false,
    limit: undefined,
    offset: undefined,
    forUpdate: false,
  };
}
