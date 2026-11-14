/**
 * 入口。
 * ```ts
 * const db = createDb({ schema, adapter: sqlite(new DatabaseSync(':memory:')), log: s => console.log(s.sql) })
 * const users = await db.queryable(User).where(u => u.name.like('a')).toList()
 * await db.transaction(async tx => { await tx.insert(User).values({ ... }).execute() })
 * ```
 */
import { SqlWriter, type Statement } from './dialect.ts';
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
  prepareQuery,
  type PreparedQuery,
  type Query,
  type Queryable,
} from './query.ts';
import {
  mergeSchemas,
  type AnySchema,
  type DistinctEntities,
  type DistinctNavigations,
  type EntityKey,
  type MergedEntities,
  type MergedRelations,
  type MergedSchema,
  type Relation,
  type RelationDefs,
  type Schema,
} from './relations.ts';
import type { Expr } from './expr.ts';
import type { Ref } from './ref.ts';
import type { DerivedEntity, Entity, KeyInput, Row } from './schema.ts';
import { createSqlTag, type SqlTag } from './native.ts';
import { checksum, historyEntity, ordered, type Migration } from './migrate.ts';
import { databaseError, DeadlockError, MigrationError, SerializationError } from './errors.ts';
import type {
  Capability,
  CapabilitiesOf,
  ReadOnly,
  Requires,
  WithCapabilities,
} from './capabilities.ts';
import { AggregateSaver, type SaveInclude, type SaveValue } from './save.ts';
import {
  bareName,
  createStatements,
  findTable,
  planSync,
  schemaOf,
  type DbTable,
  type QueryRunner,
  type SyncPlan,
} from './ddl.ts';
import {
  assertWritable,
  execute,
  explain,
  query,
  type Adapter,
  type Context,
  type ExecutionEvent,
  type ExplainOptions,
  type Replicas,
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
export type WithCte<S extends AnySchema, N extends string, Out> = WithCapabilities<
  Schema<S['entities'] & { [P in N]: DerivedEntity<N, Out> }, S['relations'] & { [P in N]: {} }>,
  CapabilitiesOf<S>
>;

/** transaction 的重试选项 */
export interface RetryOptions {
  /** 遇到死锁、串行化失败时最多重试几次（整个 work 重新执行）；默认 0 */
  readonly retries?: number;
}

/** createDb 的选项 */
export interface DbOptions<S extends AnySchema> {
  readonly schema: S;
  readonly adapter: Adapter;
  /** 每条语句执行前调用，最简单的日志 */
  readonly log?: (statement: Statement) => void;
  /**
   * 每条语句执行后调用（成功与失败都会），带耗时与行数；用来记慢 SQL、指标、链路追踪。钩子里抛错会让这条语句失败。
   * 几个钩子写成数组，按顺序调用：`[statementSpans(tracer), watch.onExecute]`
   */
  readonly onExecute?: OnExecute | readonly OnExecute[];
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
  /**
   * 读写分离（对应 Java 版的读写分离）：从库的 Adapter（同一种库）。事务外的查询按轮询走从库；写入（含 RETURNING、
   * 写入前后的回查）、事务里的一切、introspect 走主库。刚写完马上要读到时用 `db.usePrimary()`
   */
  readonly replicas?: readonly Adapter[];
  /** 每条语句默认的超时（毫秒），见 Db.withTimeout；默认不限 */
  readonly statementTimeout?: number;
}

export class Db<S extends AnySchema> {
  private readonly ctx: Context;
  private readonly adapter: Adapter;
  private readonly keys: Map<Entity, string>;
  private readonly inTransaction: boolean;
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

  insert<E extends SchemaEntity<S>>(
    this: Requires<S, 'write', Db<S>>,
    entity: E,
  ): Insertable<S, KeyOf<S, E>>;
  insert<E extends Entity>(
    this: Requires<S, 'write', Db<S>>,
    entity: E,
  ): Insertable<AdhocSchema<E>, E['name']>;
  insert(entity: Entity): Insertable<any, string> {
    const { ctx, key } = this.target(entity);
    return new Insertable(writable(ctx), key);
  }

  update<E extends SchemaEntity<S>>(
    this: Requires<S, 'update' | 'write', Db<S>>,
    entity: E,
  ): Updatable<S, KeyOf<S, E>>;
  update<E extends Entity>(
    this: Requires<S, 'update' | 'write', Db<S>>,
    entity: E,
  ): Updatable<AdhocSchema<E>, E['name']>;
  update(entity: Entity): Updatable<any, string> {
    const { ctx, key } = this.target(entity);
    return new Updatable(writable(ctx), key);
  }

  delete<E extends SchemaEntity<S>>(
    this: Requires<S, 'write', Db<S>>,
    entity: E,
  ): Deletable<S, KeyOf<S, E>>;
  delete<E extends Entity>(
    this: Requires<S, 'write', Db<S>>,
    entity: E,
  ): Deletable<AdhocSchema<E>, E['name']>;
  delete(entity: Entity): Deletable<any, string> {
    const { ctx, key } = this.target(entity);
    return new Deletable(writable(ctx), key);
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
  save<E extends SchemaEntity<S>, const I extends SaveInclude<S, KeyOf<S, E>> = {}>(
    this: Requires<S, 'write', Db<S>>,
    entity: E,
    input: NoInfer<SaveValue<S, KeyOf<S, E>, I>>,
    options?: { readonly include?: I },
  ): Promise<Row<E>>;
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
    return this.atomically(run);
  }

  /**
   * 删除一棵对象树（save 的反向）：按主键找到这一行，沿 include 先删它拥有的子项（一对多、一对一）和中间表的行，再删它自己。
   * 行不存在时返回 false。逻辑删除的实体照常变成逻辑删除
   * ```ts
   * await db.remove(User, 1, { include: { posts: { include: { comments: true } }, roles: true } })
   * ```
   */
  remove<E extends SchemaEntity<S>, const I extends SaveInclude<S, KeyOf<S, E>> = {}>(
    this: Requires<S, 'write', Db<S>>,
    entity: E,
    key: KeyInput<E>,
    options?: { readonly include?: I },
  ): Promise<boolean>;
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
    return this.atomically(run);
  }

  /**
   * save / remove 要么全做要么全不做：不在事务里就开一个；已经在事务里就包一层保存点——
   * 中途失败时只撤掉它自己写的那部分，调用方接住错误继续用外层事务也不会留下半截数据。没有保存点的库直接执行
   */
  private atomically<T>(work: (db: Db<S>) => Promise<T>): Promise<T> {
    if (this.inTransaction && !this.ctx.dialect.supportsSavepoints) return work(this);
    return this.runInTransaction(work);
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
  createTables(this: Requires<S, 'write', Db<S>>, ...entities: Entity[]): Promise<void>;
  async createTables(...entities: Entity[]): Promise<void> {
    const targets = this.targets(entities);
    const tables = await this.catalog(targets);
    const missing = targets.filter((e) => !findTable(tables, e.table));
    await this.runDdl(createStatements(this.ctx.dialect, this.ctx.schema, missing, false));
  }

  /**
   * 读库里的表结构：列、主键、索引、外键（syncTables、由表生成实体用）。不给 schema 读当前的；
   * 给了读那一个（PG、MySQL、SQLite 的附加库、SQL Server、HANA、Db2、DuckDB、ClickHouse），别的方言报错
   */
  introspect(schema?: string): Promise<DbTable[]> {
    if (schema !== undefined && !this.ctx.dialect.introspectsSchemas)
      throw new Error(
        `the ${this.ctx.dialect.name} dialect can only read the table structure of the current schema`,
      );
    return this.ctx.dialect.introspect(this.catalogRunner(), schema);
  }

  /**
   * 这些实体所在的各个 schema 的表（createTables、planSync、dropTables 用）：表名带 schema 前缀的实体（inSchema 之后）
   * 到它自己的 schema 里找，当前 schema 里有同名的表不算数
   */
  private async catalog(entities: readonly Entity[]): Promise<DbTable[]> {
    const current = await this.introspect();
    const tables = [...current];
    for (const schema of new Set(entities.map((e) => schemaOf(e.table)))) {
      if (schema === undefined) continue;
      // 读不了别的 schema 的方言照旧只认表名：前缀就是当前 schema 时是对的
      const found = this.ctx.dialect.introspectsSchemas ? await this.introspect(schema) : current;
      tables.push(...found.map((t): DbTable => ({ ...t, schema })));
    }
    return tables;
  }

  /** 读系统表的查询：走主库（从库可能落后） */
  private catalogRunner(): QueryRunner {
    const ctx = primary(this.ctx);
    return (sql, params = []) => query(ctx, { sql, params: [...params] });
  }

  async tableExists(entity: Entity): Promise<boolean> {
    const targets = this.targets([entity]);
    const tables = await this.catalog(targets);
    return targets.every((e) => findTable(tables, e.table) !== undefined);
  }

  /**
   * 比较实体与库里的表，得出同步计划，不执行（对应 Java 版的 syncTableCommand 先看 SQL）：
   * 要执行的语句只增不删——建缺的表、加缺的列、按 renamedFrom 改表名列名、建缺的索引与外键；
   * 类型、可空、注释不一致和库里多出来的列放进 differences，由人决定怎么迁移
   * ```ts
   * const plan = await db.planSync()
   * console.log(plan.statements.join(';\n'), plan.differences)
   * ```
   */
  async planSync(...entities: Entity[]): Promise<SyncPlan> {
    const targets = this.targets(entities);
    return planSync(
      this.ctx.dialect,
      this.ctx.schema,
      targets,
      await this.catalog(targets),
      await this.ctx.dialect.introspectTypes(this.catalogRunner()),
    );
  }

  /** 算出同步计划并执行它的语句（PG、SQLite 在一个事务里；MySQL、HANA 的 DDL 会隐式提交），返回计划 */
  syncTables(this: Requires<S, 'write', Db<S>>, ...entities: Entity[]): Promise<SyncPlan>;
  async syncTables(...entities: Entity[]): Promise<SyncPlan> {
    const plan = await this.planSync(...entities);
    await this.runDdl(plan.statements);
    return plan;
  }

  /** 删掉这些实体的表（库里没有的跳过） */
  dropTables(this: Requires<S, 'write', Db<S>>, ...entities: Entity[]): Promise<void>;
  async dropTables(...entities: Entity[]): Promise<void> {
    const targets = this.targets(entities);
    const tables = await this.catalog(targets);
    await this.runDdl(
      targets
        .filter((e) => findTable(tables, e.table))
        .map((e) => this.ctx.dialect.dropTable(e.table)),
    );
  }

  /**
   * 只读的 Db：类型上没有写方法（insert、update、delete、save、remove、DDL、迁移、加锁），运行时写入也报错。
   * 给只读接口、报表、只连从库的服务用：`createDb({ schema, adapter: replica }).readonly()`。
   * 查询、事务（读一致的快照）照常；`db.sql.execute` 在类型上不受限，运行时报错
   */
  readonly(): Db<ReadOnly<S>> {
    return new Db(
      { ...this.ctx, guards: { ...this.ctx.guards, readonly: true } },
      this.adapter,
      this.keys,
      this.inTransaction,
    ) as never;
  }

  /** 之后的读也走主库（读写分离时，刚写完马上要读到自己写的数据） */
  usePrimary(): Db<S> {
    return new Db(primary(this.ctx), this.adapter, this.keys, this.inTransaction);
  }

  /**
   * 没给实体时是 schema 里全部非派生的实体；分表实体展开成它的每一张实际表。
   * 用户手里的实体对象按键换成当前 schema 里的那份：mapTables、inSchema 之后 DDL 才落在映射后的表上，不会动到原表
   */
  private targets(entities: readonly Entity[]): Entity[] {
    const current = (e: Entity): Entity => {
      const key = this.keys.get(e);
      return (key && this.ctx.schema.entities[key]) || e;
    };
    const list =
      entities.length > 0
        ? entities.map(current)
        : Object.values(this.ctx.schema.entities).filter((e) => !e.derived);
    return list.flatMap((e) => {
      if (!e.sharding) return [e];
      const { sharding: _sharding, ...plain } = e;
      return e.sharding.tables(e.table).map((table): Entity => ({ ...plain, table }));
    });
  }

  /**
   * 执行还没执行过的迁移（按 id 的顺序），记进历史表（默认 eqts_migrations，没有就建），返回这次执行的 id。
   * 每条迁移连同它的历史记录在一个事务里（DDL 能放进事务的库）；已经执行过的迁移被改了（校验和对不上）直接报错。见 migrate.ts。
   *
   * 几个实例同时启动、同时迁移时排队，每条只执行一次：PostgreSQL、SQL Server 用事务级的咨询锁；MySQL、MariaDB 用
   * GET_LOCK，锁拿在另一条连接上，所以迁移期间要占两条连接（连接池只有一条时传 `lock: false`，自己保证只有一个实例在迁移）。
   * 别的库没有可用的锁，迁移放在发布流程里由一个进程执行。
   *
   * 某条迁移失败时抛 MigrationError：说明是哪一条的第几条语句、做过的改动有没有回滚
   */
  migrate(
    this: Requires<S, 'write', Db<S>>,
    migrations: readonly Migration[],
    options?: { readonly table?: string; readonly lock?: boolean },
  ): Promise<string[]>;
  async migrate(
    migrations: readonly Migration[],
    options: { readonly table?: string; readonly lock?: boolean } = {},
  ): Promise<string[]> {
    assertWritable(this.ctx);
    const history = historyEntity(options.table ?? 'eqts_migrations');
    const dialect = this.ctx.dialect;
    const key = `eqts.migrate:${bareName(history.table)}`.slice(0, 64);
    const locks =
      options.lock === false || this.inTransaction ? undefined : dialect.sessionLockStatements('?');
    if (!locks) return this.runMigrations(migrations, history);
    // 会话级的锁：拿在一条专门的连接上（事务只是为了占住这条连接），迁移照常走连接池
    return this.runInTransaction(async (holder) => {
      const statement = (make: (key: string) => string): Statement => {
        const w = new SqlWriter();
        return { sql: make(dialect.bindParam(key, w)), params: w.params };
      };
      const pair = (name: 'acquire' | 'release') =>
        statement((bound) => dialect.sessionLockStatements(bound)![name]);
      const [row] = await query(holder.ctx, pair('acquire'));
      if (!truthy(row?.['ok']))
        throw new Error(`migrate: could not get the lock '${key}'; is another migration stuck?`);
      try {
        return await this.runMigrations(migrations, history);
      } finally {
        await query(holder.ctx, pair('release')).catch(() => undefined);
      }
    });
  }

  private async runMigrations(
    migrations: readonly Migration[],
    history: ReturnType<typeof historyEntity>,
  ): Promise<string[]> {
    // 建历史表也要排队：几个实例同时 CREATE TABLE IF NOT EXISTS，PG 会有一个报系统表的唯一键冲突
    const ensure = async (db: Db<S>): Promise<void> => {
      if (db.ctx.dialect.advisoryLocks && db.inTransaction)
        await db.advisoryLock(`eqts.migrate:${history.table}`);
      if (!findTable(await db.catalog([history]), history.table))
        await execute(db.ctx, { sql: db.ctx.dialect.createTable(history, true), params: [] });
    };
    if (this.ctx.dialect.transactionalDdl && !this.inTransaction)
      await this.runInTransaction(ensure);
    else await ensure(this);
    const applied = new Map(
      (await this.usePrimary().queryable(history).toList()).map((row) => [row.id, row.checksum]),
    );
    const done: string[] = [];
    for (const migration of ordered(migrations)) {
      const sum = checksum(migration);
      const before = applied.get(migration.id);
      if (before !== undefined) {
        // 函数写的迁移不校验（见 migrate.ts）；以前的版本给它记过源码的校验和，也不拿来比
        if (before !== sum && typeof migration.up !== 'function')
          throw changed(migration.id, before, sum);
        continue;
      }
      const run = async (db: Db<S>): Promise<boolean> => {
        // 几个实例同时启动、同时迁移：有咨询锁的库按历史表排队，轮到自己时再看一眼是不是已经被别人执行了
        if (db.ctx.dialect.advisoryLocks && db.inTransaction) {
          await db.advisoryLock(`eqts.migrate:${history.table}`);
          const [raced] = await db
            .queryable(history)
            .where((h) => h.id.eq(migration.id))
            .toList();
          if (raced) {
            if (raced.checksum !== sum && typeof migration.up !== 'function')
              throw changed(migration.id, raced.checksum, sum);
            return false;
          }
        }
        const rolledBack = db.ctx.dialect.transactionalDdl && db.inTransaction;
        if (typeof migration.up === 'function') {
          await migration.up(db).catch((cause: unknown) => {
            throw migrationFailed(migration, undefined, rolledBack, cause);
          });
        } else {
          for (const [index, sql] of migration.up.entries())
            await execute(db.ctx, { sql, params: [] }).catch((cause: unknown) => {
              throw migrationFailed(migration, index, rolledBack, cause);
            });
        }
        await (db as unknown as Db<AnySchema>)
          .insert(history)
          .values({ id: migration.id, checksum: sum, appliedAt: new Date() })
          .execute();
        return true;
      };
      const ran =
        this.ctx.dialect.transactionalDdl && !this.inTransaction
          ? await this.runInTransaction(run)
          : await run(this);
      if (ran) done.push(migration.id);
    }
    return done;
  }

  /** 逐条执行 DDL；能放进事务的库在一个事务里执行 */
  private async runDdl(statements: readonly string[]): Promise<void> {
    if (statements.length === 0) return;
    assertWritable(this.ctx);
    const run = async (db: Db<S>) => {
      for (const sql of statements) await execute(db.ctx, { sql, params: [] });
    };
    if (this.ctx.dialect.transactionalDdl && !this.inTransaction) await this.runInTransaction(run);
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
   * 在这个 Db 上再挂一组 schema（插件、按需加载的模块）：返回同时认识两组实体的 Db，连接、拦截器、取消信号与事务都共用——
   * 在事务里的 tx 上 mount，挂上的实体也在同一个事务里。跨组的关系写在第二个参数里，与 mergeSchemas 的写法一样：
   * ```ts
   * const sdb = db.mount(shop, { Order: (r) => ({ customer: r.one('Customer', { from: 'customerId', to: 'id' }) }) })
   * await sdb.queryable(Order).where((o) => o.customer.name.eq('acme')).toList()
   * ```
   * 实体键与已挂的重名、新导航与已有的重名，在调用处就报错
   */
  mount<
    T extends AnySchema,
    R extends { [K in keyof MergedEntities<[S, T]>]?: Record<string, Relation> } = {},
  >(
    schema: T & DistinctEntities<[S, T]>,
    relations?: RelationDefs<MergedEntities<[S, T]>, R> &
      DistinctNavigations<MergedEntities<[S, T]>, MergedRelations<[S, T]>, R>,
  ): Db<WithCapabilities<MergedSchema<[S, T], R>, CapabilitiesOf<S>>> {
    const merged = (
      mergeSchemas as (schemas: readonly AnySchema[], relations?: unknown) => AnySchema
    )([this.ctx.schema, schema], relations);
    const keys = new Map(this.keys);
    for (const [key, entity] of Object.entries((schema as AnySchema).entities))
      keys.set(entity, key);
    return new Db({ ...this.ctx, schema: merged }, this.adapter, keys, this.inTransaction) as never;
  }

  /**
   * 预编译一条查询：SQL 只渲染一次，之后每次只换参数（热点接口省掉每次拼 SQL）。p 的每个属性是同名的占位值；
   * 在回调参数上标出 p 的类型，结果类型照常推断：
   * ```ts
   * const byName = db.prepare((p: { name: string }) => db.queryable(User).where((u) => u.name.eq(p.name)))
   * await byName.toList({ name: 'alice' })
   * ```
   * 见 PreparedQuery 的限制
   */
  prepare<P extends Record<string, unknown>, Out>(
    make: (p: P) => Query<Out>,
  ): PreparedQuery<P, Out> {
    return prepareQuery(make);
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
   * PG、MySQL 的驱动同时在服务端终止正在跑的语句（pg_cancel_backend、KILL QUERY）；别的库只是"客户端不再等"。
   * 每条语句的超时用 withTimeout
   */
  withSignal(signal: AbortSignal): Db<S> {
    return new Db({ ...this.ctx, signal }, this.adapter, this.keys, this.inTransaction);
  }

  /** 任意一条语句的执行计划（queryWatch 的慢查询带计划时用），见 Query.explain */
  explain(statement: Statement, options?: ExplainOptions): Promise<unknown> {
    return explain(primary(this.ctx), statement, options);
  }

  /**
   * 每条语句最多跑这么多毫秒（从发出算起，各自计时），到点按取消处理：调用方立刻以 TimeoutError 失败，
   * PG、MySQL 的语句在服务端被终止。整个 Db 的默认见 createDb 的 statementTimeout；流式读取不受它限制
   */
  withTimeout(ms: number): Db<S> {
    if (!Number.isSafeInteger(ms) || ms <= 0)
      throw new RangeError(`timeout must be a positive number of milliseconds, got ${ms}`);
    return new Db({ ...this.ctx, timeoutMs: ms }, this.adapter, this.keys, this.inTransaction);
  }

  /**
   * work 里用 tx 执行的语句在同一个事务里；work 抛错时回滚。
   * 已经在事务里再调用，开的是嵌套事务（保存点）：work 抛错只回滚到保存点，外层事务不受影响（异常仍会抛出，由调用方决定要不要吞掉）。
   *
   * `retries`：遇到死锁、串行化失败（DeadlockError、SerializationError）时把整个 work 重新执行，最多这么多次，每次之间稍等一下。
   * 这两种错误是数据库在几个事务相互冲突时挑一个回滚，重来多半能成。work 会被执行几遍：里面不能有回滚不掉的副作用
   * （发消息、调外部接口放到 afterCommit 里，它只在成功的那一遍之后执行）。默认 0，不重试
   * ```ts
   * await db.transaction(transfer, { isolation: 'serializable', retries: 3 });
   * ```
   */
  transaction<T>(
    this: Requires<S, 'transactions', Db<S>>,
    work: (tx: Db<S>) => Promise<T>,
    options?: TransactionOptions & RetryOptions,
  ): Promise<T>;
  async transaction<T>(
    work: (tx: Db<S>) => Promise<T>,
    options: TransactionOptions & RetryOptions = {},
  ): Promise<T> {
    const { retries = 0, ...transaction } = options;
    if (!Number.isSafeInteger(retries) || retries < 0)
      throw new RangeError(`retries must be a non-negative integer, got ${retries}`);
    if (retries > 0 && this.inTransaction)
      throw new Error(
        'retries only apply to the outermost transaction: a deadlock rolls the whole transaction back, not a savepoint',
      );
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.runInTransaction(work, transaction);
      } catch (error) {
        const retryable = error instanceof DeadlockError || error instanceof SerializationError;
        if (!retryable || attempt >= retries) throw error;
        // 冲突的几个事务同时重来又会撞上：等的时间逐次加长，并带上随机量错开
        const wait = Math.min(1000, 20 * 2 ** attempt) * (0.5 + Math.random() / 2);
        await new Promise((resolve) => setTimeout(resolve, wait));
      }
    }
  }

  /** transaction 的实现；内部（save、remove、syncTables）不看能力直接用：没有事务的库由驱动依次执行 */
  private async runInTransaction<T>(
    work: (tx: Db<S>) => Promise<T>,
    options?: TransactionOptions,
  ): Promise<T> {
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
      // 提交时才报的错（串行化失败）没经过语句的执行：在这里归一
      throw databaseError(this.ctx.dialect, error);
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
  lock<E extends SchemaEntity<S>>(
    this: Requires<S, 'lock', Db<S>>,
    entity: E,
    key: KeyInput<E>,
  ): Promise<boolean>;
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

  /**
   * 咨询锁（ROADMAP 19.10，PostgreSQL、SQL Server）：按一个名字加锁直到事务结束——没有对应的行也能锁（"同一时间只有一个任务在生成月报"），
   * 跨进程、跨机器都生效。`wait: false` 时拿不到立即返回 false（不排队），默认等到拿到为止返回 true
   * ```ts
   * await db.transaction(async (tx) => {
   *   if (!(await tx.advisoryLock(`report:${month}`, { wait: false }))) return; // 别人在做
   *   …
   * });
   * ```
   */
  async advisoryLock(key: string, options: { readonly wait?: boolean } = {}): Promise<boolean> {
    if (!this.inTransaction)
      throw new Error(
        'advisoryLock() must be called inside a transaction: the lock lasts until it ends',
      );
    const w = new SqlWriter();
    const sql = this.ctx.dialect.advisoryLockStatement(
      this.ctx.dialect.bindParam(key, w),
      options.wait !== false,
    );
    const [row] = await query(this.ctx, { sql, params: w.params });
    return truthy(row?.['ok']);
  }

  /**
   * 发一条通知（ROADMAP 19.10，PG 的 NOTIFY）：在事务里时随提交发出、回滚就不发。收听用方言包的 listen（PG：easy-query-ts-pg 的 listen）。
   * 二级缓存的失效、跨进程的事件可以接它
   */
  async notify(channel: string, payload = ''): Promise<void> {
    const w = new SqlWriter();
    const dialect = this.ctx.dialect;
    const sql = dialect.notifyStatement(
      dialect.bindParam(channel, w),
      dialect.bindParam(payload, w),
    );
    await query(primary(this.ctx), { sql, params: w.params });
  }

  /** 嵌套事务：SAVEPOINT，成功则释放，失败则回滚到保存点 */
  private async nested<T>(work: (tx: Db<S>) => Promise<T>): Promise<T> {
    const dialect = this.ctx.dialect;
    const hooks = this.ctx.hooks!;
    const name = `eqts_sp_${++hooks.savepoints}`;
    await execute(this.ctx, { sql: dialect.savepoint(name), params: [] });
    const release = dialect.releaseSavepoint(name);
    // 保存点里登记的钩子另起一帧：成功并进外层，回滚则丢掉提交后的、执行回滚后的
    const frames = hooks.frames;
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
  begin(
    this: Requires<S, 'transactions', Db<S>>,
    options?: TransactionOptions,
  ): Promise<Transaction<S>>;
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
      // 事务没开起来（连不上库、BEGIN 失败）时 finished 没有人等：错误已经由 reject 交给调用方，这里接住，免得成了未处理的拒绝
      finished.catch(() => undefined);
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

/** 已经执行过的迁移被改了：校验和对不上 */
/** 驱动读出的"真"：各库给 true、1、't'、'1'，64 位整数的还会给 1n */
function truthy(value: unknown): boolean {
  return value === true || value === 1 || value === 1n || value === 't' || value === '1';
}

/** 一条迁移执行失败：说清是哪一条语句、做过的改动还在不在 */
function migrationFailed(
  migration: Migration,
  index: number | undefined,
  rolledBack: boolean,
  cause: unknown,
): MigrationError {
  const reason = cause instanceof Error ? cause.message : String(cause);
  const where = index === undefined ? '' : ` at statement ${index + 1} of ${migration.up.length}`;
  const state = rolledBack
    ? 'the migration was rolled back'
    : index === undefined
      ? 'this database does not roll DDL back: what the migration did before failing stays applied and it is not recorded'
      : index === 0
        ? 'nothing of this migration was applied'
        : `this database does not roll DDL back: statements 1 to ${index} stay applied and the migration is not recorded; ` +
          'fix the database by hand (or remove those statements from the migration) before running migrate again';
  return new MigrationError(`migration '${migration.id}' failed${where}: ${reason} (${state})`, {
    id: migration.id,
    statement: index === undefined ? undefined : index + 1,
    rolledBack: rolledBack || index === 0,
    cause,
  });
}

function changed(id: string, before: string, now: string): Error {
  return new Error(
    `migration '${id}' was changed after it was applied (checksum ${before} → ${now}); add a new migration instead`,
  );
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

type OnExecute = (event: ExecutionEvent) => void;

/** 几个 onExecute 钩子合成一个 */
function chain(hooks: OnExecute | readonly OnExecute[] | undefined): OnExecute | undefined {
  if (typeof hooks === 'function' || !hooks) return hooks;
  if (hooks.length <= 1) return hooks[0];
  return (event) => {
    for (const hook of hooks) hook(event);
  };
}

/** 写入用的上下文：只读的 Db 报错，写入走主库 */
function writable(ctx: Context): Context {
  assertWritable(ctx);
  return primary(ctx);
}

/** 去掉从库：写入与要读到最新数据的地方用 */
function primary(ctx: Context): Context {
  return ctx.replicas ? { ...ctx, replicas: undefined } : ctx;
}

function replicaSet<S extends AnySchema>(options: DbOptions<S>): Replicas | undefined {
  const replicas = options.replicas ?? [];
  if (replicas.length === 0) return undefined;
  for (const replica of replicas)
    if (replica.dialect.name !== options.adapter.dialect.name)
      throw new Error(
        `a replica must use the same dialect as the primary (${options.adapter.dialect.name}), got ${replica.dialect.name}`,
      );
  return { sessions: replicas.map((r) => r.driver), next: 0 };
}

export function createDb<S extends AnySchema, C extends Capability = Capability>(
  options: DbOptions<S> & { readonly adapter: Adapter<C> },
): Db<WithCapabilities<S, C>> {
  const keys = new Map<Entity, string>();
  for (const [key, entity] of Object.entries(options.schema.entities)) keys.set(entity, key);
  const ctx: Context = {
    schema: options.schema,
    dialect: options.adapter.dialect,
    session: options.adapter.driver,
    log: options.log,
    onExecute: chain(options.onExecute),
    signal: undefined,
    timeoutMs: options.statementTimeout,
    hooks: undefined,
    replicas: replicaSet(options),
    guards: {
      hardDelete: options.hardDelete ?? 'allow',
      maxRows: options.maxRows,
      reversePageAfter: options.reversePageAfter,
      readonly: false,
    },
    // 列修饰器驱动的内置规则在前，用户的拦截器在后
    interceptors: new Interceptors([...columnRules(), ...(options.interceptors ?? [])]),
  };
  return new Db(ctx, options.adapter, keys, false) as never;
}
