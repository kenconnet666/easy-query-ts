/**
 * 插入、更新、删除。更新与删除没有条件时拒绝执行，要整表操作显式调用 all()；条件全被跳过（例如 `id && u.id.eq(id)` 里 id 为空）同样算没有条件。
 */
import { checkAliases, type ConflictNode, type Node, type SelectNode } from './ast.ts';
import { SqlWriter, type Statement } from './dialect.ts';
import { condNode, Expr, toNode, type Cond } from './expr.ts';
import { newQueryable, type Built, type Query } from './query.ts';
import { REF, refColumn, Scope, type Ref } from './ref.ts';
import type { AnySchema, EntityKey } from './relations.ts';
import type { AnyColumn, Entity, Insert, Row, ValueOf } from './schema.ts';
import { Interceptors, refEntity, type WriteEvent } from './interceptor.ts';
import { execute, query, type Context } from './session.ts';

type EntityOf<S extends AnySchema, K extends EntityKey<S>> = S['entities'][K];

export class Insertable<S extends AnySchema, K extends EntityKey<S>> {
  private readonly ctx: Context;
  private readonly key: K;

  constructor(ctx: Context, key: K) {
    this.ctx = ctx;
    this.key = key;
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
  private readonly kind: WriteEvent['kind'];

  constructor(
    ctx: Context,
    entity: Entity,
    statements: readonly Statement[],
    props: readonly string[],
    kind: WriteEvent['kind'],
  ) {
    this.ctx = ctx;
    this.entity = entity;
    this.statements = statements;
    this.props = props;
    this.kind = kind;
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
        out.push(
          Object.fromEntries(
            this.props.map((p) => {
              const raw = row[this.entity.columnNames[p]!];
              return [
                p,
                raw === null || raw === undefined
                  ? null
                  : this.entity.columns[p]!.codec.decode(raw),
              ];
            }),
          ) as R,
        );
      }
    }
    await this.ctx.interceptors.afterWrite({
      kind: this.kind,
      entity: this.entity,
      affected: out.length,
    });
    return out;
  }
}

/** returning 的列名：不写就是整行；写了就只取这些（类型检查只允许实体的列） */
function returningProps(entity: Entity, columns: readonly string[]): string[] {
  for (const c of columns)
    if (!(c in entity.columns)) throw new Error(`${entity.table} has no column '${c}'`);
  const props = columns.length > 0 ? [...columns] : Object.keys(entity.columns);
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

/**
 * INSERT … SELECT：把一条查询的结果直接插进表里，数据不经过应用。查询的 select 键就是目标列名，
 * 列的值类型必须和目标列一致，目标列里必填的都要有。**不经过插入拦截器**（租户、默认值、版本等要在 select 里自己给）。
 * ```ts
 * await db.insert(PostArchive).fromQuery(db.queryable(Post).where(p => p.createdAt.lt(cutoff)).select(p => ({ id: p.id, userId: p.userId, title: p.title, amount: p.amount }))).execute()
 * ```
 */
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
    const affected = (await execute(this.ctx, this.toSQL())).affected;
    await this.ctx.interceptors.afterWrite({ kind: 'insert', entity: this.entity, affected });
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
    this.rows = rows;
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
      'insert',
    );
  }

  /** 返回影响的行数 */
  async execute(): Promise<number> {
    let affected = 0;
    for (const statement of this.toSQL()) affected += (await execute(this.ctx, statement)).affected;
    await this.ctx.interceptors.afterWrite({ kind: 'insert', entity: this.entity, affected });
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
    await this.ctx.interceptors.afterWrite({ kind: 'insert', entity: this.entity, affected: 1 });
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

/** set 里每列可以是值或表达式（`u.age.plus(1)`） */
export type SetValues<S extends AnySchema, K extends EntityKey<S>> = {
  [C in keyof EntityOf<S, K>['columns']]?:
    ValueOf<EntityOf<S, K>['columns'][C]> | Expr<ValueOf<EntityOf<S, K>['columns'][C]>>;
};

interface WriteState {
  readonly where: readonly ((r: any) => Cond)[];
  readonly all: boolean;
  /** delete 绕过逻辑删除，物理删除 */
  readonly hard?: boolean;
  /** entity(row) 带了版本条件：一行都没更新到说明被别人改过，要抛错 */
  readonly versionGuard?: boolean;
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
    const scope = new Scope(this.ctx.schema, { n: 0 }, false, (ref) =>
      this.interceptors().filters(ref, refEntity(ref)),
    );
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

  /** 这条写入语句生效的拦截器；delete(X).hard() 会关掉逻辑删除 */
  protected interceptors(): Interceptors {
    return this.ctx.interceptors;
  }

  async execute(): Promise<number> {
    const affected = (await execute(this.ctx, this.toSQL())).affected;
    const expect = this.state.expect;
    if (expect && affected !== expect.count) throw expect.error(affected);
    await this.ctx.interceptors.afterWrite({
      kind: this.verb as WriteEvent['kind'],
      entity: this.ctx.schema.entities[this.key]!,
      affected,
    });
    return affected;
  }

  abstract toSQL(): Statement;
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
   * 按主键更新整行：set 除主键外的所有列（值为 undefined 的列跳过），where 主键相等。
   * ```ts
   * const user = await db.queryable(User).where(u => u.id.eq(1)).single()
   * await db.update(User).entity({ ...user, name: 'b' }).execute()
   * ```
   */
  entity(row: Row<EntityOf<S, K>>): Updatable<S, K> {
    const entity = this.ctx.schema.entities[this.key]!;
    if (entity.primaryKey.length === 0)
      throw new Error(`update(..).entity(..) needs a primary key on ${entity.table}`);
    const values = row as Record<string, unknown>;
    for (const key of entity.primaryKey) {
      if (values[key] === undefined || values[key] === null)
        throw new Error(`update(..).entity(..) needs the primary key '${key}' of ${entity.table}`);
    }
    const set: Record<string, unknown> = Object.fromEntries(
      Object.keys(entity.columns)
        .filter(
          (p) =>
            !entity.primaryKey.includes(p) &&
            values[p] !== undefined &&
            !entity.columns[p]!.options.insertOnly,
        )
        .map((p) => [p, values[p]]),
    );
    // 乐观锁：版本列作为条件，并写入加 1 后的版本；没有更新到行说明已被别人改过（见 execute）
    const version = Object.keys(entity.columns).find((p) => entity.columns[p]!.options.version);
    if (version !== undefined) {
      const current = values[version];
      if (current === undefined || current === null)
        throw new Error(`update(..).entity(..) needs the version '${version}' of ${entity.table}`);
      set[version] = typeof current === 'bigint' ? current + 1n : Number(current) + 1;
    }
    const byKey = (r: any) => [
      ...entity.primaryKey.map((k) => (r[k] as Expr<unknown>).eq(values[k] as never)),
      ...(version !== undefined
        ? [(r[version] as Expr<unknown>).eq(values[version] as never)]
        : []),
    ];
    return new Updatable(
      this.ctx,
      this.key as K,
      { ...this.state, where: [...this.state.where, byKey], versionGuard: version !== undefined },
      () => set,
    );
  }

  /** 带乐观锁条件的更新没有更新到任何行：行已被删除或已被别人改过 */
  override async execute(): Promise<number> {
    const affected = await super.execute();
    if (affected === 0 && this.state.versionGuard) {
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
    return new Returning(
      this.ctx,
      entity,
      [this.toSQL()],
      returningProps(entity, columns),
      'update',
    );
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

  all(): Updatable<S, K> {
    return new Updatable(this.ctx, this.key as K, { ...this.state, all: true }, this.values);
  }

  toSQL(): Statement {
    if (!this.values) throw new Error('update needs set(...)');
    const { root, where } = this.scope();
    const entity = this.ctx.schema.entities[this.key]!;
    const given = this.values(root);
    for (const p of Object.keys(given)) {
      if (given[p] !== undefined && entity.columns[p]?.options.insertOnly)
        throw new Error(`column '${p}' of ${entity.table} is insert-only and cannot be updated`);
    }
    const values = this.ctx.interceptors.beforeUpdate(given, entity);
    const set = Object.entries(values)
      .filter(([, v]) => v !== undefined)
      .map(([p, v]) => {
        const column = entity.columns[p];
        if (!column) throw new Error(`${entity.table} has no column '${p}'`);
        return { column: entity.columnNames[p]!, e: columnValue(column, v) };
      });
    // 乐观锁列：没有显式写版本的更新（表达式更新、批量更新）也让版本加 1，别人手里的旧版本就会失效
    for (const [p, column] of Object.entries(entity.columns)) {
      if (column.options.version && values[p] === undefined) {
        set.push({
          column: entity.columnNames[p]!,
          e: {
            k: 'op',
            op: '+',
            l: { k: 'col', alias: root[REF].alias, name: entity.columnNames[p]! },
            r: { k: 'lit', sql: '1' },
          },
        });
      }
    }
    if (set.length === 0) throw new Error(`update of ${entity.table} sets no columns`);
    const node = { from: { table: entity.table, alias: root[REF].alias }, set, where };
    checkAliases(node);
    const w = new SqlWriter();
    return { sql: this.ctx.dialect.update(node, w), params: w.params };
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
    return new Returning(
      this.ctx,
      entity,
      [this.toSQL()],
      returningProps(entity, columns),
      'delete',
    );
  }

  /** 物理删除：绕过逻辑删除（读过滤与改写成 update 都不再生效），已被逻辑删除的行也会被删掉 */
  hard(): Deletable<S, K> {
    return new Deletable(this.ctx, this.key as K, { ...this.state, hard: true });
  }

  protected override interceptors(): Interceptors {
    return this.state.hard ? this.ctx.interceptors.without(['softDelete']) : this.ctx.interceptors;
  }

  toSQL(): Statement {
    const { root, where } = this.scope();
    const entity = this.ctx.schema.entities[this.key]!;
    const from = { table: entity.table, alias: root[REF].alias };
    // 逻辑删除：delete 改写成把标记列设为"已删除"的 update，条件不变（读过滤已经保证不会重复删）
    const softSet = this.interceptors().deleteAsUpdate(entity);
    if (softSet) {
      const set = Object.entries(softSet).map(([p, v]) => ({
        column: entity.columnNames[p]!,
        e: columnValue(entity.columns[p]!, v),
      }));
      const update = { from, set, where };
      checkAliases(update);
      const w = new SqlWriter();
      return { sql: this.ctx.dialect.update(update, w), params: w.params };
    }
    const node = { from, where };
    checkAliases(node);
    const w = new SqlWriter();
    return { sql: this.ctx.dialect.delete(node, w), params: w.params };
  }
}

/**
 * 锁住一行（Db.lock）：没有行锁的库（SQLite）用一条把主键写回自己的 UPDATE 拿到写锁。
 * 不经拦截器（不加租户条件、不改更新时间）、不动版本列：锁不改任何数据
 */
export class LockRow extends Filtered {
  protected readonly verb = 'lock';

  constructor(ctx: Context, key: string, where: (r: any) => Cond) {
    super(ctx, key, { where: [where], all: false });
  }

  protected override interceptors(): Interceptors {
    return Interceptors.none;
  }

  override async execute(): Promise<number> {
    return (await execute(this.ctx, this.toSQL())).affected;
  }

  toSQL(): Statement {
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
    return { sql: this.ctx.dialect.update(node, w), params: w.params };
  }
}
