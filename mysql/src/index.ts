/**
 * MySQL 8（基线 8.0.18，覆盖 PolarDB MySQL 8.0.18-X-Cluster），驱动用 mysql2/promise 的连接池。
 * ```ts
 * import { createPool } from 'mysql2/promise'
 * const db = createDb({ schema, adapter: mysql(createPool({ uri, timezone: 'Z' })) })
 * ```
 * 日期时间、DECIMAL、BIGINT 每条查询都按文字读出再由列的 codec 解码，所以不依赖连接池的 dateStrings / supportBigNumbers 配置；
 * TIMESTAMP 列会按会话时区换算，建议连接池设 `timezone: 'Z'` 并让会话时区为 +00:00。
 */
import type { Pool, PoolConnection, ResultSetHeader } from 'mysql2/promise';
import {
  assembleTables,
  Dialect,
  type ColumnOptions,
  type Adapter,
  type ConflictNode,
  type DbTable,
  type DeleteNode,
  type Driver,
  type Entity,
  type ExecuteResult,
  sqlString,
  type DatePart,
  type FunctionRenderer,
  type Node,
  type QueryRunner,
  type SelectNode,
  type Session,
  SqlWriter,
  type TransactionOptions,
  type UpdateNode,
} from '@zerodep-dev/easy-query-ts';
import { mysqlFunctions } from './functions.ts';

export { MySQL } from './functions.ts';
export type { MatchMode } from './functions.ts';

/** MySQL 要求 OFFSET 前必须有 LIMIT；没给 LIMIT 时用最大值 */
const NO_LIMIT = '18446744073709551615';

/** MySQL 的版本：'8.0.18'（PolarDB 基线）、'8.4'、'9.1' …；5.7 也能用，只是窗口函数、CTE 渲染时报错 */
export type MySqlVersion = `${5 | 8 | 9}.${number}` | `${5 | 8 | 9}.${number}.${number}`;

/** 专属函数的最低版本 */
const MYSQL_MINIMUM: Record<string, string> = {
  'mysql.json_overlaps': '8.0.17',
  'mysql.member_of': '8.0.17',
  'mysql.member_of_path': '8.0.17',
};

export class MySqlDialect extends Dialect {
  /** 带 join：MySQL 的多表 UPDATE，JOIN 写在 SET 前面，SET 的列带上别名 */
  override update(q: UpdateNode, w: SqlWriter = new SqlWriter()): string {
    if (!q.joins?.length) return super.update(q, w);
    const alias = q.from.alias;
    let s = `UPDATE ${this.table(q.from.table)} AS ${alias}${this.joinClauses(q.joins, w)}`;
    s += ` SET ${q.set.map((c) => `${alias}.${this.quote(c.column)} = ${this.node(c.e, w)}`).join(', ')}`;
    if (q.where.length > 0) s += ` WHERE ${this.conjunction(q.where, w)}`;
    return s;
  }

  /** 带 join：`DELETE t0 FROM t AS t0 LEFT JOIN …` */
  override delete(q: DeleteNode, w: SqlWriter = new SqlWriter()): string {
    if (!q.joins?.length) return super.delete(q, w);
    let s = `DELETE ${q.from.alias} FROM ${this.table(q.from.table)} AS ${q.from.alias}${this.joinClauses(q.joins, w)}`;
    if (q.where.length > 0) s += ` WHERE ${this.conjunction(q.where, w)}`;
    return s;
  }

  readonly name = 'mysql';
  /** MySQL 预处理语句最多 65535 个占位符 */
  override readonly maxBindParams = 65535;

  /**
   * mysql2 的 query 在客户端把参数插进 SQL：bigint 会被写成带引号的字符串，`BIGINT + '1'` 在 MySQL 里按 DOUBLE 运算，
   * 超过 2^53 的值就丢精度。bigint 只含数字和负号，直接写成整数字面量；二进制统一成 Buffer（mysql2 只认 Buffer）。
   */
  override bindParam(value: unknown, w: SqlWriter): string {
    if (typeof value === 'bigint') return value.toString();
    return super.bindParam(
      value instanceof Uint8Array && !Buffer.isBuffer(value) ? Buffer.from(value) : value,
      w,
    );
  }

  override columnType(kind: string, o: ColumnOptions): string {
    if (o.dbType) return o.dbType;
    switch (kind) {
      case 'int':
        return 'INT';
      case 'double':
        return 'DOUBLE';
      case 'datetime':
        return 'DATETIME(3)';
      case 'json':
        return 'JSON';
      default:
        return super.columnType(kind, o);
    }
  }

  override identity(): string {
    return 'AUTO_INCREMENT';
  }

  /** 列注释写在列定义里，表注释写在建表语句末尾 */
  override readonly commentStyle = 'inline';
  /** MySQL 的 CREATE INDEX 没有 IF NOT EXISTS */
  override readonly indexIfNotExists = false;

  protected override tableOptions(entity: Entity): string {
    return entity.comment !== undefined ? ` COMMENT=${sqlString(entity.comment)}` : '';
  }

  /** 整数的显示宽度（int(11)）不算类型差异；BOOLEAN 在库里是 tinyint(1) */
  protected override normalizeType(type: string): string {
    const t = super.normalizeType(type);
    if (t === 'tinyint(1)') return 'boolean';
    return t.replace(/^(tinyint|smallint|mediumint|int|bigint)\(\d+\)/, '$1');
  }

  /** 读 information_schema（当前库） */
  override async introspect(run: QueryRunner): Promise<DbTable[]> {
    const schema = 'TABLE_SCHEMA = DATABASE()';
    return assembleTables({
      tables: await run(
        `SELECT TABLE_NAME AS table_name, TABLE_COMMENT AS comment FROM information_schema.TABLES
         WHERE ${schema} AND TABLE_TYPE = 'BASE TABLE' ORDER BY TABLE_NAME`,
      ),
      columns: await run(
        `SELECT TABLE_NAME AS table_name, COLUMN_NAME AS column_name, COLUMN_TYPE AS column_type,
           IS_NULLABLE AS is_nullable, COLUMN_DEFAULT AS column_default, COLUMN_COMMENT AS comment,
           EXTRA LIKE '%auto_increment%' AS is_generated, COLUMN_KEY = 'PRI' AS primary_key
         FROM information_schema.COLUMNS WHERE ${schema} ORDER BY TABLE_NAME, ORDINAL_POSITION`,
      ),
      indexes: await run(
        `SELECT TABLE_NAME AS table_name, INDEX_NAME AS index_name, NON_UNIQUE = 0 AS is_unique,
           COLUMN_NAME AS column_name
         FROM information_schema.STATISTICS WHERE ${schema} AND INDEX_NAME <> 'PRIMARY'
         ORDER BY TABLE_NAME, INDEX_NAME, SEQ_IN_INDEX`,
      ),
      foreignKeys: await run(
        `SELECT TABLE_NAME AS table_name, CONSTRAINT_NAME AS constraint_name, COLUMN_NAME AS column_name,
           REFERENCED_TABLE_NAME AS referenced_table, REFERENCED_COLUMN_NAME AS referenced_column
         FROM information_schema.KEY_COLUMN_USAGE WHERE ${schema} AND REFERENCED_TABLE_NAME IS NOT NULL
         ORDER BY TABLE_NAME, CONSTRAINT_NAME, ORDINAL_POSITION`,
      ),
    });
  }

  /** MySQL 的 `<=>` 就是 null 安全的相等 */
  override readonly nullSafeEquals = '<=>';

  /** DATE_FORMAT：%Y-%m-%d %H:%i:%s，文字里的 % 写两次 */
  protected override formatDate(value: string, parts: readonly DatePart[]): string {
    const tokens = { yyyy: '%Y', yy: '%y', MM: '%m', dd: '%d', HH: '%H', mm: '%i', ss: '%s' };
    const format = parts
      .map((p) => ('token' in p ? tokens[p.token] : p.text.replaceAll('%', '%%')))
      .join('');
    return `DATE_FORMAT(${value}, ${sqlString(format)})`;
  }

  /** GROUP_CONCAT([DISTINCT] e ORDER BY … SEPARATOR '…') */
  protected override stringAgg(n: Extract<Node, { k: 'string_agg' }>, w: SqlWriter): string {
    return `GROUP_CONCAT(${n.distinct ? 'DISTINCT ' : ''}${this.node(n.e, w)}${this.aggOrder(n.order, w)} SEPARATOR ${sqlString(n.separator)})`;
  }

  /** MySQL 只有 WITH ROLLUP（没有 CUBE） */
  override groupByKeys(keys: string[], mode: 'rollup' | 'cube' | undefined): string {
    if (mode === 'cube')
      throw new Error(
        'cube() is not supported by MySQL; use rollup() or group the combinations yourself',
      );
    return keys.join(', ') + (mode === 'rollup' ? ' WITH ROLLUP' : '');
  }

  /** MySQL.json / MySQL.match 的函数（见 functions.ts） */
  protected override functions(): Record<string, FunctionRenderer> {
    const gated = Object.fromEntries(
      Object.entries(MYSQL_MINIMUM).map(([name, min]): [string, FunctionRenderer] => {
        const render = mysqlFunctions[name]!;
        return [
          name,
          (a) => (this.requires(`${name.replace(/^mysql\./, '').toUpperCase()}`, min), render(a)),
        ];
      }),
    );
    return { ...super.functions(), ...mysqlFunctions, ...gated };
  }

  override quote(identifier: string): string {
    return '`' + identifier.replace(/`/g, '``') + '`';
  }

  /** MySQL 的 LIKE 默认转义符就是反斜杠 */
  override likeEscape(): string {
    return '';
  }

  /**
   * MySQL 按表上的主键 / 唯一键判断冲突；用 VALUES(col) 取新值（8.0.19 起的 AS 别名写法 8.0.18 不认）。
   * ignore 写成对 target 的空更新，而不是 INSERT IGNORE（后者会吞掉其它错误）。
   */
  override onConflict(c: ConflictNode): string {
    if (c.update.length === 0)
      return ` ON DUPLICATE KEY UPDATE ${c.target.map((t) => `${this.quote(t)} = ${this.quote(t)}`).join(', ')}`;
    // 8.0.19 起用行别名取新值（VALUES() 在 8.0.20 起弃用）；之前（PolarDB 8.0.18）用 VALUES(col)
    if (this.atLeast('8.0.19'))
      return ` AS eq_new ON DUPLICATE KEY UPDATE ${c.update.map((u) => `${this.quote(u)} = eq_new.${this.quote(u)}`).join(', ')}`;
    return ` ON DUPLICATE KEY UPDATE ${c.update.map((u) => `${this.quote(u)} = VALUES(${this.quote(u)})`).join(', ')}`;
  }

  /** 窗口函数与 CTE 要 8.0 */
  override node(n: Node, w: SqlWriter): string {
    if (n.k === 'over') this.requires('window functions', '8.0');
    return super.node(n, w);
  }

  override select(q: SelectNode, w: SqlWriter = new SqlWriter()): string {
    if (q.ctes?.length) this.requires('WITH (common table expressions)', '8.0');
    return super.select(q, w);
  }

  /** NOWAIT / SKIP LOCKED 要 8.0.1 */
  override forUpdate(wait?: 'nowait' | 'skip'): string {
    if (wait) this.requires(wait === 'skip' ? 'SKIP LOCKED' : 'NOWAIT', '8.0.1');
    return super.forUpdate(wait);
  }

  override limitOffset(
    limit: number | undefined,
    offset: number | undefined,
    ordered = false,
  ): string {
    if (limit === undefined && offset !== undefined && offset > 0)
      return ` LIMIT ${NO_LIMIT} OFFSET ${offset}`;
    return super.limitOffset(limit, offset, ordered);
  }
}

const AS_TEXT = new Set([
  'DATE',
  'NEWDATE',
  'DATETIME',
  'DATETIME2',
  'TIMESTAMP',
  'TIMESTAMP2',
  'TIME',
  'TIME2',
  'NEWDECIMAL',
  'DECIMAL',
  'LONGLONG',
]);

/** 这些类型按文字读，交给列的 codec：避免驱动按本地时区解析日期、DECIMAL 变浮点、BIGINT 丢精度 */
function typeCast(field: { type: string; string(): string | null }, next: () => unknown): unknown {
  return AS_TEXT.has(field.type) ? field.string() : next();
}

type Queryable = Pick<Pool, 'query'> | PoolConnection;

/** mysql2 底层的回调式 API：流式读取只在这一层有（promise 包装没有暴露 stream） */
interface CoreQueryable {
  query(options: object): { stream(options: object): AsyncIterable<unknown> & { destroy(): void } };
}

/** 底层的连接：流式读取自己借一条，读完 release，中途放弃就 destroy（连接关掉，服务端随之终止查询） */
interface CoreConnection extends CoreQueryable {
  release(): void;
  destroy(): void;
}

/** 底层的连接池（只有池级的会话有 getConnection，事务里的会话没有） */
interface CorePool extends CoreQueryable {
  getConnection(callback: (error: Error | null, connection: CoreConnection) => void): void;
}

class MySqlSession implements Session {
  protected readonly target: Queryable;
  private readonly core: CoreQueryable;

  constructor(target: Queryable, core: CoreQueryable) {
    this.target = target;
    this.core = core;
  }

  async query(sql: string, params: readonly unknown[]): Promise<Record<string, unknown>[]> {
    const [rows] = await this.target.query({ sql, values: params, typeCast });
    return rows as Record<string, unknown>[];
  }

  /**
   * mysql2 的结果流（底层回调 API 的 query().stream()）：边收边产出，不攒整个结果集。
   * 池级：借一条专用连接，读完归还；调用方中途放弃就销毁这条连接，别的查询不受影响。
   * 事务里：连接不能销毁，中途放弃时把剩下的行读掉丢弃，保证事务还能继续用。
   */
  async *stream(
    sql: string,
    params: readonly unknown[],
    batchSize: number,
  ): AsyncGenerator<Record<string, unknown>[]> {
    const pool = this.core as Partial<CorePool>;
    const own = pool.getConnection
      ? await new Promise<CoreConnection>((resolve, reject) =>
          pool.getConnection!((error, connection) => (error ? reject(error) : resolve(connection))),
        )
      : undefined;
    const rows = (own ?? this.core)
      .query({ sql, values: params as unknown[], typeCast })
      .stream({ highWaterMark: batchSize });
    // 手动迭代而不是 for await：for await 提前退出会销毁流，事务里就没法把剩下的读掉了
    const iterator = rows[Symbol.asyncIterator]();
    let finished = false;
    try {
      let batch: Record<string, unknown>[] = [];
      for (;;) {
        const next = await iterator.next();
        if (next.done) break;
        batch.push(next.value as Record<string, unknown>);
        if (batch.length >= batchSize) {
          yield batch;
          batch = [];
        }
      }
      if (batch.length > 0) yield batch;
      finished = true;
    } finally {
      if (own) {
        if (finished) own.release();
        else own.destroy();
      } else if (!finished) {
        while (!(await iterator.next()).done) {
          /* 丢弃剩余的行 */
        }
      }
    }
  }

  async execute(sql: string, params: readonly unknown[]): Promise<ExecuteResult> {
    const [result] = await this.target.query<ResultSetHeader>({ sql, values: params });
    return {
      affected: result.affectedRows,
      insertId: result.insertId === 0 ? undefined : result.insertId,
    };
  }
}

const ISOLATION = {
  'read uncommitted': 'READ UNCOMMITTED',
  'read committed': 'READ COMMITTED',
  'repeatable read': 'REPEATABLE READ',
  serializable: 'SERIALIZABLE',
} as const;

class MySqlDriver extends MySqlSession implements Driver {
  private readonly pool: Pool;

  constructor(pool: Pool) {
    super(pool, (pool as unknown as { pool: CoreQueryable }).pool);
    this.pool = pool;
  }

  async transaction<T>(
    work: (session: Session) => Promise<T>,
    options?: TransactionOptions,
  ): Promise<T> {
    const connection = await this.pool.getConnection();
    try {
      // SET TRANSACTION 只作用于下一个事务，不改连接的默认隔离级别
      if (options?.isolation)
        await connection.query(`SET TRANSACTION ISOLATION LEVEL ${ISOLATION[options.isolation]}`);
      await connection.query(
        options?.readOnly ? 'START TRANSACTION READ ONLY' : 'START TRANSACTION',
      );
      try {
        const result = await work(
          new MySqlSession(
            connection,
            (connection as unknown as { connection: CoreQueryable }).connection,
          ),
        );
        await connection.commit();
        return result;
      } catch (error) {
        await connection.rollback();
        throw error;
      }
    } finally {
      connection.release();
    }
  }
}

export interface MySqlOptions {
  /** 服务器版本：按它选写法（如 8.0.18 的 upsert 用 VALUES()），用到更高版本的特性时报错；默认最新 */
  readonly version?: MySqlVersion;
}

export function mysql(pool: Pool, options: MySqlOptions = {}): Adapter {
  return { dialect: new MySqlDialect({ version: options.version }), driver: new MySqlDriver(pool) };
}
