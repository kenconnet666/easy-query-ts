/**
 * 入口。
 * ```ts
 * const db = createDb({ schema, adapter: sqlite(new DatabaseSync(':memory:')), log: s => console.log(s.sql) })
 * const users = await db.queryable(User).where(u => u.name.like('a')).toList()
 * await db.transaction(async tx => { await tx.insert(User).values({ ... }).execute() })
 * ```
 */
import type { Statement } from './dialect.ts';
import {
  columnRules,
  Interceptors,
  type Interceptor,
  type InterceptorToggle,
} from './interceptor.ts';
import { Deletable, Insertable, LockRow, Updatable } from './mutation.ts';
import {
  cteEntity,
  keyCondition,
  newQueryable,
  recursiveCteEntity,
  type KeyInput,
  type Query,
  type Queryable,
} from './query.ts';
import type { AnySchema, EntityKey, Schema } from './relations.ts';
import type { Expr } from './expr.ts';
import type { Ref } from './ref.ts';
import type { DerivedEntity, Entity, Row } from './schema.ts';
import { createSqlTag, type SqlTag } from './native.ts';
import { AggregateSaver, type SaveInclude, type SaveValue } from './save.ts';
import { createStatements, findTable, planSync, type DbTable, type SyncPlan } from './ddl.ts';
import {
  execute,
  query,
  type Adapter,
  type Context,
  type ExecutionEvent,
  type Session,
  type TransactionOptions,
  newTransactionHooks,
  runHooks,
} from './session.ts';

/** 不在 schema 里的实体单独成一个 schema（没有导航） */
export type AdhocSchema<E extends Entity> = Schema<
  { [N in E['name']]: E },
  { [N in E['name']]: {} }
>;

/** 实体对象在 schema 里的键 */
export type KeyOf<S extends AnySchema, E> = {
  [K in EntityKey<S>]: S['entities'][K] extends E ? K : never;
}[EntityKey<S>];

type SchemaEntity<S extends AnySchema> = S['entities'][EntityKey<S>];

/** descendantsOf / ancestorsOf 的选项 */
export interface TreeWalk<S extends AnySchema, K extends EntityKey<S>> {
  /** 指向上级的列（或表达式）：`d => d.parentId` */
  parent: (row: Ref<S, K>) => Expr<unknown>;
  /** 结果里含不含起点这个节点，默认含 */
  self?: boolean;
}

/** 加上一个 CTE 实体之后的 schema：原有实体 + 名字为 N、列取自查询输出 Out 的派生实体 */
export type WithCte<S extends AnySchema, N extends string, Out> = Schema<
  S['entities'] & { [P in N]: DerivedEntity<N, Out> },
  S['relations'] & { [P in N]: {} }
>;

export interface DbOptions<S extends AnySchema> {
  readonly schema: S;
  readonly adapter: Adapter;
  /** 每条语句执行前调用，最简单的日志 */
  readonly log?: (statement: Statement) => void;
  /** 每条语句执行后调用（成功与失败都会），带耗时与行数；用来记慢 SQL、指标、链路追踪。钩子里抛错会让这条语句失败 */
  readonly onExecute?: (event: ExecutionEvent) => void;
  /** 谓词与写入拦截器，见 tenant()、touch() */
  readonly interceptors?: readonly Interceptor[];
  /**
   * 物理删除：'forbid' 时没有逻辑删除列的实体 delete 要显式写 `.hard()` 才执行，防止误删（对应 Java 版的 deleteThrow）。默认 'allow'
   */
  readonly hardDelete?: 'allow' | 'forbid';
  /**
   * 没写 limit 的 toList 最多读这么多行，多了报错而不是悄悄截断（对应 Java 版的 resultSizeLimit），防止误拉整表；
   * 显式写了 limit、toPage、stream 不受限。默认不限
   */
  readonly maxRows?: number;
  /**
   * 深分页倒序取（对应 Java 版的 reverseOffsetThreshold）：toPage / table 的偏移量超过它、且超过总数一半时，
   * 按相反的排序取（偏移量变小），再把这一页翻回来；查询要有 orderBy。默认不倒序
   */
  readonly reversePageAfter?: number;
}

export class Db<S extends AnySchema> {
  private readonly ctx: Context;
  private readonly adapter: Adapter;
  private readonly keys: Map<Entity, string>;
  private readonly inTransaction: boolean;
  /** 嵌套事务的保存点序号（同一个事务里的 Db 共用） */
  private readonly savepoints: { n: number } = { n: 0 };
  /** 原生 SQL：`db.sql\`SELECT … ${value}\``（查询）、`db.sql.execute\`…\``（写入），值作为绑定参数，见 native.ts */
  readonly sql: SqlTag;

  constructor(ctx: Context, adapter: Adapter, keys: Map<Entity, string>, inTransaction: boolean) {
    this.ctx = ctx;
    this.adapter = adapter;
    this.keys = keys;
    this.inTransaction = inTransaction;
    this.sql = createSqlTag(ctx);
  }

  /**
   * 从一个实体开始查询。不在 schema 里的实体也行（动态表、外部表、按月分的表，对应 Java 版的 mapQueryable 与动态表名）：
   * `db.queryable(entity('t_log_202610', { id: col.int(), msg: col.string() }))`，类型照样由列推出，只是没有导航
   */
  queryable<E extends SchemaEntity<S>>(entity: E): Queryable<S, KeyOf<S, E>>;
  queryable<E extends Entity>(entity: E): Queryable<AdhocSchema<E>, E['name']>;
  queryable(entity: Entity): Queryable<any, any, any, any> {
    const { ctx, key } = this.target(entity);
    return newQueryable(ctx, key);
  }

  insert<E extends SchemaEntity<S>>(entity: E): Insertable<S, KeyOf<S, E>>;
  insert<E extends Entity>(entity: E): Insertable<AdhocSchema<E>, E['name']>;
  insert(entity: Entity): Insertable<any, string> {
    const { ctx, key } = this.target(entity);
    return new Insertable(ctx, key);
  }

  update<E extends SchemaEntity<S>>(entity: E): Updatable<S, KeyOf<S, E>>;
  update<E extends Entity>(entity: E): Updatable<AdhocSchema<E>, E['name']>;
  update(entity: Entity): Updatable<any, string> {
    const { ctx, key } = this.target(entity);
    return new Updatable(ctx, key);
  }

  delete<E extends SchemaEntity<S>>(entity: E): Deletable<S, KeyOf<S, E>>;
  delete<E extends Entity>(entity: E): Deletable<AdhocSchema<E>, E['name']>;
  delete(entity: Entity): Deletable<any, string> {
    const { ctx, key } = this.target(entity);
    return new Deletable(ctx, key);
  }

  /** 实体在 schema 里就用它；不在就临时登记进这条语句的 schema（名字被占用时加序号） */
  private target(entity: Entity): { ctx: Context; key: string } {
    const known = this.keys.get(entity);
    if (known !== undefined) return { ctx: this.ctx, key: known };
    const entities = this.ctx.schema.entities;
    let key = entity.name;
    for (let n = 2; key in entities; n++) key = `${entity.name}#${n}`;
    const schema: AnySchema = {
      entities: { ...entities, [key]: entity },
      relations: { ...this.ctx.schema.relations, [key]: {} },
    };
    return { ctx: { ...this.ctx, schema }, key };
  }

  /** schema 里某个实体的对象（join、queryable 都要传实体对象）；CTE 登记之后用它取：`tdb.queryable(tdb.entity('recent'))` */
  entity<K extends EntityKey<S>>(key: K): S['entities'][K] {
    const found = this.ctx.schema.entities[key];
    if (!found) throw new Error(`entity '${key}' is not part of the schema`);
    return found as S['entities'][K];
  }

  /**
   * 登记一个 CTE（`WITH name AS (query)`），返回能查询它的新 Db。之后的查询把它当作一个实体用，可以和别的实体 join：
   * ```ts
   * const tdb = db.with('big', db.queryable(Post).where(p => p.amount.gt('100')).select(p => ({ userId: p.userId, amount: p.amount })))
   * await tdb.queryable(User).innerJoin(tdb.entity('big'), (u, b) => b.userId.eq(u.id)).select((u, b) => ({ name: u.name, amount: b.amount })).toList()
   * ```
   * query 的 select 必须只由表达式组成；用到的 CTE 只在引用它的语句里出现，WITH 一律放在最外层。
   */
  with<N extends string, Out>(name: N, query: Query<Out>): Db<WithCte<S, N, Out>> {
    return this.extend(cteEntity(query, this.freshName(name)));
  }

  /**
   * 递归 CTE（树、层级、图的可达性）：anchor 是起点，step 用回调拿到的 self 实体写递归的那一步，两部分按列名对齐。
   * 默认 UNION ALL；传 `{ all: false }` 用 UNION，天然去重、能挡住环。HANA 没有 WITH RECURSIVE，会报不支持。
   * ```ts
   * const tdb = db.withRecursive('tree',
   *   db.queryable(Dept).where(d => d.id.eq(1)).select(d => ({ id: d.id, depth: sql<number>`0` })),
   *   (rdb, self) => rdb.queryable(Dept).innerJoin(self, (d, t) => d.parentId.eq(t.id)).select((d, t) => ({ id: d.id, depth: t.depth.plus(1) })))
   * ```
   */
  withRecursive<N extends string, Out>(
    name: N,
    anchor: Query<Out>,
    step: (db: Db<WithCte<S, N, Out>>, self: DerivedEntity<N, Out>) => Query<Out>,
    options: { all?: boolean } = {},
  ): Db<WithCte<S, N, Out>> {
    let extended: Db<WithCte<S, N, Out>> | undefined;
    const entity = recursiveCteEntity(anchor, this.freshName(name), options.all ?? true, (self) => {
      extended = this.extend(self);
      return step(extended, self as DerivedEntity<N, Out>);
    });
    // 递归部分构建完成后实体才完整；Db 本身只持有实体的引用，所以直接可用
    return extended ?? this.extend(entity);
  }

  /**
   * 某个节点的全部下级（对应 Java 版的 asTreeCTE）：递归 CTE 从 key 这个节点沿 parent 往下走，返回只含这些行的查询，
   * 之后照常 where、select、toTree。self 默认 true（含这个节点）。递归用 UNION 去重，数据里有环也会停下。
   * 只支持单列主键；HANA 没有递归 CTE，渲染时报不支持。
   * ```ts
   * await db.descendantsOf(Dept, 1, { parent: d => d.parentId }).select(...).toTree({ id: 'id', parent: 'parentId' })
   * ```
   */
  descendantsOf<E extends SchemaEntity<S>>(
    entity: E,
    key: unknown,
    options: TreeWalk<S, KeyOf<S, E>>,
  ): Queryable<S, KeyOf<S, E>> {
    return this.walkTree(entity, key, options, 'down');
  }

  /** 某个节点的全部上级（从它的上级一直到根），用法同 descendantsOf */
  ancestorsOf<E extends SchemaEntity<S>>(
    entity: E,
    key: unknown,
    options: TreeWalk<S, KeyOf<S, E>>,
  ): Queryable<S, KeyOf<S, E>> {
    return this.walkTree(entity, key, options, 'up');
  }

  private walkTree<E extends SchemaEntity<S>>(
    entity: E,
    key: unknown,
    { parent, self = true }: TreeWalk<S, KeyOf<S, E>>,
    direction: 'down' | 'up',
  ): Queryable<S, KeyOf<S, E>> {
    const [pk, ...rest] = entity.primaryKey;
    if (pk === undefined || rest.length > 0)
      throw new Error(
        `descendantsOf / ancestorsOf need a single-column primary key on ${entity.table}`,
      );
    // 递归 CTE 的两列：id 是走到的行，up 是它的上级（往上走时下一步按它找）
    type Columns = Record<string, Expr<unknown>>;
    const shape = (row: unknown) => ({
      id: (row as Columns)[pk]!,
      up: parent(row as never) as Expr<unknown>,
    });
    let walked: DerivedEntity<string, unknown> | undefined;
    const tdb = this.withRecursive(
      'tree_walk',
      this.queryable(entity)
        .where((row) => (row as unknown as Columns)[pk]!.eq(key as never))
        .select(shape),
      (rdb, cte) => {
        walked = cte as DerivedEntity<string, unknown>;
        // 递归的这一步只在内部拼，实体与 CTE 的类型在这里放宽，对外的签名照样带类型
        const step = (rdb as unknown as Db<AnySchema>).queryable(entity as never) as unknown as {
          innerJoin(
            other: unknown,
            on: (row: unknown, walkedRow: Columns) => unknown,
          ): { select(shape: (row: unknown) => unknown): Query<unknown> };
        };
        return step
          .innerJoin(cte, (row, walkedRow) =>
            direction === 'down'
              ? (parent(row as never) as Expr<unknown>).eq(walkedRow['id'] as never)
              : (row as Columns)[pk]!.eq(walkedRow['up'] as never),
          )
          .select((row) => shape(row)) as never;
      },
      { all: false },
    );
    const ids = tdb.queryable(walked as never).select((row) => (row as Columns)['id']!);
    let query = tdb
      .queryable(entity as never)
      .where((row) => (row as unknown as Columns)[pk]!.in(ids as never));
    if (!self) query = query.where((row) => (row as unknown as Columns)[pk]!.ne(key as never));
    return query as unknown as Queryable<S, KeyOf<S, E>>;
  }

  /**
   * 聚合保存（对应 Java 版的 savable）：保存一个实体以及 include 里列出的导航，整个过程在一个事务里，返回保存后重新读出的行。
   * ```ts
   * await db.save(User, { id: 1, name: 'alice2', posts: [{ id: 5, title: 'changed' }, { title: 'new' }] }, {
   *   include: { posts: { removed: 'delete' } },   // 不在列表里的帖子删掉
   * })
   * ```
   * - 带完整主键：行已存在就只更新给出的列（没给的保持原值，`$onUpdate` 照常生效），不存在就插入；主键没给（自增）就插入并取回新主键
   * - 导航按 include 保存：一对多 / 一对一按差异增改、移除；多对一先存目标再设外键；多对多只增删中间表的行。细则见 save.ts
   * - 必填列的检查交给数据库：插入新行时少了必填列会报错
   */
  async save<E extends SchemaEntity<S>, const I extends SaveInclude<S, KeyOf<S, E>> = {}>(
    entity: E,
    input: NoInfer<SaveValue<S, KeyOf<S, E>, I>>,
    options: { readonly include?: I } = {},
  ): Promise<Row<E>> {
    const run = async (db: Db<S>): Promise<Row<E>> => {
      const key = db.key<string>(entity);
      const saver = new AggregateSaver(db as never, db.ctx.schema);
      const saved = await saver.save(
        key,
        input as Record<string, unknown>,
        options.include as never,
      );
      return db
        .queryable(entity)
        .where((r: any) =>
          entity.primaryKey.map((k) => (r[k] as Expr<unknown>).eq(saved[k] as never)),
        )
        .firstOrThrow() as Promise<Row<E>>;
    };
    return this.inTransaction ? run(this) : this.transaction(run);
  }

  /**
   * 删除一棵对象树（save 的反向）：按主键找到这一行，沿 include 先删它拥有的子项（一对多、一对一）和中间表的行，再删它自己。
   * 行不存在时返回 false。逻辑删除的实体照常变成逻辑删除
   * ```ts
   * await db.remove(User, 1, { include: { posts: { include: { comments: true } }, roles: true } })
   * ```
   */
  async remove<E extends SchemaEntity<S>, const I extends SaveInclude<S, KeyOf<S, E>> = {}>(
    entity: E,
    key: KeyInput<E>,
    options: { readonly include?: I } = {},
  ): Promise<boolean> {
    const run = async (db: Db<S>): Promise<boolean> => {
      const name = db.key<string>(entity);
      const row = await db
        .queryable(entity)
        .where((r: any) => keyCondition(entity, key, r))
        .first();
      if (!row) return false;
      await new AggregateSaver(db as never, db.ctx.schema).removeRows(
        name,
        [row as never],
        options.include as never,
      );
      return true;
    };
    return this.inTransaction ? run(this) : this.transaction(run);
  }

  /** 按实体定义生成建表语句（列、主键、唯一约束、MySQL 的注释），不执行。类型规则见各方言的 columnType */
  createTableSql(entity: Entity): string {
    return this.ctx.dialect.createTable(entity, true);
  }

  /**
   * 建这些实体（默认 schema 里全部非派生的实体）要的全部语句，不执行：建表、注释、索引、外键（对应 Java 版的 createTableCommand）
   */
  createTablesSql(...entities: Entity[]): string[] {
    return createStatements(this.ctx.dialect, this.ctx.schema, this.targets(entities), true);
  }

  /**
   * 建库里还没有的表（连同注释、索引、外键），已有的表不动；默认是 schema 里全部非派生的实体。
   * 适合测试、原型和"库里还没有表"的起步；已有的表要跟上实体的变化用 planSync / syncTables
   */
  async createTables(...entities: Entity[]): Promise<void> {
    const tables = await this.introspect();
    const missing = this.targets(entities).filter((e) => !findTable(tables, e.table));
    await this.runDdl(createStatements(this.ctx.dialect, this.ctx.schema, missing, false));
  }

  /** 读库里（当前 schema）的表结构：列、主键、索引、外键（syncTables、由表生成实体用） */
  introspect(): Promise<DbTable[]> {
    return this.ctx.dialect.introspect((sql, params = []) =>
      query(this.ctx, { sql, params: [...params] }),
    );
  }

  async tableExists(entity: Entity): Promise<boolean> {
    return findTable(await this.introspect(), entity.table) !== undefined;
  }

  /**
   * 比较实体与库里的表，得出同步计划，不执行（对应 Java 版的 syncTableCommand 先看 SQL）：
   * 要执行的语句只增不删——建缺的表、加缺的列、按 renamedFrom 改表名列名、建缺的索引与外键；
   * 类型、可空、注释不一致和库里多出来的列放进 differences，由人决定怎么迁移
   * ```ts
   * const plan = await db.planSync()
   * console.log(plan.statements.join(';
'), plan.differences)
   * ```
   */
  async planSync(...entities: Entity[]): Promise<SyncPlan> {
    return planSync(
      this.ctx.dialect,
      this.ctx.schema,
      this.targets(entities),
      await this.introspect(),
    );
  }

  /** 算出同步计划并执行它的语句（PG、SQLite 在一个事务里；MySQL、HANA 的 DDL 会隐式提交），返回计划 */
  async syncTables(...entities: Entity[]): Promise<SyncPlan> {
    const plan = await this.planSync(...entities);
    await this.runDdl(plan.statements);
    return plan;
  }

  /** 删掉这些实体的表（库里没有的跳过） */
  async dropTables(...entities: Entity[]): Promise<void> {
    const tables = await this.introspect();
    await this.runDdl(
      entities
        .filter((e) => findTable(tables, e.table))
        .map((e) => this.ctx.dialect.dropTable(e.table)),
    );
  }

  /** 没给实体时是 schema 里全部非派生的实体 */
  private targets(entities: readonly Entity[]): Entity[] {
    return entities.length > 0
      ? [...entities]
      : Object.values(this.ctx.schema.entities).filter((e) => !e.derived);
  }

  /** 逐条执行 DDL；能放进事务的库在一个事务里执行 */
  private async runDdl(statements: readonly string[]): Promise<void> {
    if (statements.length === 0) return;
    const run = async (db: Db<S>) => {
      for (const sql of statements) await execute(db.ctx, { sql, params: [] });
    };
    if (this.ctx.dialect.transactionalDdl && !this.inTransaction) await this.transaction(run);
    else await run(this);
  }

  /**
   * 换表：这个 Db 上的查询把实体映射到别的表（热表 / 归档表、按月分表），导航、join、子查询、include 都跟着换，
   * 不用改任何查询代码。映射的表要有同样的列；`mapTables({ Post: 't_post_2025' })`。
   * 对应 Java 版的 TableNameMapping。
   */
  mapTables(mapping: { [K in EntityKey<S>]?: string }): Db<S> {
    const entities: Record<string, Entity> = { ...this.ctx.schema.entities };
    const keys = new Map(this.keys);
    for (const [key, table] of Object.entries(mapping) as [string, string][]) {
      const original = this.ctx.schema.entities[key];
      if (!original) throw new Error(`mapTables: entity '${key}' is not part of the schema`);
      if (original.derived)
        throw new Error(`mapTables: '${key}' is a derived table and has no table name to replace`);
      // 复制一份换了表名的实体放进 schema；用户手里的原实体对象仍然指向同一个键
      entities[key] = { ...original, table };
      keys.set(entities[key]!, key);
    }
    return new Db(
      { ...this.ctx, schema: { ...this.ctx.schema, entities } },
      this.adapter,
      keys,
      this.inTransaction,
    );
  }

  /**
   * 换 schema（对应 Java 版的 asSchema）：这个 Db 上的查询与写入把表放到另一个 schema（MySQL 是库）下，
   * 多租户分库、归档库都不用改查询代码：`db.inSchema('archive_2025')`；only 只换这几个实体。表名已带 schema 前缀的换掉前缀
   */
  inSchema(schema: string, only?: readonly EntityKey<S>[]): Db<S> {
    const entities = this.ctx.schema.entities;
    const keys = only ?? Object.keys(entities).filter((key) => !entities[key]!.derived);
    return this.mapTables(
      Object.fromEntries(
        keys.map((key) => [key, `${schema}.${entities[key]!.table.split('.').at(-1)}`]),
      ) as { [K in EntityKey<S>]?: string },
    );
  }

  /**
   * 跨库链接（对应 Java 版的 asTableLink，如 Oracle 的 db link）：这个 Db 上的表名后面加上 `@link`；only 只换这几个实体
   */
  withTableLink(link: string, only?: readonly EntityKey<S>[]): Db<S> {
    if (!/^[A-Za-z_][\w$#.]*$/.test(link))
      throw new Error(`withTableLink: '${link}' is not a valid link name`);
    const entities = this.ctx.schema.entities;
    const keys = only ?? Object.keys(entities).filter((key) => !entities[key]!.derived);
    return this.mapTables(
      Object.fromEntries(
        keys.map((key) => [key, `${entities[key]!.table.split('@')[0]}@${link}`]),
      ) as { [K in EntityKey<S>]?: string },
    );
  }

  private freshName(name: string): string {
    if (name in this.ctx.schema.entities)
      throw new Error(`'${name}' is already an entity or CTE of this schema`);
    return name;
  }

  /** 在 schema 里加一个实体（CTE），其余不变 */
  private extend<S2 extends AnySchema>(entity: Entity): Db<S2> {
    const schema = {
      entities: { ...this.ctx.schema.entities, [entity.name]: entity },
      relations: { ...this.ctx.schema.relations, [entity.name]: {} },
    };
    const keys = new Map(this.keys);
    keys.set(entity, entity.name);
    return new Db({ ...this.ctx, schema }, this.adapter, keys, this.inTransaction);
  }

  /**
   * 这个 Db 上所有语句的拦截器开关（与语句上的 noInterceptor / useInterceptor 叠加，语句上的在后）：
   * 后台任务、管理员接口整段关掉租户 `db.withInterceptors({ skip: ['tenant'] })`，某个接口打开数据范围 `{ use: ['dataScope'] }`
   */
  withInterceptors(toggle: InterceptorToggle): Db<S> {
    return new Db(
      { ...this.ctx, interceptors: this.ctx.interceptors.configure(toggle) },
      this.adapter,
      this.keys,
      this.inTransaction,
    );
  }

  /**
   * 一个绑定了取消信号的 Db：通过它发出的所有语句（含事务里的）遵守这个信号。
   * 信号已取消时新语句直接失败；执行中取消则不再等待结果，立刻以信号的 reason 失败。
   * 这只是"客户端不再等"，数据库里的语句不会被终止。超时：`db.withSignal(AbortSignal.timeout(5000))`。
   */
  withSignal(signal: AbortSignal): Db<S> {
    return new Db({ ...this.ctx, signal }, this.adapter, this.keys, this.inTransaction);
  }

  /**
   * work 里用 tx 执行的语句在同一个事务里；work 抛错时回滚。
   * 已经在事务里再调用，开的是嵌套事务（保存点）：work 抛错只回滚到保存点，外层事务不受影响（异常仍会抛出，由调用方决定要不要吞掉）。
   */
  async transaction<T>(work: (tx: Db<S>) => Promise<T>, options?: TransactionOptions): Promise<T> {
    if (this.inTransaction) {
      if (options?.isolation || options?.readOnly)
        throw new Error(
          'a nested transaction cannot change isolation or read-only; set them on the outermost transaction',
        );
      return this.nested(work);
    }
    const hooks = newTransactionHooks();
    let result: T;
    try {
      result = await this.adapter.driver.transaction(
        (session: Session) =>
          work(new Db({ ...this.ctx, session, hooks }, this.adapter, this.keys, true)),
        options,
      );
    } catch (error) {
      // 回滚后的钩子出错不盖住原来的错误
      await runHooks(hooks.frames[0]!.rollback).catch(() => undefined);
      throw error;
    }
    await runHooks(hooks.frames[0]!.commit);
    return result;
  }

  /**
   * 事务提交之后执行（发通知、发消息、清缓存）：回滚了就不执行；登记在保存点（嵌套事务）里、保存点回滚了的也不执行。
   * 必须在事务里调用。fn 出错时数据已经提交，错误抛给发起事务的调用方
   * ```ts
   * await db.transaction(async (tx) => {
   *   await tx.insert(Order).values(order).execute();
   *   tx.afterCommit(() => mailer.send(order));
   * });
   * ```
   */
  afterCommit(fn: () => unknown): void {
    this.frame('afterCommit').commit.push(fn);
  }

  /** 事务（或登记它的保存点）回滚之后执行：撤销事务外做的事（删上传的文件这类）。必须在事务里调用；fn 出错不盖住原来的错误 */
  afterRollback(fn: () => unknown): void {
    this.frame('afterRollback').rollback.push(fn);
  }

  private frame(what: string) {
    const frames = this.ctx.hooks?.frames;
    if (!frames) throw new Error(`${what}() must be called inside a transaction`);
    return frames[frames.length - 1]!;
  }

  /**
   * 锁住一行直到事务结束，返回这一行在不在。同一行的写入（或同样先锁它的事务）在这里排队，之后读到的都是对方提交后的数据：
   * 流程实例、账户这类"聚合根"，每个改它的操作先锁它，并发的两个操作不会都以为对方还没做。
   * 有行锁的库用 SELECT … FOR UPDATE；SQLite 用一条把主键写回自己的 UPDATE 拿到写锁。不经拦截器、不动版本列
   * ```ts
   * await db.transaction(async (tx) => {
   *   if (!(await tx.lock(Instance, id))) throw new NotFound(id);
   *   const instance = await tx.queryable(Instance).findOrThrow(id);
   * });
   * ```
   */
  async lock<E extends SchemaEntity<S>>(entity: E, key: KeyInput<E>): Promise<boolean> {
    if (!this.inTransaction) {
      throw new Error('lock() must be called inside a transaction: the lock lasts until it ends');
    }
    const name = this.key<string>(entity);
    const where = (row: any) => keyCondition(this.ctx.schema.entities[name]!, key, row);
    if (!this.ctx.dialect.rowLocks) {
      return (await new LockRow(this.ctx, name, where).execute()) > 0;
    }
    const rows = await newQueryable({ ...this.ctx, interceptors: Interceptors.none }, name)
      .where(where)
      .forUpdate()
      .toList();
    return rows.length > 0;
  }

  /** 嵌套事务：SAVEPOINT，成功则释放，失败则回滚到保存点 */
  private async nested<T>(work: (tx: Db<S>) => Promise<T>): Promise<T> {
    const dialect = this.ctx.dialect;
    const name = `eqts_sp_${++this.savepoints.n}`;
    await execute(this.ctx, { sql: dialect.savepoint(name), params: [] });
    const release = dialect.releaseSavepoint(name);
    // 保存点里登记的钩子另起一帧：成功并进外层，回滚则丢掉提交后的、执行回滚后的
    const frames = this.ctx.hooks!.frames;
    const frame = { commit: [] as (() => unknown)[], rollback: [] as (() => unknown)[] };
    frames.push(frame);
    try {
      const result = await work(this);
      if (release) await execute(this.ctx, { sql: release, params: [] });
      frames.pop();
      frames[frames.length - 1]!.commit.push(...frame.commit);
      frames[frames.length - 1]!.rollback.push(...frame.rollback);
      return result;
    } catch (error) {
      frames.pop();
      await runHooks(frame.rollback).catch(() => undefined);
      // 回滚本身失败（比如连接已断）不能盖住原来的错误
      try {
        await execute(this.ctx, { sql: dialect.rollbackToSavepoint(name), params: [] });
        if (release) await execute(this.ctx, { sql: release, params: [] });
      } catch {
        /* 保留 work 抛出的原始错误 */
      }
      throw error;
    }
  }

  /**
   * 手动开始一个事务，配合 `await using` 使用：离开作用域时没提交就自动回滚，不用多包一层回调。
   * ```ts
   * await using tx = await db.begin()
   * await tx.insert(User).values(row).execute()
   * if (bad) return                // 提前返回：自动回滚
   * await tx.commit()
   * ```
   */
  async begin(options?: TransactionOptions): Promise<Transaction<S>> {
    if (this.inTransaction)
      throw new Error(
        'begin() cannot be used inside a transaction; use transaction() for a nested one',
      );
    // 驱动只提供"回调式"事务：在回调里等一个"提交 / 回滚"的决定，决定下来回调才返回，驱动随即提交或回滚
    let decide!: (commit: boolean) => void;
    const decision = new Promise<boolean>((resolve) => {
      decide = resolve;
    });
    let finished!: Promise<void>;
    const hooks = newTransactionHooks();
    const transaction = await new Promise<Transaction<S>>((resolve, reject) => {
      finished = this.adapter.driver
        .transaction(async (session: Session) => {
          resolve(
            new Transaction({ ...this.ctx, session, hooks }, this.adapter, this.keys, {
              finish: async (commit) => {
                decide(commit);
                try {
                  await finished;
                } catch (error) {
                  await runHooks(hooks.frames[0]!.rollback).catch(() => undefined);
                  throw error;
                }
                await runHooks(hooks.frames[0]![commit ? 'commit' : 'rollback']);
              },
            }),
          );
          if (!(await decision)) throw ROLLBACK;
        }, options)
        .then(
          () => undefined,
          (error: unknown) => {
            if (error !== ROLLBACK) {
              reject(error);
              throw error;
            }
          },
        );
    });
    return transaction;
  }

  private key<K>(entity: Entity): K {
    const key = this.keys.get(entity);
    if (key === undefined)
      throw new Error(`entity for table '${entity.table}' is not part of the schema`);
    return key as K;
  }
}

/** begin() 里用来表示"回滚"的哨兵：让驱动的回调抛出它，驱动据此回滚，再被吞掉 */
const ROLLBACK = Symbol('eqts.rollback');

/** begin() 的结果：一个 Db，外加 commit / rollback；`await using` 离开作用域时没结束就回滚 */
export class Transaction<S extends AnySchema> extends Db<S> {
  private readonly control: { finish(commit: boolean): Promise<void> };
  private done = false;

  constructor(
    ctx: Context,
    adapter: Adapter,
    keys: Map<Entity, string>,
    control: { finish(commit: boolean): Promise<void> },
  ) {
    super(ctx, adapter, keys, true);
    this.control = control;
  }

  async commit(): Promise<void> {
    if (this.done) throw new Error('the transaction is already finished');
    this.done = true;
    await this.control.finish(true);
  }

  /** 回滚；已经提交或回滚过则什么也不做（所以 `await using` 在提交之后离开作用域是安全的） */
  async rollback(): Promise<void> {
    if (this.done) return;
    this.done = true;
    await this.control.finish(false);
  }

  async [Symbol.asyncDispose](): Promise<void> {
    await this.rollback();
  }
}

export function createDb<S extends AnySchema>(options: DbOptions<S>): Db<S> {
  const keys = new Map<Entity, string>();
  for (const [key, entity] of Object.entries(options.schema.entities)) keys.set(entity, key);
  const ctx: Context = {
    schema: options.schema,
    dialect: options.adapter.dialect,
    session: options.adapter.driver,
    log: options.log,
    onExecute: options.onExecute,
    signal: undefined,
    hooks: undefined,
    guards: {
      hardDelete: options.hardDelete ?? 'allow',
      maxRows: options.maxRows,
      reversePageAfter: options.reversePageAfter,
    },
    // 列修饰器驱动的内置规则在前，用户的拦截器在后
    interceptors: new Interceptors([...columnRules(), ...(options.interceptors ?? [])]),
  };
  return new Db(ctx, options.adapter, keys, false);
}
