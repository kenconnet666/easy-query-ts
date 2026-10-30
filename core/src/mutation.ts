/**
 * 插入、更新、删除。更新与删除没有条件时拒绝执行，要整表操作显式调用 all()；条件全被跳过（例如 `id && u.id.eq(id)` 里 id 为空）同样算没有条件。
 */
import {
  checkAliases,
  type ConflictNode,
  type Node,
  type SelectNode,
  type UpdateNode,
} from './ast.ts';
import { SqlWriter, type Statement } from './dialect.ts';
import { Placeholder } from './placeholder.ts';
import { and, condNode, Expr, or, orderNodes, toNode, type Cond, type OrderItem } from './expr.ts';
import { newQueryable, type Built, type Query } from './query.ts';
import { makeRef, REF, refColumn, Scope, type Ref } from './ref.ts';
import type { CapabilitiesOf, Requires, Unsupported } from './capabilities.ts';
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
import { shardTables } from './sharding.ts';

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

  /**
   * 一行或多行；多行时列不同的行分成几条语句。没给（undefined）的列不写；值为 null 的列默认写 NULL，
   * `{ columns: 'notNull' }` 时也不写（交给库里的默认值，对应 Java 版插入的 ONLY_NOT_NULL_COLUMNS）
   */
  values(
    rows: Insert<EntityOf<S, K>> | readonly Insert<EntityOf<S, K>>[],
    options: InsertOptions = {},
  ): InsertValues<S, K> {
    const entity = this.ctx.schema.entities[this.key]!;
    const list = (Array.isArray(rows) ? rows : [rows]) as readonly Record<string, unknown>[];
    const picked =
      options.columns === 'notNull'
        ? list.map((row) =>
            pickColumns(flattenRow(entity, row), Object.keys(entity.columns), 'notNull'),
          )
        : list;
    return new InsertValues(this.ctx, this.key, picked, undefined);
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
  /** update / delete：读改之前的行（拦截器要时） */
  private readonly before: (() => Promise<Record<string, unknown>[] | undefined>) | undefined;

  constructor(
    ctx: Context,
    entity: Entity,
    statements: readonly Statement[],
    props: readonly string[],
    detail: WriteDetail,
    before?: () => Promise<Record<string, unknown>[] | undefined>,
  ) {
    this.ctx = ctx;
    this.entity = entity;
    this.statements = statements;
    this.props = props;
    this.detail = detail;
    this.before = before;
  }

  toSQL(): Statement[] {
    const columns = this.props.map((p) => this.entity.columnNames[p]!);
    const clause = this.ctx.dialect.returningColumns(columns);
    return this.statements.map((s) => ({ sql: s.sql + clause, params: s.params }));
  }

  async execute(): Promise<R[]> {
    const before = await this.before?.();
    const out: R[] = [];
    for (const statement of this.toSQL())
      for (const row of await query(this.ctx, statement))
        out.push(decodeRow(this.entity, this.props, (p) => row[this.entity.columnNames[p]!]) as R);
    await this.ctx.interceptors.afterWrite(
      {
        ...this.detail,
        entity: this.entity,
        affected: out.length,
        statements: this.statements,
        ...(before ? { before } : {}),
      },
      this.ctx.hooks,
    );
    return out;
  }
}

/** 读出的一行按列解码，值对象的列放回嵌套对象 */
function decodeRow(
  entity: Entity,
  props: readonly string[],
  raw: (prop: string, index: number) => unknown,
): Record<string, unknown> {
  const item: Record<string, unknown> = {};
  props.forEach((p, i) => {
    const value = raw(p, i);
    setPath(
      item,
      p,
      value === null || value === undefined ? null : entity.columns[p]!.codec.decode(value),
    );
  });
  return item;
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

/** 写哪些列（对应 Java 版的 SQLExecuteStrategyEnum）：全部、只写非 null 的、只写 null 的；没给（undefined）的列一律不写 */
export type ColumnStrategy = 'all' | 'notNull' | 'null';

/** insert(..).values 的选项 */
export interface InsertOptions {
  /** 'notNull'：值为 null 的列也不写，交给库里的默认值 */
  readonly columns?: 'all' | 'notNull';
}

/** update(..).entity / entities 的选项 */
export interface EntityUpdateOptions {
  /** 写哪些列，默认 'all'（主键、版本、只插入的列本来就不写） */
  readonly columns?: ColumnStrategy;
}

/** 按策略挑出这一行要写的列 */
function pickColumns(
  row: Readonly<Record<string, unknown>>,
  props: readonly string[],
  strategy: ColumnStrategy = 'all',
): Record<string, unknown> {
  return Object.fromEntries(
    props
      .filter(
        (p) =>
          row[p] !== undefined &&
          (strategy === 'all' || (row[p] === null) === (strategy === 'null')),
      )
      .map((p) => [p, row[p]]),
  );
}

/**
 * 一批按主键更新的实体，见 Updatable.entities。默认每行一条语句；`batch()` 时把写的列相同的行合成一条
 * `UPDATE … SET c = CASE WHEN 主键 = ? THEN ? … END WHERE 主键 = ? OR …`（对应 Java 版的 batch，但不依赖驱动的批量接口，各库都是一次往返）。
 * 带版本列时条件逐行带上版本，改到的行数不足就抛乐观锁错误
 */
export class BatchUpdate {
  private readonly ctx: Context;
  private readonly key: string;
  private readonly state: WriteState;
  private readonly rows: readonly Readonly<Record<string, unknown>>[];
  private readonly options: EntityUpdateOptions;
  private readonly merged: boolean;

  constructor(
    ctx: Context,
    key: string,
    state: WriteState,
    rows: readonly Readonly<Record<string, unknown>>[],
    options: EntityUpdateOptions,
    merged = false,
  ) {
    this.ctx = ctx;
    this.key = key;
    this.state = state;
    this.rows = rows;
    this.options = options;
    this.merged = merged;
  }

  /** 写的列相同的行合成一条语句（按方言的绑定参数上限切块） */
  batch(): BatchUpdate {
    return new BatchUpdate(this.ctx, this.key, this.state, this.rows, this.options, true);
  }

  toSQL(): Statement[] {
    return this.updates().map((u) => u.toSQL());
  }

  async execute(): Promise<number> {
    let affected = 0;
    for (const update of this.updates()) affected += await update.execute();
    return affected;
  }

  private updates(): Updatable<any, any>[] {
    if (!this.merged)
      return this.rows.map((row) =>
        new Updatable(this.ctx, this.key, this.state).entity(row as never, this.options),
      );
    const entity = this.ctx.schema.entities[this.key]!;
    const version = guardedVersion(entity, this.state);
    const props = Object.keys(entity.columns).filter((p) => updatableColumn(entity, p));
    // 写的列相同的行分一组：组里每一行都有这些列的值，CASE 能逐行给出
    const groups = new Map<string, { written: string[]; rows: Record<string, unknown>[] }>();
    for (const row of this.rows) {
      const flat = flattenRow(entity, row);
      requireKey(entity, flat, version, 'update(..).entities(..).batch()');
      const written = Object.keys(pickColumns(flat, props, this.options.columns));
      if (version !== undefined) written.push(version);
      if (written.length === 0) throw new Error(`update of ${entity.table} sets no columns`);
      const id = written.join(',');
      let group = groups.get(id);
      if (!group) groups.set(id, (group = { written, rows: [] }));
      group.rows.push(flat);
    }
    const pk = entity.primaryKey;
    // 每行占的参数：每列一个 WHEN（主键几列 + 值），WHERE 里主键几列（+ 版本）
    const perRow = (columns: number) =>
      columns * (pk.length + 1) + pk.length + (version === undefined ? 0 : 1);
    return [...groups.values()].flatMap(({ written, rows }) => {
      const size = Math.max(1, Math.floor(this.ctx.dialect.maxBindParams / perRow(written.length)));
      const updates: Updatable<any, any>[] = [];
      for (let from = 0; from < rows.length; from += size)
        updates.push(this.merge(entity, written, rows.slice(from, from + size)));
      return updates;
    });
  }

  /** 一组行合成一条 UPDATE */
  private merge(
    entity: Entity,
    written: readonly string[],
    rows: readonly Record<string, unknown>[],
  ): Updatable<any, any> {
    const version = guardedVersion(entity, this.state);
    const matches = (r: any, row: Record<string, unknown>) =>
      entity.primaryKey.map((k) => (refColumn(r, k) as Expr<unknown>).eq(row[k] as never));
    const values = (r: any) =>
      Object.fromEntries(
        written.map((p) => {
          const column = entity.columns[p]!;
          const value = (row: Record<string, unknown>) =>
            p === version ? nextVersion(column, row[p]) : row[p];
          // ELSE 原列：条件只会选中这些行，走不到它；PG 靠它推出 CASE 的类型（分支全是参数时会当成 text）
          const node: Node = {
            k: 'case',
            when: rows.map((row) => [
              condNode(and(...matches(r, row)))!,
              toNode(value(row), column.codec),
            ]),
            else: { k: 'col', alias: r[REF].alias, name: entity.columnNames[p]! },
          };
          return [p, new Expr(node, column.codec)];
        }),
      );
    const where = (r: any) =>
      or(
        ...rows.map((row) =>
          and(
            ...matches(r, row),
            version !== undefined &&
              (refColumn(r, version) as Expr<unknown>).eq(row[version] as never),
          ),
        ),
      );
    const update = new Updatable(this.ctx, this.key, {
      ...this.state,
      where: [...this.state.where, where],
    }).set(values as never);
    if (version === undefined) return update;
    return update.expectRows(
      rows.length,
      (affected) =>
        new Error(
          `optimistic lock failed: ${rows.length - affected} of ${rows.length} ${entity.table} rows were changed or deleted by someone else`,
        ),
    );
  }
}

/** 按主键（与版本）定位一行时，主键与版本都要有值 */
function requireKey(
  entity: Entity,
  row: Readonly<Record<string, unknown>>,
  version: string | undefined,
  what: string,
): void {
  if (entity.primaryKey.length === 0)
    throw new Error(`${what} needs a primary key on ${entity.table}`);
  for (const key of entity.primaryKey)
    if (row[key] === undefined || row[key] === null)
      throw new Error(`${what} needs the primary key '${key}' of ${entity.table}`);
  if (version !== undefined && (row[version] === undefined || row[version] === null))
    throw new Error(`${what} needs the version '${version}' of ${entity.table}`);
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
    await this.ctx.interceptors.afterWrite(
      {
        kind: 'insert',
        rows: [],
        entity: this.entity,
        affected,
        statements: [statement],
      },
      this.ctx.hooks,
    );
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
   * db.insert(Doc).values(row).onConflict(d => d.id).merge(undefined, {               // 只在新版本更大时覆盖（PG、SQLite）
   *   onlyIf: (current, incoming) => current.version.lt(incoming.version),
   * })
   * ```
   * MySQL 按表上的主键 / 唯一键判断冲突（ON DUPLICATE KEY UPDATE），target 只用于 ignore 时的空更新。
   */
  onConflict(
    this: Requires<S, 'upsert', InsertValues<S, K>>,
    target: Columns<S, K>,
  ): {
    merge: (columns?: Columns<S, K>, options?: MergeOptions<S, K>) => InsertValues<S, K>;
    /** 不支持时不能调用（Doris、TDengine 写同一主键就是覆盖） */
    ignore: ['upsertIgnore'] extends [CapabilitiesOf<S>]
      ? () => InsertValues<S, K>
      : Unsupported<'upsertIgnore'>;
  };
  onConflict(target: Columns<S, K>): {
    merge: (columns?: Columns<S, K>, options?: MergeOptions<S, K>) => InsertValues<S, K>;
    ignore: unknown;
  } {
    const targetColumns = this.columnNames(target);
    return {
      merge: (columns, options) => {
        const update = columns
          ? this.columnNames(columns)
          : this.insertedColumns().filter((c) => !targetColumns.includes(c));
        if (update.length === 0)
          throw new Error(
            `onConflict(..).merge() on ${this.entity.table} has no column to update; use ignore()`,
          );
        return new InsertValues(this.ctx, this.key, this.rows, {
          target: targetColumns,
          update,
          where: options?.onlyIf ? this.mergeCondition(options.onlyIf) : undefined,
        });
      },
      ignore: () =>
        new InsertValues(this.ctx, this.key, this.rows, { target: targetColumns, update: [] }),
    };
  }

  /** merge 的 onlyIf：现有的行用别名 t0，新行用 excluded */
  private mergeCondition(onlyIf: NonNullable<MergeOptions<S, K>['onlyIf']>): ConflictNode['where'] {
    if (!this.ctx.dialect.conditionalUpsert)
      throw new Error(
        `merge(…, { onlyIf }) is not supported by the ${this.ctx.dialect.name} dialect (no ON CONFLICT … DO UPDATE … WHERE)`,
      );
    const scope = new Scope(this.ctx.schema, { n: 0 }, false);
    const current = scope.root(this.key);
    const incoming = makeRef(scope, this.key, 'excluded', false);
    const cond = condNode(onlyIf(current as Ref<S, K>, incoming as Ref<S, K>));
    return cond ? { alias: current[REF].alias, cond } : undefined;
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
  returning(this: Requires<S, 'returning', InsertValues<S, K>>): Returning<Row<EntityOf<S, K>>>;
  returning<C extends keyof Row<EntityOf<S, K>> & string>(
    this: Requires<S, 'returning', InsertValues<S, K>>,
    ...columns: C[]
  ): Returning<Pick<Row<EntityOf<S, K>>, C>>;
  returning(...columns: string[]): Returning<unknown> {
    return this.returningColumns(columns);
  }

  private returningColumns(columns: readonly string[]): Returning<unknown> {
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
    await this.ctx.interceptors.afterWrite(
      {
        ...this.detail(),
        entity: this.entity,
        affected,
        statements,
      },
      this.ctx.hooks,
    );
    return affected;
  }

  /** 单行插入，返回自增主键 */
  returnId(this: Requires<S, 'generatedKeys', InsertValues<S, K>>): Promise<number | bigint>;
  returnId(): Promise<number | bigint> {
    return this.generatedId();
  }

  private async generatedId(): Promise<number | bigint> {
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
    await this.ctx.interceptors.afterWrite(
      {
        ...this.detail(),
        entity: this.entity,
        affected: 1,
        statements,
      },
      this.ctx.hooks,
    );
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
      return (await this.returningColumns([]).execute())[0] as Row<EntityOf<S, K>>;
    const values: Record<string, unknown> = { ...this.filled()[0] };
    const generated = this.entity.primaryKey.filter((k) => values[k] === undefined);
    if (generated.length > 1)
      throw new Error('returnEntity() can only generate a single-column primary key');
    if (generated.length === 1) values[generated[0]!] = await this.generatedId();
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

  /** 这一行写进哪张表：分表时按分片键算 */
  private tableOf(row: Readonly<Record<string, unknown>>): string {
    const rule = this.entity.sharding;
    if (!rule) return this.entity.table;
    const value = row[rule.column];
    if (value === undefined || value === null)
      throw new Error(
        `insert into the sharded ${this.entity.table} needs the sharding column '${rule.column}'`,
      );
    return rule.tableOf(this.entity.table, value);
  }

  private filled(): Record<string, unknown>[] {
    return (this.filledRows ??= this.rows.map((r) =>
      this.ctx.interceptors.beforeInsert(r, this.entity),
    ));
  }

  toSQL(): Statement[] {
    if (this.rows.length === 0) return [];
    // 列相同、目标表相同（分表时按分片键路由）的行分一组
    const groups = new Map<
      string,
      { table: string; props: string[]; rows: Record<string, unknown>[] }
    >();
    for (const row of this.filled()) {
      const props = Object.keys(this.entity.columns).filter((p) => row[p] !== undefined);
      const table = this.tableOf(row);
      const id = `${table}|${props.join(',')}`;
      let group = groups.get(id);
      if (!group) groups.set(id, (group = { table, props, rows: [] }));
      group.rows.push(row);
    }
    return [...groups.values()].flatMap(({ table, props, rows }) => {
      if (props.length === 0) throw new Error(`insert into ${this.entity.table} has no values`);
      // 每行占 props.length 个参数；按方言的绑定参数上限切块，一块一条语句（至少一行）
      const perStatement = Math.max(
        1,
        Math.min(
          this.ctx.dialect.maxInsertRows,
          Math.floor(this.ctx.dialect.maxBindParams / props.length),
        ),
      );
      const cells = rows.map((r) => props.map((p) => columnValue(this.entity.columns[p]!, r[p])));
      const columns = props.map((p) => this.entity.columns[p]!);
      // 每列一个数组参数的批量插入（PG 的 unnest）：行数够多、值都是参数、没有数组列（数组的数组会被 unnest 摊平）
      const from = this.ctx.dialect.arrayInsertFrom;
      const arrayInsert =
        from !== undefined &&
        rows.length >= from &&
        columns.every((c) => c.codec.kind !== 'array') &&
        cells.every((r) => r.every((n) => n.k === 'param' && !(n.value instanceof Placeholder)));
      const statements: Statement[] = [];
      const step = arrayInsert ? rows.length : perStatement;
      for (const [start, end] of chunkRows(cells, step, this.ctx.dialect.maxStatementBytes)) {
        const w = new SqlWriter();
        const sql = this.ctx.dialect.insert(
          {
            table,
            columns: props.map((p) => this.entity.columnNames[p]!),
            rows: cells.slice(start, end),
            conflict: this.conflict,
            identityInsert: columns.some((c) => c.options.generated),
            arrayColumns: arrayInsert
              ? columns.map((c) => ({ kind: c.codec.kind, options: c.options }))
              : undefined,
          },
          w,
        );
        statements.push({ sql, params: w.params });
      }
      return statements;
    });
  }
}

/**
 * 插入的行怎么分成语句：每条最多 step 行；有语句大小上限时（MySQL 的 max_allowed_packet）再按估计的字节数切，
 * 每条至少一行。返回 [起, 止) 的区间
 */
function chunkRows(
  cells: readonly (readonly Node[])[],
  step: number,
  maxBytes: number | undefined,
): [number, number][] {
  const chunks: [number, number][] = [];
  let start = 0;
  let bytes = 0;
  for (let i = 0; i < cells.length; i++) {
    const size = maxBytes === undefined ? 0 : cells[i]!.reduce((n, c) => n + cellBytes(c), 0);
    if (i > start && (i - start >= step || (maxBytes !== undefined && bytes + size > maxBytes))) {
      chunks.push([start, i]);
      start = i;
      bytes = 0;
    }
    bytes += size;
  }
  if (start < cells.length) chunks.push([start, cells.length]);
  return chunks;
}

/** 一个值写进 SQL 文本后最多占多少字节：文字按每个字符 3 字节（UTF-8 加转义的上界），二进制写成十六进制 */
function cellBytes(n: Node): number {
  if (n.k !== 'param') return 64;
  const v = n.value;
  if (v === null || v === undefined) return 4;
  if (typeof v === 'string') return v.length * 3 + 2;
  if (v instanceof Uint8Array) return v.length * 2 + 3;
  if (typeof v === 'object' && !(v instanceof Date)) return JSON.stringify(v).length * 3 + 2;
  return 32;
}

function positiveCount(n: number): number {
  if (!Number.isSafeInteger(n) || n <= 0)
    throw new RangeError(`limit must be a positive integer, got ${n}`);
  return n;
}

/** upsert 的 merge 选项 */
export interface MergeOptions<S extends AnySchema, K extends EntityKey<S>> {
  /** 只在条件为真时用新值更新（PG、SQLite 的 DO UPDATE … WHERE）：current 是库里现有的行，incoming 是这次要插入的行 */
  readonly onlyIf?: (current: Ref<S, K>, incoming: Ref<S, K>) => Cond;
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

/** 这条语句要管的版本列：ignoreVersion() 时没有 */
function guardedVersion(entity: Entity, state: WriteState): string | undefined {
  return state.ignoreVersion ? undefined : versionColumn(entity);
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
  /** delete 显式写了 hard()：hardDelete: 'forbid' 时也执行物理删除 */
  readonly hard?: boolean;
  /** ignoreVersion()：不带版本条件、也不换版本（对应 Java 版的 ignoreVersion） */
  readonly ignoreVersion?: boolean;
  /** 带 RETURNING：不能再有导航产生的 join（自连接里两份目标表的列名会重名） */
  readonly returning?: boolean;
  /** orderBy(…).limit(n)：只改 / 删前 n 行 */
  readonly limit?: {
    readonly orderBy: readonly ((r: any) => OrderItem | readonly OrderItem[])[];
    readonly count?: number;
  };
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

  /** 新的构建现场：条件、set 里用到的多对一导航生成 join（放进 scope.joins，各库的写法见 Dialect.update / delete） */
  protected scope(): { scope: Scope; root: any; where: Node[] } {
    const kind = this.verb === 'delete' ? 'delete' : 'update';
    const scope = new Scope(this.ctx.schema, { n: 0 }, true, this.ctx.interceptors, kind);
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

  /**
   * orderBy(…).limit(n)：MySQL 直接写 ORDER BY … LIMIT；别的方言改写成"主键 IN (按同样的条件排序取前 n 行的主键)"
   */
  protected limited(scope: Scope, root: any, where: Node[]): Pick<UpdateNode, 'where' | 'limit'> {
    const spec = this.state.limit;
    if (!spec) return { where };
    const entity = this.ctx.schema.entities[this.key]!;
    if (spec.count === undefined)
      throw new Error(`orderBy() on an ${this.verb} of ${entity.table} needs limit(n)`);
    if (scope.joins.length > 0 || entity.sharding)
      throw new Error(
        `limit() on an ${this.verb} of ${entity.table} cannot be combined with navigations or sharding`,
      );
    const orderBy = spec.orderBy.flatMap((f) => orderNodes(f(root)));
    const limit = { orderBy, count: spec.count };
    if (this.ctx.dialect.nativeWriteLimit) return { where, limit };
    if (entity.primaryKey.length !== 1)
      throw new Error(
        `limit() on an ${this.verb} of ${entity.table} needs a single-column primary key`,
      );
    const alias = root[REF].alias;
    const key: Node = { k: 'col', alias, name: entity.columnNames[entity.primaryKey[0]!]! };
    const picked: SelectNode = {
      from: { table: entity.table, alias },
      joins: [],
      where,
      groupBy: [],
      having: [],
      orderBy,
      columns: [{ e: key, as: 'k' }],
      distinct: false,
      limit: spec.count,
      offset: undefined,
      forUpdate: false,
    };
    return { where: [{ k: 'in_sub', e: key, q: picked, not: false }] };
  }

  /** 语句的目标：表与别名、导航产生的 join、主键列（有 join 时各库按它对上同一行） */
  protected target(scope: Scope, root: any): Pick<UpdateNode, 'from' | 'joins' | 'key'> {
    const entity = this.ctx.schema.entities[this.key]!;
    if (this.state.returning && scope.joins.length > 0)
      throw new Error(
        `returning() cannot be used when an update / delete of ${entity.table} goes through a navigation`,
      );
    return {
      from: { table: entity.table, alias: root[REF].alias },
      joins: scope.joins,
      key: entity.primaryKey.map((k) => entity.columnNames[k]!),
    };
  }

  async execute(): Promise<number> {
    const tables = this.shardTargets();
    if (!tables) return this.run(true);
    // 分表：裁剪出的表逐张执行（同一个事务里的话一起回滚），行数合计后再检查 expectRows 与乐观锁
    let affected = 0;
    for (const table of tables) affected += await this.retarget(this.onTable(table)).run(false);
    this.check(affected);
    return affected;
  }

  /** @internal 条件（含拦截器加的）与主表别名：分库按分片键路由用 */
  conditions(): { alias: string; where: Node[] } {
    const { root, where } = this.scope();
    return { alias: root[REF].alias, where };
  }

  /** 分表实体：这条语句要碰的表；不分表时 undefined */
  private shardTargets(): string[] | undefined {
    const entity = this.ctx.schema.entities[this.key]!;
    if (!entity.sharding) return undefined;
    if (this.state.returning)
      throw new Error(`returning() is not supported on the sharded ${entity.table}`);
    const { root, where } = this.scope();
    return shardTables(entity, where, root[REF].alias).tables;
  }

  /** 实体换成其中一张实际表的构建现场 */
  private onTable(table: string): Context {
    const entities = this.ctx.schema.entities;
    const entity = { ...entities[this.key]!, table };
    delete (entity as { sharding?: unknown }).sharding;
    return {
      ...this.ctx,
      schema: { ...this.ctx.schema, entities: { ...entities, [this.key]: entity } },
    };
  }

  /** 同样的语句，换一个构建现场 */
  protected abstract retarget(ctx: Context): Filtered;

  private check(affected: number): void {
    const expect = this.state.expect;
    if (expect && affected !== expect.count) throw expect.error(affected);
    // 带乐观锁条件却一行也没改到：行已被删除或已被别人改过
    if (affected === 0 && this.state.version)
      throw new Error(
        `optimistic lock failed: ${this.ctx.schema.entities[this.key]!.table} row was changed or deleted by someone else`,
      );
  }

  /** 执行一条语句；checks 为 false 时由调用方合计后再检查 */
  protected async run(checks: boolean): Promise<number> {
    // 只构建一次：$onUpdate、逻辑删除的时间这类值每次求值都不同，语句与事件要是同一份
    const { statement, detail } = this.build();
    const before = await this.rowsBefore();
    const affected = (await execute(this.ctx, statement)).affected;
    if (checks) this.check(affected);
    await this.ctx.interceptors.afterWrite(
      {
        ...detail,
        entity: this.ctx.schema.entities[this.key]!,
        affected,
        statements: [statement],
        ...(before ? { before } : {}),
      },
      this.ctx.hooks,
    );
    return affected;
  }

  /**
   * 改之前的行（有拦截器声明 before 时，否则 undefined）：与这条语句同样的条件（含拦截器给 update / delete 加的），整行读出。
   * 不加行锁：同一事务里随后的 update / delete 会锁住这些行，两步之间被别人改了的情况留给乐观锁
   */
  protected async rowsBefore(): Promise<Record<string, unknown>[] | undefined> {
    const entity = this.ctx.schema.entities[this.key]!;
    if (!this.ctx.interceptors.wantsBefore(entity)) return undefined;
    const { scope, root, where } = this.scope();
    const props = Object.keys(entity.columns);
    const node: SelectNode = {
      from: { table: entity.table, alias: root[REF].alias },
      joins: scope.joins,
      where,
      groupBy: [],
      having: [],
      orderBy: [],
      columns: props.map((p, i) => ({
        e: (refColumn(root, p) as Expr<unknown>).node,
        as: `c${i}`,
      })),
      distinct: false,
      limit: undefined,
      offset: undefined,
      forUpdate: false,
    };
    const w = new SqlWriter();
    const rows = await query(this.ctx, { sql: this.ctx.dialect.select(node, w), params: w.params });
    return rows.map((row) => decodeRow(entity, props, (_, i) => row[`c${i}`]));
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
   * `columns: 'notNull'` 只写非 null 的列（表单里没填的保持原值），`'null'` 只写 null 的列（对应 Java 版的 SQLExecuteStrategyEnum）
   * ```ts
   * const user = await db.queryable(User).where(u => u.id.eq(1)).single()
   * await db.update(User).entity({ ...user, name: 'b' }).execute()
   * await db.update(User).entity(form, { columns: 'notNull' }).execute()
   * ```
   */
  entity(row: Row<EntityOf<S, K>>, options: EntityUpdateOptions = {}): Updatable<S, K> {
    const entity = this.ctx.schema.entities[this.key]!;
    const values = flattenRow(entity, row as Record<string, unknown>);
    const props = Object.keys(entity.columns).filter((p) => updatableColumn(entity, p));
    const set = pickColumns(values, props, options.columns);
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
    const version = guardedVersion(entity, this.state);
    requireKey(entity, row, version, what);
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

  /** changes 没有变化时不发语句 */
  override async execute(): Promise<number> {
    if (this.state.unchanged) return 0;
    return super.execute();
  }

  /** 更新后返回这些列（已解码）；见 Returning */
  returning(this: Requires<S, 'returning', Updatable<S, K>>): Returning<Row<EntityOf<S, K>>>;
  returning<C extends keyof Row<EntityOf<S, K>> & string>(
    this: Requires<S, 'returning', Updatable<S, K>>,
    ...columns: C[]
  ): Returning<Pick<Row<EntityOf<S, K>>, C>>;
  returning(...columns: string[]): Returning<unknown> {
    const entity = this.ctx.schema.entities[this.key]!;
    const { statement, detail } = this.withState({ returning: true }).build();
    return new Returning(
      this.ctx,
      entity,
      [statement],
      returningProps(entity, columns),
      detail,
      () => this.rowsBefore(),
    );
  }

  /**
   * 按主键更新一批实体（每行同 `entity(row, options)`，带乐观锁条件），返回总共更新的行数；
   * 默认每行一条语句，`.batch()` 合成一条（见 BatchUpdate）。不自带事务：要么全成要么全败请放进 `db.transaction`
   * ```ts
   * await db.update(Post).entities(rows).batch().execute()
   * ```
   */
  entities(rows: readonly Row<EntityOf<S, K>>[], options: EntityUpdateOptions = {}): BatchUpdate {
    return new BatchUpdate(this.ctx, this.key, this.state, rows as never, options);
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

  protected retarget(ctx: Context): Updatable<S, K> {
    return new Updatable(ctx, this.key as K, this.state, this.values);
  }

  private withState(change: Partial<WriteState>): Updatable<S, K> {
    return new Updatable(this.ctx, this.key as K, { ...this.state, ...change }, this.values);
  }

  /** 和 limit(n) 一起用：按这个顺序取前 n 行 */
  orderBy(order: (r: Ref<S, K>) => OrderItem | readonly OrderItem[]): Updatable<S, K> {
    const limit = this.state.limit;
    return this.withState({ limit: { ...limit, orderBy: [...(limit?.orderBy ?? []), order] } });
  }

  /**
   * 只改前 n 行（按 orderBy），分批处理大表、避免长事务：
   * `while ((await db.update(Log).set({ archived: true }).where(…).orderBy((l) => l.id).limit(1000).execute()) > 0) {}`。
   * MySQL 写成 ORDER BY … LIMIT，别的库写成主键 IN 子查询（要单列主键）；不能与导航、分表一起用
   */
  limit(n: number): Updatable<S, K> {
    return this.withState({
      limit: { orderBy: this.state.limit?.orderBy ?? [], count: positiveCount(n) },
    });
  }

  /**
   * 不管乐观锁（对应 Java 版的 ignoreVersion）：不带版本条件、也不换版本；entity(row) 不再要求版本。
   * 管理端的批量修正这类不该让别人手里的版本失效的更新用它；写在 entity / entities 前后都行
   */
  ignoreVersion(): Updatable<S, K> {
    const { version: _version, ...rest } = this.state;
    return new Updatable(this.ctx, this.key as K, { ...rest, ignoreVersion: true }, this.values);
  }

  all(): Updatable<S, K> {
    return new Updatable(this.ctx, this.key as K, { ...this.state, all: true }, this.values);
  }

  protected build(): { statement: Statement; detail: WriteDetail } {
    if (!this.values) throw new Error('update needs set(...)');
    if (this.state.unchanged)
      throw new Error('changes(): nothing changed, so there is no statement (execute() returns 0)');
    const { scope, root, where } = this.scope();
    const entity = this.ctx.schema.entities[this.key]!;
    const given = flattenRow(entity, this.values(root));
    for (const p of Object.keys(given)) {
      if (given[p] !== undefined && entity.columns[p]?.options.insertOnly)
        throw new Error(`column '${p}' of ${entity.table} is insert-only and cannot be updated`);
    }
    const version = guardedVersion(entity, this.state);
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
    const node = { ...this.target(scope, root), set, ...this.limited(scope, root, where) };
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
  returning(this: Requires<S, 'returning', Deletable<S, K>>): Returning<Row<EntityOf<S, K>>>;
  returning<C extends keyof Row<EntityOf<S, K>> & string>(
    this: Requires<S, 'returning', Deletable<S, K>>,
    ...columns: C[]
  ): Returning<Pick<Row<EntityOf<S, K>>, C>>;
  returning(...columns: string[]): Returning<unknown> {
    const entity = this.ctx.schema.entities[this.key]!;
    const { statement, detail } = this.withState({ returning: true }).build();
    return new Returning(
      this.ctx,
      entity,
      [statement],
      returningProps(entity, columns),
      detail,
      () => this.rowsBefore(),
    );
  }

  protected retarget(ctx: Context): Deletable<S, K> {
    return new Deletable(ctx, this.key as K, this.state);
  }

  private withState(change: Partial<WriteState>): Deletable<S, K> {
    return new Deletable(this.ctx, this.key as K, { ...this.state, ...change });
  }

  /** 和 limit(n) 一起用：按这个顺序取前 n 行 */
  orderBy(order: (r: Ref<S, K>) => OrderItem | readonly OrderItem[]): Deletable<S, K> {
    const limit = this.state.limit;
    return this.withState({ limit: { ...limit, orderBy: [...(limit?.orderBy ?? []), order] } });
  }

  /**
   * 只删前 n 行（按 orderBy），分批清理大表、避免长事务：
   * `while ((await db.delete(Log).where((l) => l.at.lt(cutoff)).orderBy((l) => l.id).limit(1000).execute()) > 0) {}`。
   * MySQL 写成 ORDER BY … LIMIT，别的库写成主键 IN 子查询（要单列主键）；不能与导航、分表一起用
   */
  limit(n: number): Deletable<S, K> {
    return this.withState({
      limit: { orderBy: this.state.limit?.orderBy ?? [], count: positiveCount(n) },
    });
  }

  /**
   * 带乐观锁删除（对应 Java 版 deletable 的 withVersion）：条件加上"版本等于 current"，没删到行就抛错；
   * 逻辑删除时顺带把版本换成下一个
   */
  withVersion(current: unknown): Deletable<S, K> {
    const entity = this.ctx.schema.entities[this.key]!;
    if (versionColumn(entity) === undefined)
      throw new Error(`withVersion(): ${entity.table} has no version column`);
    return this.withState({ version: { current } });
  }

  /** 按主键删这一行（对应 Java 版的 deletable(entity)）；有版本列时带上版本条件 */
  entity(row: Row<EntityOf<S, K>>): Deletable<S, K> {
    const entity = this.ctx.schema.entities[this.key]!;
    const values = flattenRow(entity, row as Record<string, unknown>);
    const version = versionColumn(entity);
    requireKey(entity, values, version, 'delete(..).entity(..)');
    const deletable = this.where((r: any) =>
      entity.primaryKey.map((k) => (refColumn(r, k) as Expr<unknown>).eq(values[k] as never)),
    );
    return version === undefined ? deletable : deletable.withVersion(values[version]);
  }

  /** 物理删除：绕过逻辑删除（读过滤与改写成 update 都不再生效），已被逻辑删除的行也会被删掉 */
  hard(): Deletable<S, K> {
    return new Deletable(withToggle(this.ctx, { skip: ['softDelete'] }), this.key as K, {
      ...this.state,
      hard: true,
    });
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
    const { scope, root, where } = this.scope();
    const entity = this.ctx.schema.entities[this.key]!;
    const target = this.target(scope, root);
    // 逻辑删除：delete 改写成把标记列设为"已删除"的 update，条件不变（读过滤已经保证不会重复删）
    const version = versionColumn(entity);
    const guard = this.state.version;
    if (version !== undefined && guard)
      where.push(condNode(refColumn(root, version).eq(guard.current as never))!);
    const deleteAs = this.ctx.interceptors.deleteAsUpdate(entity);
    const softSet =
      deleteAs && version !== undefined && guard
        ? { ...deleteAs, [version]: nextVersion(entity.columns[version]!, guard.current) }
        : deleteAs;
    if (softSet) {
      const set = Object.entries(softSet).map(([p, v]) => ({
        column: entity.columnNames[p]!,
        e: columnValue(entity.columns[p]!, v),
      }));
      const update = { ...target, set, ...this.limited(scope, root, where) };
      checkAliases(update);
      const w = new SqlWriter();
      return {
        statement: { sql: this.ctx.dialect.update(update, w), params: w.params },
        detail: { kind: 'delete', soft: true },
      };
    }
    if (this.ctx.guards.hardDelete === 'forbid' && !this.state.hard)
      throw new Error(
        `physical delete of ${entity.table} is forbidden (hardDelete: 'forbid'); give it a softDelete column or call .hard()`,
      );
    const node = { ...target, ...this.limited(scope, root, where) };
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

  protected retarget(ctx: Context): LockRow {
    return new LockRow(ctx, this.key, this.state.where[0]!);
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
