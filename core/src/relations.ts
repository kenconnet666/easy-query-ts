/**
 * 实体之间的关系（导航）。与实体分开定义：A 引用 B、B 又引用 A 时，写在实体的初始化里会让 TS 循环推导报错。
 *
 * ```ts
 * export const schema = defineSchema({ Company, User, Post, Role, UserRole }, {
 *   User: r => ({
 *     company: r.one('Company', { from: 'companyId', to: 'id' }),   // companyId 可空 → u.company.* 可空
 *     posts: r.many('Post', { from: 'id', to: 'userId' }),
 *     roles: r.manyToMany('Role', { through: 'UserRole', throughFrom: 'userId', throughTo: 'roleId' }),   // 经中间表
 *   }),
 *   Post: r => ({ user: r.one('User', { from: 'userId', to: 'id' }) }),
 * })
 * ```
 * 复合外键把 from / to 写成列的数组：`{ from: ['tenantId', 'userId'], to: ['tenantId', 'id'] }`，两边个数必须相同。
 */
import type { Cond, Expr } from './expr.ts';
import type { InterceptorToggle } from './interceptor.ts';
import type { ColumnRefs, Ref } from './ref.ts';
import type { Column, Embedded, Entity } from './schema.ts';

/** 关系上固定的条件（对应 Java 版导航的 extraFilter）：拿到目标表各列的表达式，返回条件；每次用到这个导航都带上 */
export type RelationFilter<E extends Entity = Entity> = (target: ColumnRefs<E['fields']>) => Cond;

/** 多对一 / 一对一：from 是本表的列，to 是目标表的列（按位置一一对应）。N 为 true 时目标可能不存在，导航出来的列都可空 */
export interface One<T extends string = string, N extends boolean = boolean> {
  readonly kind: 'one';
  readonly target: T;
  readonly from: readonly string[];
  readonly to: readonly string[];
  readonly nullable: N;
  /** 固定的条件：写进 JOIN 的 ON，不满足时导航为空 */
  readonly where?: RelationFilter;
  /** 直达关系（pathOne）：沿着这几段导航走到目标 */
  readonly path?: readonly string[];
  /** 任意条件的关系（oneOn）：条件写进 JOIN 的 ON */
  readonly on?: RelationOn;
  /** 目标一定存在（对应 Java 版的 @Navigate(required = true)）：渲染成 INNER JOIN，列不可空 */
  readonly required?: boolean;
  /** 用到这个导航时对目标表的拦截器开关（如 `{ skip: ['softDelete'] }`：已删除的公司也要显示名字） */
  readonly interceptors?: InterceptorToggle;
  /** oneOn / manyOn 的本表（条件要拿本表的列） */
  readonly source?: string;
}

/** 多对多经过的中间表：from 列引用本表，to 列引用目标表（都是中间表上的列） */
export interface Through {
  /** 中间表实体在 schema 里的键 */
  readonly entity: string;
  readonly from: readonly string[];
  readonly to: readonly string[];
}

/**
 * 一对多：目标表里 to 列等于本表 from 列的行；多对多时 from / to 是本表与目标表上的列（默认各自的主键），
 * 再经 through 的中间表把两边连起来。
 */
export interface Many<T extends string = string> {
  readonly kind: 'many';
  readonly target: T;
  readonly from: readonly string[];
  readonly to: readonly string[];
  readonly through?: Through;
  /** 固定的条件：any / count / toList 等每次用到这个导航都带上 */
  readonly where?: RelationFilter;
  /** 直达关系（path）：沿着这几段导航走到目标 */
  readonly path?: readonly string[];
  /** 直达关系的各段（定义 schema 时按 path 找到） */
  readonly hops?: readonly Relation[];
  /** 任意条件的关系（manyOn）：from 是本表的主键，子查询里再连一份本表、按条件关联 */
  readonly on?: RelationOn;
  /** 用到这个导航时对目标表的拦截器开关（子查询、toList、分组 join 都带上） */
  readonly interceptors?: InterceptorToggle;
  /** oneOn / manyOn 的本表（条件要拿本表的列） */
  readonly source?: string;
}

/** 定义关系时的选项：固定的条件、对目标表的拦截器开关 */
export interface RelationOptions<Target extends Entity = Entity> {
  /** 固定的条件（对应 Java 版导航的 extraFilter）：每次用到这个导航都带上 */
  readonly where?: RelationFilter<Target>;
  /** 对目标表的拦截器开关，如 `{ skip: ['softDelete'] }` */
  readonly interceptors?: InterceptorToggle;
}

/** 任意条件的关系的条件：拿到本表与目标表各列的表达式 */
export type RelationOn<Self extends Entity = Entity, Target extends Entity = Entity> = (
  self: ColumnRefs<Self['fields']>,
  target: ColumnRefs<Target['fields']>,
) => Cond;

/** 计算属性（defineComputed）：由本表引用算出的表达式，查询里像一列一样用 */
export interface Computed<V = unknown> {
  readonly kind: 'computed';
  readonly value: (ref: any) => Expr<V>;
}

export type Relation = One | Many;

/** schema 关系表里的一项：导航，或计算属性 */
export type Member = Relation | Computed;

/** 能当关联列的列名（值对象不能整个当关联列） */
type ColumnKey<E extends Entity> = {
  [K in keyof E['fields']]: E['fields'][K] extends Embedded<any> ? never : K;
}[keyof E['fields']] &
  string;
/** 一个列名，或复合外键的列名数组 */
type OneOrMany<K extends string> = K | readonly K[];
/** 任何一个 from 列可空，导航的目标就可能不存在 */
type AnyNullable<E extends Entity, F extends string> = true extends {
  [K in F]: E['fields'][K] extends Column<any, infer N, any> ? N : never;
}[F]
  ? true
  : false;

/** 给某个实体定义关系时拿到的帮助对象：from 只能是本实体的列，to 只能是目标实体的列 */
export interface RelationBuilder<E extends Record<string, Entity>, S extends keyof E> {
  /**
   * 多对一 / 一对一。from 列可空时目标可空；from 列非空但目标仍可能不存在（例如从主键指向对方的外键）时传 `{ optional: true }`。
   * 复合外键：from / to 写成数组。
   */
  one<
    T extends keyof E & string,
    F extends ColumnKey<E[S]>,
    O extends boolean = false,
    Req extends boolean = false,
  >(
    target: T,
    on: { from: OneOrMany<F>; to: OneOrMany<ColumnKey<E[T]>> },
    options?: RelationOptions<E[T]> & { optional?: O; required?: Req },
  ): One<T, Req extends true ? false : O extends true ? true : AnyNullable<E[S], F>>;
  /** 一对多；options.where 是固定的条件（例如只算有效的子项：`{ where: (p) => p.deleted.eq(false) }`） */
  many<T extends keyof E & string>(
    target: T,
    on: { from: OneOrMany<ColumnKey<E[S]>>; to: OneOrMany<ColumnKey<E[T]>> },
    options?: RelationOptions<E[T]>,
  ): Many<T>;
  /**
   * 多对多：经中间表 through 连接两边。throughFrom 是中间表上引用本表的列，throughTo 是引用目标表的列；
   * from / to 是本表与目标表上被引用的列，省略时用各自的主键。中间表的实体也要在 schema 里。
   */
  manyToMany<T extends keyof E & string, M extends keyof E & string>(
    target: T,
    on: {
      through: M;
      throughFrom: OneOrMany<ColumnKey<E[M]>>;
      throughTo: OneOrMany<ColumnKey<E[M]>>;
      from?: OneOrMany<ColumnKey<E[S]>>;
      to?: OneOrMany<ColumnKey<E[T]>>;
    },
    options?: RelationOptions<E[T]>,
  ): Many<T>;
  /**
   * 跨导航的直达关系（对应 Java 版的 directMapping）：沿着已经定义的导航走到 target。
   * 例如用户经角色到菜单 `menus: r.path('Menu', ['roles', 'menus'])`，之后 `u.menus.any(…)`、`count()`、`toList()` 与普通一对多一样用；
   * 同一个目标经几条路径到达也只算一次。各段导航上的固定条件、拦截器照常生效；导航名与终点在定义 schema 时核对
   */
  path<T extends keyof E & string>(
    target: T,
    navigations: readonly [string, string, ...string[]],
  ): Many<T>;
  /** 每一段都是多对一 / 一对一的直达关系：`city: r.pathOne('City', ['company', 'city'])`，等同于写 `u.company.city`，目标可空 */
  pathOne<T extends keyof E & string>(
    target: T,
    navigations: readonly [string, string, ...string[]],
  ): One<T, true>;
  /**
   * 按任意条件的一对多 / 多对多（对应 Java 版的自定义关联：逗号分隔列、路径左匹配、无中间表）：
   * `books: r.manyOn('Book', (u, b) => b.id.inCsv(u.bookIds))`、`children: r.manyOn('Dept', (d, c) => c.path.startsWith(d.path))`。
   * any / count / toList / groupJoin 都能用；本表要有主键（toList 按它把子项分到各行）
   */
  manyOn<T extends keyof E & string>(
    target: T,
    on: RelationOn<E[S], E[T]>,
    options?: RelationOptions<E[T]>,
  ): Many<T>;
  /** 按任意条件的多对一 / 一对一：条件写进 LEFT JOIN 的 ON，目标可空 */
  oneOn<T extends keyof E & string>(
    target: T,
    on: RelationOn<E[S], E[T]>,
    options?: RelationOptions<E[T]>,
  ): One<T, true>;
}

/** 实体与关系的整体；查询从这里取导航 */
export interface Schema<
  E extends Record<string, Entity> = Record<string, Entity>,
  R = Record<string, Record<string, Relation>>,
> {
  readonly entities: E;
  readonly relations: R;
}

export type AnySchema = Schema<Record<string, Entity>, Record<string, Record<string, Member>>>;
export type EntityKey<S extends AnySchema> = keyof S['entities'] & string;

/** 表达式的值类型 */
type ExprValue<X> = X extends Expr<infer V> ? V : never;

/** 加上计算属性之后的 schema */
export type WithComputed<
  S extends AnySchema,
  K extends EntityKey<S>,
  C extends Record<string, Expr<unknown>>,
> = Schema<
  S['entities'],
  Omit<S['relations'], K> & {
    [Q in K]: S['relations'][K] & { [P in keyof C]: Computed<ExprValue<C[P]>> };
  }
>;

/**
 * 计算属性（对应 Java 版的数据库计算属性：组合、状态、跨表，prop/*）：在 schema 定义好之后给实体加，
 * 之后在 where / orderBy / select / groupBy / table() 里都像一列一样用 `u.fullName`，类型自动推出：
 * ```ts
 * export const schema = defineComputed(base, 'User', {
 *   fullName: (u) => text\`\${u.first} \${u.last}\`,
 *   status: (u) => caseWhen(u.deletedAt.isNotNull(), '已注销').else('正常'),
 *   postCount: (u) => u.posts.count(),          // 跨表
 * })
 * ```
 * 计算属性不进整行（每行多算一遍、可能多一条子查询），要带出时写进 select 或 include。在 JS 里算的（内存计算属性）用视图或拿到行后再算
 */
export function defineComputed<
  S extends AnySchema,
  K extends EntityKey<S>,
  C extends Record<string, Expr<unknown>>,
>(
  schema: S,
  key: K,
  computed: { [P in keyof C]: (ref: Ref<S, K>) => C[P] },
): WithComputed<S, K, C> {
  const entity = schema.entities[key];
  if (!entity) throw new Error(`defineComputed: entity '${key}' is not part of the schema`);
  const own = schema.relations[key] ?? {};
  const added: Record<string, Computed> = {};
  for (const [name, value] of Object.entries(computed) as [
    string,
    (ref: unknown) => Expr<unknown>,
  ][]) {
    if (name in entity.fields || name in own)
      throw new Error(`defineComputed: ${key}.${name} has the same name as a column or navigation`);
    added[name] = { kind: 'computed', value };
  }
  return {
    entities: schema.entities,
    relations: { ...schema.relations, [key]: { ...own, ...added } },
  } as never;
}

/** 没定义关系的实体补成 {} */
type ResolvedRelations<E extends Record<string, Entity>, R> = {
  [K in keyof E]: K extends keyof R ? R[K] : {};
};

/**
 * 汇总实体与关系。relations 的每个函数拿到本实体专用的 RelationBuilder；关系类型从返回值反推（反向映射类型推导），不用手写。
 */
export function defineSchema<
  const E extends Record<string, Entity>,
  R extends { [S in keyof E]?: Record<string, Relation> } = {},
>(
  entities: E,
  relations?: { [S in keyof R]: (r: RelationBuilder<E, S & keyof E>) => R[S] },
): Schema<E, ResolvedRelations<E, R>> {
  const defined: Record<string, Record<string, Relation>> = {};
  for (const key of Object.keys(entities)) {
    const define = (
      relations as
        | Record<string, ((r: RelationBuilder<E, string>) => Record<string, Relation>) | undefined>
        | undefined
    )?.[key];
    defined[key] = define ? define(builderFor(entities, key)) : {};
  }
  // 直达关系要引用别的实体的导航：全部定义完再按名字找
  const resolved: Record<string, Record<string, Relation>> = {};
  for (const [key, own] of Object.entries(defined)) {
    const relationsOfKey: Record<string, Relation> = {};
    for (const [name, rel] of Object.entries(own)) {
      const relation = rel.path ? resolvePath(defined, key, name, rel) : rel;
      check(entities, key, name, relation);
      relationsOfKey[name] = relation;
    }
    resolved[key] = relationsOfKey;
  }
  return { entities, relations: resolved as ResolvedRelations<E, R> };
}

/** 直达关系：按导航名一段段走到终点，核对终点与种类，补上 from / to 与各段 */
function resolvePath(
  relations: Record<string, Record<string, Relation>>,
  key: string,
  name: string,
  rel: Relation,
): Relation {
  const where = `relation ${key}.${name}`;
  const hops: Relation[] = [];
  let current = key;
  for (const hop of rel.path!) {
    const next = relations[current]?.[hop];
    if (!next) throw new Error(`${where}: ${current} has no navigation '${hop}'`);
    if (next.path)
      throw new Error(`${where}: '${hop}' is itself a path; list its navigations instead`);
    if (next.on)
      throw new Error(
        `${where}: '${hop}' is a manyOn / oneOn relation and cannot be part of a path`,
      );
    hops.push(next);
    current = next.target;
  }
  if (current !== rel.target)
    throw new Error(`${where}: the path ends at ${current}, not ${rel.target}`);
  const toMany = hops.some((hop) => hop.kind === 'many');
  if (rel.kind === 'one' && toMany)
    throw new Error(`${where}: the path passes a one-to-many navigation; use r.path`);
  if (rel.kind === 'many' && !toMany)
    throw new Error(`${where}: every step is many-to-one; use r.pathOne`);
  const first = hops[0]!;
  const last = hops.at(-1)!;
  if (rel.kind === 'one') return { ...rel, from: first.from, to: last.to };
  // 最后一段的固定条件作用在目标上，交给一对多导航的通用逻辑；中间各段的在桥里
  return {
    ...rel,
    from: first.from,
    to: last.to,
    hops,
    ...(last.where ? { where: last.where } : {}),
  };
}

/** 定义时就把写错的列名、个数对不上的复合外键报出来，而不是等到第一次查询 */
function check(entities: Record<string, Entity>, key: string, name: string, rel: Relation): void {
  const where = `relation ${key}.${name}`;
  const source = entities[key]!;
  const target = entities[rel.target];
  if (!target) throw new Error(`${where}: unknown entity '${rel.target}'`);
  if (name in source.columns) throw new Error(`${where} has the same name as a column`);
  // 直达关系的各段在定义它们的地方已经核对过；任意条件的关系没有关联列要核对
  if (rel.path || rel.on) return;
  const columns = (entity: Entity, entityKey: string, names: readonly string[], what: string) => {
    if (names.length === 0) throw new Error(`${where}: ${what} must name at least one column`);
    for (const c of names)
      if (!(c in entity.columns)) throw new Error(`${where}: ${entityKey} has no column '${c}'`);
  };
  columns(source, key, rel.from, 'from');
  columns(target, rel.target, rel.to, 'to');
  if (rel.from.length !== rel.to.length)
    throw new Error(
      `${where}: from (${rel.from.length} columns) and to (${rel.to.length} columns) must match`,
    );
  if (rel.kind === 'many' && rel.through) {
    const through = entities[rel.through.entity];
    if (!through) throw new Error(`${where}: unknown through entity '${rel.through.entity}'`);
    columns(through, rel.through.entity, rel.through.from, 'throughFrom');
    columns(through, rel.through.entity, rel.through.to, 'throughTo');
    if (rel.through.from.length !== rel.from.length)
      throw new Error(`${where}: throughFrom must have as many columns as from`);
    if (rel.through.to.length !== rel.to.length)
      throw new Error(`${where}: throughTo must have as many columns as to`);
  }
}

const list = (v: string | readonly string[]): readonly string[] =>
  typeof v === 'string' ? [v] : v;

function builderFor<E extends Record<string, Entity>>(
  entities: E,
  source: string,
): RelationBuilder<E, string> {
  // 只在给了固定条件时才带上 where 属性，没给的关系对象保持原样（exactOptionalPropertyTypes）
  const where = (options?: {
    where?: RelationFilter<never>;
    interceptors?: InterceptorToggle;
  }) => ({
    ...(options?.where ? { where: options.where as RelationFilter } : {}),
    ...(options?.interceptors ? { interceptors: options.interceptors } : {}),
  });
  const primaryKey = (entity: Entity, what: string): readonly string[] => {
    if (entity.primaryKey.length === 0)
      throw new Error(`relation on ${what} needs from / to or a primary key on ${entity.table}`);
    return entity.primaryKey;
  };
  return {
    one(target, on, options) {
      const from = list(on.from);
      const required = options?.required === true;
      const nullable =
        !required &&
        (options?.optional === true ||
          from.some((c) => entities[source]!.columns[c]?.options.nullable));
      return {
        kind: 'one',
        target,
        from,
        to: list(on.to),
        nullable,
        ...(required ? { required } : {}),
        ...where(options),
      } as never;
    },
    many(target, on, options) {
      return { kind: 'many', target, from: list(on.from), to: list(on.to), ...where(options) };
    },
    manyToMany(target, on, options) {
      const targetEntity = entities[target];
      return {
        kind: 'many',
        target,
        from: on.from ? list(on.from) : primaryKey(entities[source]!, source),
        to: on.to ? list(on.to) : targetEntity ? primaryKey(targetEntity, target) : [],
        through: { entity: on.through, from: list(on.throughFrom), to: list(on.throughTo) },
        ...where(options),
      };
    },
    // from / to 在定义 schema 时按各段补上
    path(target, navigations) {
      return { kind: 'many', target, from: [], to: [], path: navigations };
    },
    pathOne(target, navigations) {
      return { kind: 'one', target, from: [], to: [], nullable: true, path: navigations };
    },
    manyOn(target, on, options) {
      return {
        kind: 'many',
        target,
        from: primaryKey(entities[source]!, source),
        to: [],
        on: on as RelationOn,
        source,
        ...where(options),
      };
    },
    oneOn(target, on, options) {
      return {
        kind: 'one',
        target,
        from: [],
        to: [],
        nullable: true,
        on: on as RelationOn,
        source,
        ...where(options),
      } as never;
    },
  };
}
