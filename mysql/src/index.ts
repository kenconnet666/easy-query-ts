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
  type Adapter,
  type Without,
  type Driver,
  type ExecuteResult,
  type Session,
  type TransactionOptions,
} from '@zerodep-dev/easy-query-ts';
import { MySqlDialect, type MySqlVersion } from './dialect.ts';
import { DorisDialect, type DorisOptions } from './doris.ts';

export { MySQL } from './functions.ts';
export type { MatchMode } from './functions.ts';
export { MySqlDialect, type MySqlVersion } from './dialect.ts';
export { DorisDialect, type DorisOptions } from './doris.ts';

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
  /** 终止语句时从这里另开一条连接发 KILL QUERY（事务里的会话也有） */
  private readonly killer: Pool;

  constructor(target: Queryable, core: CoreQueryable, killer: Pool) {
    this.target = target;
    this.core = core;
    this.killer = killer;
  }

  async query(
    sql: string,
    params: readonly unknown[],
    signal?: AbortSignal,
  ): Promise<Record<string, unknown>[]> {
    const [rows] = await this.killable(signal, (on) => on.query({ sql, values: params, typeCast }));
    return rows as Record<string, unknown>[];
  }

  /**
   * 带信号的语句：信号触发时 KILL QUERY 它所在的连接线程（连接本身保留）。池级会话先借一条连接才知道线程号；
   * KILL 发完才归还连接，免得落到复用这条连接的下一条语句上
   */
  private async killable<T>(
    signal: AbortSignal | undefined,
    work: (on: Queryable) => Promise<T>,
  ): Promise<T> {
    if (!signal) return work(this.target);
    signal.throwIfAborted();
    const pooled = 'getConnection' in this.target;
    const connection = pooled ? await this.killer.getConnection() : (this.target as PoolConnection);
    let killing: Promise<unknown> | undefined;
    const kill = () => {
      // 尽力而为：KILL 失败（语句恰好刚结束）不影响调用方，调用方已经以信号的 reason 失败
      killing = this.killer
        .query(`KILL QUERY ${Number(connection.threadId)}`)
        .catch(() => undefined);
    };
    signal.addEventListener('abort', kill, { once: true });
    try {
      return await work(connection);
    } finally {
      signal.removeEventListener('abort', kill);
      await killing;
      if (pooled) connection.release();
    }
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

  async execute(
    sql: string,
    params: readonly unknown[],
    signal?: AbortSignal,
  ): Promise<ExecuteResult> {
    const [result] = await this.killable(signal, (on) =>
      on.query<ResultSetHeader>({ sql, values: params }),
    );
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
    super(pool, (pool as unknown as { pool: CoreQueryable }).pool, pool);
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
            this.pool,
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
  /** 服务器的 max_allowed_packet（字节）：批量插入按它切分语句；不给按 4 MiB，mysql.detect 自动读 */
  readonly maxPacket?: number;
}

export function mysql(pool: Pool, options: MySqlOptions = {}): Adapter<Without<'returning'>> {
  return {
    dialect: new MySqlDialect({ version: options.version, maxPacket: options.maxPacket }),
    driver: new MySqlDriver(pool),
  };
}

/**
 * 连上库读出服务器版本再建 adapter：同一份代码部署到 8.0.18 还是 8.4 都自动选对写法，不用手配 version。
 * MariaDB 按 8.0 渲染（有窗口函数、CTE，upsert 用 VALUES()）。
 */
mysql.detect = async (pool: Pool): Promise<Adapter<Without<'returning'>>> => {
  const [rows] = await pool.query('SELECT VERSION() AS v, @@max_allowed_packet AS p');
  const row = (rows as { v: string; p: unknown }[])[0];
  const text = String(row?.v ?? '');
  const version = /mariadb/i.test(text) ? '8.0' : /^\d+(\.\d+)*/.exec(text)?.[0];
  const maxPacket = Number(row?.p) || undefined;
  return { dialect: new MySqlDialect({ version, maxPacket }), driver: new MySqlDriver(pool) };
};

/** Doris 的事务不能回滚：语句依次执行，不开事务 */
class DorisDriver extends MySqlDriver {
  override async transaction<T>(work: (session: Session) => Promise<T>): Promise<T> {
    return work(this);
  }
}

/** Apache Doris（MySQL 协议，驱动同样是 mysql2）；建表的副本数见 DorisOptions */
/** Doris 缺的能力：没有 RETURNING、行锁、能回滚的事务，取不回自增值，upsert 只能整行覆盖 */
export type DorisAdapter = Adapter<
  Without<
    | 'returning'
    | 'lock'
    | 'forUpdate'
    | 'skipLocked'
    | 'noWait'
    | 'transactions'
    | 'generatedKeys'
    | 'upsertIgnore'
  >
>;

export function doris(pool: Pool, options: DorisOptions = {}): DorisAdapter {
  return { dialect: new DorisDialect(options), driver: new DorisDriver(pool) };
}
