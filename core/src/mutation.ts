/**
 * 插入、更新、删除。更新与删除没有条件时拒绝执行，要整表操作显式调用 all()；条件全被跳过（例如 `id && u.id.eq(id)` 里 id 为空）同样算没有条件。
 */
import { checkAliases, type ConflictNode, type Node, type SelectNode } from './ast.ts';
import { SqlWriter, type Statement } from './dialect.ts';
import { condNode, Expr, toNode, type Cond } from './expr.ts';
import { newQueryable, type Built, type Query } from './query.ts';
import { REF, refColumn, Scope, type Ref } from './ref.ts';
import type { AnySchema, EntityKey } from './relations.ts';
import {
  flattenRow,
  nestRow,
  setPath,
  type AnyColumn,
  type Embedded,
  type Entity,
  type AllNullable,
  type Fields,
  type Insert,
  type Row,
  type UpdateOf,
  type ValueOf,
} from './schema.ts';
import {
  Interceptors,
  type InterceptorName,
  type InterceptorToggle,
  type WriteDetail,
} from './interceptor.ts';
import { execute, query, type Context } from './session.ts';

type EntityOf<S extends AnySchema, K extends EntityKey<S>> = S['entities'][K];

export class Insertable<S extends AnySchema, K extends EntityKey<S>> {
  private readonly ctx: Context;
  private readonly key: K;

  constructor(ctx: Context, key: K) {
    this.ctx = ctx;
    this.key = key;
  }

  /** 这条语句不用这些拦截器（名字见 InterceptorNames） */
  noInterceptor(...names: InterceptorName[]): Insertable<S, K> {
    return this.interceptors({ skip: names });
  }

  /** 这条语句打开这些拦截器（含默认关着的） */
  useInterceptor(...names: InterceptorName[]): Insertable<S, K> {
    return this.interceptors({ use: names });
  }

  /** 这条语句的拦截器开关，见 InterceptorToggle */
  interceptors(toggle: InterceptorToggle): Insertable<S, K> {
    return new Insertable(withToggle(this.ctx, toggle), this.key);
  }

  /** 从一条查询插入（INSERT … SELECT），见 InsertSelect */
  fromQuery<Out extends Insert<EntityOf<S, K>>>(query: Query<Out>): InsertSelect {
    return new InsertSelect(this.ctx, this.ctx.schema.entities[this.key]!, query.buildTree());
  }

  /** 一行或多行；多行时列不同的行分成几条语句 */
  values(rows: Insert<EntityOf<S, K>> | readonly Insert<EntityOf<S, K>>[]): InsertValues<S, K> {
    const list = (Array.isArray(rows) ? rows : [rows]) as readonly Record<string, unknown>[];
    return new InsertValues(this.ctx, this.key, list, undefined);
  }
}

/**
 * 带 RETURNING 的语句：执行后返回受影响行里选定的列（已按列类型解码）。
 * 写法：`insert(X).values(row).returning('id')`、`update(X).set(…).where(…).returning('id', 'name')`；不写列名就是整行。
 * PG、SQLite 支持；MySQL、HANA 没有 RETURNING，渲染时报不支持。
 */
export class Returning<R> {
  private readonly ctx: Context;
  private readonly entity: Entity;
  private readonly statements: readonly Statement[];
  private readonly props: readonly string[];
  private readonly detail: WriteDetail;

  constructor(
    ctx: Context,
    entity: Entity,
    statements: readonly Statement[],
    props: readonly string[],
    detail: WriteDetail,
  ) {
    this.ctx = ctx;
    this.entity = entity;
    this.statements = statements;
    this.props = props;
    this.detail = detail;
  }

  toSQL(): Statement[] {
    const columns = this.props.map((p) => this.entity.columnNames[p]!);
    const clause = this.ctx.dialect.returningColumns(columns);
    return this.statements.map((s) => ({ sql: s.sql + clause, params: s.params }));
  }

  async execute(): Promise<R[]> {
    const out: R[] = [];
    for (const statement of this.toSQL()) {
      for (const row of await query(this.ctx, statement)) {
        // 值对象的列放回嵌套对象
        const item: Record<string, unknown> = {};
        out.push(item as R);
        for (const p of this.props) {
          const raw = row[this.entity.columnNames[p]!];
          setPath(
            item,
            p,
            raw === null || raw === undefined ? null : this.entity.columns[p]!.codec.decode(raw),
          );
        }
      }
    }
    await this.ctx.interceptors.afterWrite({
      ...this.detail,
      entity: this.entity,
      affected: out.length,
      statements: this.statements,
    });
    return out;
  }
}

/** returning 的列名：不写就是整行；写了就只取这些（类型检查只允许实体的列） */
function returningProps(entity: Entity, columns: readonly string[]): string[] {
  const all = Object.keys(entity.columns);
  // 选了值对象时取它的每一列
  const props =
    columns.length > 0
      ? columns.flatMap((c) => {
          const found = all.filter((p) => p === c || p.startsWith(`${c}.`));
          if (found.length === 0) throw new Error(`${entity.table} has no column '${c}'`);
          return found;
        })
      : all;
  const converted = props.filter((p) => entity.columns[p]!.options.sqlRead);
  if (converted.length > 0)
    throw new Error(
      `returning() cannot read ${converted.join(', ')} of ${entity.table}: RETURNING gives the stored value, not the sqlConvert read`,
    );
  return props;
}

/** 写进某一列的值：按列编码绑定；列声明了 sqlConvert 的 write 时再包一层 */
function columnValue(column: AnyColumn, value: unknown): Node {
  const node = toNode(value, column.codec);
  const write = column.options.sqlWrite;
  return write ? write(new Expr(node, column.codec)).node : node;
}

/** 一批按主键更新的语句，见 Updatable.entities */
export class BatchUpdate {
  private readonly updates: readonly { execute(): Promise<number>; toSQL(): Statement }[];

  constructor(updates: readonly { execute(): Promise<number>; toSQL(): Statement }[]) {
    this.updates = updates;
  }

  toSQL(): Statement[] {
    return this.updates.map((u) => u.toSQL());
  }

  async execute(): Promise<number> {
    let affected = 0;
    for (const update of this.updates) affected += await update.execute();
    return affected;
  }
}

/**
 * INSERT … SELECT：把一条查询的结果直接插进表里，数据不经过应用。查询的 select 键就是目标列名，
 * 列的值类型必须和目标列一致，目标列里必填的都要有。**不经过插入拦截器**（租户、默认值、版本等要在 select 里自己给）。
 * ```ts
 * await db.insert(PostArchive).fromQuery(db.queryable(Post).where(p => p.createdAt.lt(cutoff)).select(p => ({ id: p.id, userId: p.userId, title: p.title, amount: p.amount }))).execute()
 * ```
 */
export class InsertSelect {
  private readonly ctx: Context;
  private readonly entity: Entity;
  private readonly built: Built;

  constructor(ctx: Context, entity: Entity, built: Built) {
    this.ctx = ctx;
    this.entity = entity;
    this.built = built;
  }

  toSQL(): Statement {
    const { select, shape } = this.built;
    if (!shape.flat || shape.named.size === 0)
      throw new Error(
        'fromQuery needs a select made of plain expressions (or no select, i.e. whole rows)',
      );
    const keys = [...shape.named.keys()];
    for (const k of keys)
      if (!(k in this.entity.columns))
        throw new Error(`fromQuery: ${this.entity.table} has no column '${k}'`);
    // 查询输出列按 select 的键顺序，别名统一成 c0、c1 …，与 INSERT 的列表按位置对应
    const source: SelectNode = {
      ...select,
      columns: keys.map((k, i) => ({
        e: select.columns.find((c) => c.as === shape.named.get(k)!.alias)!.e,
        as: `c${i}`,
      })),
    };
    checkAliases(source);
    const w = new SqlWriter();
    const sql = this.ctx.dialect.insert(
      {
        table: this.entity.table,
        columns: keys.map((k) => this.entity.columnNames[k]!),
        rows: [],
        conflict: undefined,
        source,
      },
      w,
    );
    return { sql, params: w.params };
  }

  /** 返回插入的行数 */
  async execute(): Promise<number> {
    const statement = this.toSQL();
    const affected = (await execute(this.ctx, statement)).affected;
    await this.ctx.interceptors.afterWrite({
      kind: 'insert',
      rows: [],
      entity: this.entity,
      affected,
      statements: [statement],
    });
    return affected;
  }
}

type Columns<S extends AnySchema, K extends EntityKey<S>> = (
  r: Ref<S, K>,
) => Expr<unknown> | readonly Expr<unknown>[];

export class InsertValues<S extends AnySchema, K extends EntityKey<S>> {
  private readonly ctx: Context;
  private readonly key: K;
  private readonly entity: Entity;
  private readonly rows: readonly Record<string, unknown>[];
  private readonly conflict: ConflictNode | undefined;
  /** 经过插入拦截器、$default 填好值的行：只算一次，toSQL 和 returnEntity 看到同一份（$default 可能是随机的 uuid） */
  private filledRows: Record<string, unknown>[] | undefined;

  constructor(
    ctx: Context,
    key: K,
    rows: readonly Record<string, unknown>[],
    conflict: ConflictNode | undefined,
  ) {
    this.ctx = ctx;
    this.key = key;
    this.entity = ctx.schema.entities[key]!;
    this.rows = rows.map((row) => flattenRow(this.entity, row));
    this.conflict = conflict;
  }

  /**
   * upsert：target 列（主键或唯一键）冲突时怎么办。
   * ```ts
   * db.insert(User).values(row).onConflict(u => u.id).merge(u => [u.name, u.age])   // 用新值更新这些列；不传为插入的全部非冲突列
   * db.insert(User).values(row).onConflict(u => u.email).ignore()                    // 已存在就跳过
   * ```
   * MySQL 按表上的主键 / 唯一键判断冲突（ON DUPLICATE KEY UPDATE），target 只用于 ignore 时的空更新。
   */
  onConflict(target: Columns<S, K>): {
    merge: (columns?: Columns<S, K>) => InsertValues<S, K>;
    ignore: () => InsertValues<S, K>;
  } {
    const targetColumns = this.columnNames(target);
    return {
      merge: (columns) => {
        const update = columns
          ? this.columnNames(columns)
          : this.insertedColumns().filter((c) => !targetColumns.includes(c));
        if (update.length === 0)
          throw new Error(
            `onConflict(..).merge() on ${this.entity.table} has no column to update; use ignore()`,
          );
        return new InsertValues(this.ctx, this.key, this.rows, { target: targetColumns, update });
      },
      ignore: () =>
        new InsertValues(this.ctx, this.key, this.rows, { target: targetColumns, update: [] }),
    };
  }

  /** lambda 里选的列 → 库里的列名（按表达式找回是哪一列：声明了 sqlConvert 的列读出来不是裸列） */
  private columnNames(pick: Columns<S, K>): string[] {
    const root = new Scope(this.ctx.schema, { n: 0 }, false).root(this.key);
    const picked = pick(root as Ref<S, K>);
    const props = Object.keys(this.entity.columns);
    return (Array.isArray(picked) ? picked : [picked]).map((e: Expr<unknown>) => {
      const prop = props.find((p) => refColumn(root, p) === e);
      if (prop === undefined)
        throw new Error('onConflict / merge take plain columns of the inserted entity');
      return this.entity.columnNames[prop]!;
    });
  }

  private insertedColumns(): string[] {
    const props = Object.keys(this.entity.columns).filter((p) =>
      this.rows.some((r) => r[p] !== undefined),
    );
    return props.map((p) => this.entity.columnNames[p]!);
  }

  /** 插入后返回这些列（已解码）；见 Returning */
  returning(): Returning<Row<EntityOf<S, K>>>;
  returning<C extends keyof Row<EntityOf<S, K>> & string>(
    ...columns: C[]
  ): Returning<Pick<Row<EntityOf<S, K>>, C>>;
  returning(...columns: string[]): Returning<unknown> {
    return new Returning(
      this.ctx,
      this.entity,
      this.toSQL(),
      returningProps(this.entity, columns),
      this.detail(),
    );
  }

  /** 返回影响的行数 */
  async execute(): Promise<number> {
    let affected = 0;
    const statements = this.toSQL();
    for (const statement of statements) affected += (await execute(this.ctx, statement)).affected;
    await this.ctx.interceptors.afterWrite({
      ...this.detail(),
      entity: this.entity,
      affected,
      statements,
    });
    return affected;
  }

  /** 单行插入，返回自增主键 */
  async returnId(): Promise<number | bigint> {
    const statements = this.toSQL();
    if (this.rows.length !== 1 || statements.length !== 1)
      throw new Error('returnId() needs exactly one row');
    let id: number | bigint;
    if (this.ctx.dialect.generatedKeys === 'returning') {
      id = await this.returnIdByReturning(statements[0]!);
    } else {
      const result = await execute(this.ctx, statements[0]!);
      if (result.insertId === undefined)
        throw new Error(`the ${this.ctx.dialect.name} driver did not report a generated key`);
      id = result.insertId;
    }
    await this.ctx.interceptors.afterWrite({
      ...this.detail(),
      entity: this.entity,
      affected: 1,
      statements,
    });
    return id;
  }

  /**
   * 插入一行并返回完整的行（含自增主键、库里的默认值、触发器改过的值）。
   * 支持 RETURNING 的库（PG、SQLite）一条语句搞定；MySQL、HANA 先插入拿到主键，再按主键查回来。
   */
  async returnEntity(): Promise<Row<EntityOf<S, K>>> {
    if (this.rows.length !== 1) throw new Error('returnEntity() needs exactly one row');
    if (this.entity.primaryKey.length === 0)
      throw new Error(`returnEntity() needs a primary key on ${this.entity.table}`);
    // sqlConvert 的列 RETURNING 拿不到转换后的值：插入后再按主键查回
    const converted = Object.values(this.entity.columns).some((c) => c.options.sqlRead);
    if (this.ctx.dialect.supportsReturning && !converted)
      return (await this.returning().execute())[0] as Row<EntityOf<S, K>>;
    const values: Record<string, unknown> = { ...this.filled()[0] };
    const generated = this.entity.primaryKey.filter((k) => values[k] === undefined);
    if (generated.length > 1)
      throw new Error('returnEntity() can only generate a single-column primary key');
    if (generated.length === 1) values[generated[0]!] = await this.returnId();
    else await this.execute();
    const key = this.key;
    const found = await newQueryable(this.ctx, key)
      .where((r: any) =>
        this.entity.primaryKey.map((k) => (r[k] as Expr<unknown>).eq(values[k] as never)),
      )
      .first();
    if (!found)
      throw new Error(
        `returnEntity(): the inserted row of ${this.entity.table} is not visible to the current interceptors`,
      );
    return found as Row<EntityOf<S, K>>;
  }

  private async returnIdByReturning(statement: Statement): Promise<number | bigint> {
    const key = this.entity.primaryKey[0];
    if (key === undefined)
      throw new Error(`returnId() needs a primary key on ${this.entity.table}`);
    const rows = await query(this.ctx, {
      sql: statement.sql + this.ctx.dialect.returning(this.entity.columnNames[key]!),
      params: statement.params,
    });
    const value = rows[0] ? Object.values(rows[0])[0] : undefined;
    if (value === undefined || value === null)
      throw new Error(`insert into ${this.entity.table} returned no key`);
    if (typeof value === 'number' || typeof value === 'bigint') return value;
    // int8 以文字返回：安全范围内给 number，超出给 bigint
    const n = Number(value);
    return Number.isSafeInteger(n) ? n : BigInt(value as string);
  }

  /** 写了什么：补好值的各行，值对象放回嵌套对象 */
  private detail(): WriteDetail {
    return { kind: 'insert', rows: this.filled().map(nestRow) };
  }

  private filled(): Record<string, unknown>[] {
    return (this.filledRows ??= this.rows.map((r) =>
      this.ctx.interceptors.beforeInsert(r, this.entity),
    ));
  }

  toSQL(): Statement[] {
    if (this.rows.length === 0) return [];
    const groups = new Map<string, Record<string, unknown>[]>();
    for (const row of this.filled()) {
      const props = Object.keys(this.entity.columns).filter((p) => row[p] !== undefined);
      const id = props.join(',');
      let group = groups.get(id);
      if (!group) groups.set(id, (group = []));
      group.push(row);
    }
    return [...groups].flatMap(([id, rows]) => {
      const props = id === '' ? [] : id.split(',');
      if (props.length === 0) throw new Error(`insert into ${this.entity.table} has no values`);
      // 每行占 props.length 个参数；按方言的绑定参数上限切块，一块一条语句（至少一行）
      const perStatement = Math.max(1, Math.floor(this.ctx.dialect.maxBindParams / props.length));
      const statements: Statement[] = [];
      for (let from = 0; from < rows.length; from += perStatement) {
        const w = new SqlWriter();
        const sql = this.ctx.dialect.insert(
          {
            table: this.entity.table,
            columns: props.map((p) => this.entity.columnNames[p]!),
            rows: rows
              .slice(from, from + perStatement)
              .map((r) => props.map((p) => columnValue(this.entity.columns[p]!, r[p]))),
            conflict: this.conflict,
          },
          w,
        );
        statements.push({ sql, params: w.params });
      }
      return statements;
    });
  }
}

/** 一组声明的列在 set 里的形状：每列可以是值或表达式，值对象可以只给其中几项 */
export type SetOf<F extends Fields> = {
  [C in keyof F]?: F[C] extends Embedded<infer G>
    ? SetOf<G> | (AllNullable<G> extends true ? null : never)
    : ValueOf<F[C]> | Expr<ValueOf<F[C]>>;
};

/** set 里每列可以是值或表达式（`u.age.plus(1)`） */
export type SetValues<S extends AnySchema, K extends EntityKey<S>> = SetOf<
  EntityOf<S, K>['fields']
>;

/** 实体的版本列（属性名）；没有时 undefined */
function versionColumn(entity: Entity): string | undefined {
  return Object.keys(entity.columns).find((p) => entity.columns[p]!.options.version);
}

/** 版本列的下一个版本：有规则用规则，没有就按整数加 1 */
function nextVersion(column: AnyColumn, current: unknown): unknown {
  const next = column.options.version!.next;
  if (next) return next(current);
  return typeof current === 'bigint' ? current + 1n : Number(current) + 1;
}

/** entity(row)、changes 会写的列：主键、版本（由版本条件另写）、只插入的列不写 */
function updatableColumn(entity: Entity, prop: string): boolean {
  const options = entity.columns[prop]!.options;
  return !entity.primaryKey.includes(prop) && !options.version && !options.insertOnly;
}

/** 两个值在这一列上是否相同：按列的编码比（日期比时刻、JSON 比内容、decimal.js 比文字、二进制逐字节） */
function sameValue(column: AnyColumn, a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || a === undefined || b === null || b === undefined) return false;
  const x = column.codec.encode(a);
  const y = column.codec.encode(b);
  if (x instanceof Uint8Array && y instanceof Uint8Array)
    return x.length === y.length && x.every((byte, i) => byte === y[i]);
  return x === y || String(x) === String(y);
}

/** 叠加了拦截器开关的执行上下文 */
function withToggle(ctx: Context, toggle: InterceptorToggle): Context {
  return { ...ctx, interceptors: ctx.interceptors.configure(toggle) };
}

interface WriteState {
  readonly where: readonly ((r: any) => Cond)[];
  readonly all: boolean;
  /** 带版本条件（entity(row)、changes、withVersion）时的当前版本：条件是版本等于它，写入它的下一个；一行都没更新到说明被别人改过，要抛错 */
  readonly version?: { readonly current: unknown };
  /** changes(before, after) 比出来没有变化：execute 不发语句，返回 0 */
  readonly unchanged?: boolean;
  /** expectRows：改到的行数必须是 count，否则抛 error(实际行数) */
  readonly expect?: { readonly count: number; readonly error: (affected: number) => Error };
}

abstract class Filtered {
  protected readonly ctx: Context;
  protected readonly key: string;
  protected readonly state: WriteState;

  constructor(ctx: Context, key: string, state: WriteState) {
    this.ctx = ctx;
    this.key = key;
    this.state = state;
  }

  /** 新的构建现场：不允许 join（各库对 UPDATE/DELETE 带 JOIN 的写法不一致） */
  protected scope(): { scope: Scope; root: any; where: Node[] } {
    const kind = this.verb === 'delete' ? 'delete' : 'update';
    const scope = new Scope(this.ctx.schema, { n: 0 }, false, this.ctx.interceptors, kind);
    const root = scope.root(this.key);
    const where = this.state.where
      .map((f) => condNode(f(root)))
      .filter((n): n is Node => n !== undefined);
    if (where.length === 0 && !this.state.all) {
      throw new Error(
        `refusing to ${this.verb} every row of ${this.ctx.schema.entities[this.key]!.table} without a condition; call .all() if that is intended`,
      );
    }
    // 拦截器的条件在"有没有条件"的检查之后加：租户条件不算调用方写的条件
    return { scope, root, where: [...where, ...scope.filters(root)] };
  }

  protected abstract readonly verb: string;

  async execute(): Promise<number> {
    // 只构建一次：$onUpdate、逻辑删除的时间这类值每次求值都不同，语句与事件要是同一份
    const { statement, detail } = this.build();
    const affected = (await execute(this.ctx, statement)).affected;
    const expect = this.state.expect;
    if (expect && affected !== expect.count) throw expect.error(affected);
    await this.ctx.interceptors.afterWrite({
      ...detail,
      entity: this.ctx.schema.entities[this.key]!,
      affected,
      statements: [statement],
    });
    return affected;
  }

  toSQL(): Statement {
    return this.build().statement;
  }

  /** 语句与写了什么 */
  protected abstract build(): { statement: Statement; detail: WriteDetail };
}

export class Updatable<S extends AnySchema, K extends EntityKey<S>> extends Filtered {
  protected readonly verb = 'update';
  private readonly values: ((r: any) => Record<string, unknown>) | undefined;

  constructor(
    ctx: Context,
    key: K,
    state: WriteState = { where: [], all: false },
    values?: (r: any) => Record<string, unknown>,
  ) {
    super(ctx, key, state);
    this.values = values;
  }

  set(values: SetValues<S, K> | ((r: Ref<S, K>) => SetValues<S, K>)): Updatable<S, K> {
    const fn = typeof values === 'function' ? values : () => values;
    return new Updatable(
      this.ctx,
      this.key as K,
      this.state,
      fn as (r: any) => Record<string, unknown>,
    );
  }

  /**
   * 改到的行数必须是 count，否则抛 error(实际行数)（在事务里就整个回滚）。带状态条件的更新用它：改到 0 行说明已被别人处理
   * ```ts
   * await tx.update(WorkItem).set({ state: 'done' }).where((w) => [w.id.eq(id), w.state.eq('open')])
   *   .expectRows(1, () => new AlreadyHandled(id)).execute()
   * ```
   */
  expectRows(count: number, error: (affected: number) => Error): Updatable<S, K> {
    return new Updatable(
      this.ctx,
      this.key as K,
      { ...this.state, expect: { count, error } },
      this.values,
    );
  }

  where(filter: (r: Ref<S, K>) => Cond): Updatable<S, K> {
    return new Updatable(
      this.ctx,
      this.key as K,
      { ...this.state, where: [...this.state.where, filter] },
      this.values,
    );
  }

  /**
   * 按主键更新整行：set 除主键外的所有列（值为 undefined 的列跳过），where 主键相等；有版本列时带上版本条件。
   * ```ts
   * const user = await db.queryable(User).where(u => u.id.eq(1)).single()
   * await db.update(User).entity({ ...user, name: 'b' }).execute()
   * ```
   */
  entity(row: Row<EntityOf<S, K>>): Updatable<S, K> {
    const entity = this.ctx.schema.entities[this.key]!;
    const values = flattenRow(entity, row as Record<string, unknown>);
    const set = Object.fromEntries(
      Object.keys(entity.columns)
        .filter((p) => values[p] !== undefined && updatableColumn(entity, p))
        .map((p) => [p, values[p]]),
    );
    return this.byKey(entity, values, set, 'update(..).entity(..)');
  }

  /**
   * 差异更新（对应 Java 版追踪模式下的差异更新，但不需要追踪上下文）：只 set 从 before 到 after 变了的列，
   * 按 before 的主键（与版本）定位；比较按列的类型（日期比时刻、JSON 比内容、decimal 比文字），值对象逐项比。
   * after 可以是改过的整行，也可以只是表单提交的几项；没有变化时 execute 不发语句、返回 0
   * ```ts
   * const before = await tx.queryable(User).findOrThrow(id);
   * await tx.update(User).changes(before, { ...before, ...form }).execute();
   * ```
   */
  changes(before: Row<EntityOf<S, K>>, after: UpdateOf<EntityOf<S, K>['fields']>): Updatable<S, K> {
    const entity = this.ctx.schema.entities[this.key]!;
    const old = flattenRow(entity, before as Record<string, unknown>);
    const next = flattenRow(entity, after as Record<string, unknown>);
    for (const key of entity.primaryKey)
      if (next[key] !== undefined && !sameValue(entity.columns[key]!, old[key], next[key]))
        throw new Error(`changes(): the primary key '${key}' of ${entity.table} cannot change`);
    const set = Object.fromEntries(
      Object.keys(entity.columns)
        .filter(
          (p) =>
            next[p] !== undefined &&
            updatableColumn(entity, p) &&
            !sameValue(entity.columns[p]!, old[p], next[p]),
        )
        .map((p) => [p, next[p]]),
    );
    const updatable = this.byKey(entity, old, set, 'changes()');
    if (Object.keys(set).length > 0) return updatable;
    return new Updatable(
      this.ctx,
      this.key as K,
      { ...updatable.state, unchanged: true },
      updatable.values,
    );
  }

  /**
   * 表达式更新带上乐观锁（对应 Java 版的 withVersion）：条件加上"版本等于 current"，并写入下一个版本；没更新到行就抛错
   * ```ts
   * await db.update(Doc).set({ title }).where((d) => d.id.eq(id)).withVersion(form.version).execute()
   * ```
   */
  withVersion(current: unknown): Updatable<S, K> {
    const entity = this.ctx.schema.entities[this.key]!;
    if (versionColumn(entity) === undefined)
      throw new Error(`withVersion(): ${entity.table} has no version column`);
    return new Updatable(
      this.ctx,
      this.key as K,
      { ...this.state, version: { current } },
      this.values,
    );
  }

  /** 按主键（与版本）定位一行、set 这些值 */
  private byKey(
    entity: Entity,
    row: Readonly<Record<string, unknown>>,
    set: Record<string, unknown>,
    what: string,
  ): Updatable<S, K> {
    if (entity.primaryKey.length === 0)
      throw new Error(`${what} needs a primary key on ${entity.table}`);
    for (const key of entity.primaryKey)
      if (row[key] === undefined || row[key] === null)
        throw new Error(`${what} needs the primary key '${key}' of ${entity.table}`);
    const version = versionColumn(entity);
    if (version !== undefined && (row[version] === undefined || row[version] === null))
      throw new Error(`${what} needs the version '${version}' of ${entity.table}`);
    const where = (r: any) =>
      entity.primaryKey.map((k) => (refColumn(r, k) as Expr<unknown>).eq(row[k] as never));
    return new Updatable(
      this.ctx,
      this.key as K,
      {
        ...this.state,
        where: [...this.state.where, where],
        ...(version !== undefined ? { version: { current: row[version] } } : {}),
      },
      () => set,
    );
  }

  /** 带乐观锁条件的更新没有更新到任何行：行已被删除或已被别人改过；changes 没有变化时不发语句 */
  override async execute(): Promise<number> {
    if (this.state.unchanged) return 0;
    const affected = await super.execute();
    if (affected === 0 && this.state.version) {
      throw new Error(
        `optimistic lock failed: ${this.ctx.schema.entities[this.key]!.table} row was changed or deleted by someone else`,
      );
    }
    return affected;
  }

  /** 更新后返回这些列（已解码）；见 Returning */
  returning(): Returning<Row<EntityOf<S, K>>>;
  returning<C extends keyof Row<EntityOf<S, K>> & string>(
    ...columns: C[]
  ): Returning<Pick<Row<EntityOf<S, K>>, C>>;
  returning(...columns: string[]): Returning<unknown> {
    const entity = this.ctx.schema.entities[this.key]!;
    const { statement, detail } = this.build();
    return new Returning(this.ctx, entity, [statement], returningProps(entity, columns), detail);
  }

  /**
   * 按主键逐行更新一批实体（每行一条 `entity(row)` 语句，带乐观锁条件），返回总共更新的行数。
   * 不自带事务：要么全成要么全败请放进 `db.transaction`。
   */
  entities(rows: readonly Row<EntityOf<S, K>>[]): BatchUpdate {
    const statements = rows.map((row) =>
      new Updatable<S, K>(this.ctx, this.key as K, this.state, this.values).entity(row),
    );
    return new BatchUpdate(statements);
  }

  /** 这条语句不用这些拦截器（名字见 InterceptorNames） */
  noInterceptor(...names: InterceptorName[]): Updatable<S, K> {
    return this.interceptors({ skip: names });
  }

  /** 这条语句打开这些拦截器（含默认关着的） */
  useInterceptor(...names: InterceptorName[]): Updatable<S, K> {
    return this.interceptors({ use: names });
  }

  /** 这条语句的拦截器开关，见 InterceptorToggle */
  interceptors(toggle: InterceptorToggle): Updatable<S, K> {
    return new Updatable(withToggle(this.ctx, toggle), this.key as K, this.state, this.values);
  }

  all(): Updatable<S, K> {
    return new Updatable(this.ctx, this.key as K, { ...this.state, all: true }, this.values);
  }

  protected build(): { statement: Statement; detail: WriteDetail } {
    if (!this.values) throw new Error('update needs set(...)');
    if (this.state.unchanged)
      throw new Error('changes(): nothing changed, so there is no statement (execute() returns 0)');
    const { root, where } = this.scope();
    const entity = this.ctx.schema.entities[this.key]!;
    const given = flattenRow(entity, this.values(root));
    for (const p of Object.keys(given)) {
      if (given[p] !== undefined && entity.columns[p]?.options.insertOnly)
        throw new Error(`column '${p}' of ${entity.table} is insert-only and cannot be updated`);
    }
    const version = versionColumn(entity);
    const guard = this.state.version;
    // 带版本条件时写入下一个版本（调用方显式给了就用它的）
    if (version !== undefined && guard && given[version] === undefined)
      given[version] = nextVersion(entity.columns[version]!, guard.current);
    const values = this.ctx.interceptors.beforeUpdate(given, entity);
    if (version !== undefined && guard)
      where.push(condNode(refColumn(root, version).eq(guard.current as never))!);
    const set = Object.entries(values)
      .filter(([, v]) => v !== undefined)
      .map(([p, v]) => {
        const column = entity.columns[p];
        if (!column) throw new Error(`${entity.table} has no column '${p}'`);
        return { column: entity.columnNames[p]!, e: columnValue(column, v) };
      });
    // 乐观锁列：没带版本条件的更新（表达式更新、批量更新）也换成下一个版本，别人手里的旧版本就会失效
    if (version !== undefined && values[version] === undefined) {
      const column = entity.columns[version]!;
      const name = entity.columnNames[version]!;
      set.push({
        column: name,
        e: column.options.version!.next
          ? columnValue(column, nextVersion(column, undefined))
          : {
              k: 'op',
              op: '+',
              l: { k: 'col', alias: root[REF].alias, name },
              r: { k: 'lit', sql: '1' },
            },
      });
    }
    if (set.length === 0) throw new Error(`update of ${entity.table} sets no columns`);
    const node = { from: { table: entity.table, alias: root[REF].alias }, set, where };
    checkAliases(node);
    const w = new SqlWriter();
    const written = Object.fromEntries(Object.entries(values).filter(([, v]) => v !== undefined));
    return {
      statement: { sql: this.ctx.dialect.update(node, w), params: w.params },
      detail: { kind: 'update', set: nestRow(written) },
    };
  }
}

export class Deletable<S extends AnySchema, K extends EntityKey<S>> extends Filtered {
  protected readonly verb = 'delete';

  constructor(ctx: Context, key: K, state: WriteState = { where: [], all: false }) {
    super(ctx, key, state);
  }

  where(filter: (r: Ref<S, K>) => Cond): Deletable<S, K> {
    return new Deletable(this.ctx, this.key as K, {
      ...this.state,
      where: [...this.state.where, filter],
    });
  }

  all(): Deletable<S, K> {
    return new Deletable(this.ctx, this.key as K, { ...this.state, all: true });
  }

  /** 删到的行数必须是 count，否则抛 error(实际行数)（在事务里就整个回滚）；同 Updatable 的 expectRows */
  expectRows(count: number, error: (affected: number) => Error): Deletable<S, K> {
    return new Deletable(this.ctx, this.key as K, { ...this.state, expect: { count, error } });
  }

  /** 删除后返回这些列（已解码）；逻辑删除时返回被标记的行。见 Returning */
  returning(): Returning<Row<EntityOf<S, K>>>;
  returning<C extends keyof Row<EntityOf<S, K>> & string>(
    ...columns: C[]
  ): Returning<Pick<Row<EntityOf<S, K>>, C>>;
  returning(...columns: string[]): Returning<unknown> {
    const entity = this.ctx.schema.entities[this.key]!;
    const { statement, detail } = this.build();
    return new Returning(this.ctx, entity, [statement], returningProps(entity, columns), detail);
  }

  /** 物理删除：绕过逻辑删除（读过滤与改写成 update 都不再生效），已被逻辑删除的行也会被删掉 */
  hard(): Deletable<S, K> {
    return this.noInterceptor('softDelete');
  }

  /** 这条语句不用这些拦截器（名字见 InterceptorNames） */
  noInterceptor(...names: InterceptorName[]): Deletable<S, K> {
    return this.interceptors({ skip: names });
  }

  /** 这条语句打开这些拦截器（含默认关着的） */
  useInterceptor(...names: InterceptorName[]): Deletable<S, K> {
    return this.interceptors({ use: names });
  }

  /** 这条语句的拦截器开关，见 InterceptorToggle */
  interceptors(toggle: InterceptorToggle): Deletable<S, K> {
    return new Deletable(withToggle(this.ctx, toggle), this.key as K, this.state);
  }

  protected build(): { statement: Statement; detail: WriteDetail } {
    const { root, where } = this.scope();
    const entity = this.ctx.schema.entities[this.key]!;
    const from = { table: entity.table, alias: root[REF].alias };
    // 逻辑删除：delete 改写成把标记列设为"已删除"的 update，条件不变（读过滤已经保证不会重复删）
    const softSet = this.ctx.interceptors.deleteAsUpdate(entity);
    if (softSet) {
      const set = Object.entries(softSet).map(([p, v]) => ({
        column: entity.columnNames[p]!,
        e: columnValue(entity.columns[p]!, v),
      }));
      const update = { from, set, where };
      checkAliases(update);
      const w = new SqlWriter();
      return {
        statement: { sql: this.ctx.dialect.update(update, w), params: w.params },
        detail: { kind: 'delete', soft: true },
      };
    }
    const node = { from, where };
    checkAliases(node);
    const w = new SqlWriter();
    return {
      statement: { sql: this.ctx.dialect.delete(node, w), params: w.params },
      detail: { kind: 'delete', soft: false },
    };
  }
}

/**
 * 锁住一行（Db.lock）：没有行锁的库（SQLite）用一条把主键写回自己的 UPDATE 拿到写锁。
 * 不经拦截器（不加租户条件、不改更新时间）、不动版本列：锁不改任何数据
 */
export class LockRow extends Filtered {
  protected readonly verb = 'lock';

  constructor(ctx: Context, key: string, where: (r: any) => Cond) {
    super({ ...ctx, interceptors: Interceptors.none }, key, { where: [where], all: false });
  }

  override async execute(): Promise<number> {
    return (await execute(this.ctx, this.toSQL())).affected;
  }

  protected build(): { statement: Statement; detail: WriteDetail } {
    const { root, where } = this.scope();
    const entity = this.ctx.schema.entities[this.key]!;
    const column = entity.columnNames[entity.primaryKey[0]!]!;
    const self: Node = { k: 'col', alias: root[REF].alias, name: column };
    const node = {
      from: { table: entity.table, alias: root[REF].alias },
      set: [{ column, e: self }],
      where,
    };
    checkAliases(node);
    const w = new SqlWriter();
    return {
      statement: { sql: this.ctx.dialect.update(node, w), params: w.params },
      detail: { kind: 'update', set: {} },
    };
  }
}
