/**
 * DuckDB（嵌入式的分析库，进程内运行，不用服务器），驱动用 @duckdb/node-api：
 * ```ts
 * import { DuckDBInstance } from '@duckdb/node-api'
 * const db = createDb({ schema, adapter: duckdb(await DuckDBInstance.create('app.duckdb')) })
 * ```
 * SQL 接近 PG；差异：没有 IDENTITY（自增列写成序列 + DEFAULT nextval）、没有行锁与保存点（单进程、乐观并发）、
 * 日期格式化用 strftime、JSON 用 json 扩展的 json_extract；VARCHAR 不限长度。
 */
import {
  blobValue,
  DuckDBTypeId,
  type DuckDBConnection,
  type DuckDBInstance,
} from '@duckdb/node-api';
import {
  assembleTables,
  Dialect,
  standardJsonPath,
  unquoteSql,
  type Adapter,
  type Without,
  type ColumnOptions,
  type DatePart,
  type DbTable,
  type Driver,
  type Entity,
  type ExecuteResult,
  type FunctionRenderer,
  type Node,
  type QueryRunner,
  type SqlWriter,
  type Session,
  type TransactionOptions,
} from '@zerodep-dev/easy-query-ts';

export class DuckDbDialect extends Dialect {
  readonly name = 'duckdb';
  override readonly supportsReturning = true;
  override readonly generatedKeys = 'returning';
  override readonly nullSafeEquals = 'IS NOT DISTINCT FROM';
  override readonly transactionalDdl = true;

  /** 没有 SELECT … FOR UPDATE：Db.lock 用把主键写回自己的 UPDATE 拿到写锁 */
  override get rowLocks(): boolean {
    return false;
  }

  /** 没有行锁：驱动让事务排队执行（DuckDB 本来就是单写者），锁行就是空子句 */
  override forUpdate(): string {
    return '';
  }

  /** 外键只能写在建表语句里（没有 ALTER TABLE ADD CONSTRAINT） */
  override readonly inlineForeignKeys = true;

  /** 外键不支持 ON DELETE / ON UPDATE 的动作：渲染时说清楚，而不是让库报语法错误 */
  protected override foreignKeyClause(fk: Parameters<Dialect['addForeignKey']>[0]): string {
    if (fk.onDelete || fk.onUpdate)
      throw new Error(
        `foreign key ${fk.name}: the duckdb dialect does not support ON DELETE / ON UPDATE actions`,
      );
    return super.foreignKeyClause(fk);
  }

  /** decimal 列的参数按文字传：放进算术里时推不出类型（"Could not choose a best candidate function"），转成 DECIMAL */
  override node(n: Node, w: SqlWriter): string {
    const sql = super.node(n, w);
    if (n.k === 'param' && n.value != null && n.codec?.kind === 'decimal')
      return `CAST(${sql} AS DECIMAL(38, 10))`;
    return sql;
  }

  /** NULL 的绑定变量推不出类型（"Cannot create values of type ANY"）：直接写 NULL */
  override bindParam(value: unknown, w: SqlWriter): string {
    return value === null || value === undefined ? 'NULL' : super.bindParam(value, w);
  }

  override savepoint(): string {
    throw new Error('nested transactions are not supported by the duckdb dialect (no SAVEPOINT)');
  }

  /** DuckDB 有布尔类型 */
  override encodeParam(value: unknown, kind?: string): unknown {
    return typeof value === 'boolean' ? value : super.encodeParam(value, kind);
  }

  protected override functions(): Record<string, FunctionRenderer> {
    return {
      ...super.functions(),
      length: (a) => `LENGTH(${a[0]})`,
      date_trunc: (a) => `DATE_TRUNC(${a[1]}, ${a[0]})`,
      diff_days: (a) => `DATE_DIFF('day', CAST(${a[1]} AS DATE), CAST(${a[0]} AS DATE))`,
      now: () => `CAST(now() AT TIME ZONE 'UTC' AS TIMESTAMP)`,
      json_value: (a) => `CAST(json_extract(${a[0]}, ${standardJsonPath(a[1]!)}) AS VARCHAR)`,
      json_text: (a) => `json_extract_string(${a[0]}, ${standardJsonPath(a[1]!)})`,
      json_number: (a) =>
        `CAST(json_extract_string(${a[0]}, ${standardJsonPath(a[1]!)}) AS DOUBLE)`,
      json_boolean: (a) =>
        `CAST(json_extract_string(${a[0]}, ${standardJsonPath(a[1]!)}) AS BOOLEAN)`,
      json_has: (a) => `(json_extract(${a[0]}, ${standardJsonPath(a[1]!)}) IS NOT NULL)`,
      json_length: (a) => `CAST(json_array_length(${a[0]}, ${standardJsonPath(a[1]!)}) AS INTEGER)`,
      cast_string: (a) => `CAST(${a[0]} AS VARCHAR)`,
      add_time: (a) =>
        `(${a[0]} + TO_${unquoteSql(a[2]!).toUpperCase()}S(CAST(${a[1]} AS INTEGER)))`,
    };
  }

  /** strftime：%Y-%m-%d %H:%M:%S，文字里的 % 写两次 */
  protected override formatDate(value: string, parts: readonly DatePart[]): string {
    const tokens = { yyyy: '%Y', yy: '%y', MM: '%m', dd: '%d', HH: '%H', mm: '%M', ss: '%S' };
    const format = parts
      .map((p) => ('token' in p ? tokens[p.token] : p.text.replaceAll('%', '%%')))
      .join('');
    return `strftime(${value}, '${format.replaceAll("'", "''")}')`;
  }

  // ---- 建表 ----

  override columnType(kind: string, o: ColumnOptions): string {
    if (o.dbType) return o.dbType;
    switch (kind) {
      case 'uuid':
        return 'UUID';
      // VARCHAR 不限长度（写了长度也不检查），读库结构时也没有长度：不写
      case 'string':
        return 'VARCHAR';
      case 'double':
        return 'DOUBLE';
      case 'datetime':
        return 'TIMESTAMP';
      case 'json':
        return 'JSON';
      default:
        return super.columnType(kind, o);
    }
  }

  override createTable(
    entity: Entity,
    ifNotExists = true,
    foreignKeys: Parameters<Dialect['createTable']>[2] = [],
  ): string {
    // 自增列换成 DEFAULT nextval('序列')，建表前先建序列
    const sequences: string[] = [];
    const columns = Object.fromEntries(
      Object.entries(entity.columns).map(([prop, column]) => {
        if (!column.options.generated) return [prop, column];
        const name = `seq_${entity.table.split('.').pop()}_${entity.columnNames[prop]}`;
        sequences.push(`CREATE SEQUENCE IF NOT EXISTS ${this.quote(name)}`);
        const options = { ...column.options, generated: false, dbDefault: `nextval('${name}')` };
        return [
          prop,
          Object.assign(Object.create(Object.getPrototypeOf(column) as object), column, {
            options,
          }),
        ];
      }),
    );
    return [...sequences, super.createTable({ ...entity, columns }, ifNotExists, foreignKeys)].join(
      '; ',
    );
  }

  /** information_schema 与 duckdb_* 系统函数 */
  override async introspect(run: QueryRunner): Promise<DbTable[]> {
    return assembleTables({
      tables: await run(
        `SELECT table_name, comment FROM duckdb_tables() WHERE schema_name = current_schema() ORDER BY table_name`,
      ),
      columns: await run(
        `SELECT c.table_name, c.column_name, c.data_type AS column_type, c.is_nullable AS is_nullable,
           c.column_default, c.comment, COALESCE(c.column_default LIKE 'nextval(%', false) AS is_generated,
           EXISTS (SELECT 1 FROM duckdb_constraints() k WHERE k.table_name = c.table_name AND k.schema_name = c.schema_name
             AND k.constraint_type = 'PRIMARY KEY' AND list_contains(k.constraint_column_names, c.column_name)) AS primary_key
         FROM duckdb_columns() c WHERE c.schema_name = current_schema() ORDER BY c.table_name, c.column_index`,
      ),
      // expressions 是 '[a, "b"]' 这样的文字
      indexes: (
        await run(
          `SELECT table_name, index_name, is_unique, expressions FROM duckdb_indexes() WHERE schema_name = current_schema()`,
        )
      ).flatMap((i) =>
        String(i['expressions'] as string)
          .replace(/^\[|\]$/g, '')
          .split(',')
          .map((c) => ({ ...i, column_name: c.trim().replace(/^"|"$/g, '') })),
      ),
      foreignKeys: await run(
        `SELECT k.table_name, k.constraint_name, u.column_name, k.referenced_table, r.referenced_column
         FROM duckdb_constraints() k,
           unnest(k.constraint_column_names) WITH ORDINALITY AS u(column_name, ord),
           unnest(k.referenced_column_names) WITH ORDINALITY AS r(referenced_column, rord)
         WHERE k.constraint_type = 'FOREIGN KEY' AND k.schema_name = current_schema() AND u.ord = r.rord
         ORDER BY k.table_name, k.constraint_name, u.ord`,
      ),
    });
  }
}

// ---- 驱动 ----

/**
 * 结果按 JSON 友好的形式读（BIGINT、DECIMAL 是文字，日期是 ISO 文字），与其它库的口径一致；
 * BLOB 在 JSON 形式里是逐字节转义的文字（可打印的字节原样出现），改取 JS 形式的 Uint8Array
 */
async function read(
  conn: DuckDBConnection,
  sql: string,
  params: readonly unknown[],
): Promise<Record<string, unknown>[]> {
  const reader = await conn.runAndReadAll(sql, params as never);
  const rows = reader.getRowObjectsJson() as Record<string, unknown>[];
  const names = reader.columnNames();
  const blobs = reader
    .columnTypes()
    .flatMap((type, i) => (type.typeId === DuckDBTypeId.BLOB ? [names[i]!] : []));
  if (blobs.length === 0) return rows;
  const raw = reader.getRowObjectsJS() as Record<string, unknown>[];
  return rows.map((row, i) => ({
    ...row,
    ...Object.fromEntries(blobs.map((b) => [b, raw[i]![b]])),
  }));
}

class DuckDbSession implements Session {
  protected readonly connection: () => Promise<DuckDBConnection>;

  constructor(connection: () => Promise<DuckDBConnection>) {
    this.connection = connection;
  }

  async query(sql: string, params: readonly unknown[]): Promise<Record<string, unknown>[]> {
    return read(await this.connection(), sql, params.map(bindValue));
  }

  /** DML 的结果是一行 Count */
  async execute(sql: string, params: readonly unknown[]): Promise<ExecuteResult> {
    const rows = await read(await this.connection(), sql, params.map(bindValue));
    const count = rows[0] ? Object.values(rows[0])[0] : 0;
    return { affected: Number(count ?? 0), insertId: undefined };
  }
}

/** 二进制要包成 DuckDB 的 BLOB 值（直接给 Buffer 推不出类型） */
function bindValue(value: unknown): unknown {
  return value instanceof Uint8Array ? blobValue(value) : value;
}

class DuckDbDriver extends DuckDbSession implements Driver {
  private readonly instance: DuckDBInstance;
  /** 事务排队执行，免得两个写事务冲突（"Conflict on tuple …"） */
  private queue: Promise<unknown> = Promise.resolve();

  constructor(instance: DuckDBInstance) {
    let shared: Promise<DuckDBConnection> | undefined;
    super(() => (shared ??= instance.connect()));
    this.instance = instance;
  }

  transaction<T>(work: (session: Session) => Promise<T>, options?: TransactionOptions): Promise<T> {
    const run = this.queue.then(() => this.run(work, options));
    this.queue = run.catch(() => undefined);
    return run;
  }

  private async run<T>(
    work: (session: Session) => Promise<T>,
    options?: TransactionOptions,
  ): Promise<T> {
    const conn = await this.instance.connect();
    try {
      await conn.run(options?.readOnly ? 'BEGIN TRANSACTION READ ONLY' : 'BEGIN TRANSACTION');
      try {
        const result = await work(new DuckDbSession(() => Promise.resolve(conn)));
        await conn.run('COMMIT');
        return result;
      } catch (error) {
        await conn.run('ROLLBACK').catch(() => undefined);
        throw error;
      }
    } finally {
      conn.closeSync();
    }
  }
}

/** 单写者、事务排队：锁行是空操作，SKIP LOCKED / NOWAIT 的语义做不到 */
export function duckdb(instance: DuckDBInstance): Adapter<Without<'skipLocked' | 'noWait'>> {
  return { dialect: new DuckDbDialect(), driver: new DuckDbDriver(instance) };
}
