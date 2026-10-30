/**
 * PostgreSQL（12+），驱动用 node-postgres（pg）的连接池。
 * ```ts
 * import pg from 'pg'
 * const db = createDb({ schema, adapter: postgres(new pg.Pool({ connectionString })) })
 *
 * import { Pool } from '@neondatabase/serverless'   // Neon serverless（WebSocket），与 pg.Pool 兼容
 * const db = createDb({ schema, adapter: postgres(new Pool({ connectionString })) })
 * ```
 * 日期、时间、时间戳每条查询都按文字读出，再由列的 codec 解码（不受驱动按本地时区解析的影响）；int8、numeric 本来就是文字。
 * 自增主键用 INSERT … RETURNING 取回。
 */
import pg from 'pg';
import type { QueryConfig, QueryResult } from 'pg';
import {
  type Adapter,
  type Driver,
  type ExecuteResult,
  type Session,
  type TransactionOptions,
} from '@zerodep-dev/easy-query-ts';
import { KingbaseDialect, OpenGaussDialect } from './compatible.ts';
import { PostgresDialect, TEXT_TYPE_OIDS } from './dialect.ts';

export { Pg } from './functions.ts';
export { PostgresDialect } from './dialect.ts';
export { KingbaseDialect, OpenGaussDialect } from './compatible.ts';

const AS_TEXT = new Set(TEXT_TYPE_OIDS);

const types = {
  getTypeParser: ((oid: number) =>
    AS_TEXT.has(oid)
      ? (value: string) => value
      : pg.types.getTypeParser(oid)) as typeof pg.types.getTypeParser,
};

/** 能执行语句的对象：连接池或从池里借出的连接 */
interface Target {
  query(config: QueryConfig): Promise<QueryResult>;
}

/** 从池里借出的连接；processID 是服务端的进程号（取消语句用） */
interface PgPoolClient extends Target {
  readonly processID?: number | null;
  release(): void;
}

/** 用到的连接池的部分：pg.Pool、Neon serverless 的 Pool（WebSocket）都满足 */
export interface PgPool extends Target {
  connect(): Promise<PgPoolClient>;
}

/** 游标名的序号：同一个事务里可以同时开几个游标 */
let cursors = 0;

function run(target: Target, sql: string, params: readonly unknown[]): Promise<QueryResult> {
  const config: QueryConfig = { text: sql, values: params as unknown[], types };
  return target.query(config);
}

class PostgresSession implements Session {
  protected readonly target: Target;
  /** 连接池（事务里的会话没有）：流式读取、带取消信号的语句用它借一条连接 */
  protected readonly pool: PgPool | undefined;
  /** 取消语句时从这里另开一条连接发 pg_cancel_backend（事务里的会话也有） */
  private readonly canceller: PgPool;

  constructor(target: Target, canceller: PgPool, pool?: PgPool) {
    this.target = target;
    this.canceller = canceller;
    this.pool = pool;
  }

  async query(
    sql: string,
    params: readonly unknown[],
    signal?: AbortSignal,
  ): Promise<Record<string, unknown>[]> {
    const result = await this.cancellable(sql, params, signal);
    return result.rows as Record<string, unknown>[];
  }

  /**
   * 带信号的语句：信号触发时在服务端终止它。要知道语句跑在哪个服务端进程上，池级会话先借一条连接（事务里的连接本来就固定）。
   * 取消请求发完才归还连接：否则连接可能已经在跑别人的语句，取消会落到那条语句上
   */
  private async cancellable(
    sql: string,
    params: readonly unknown[],
    signal: AbortSignal | undefined,
  ): Promise<QueryResult> {
    if (!signal) return run(this.target, sql, params);
    signal.throwIfAborted();
    const own = this.pool ? await this.pool.connect() : undefined;
    const client: Target & { readonly processID?: number | null } = own ?? this.target;
    let cancelling: Promise<unknown> | undefined;
    const cancel = () => {
      if (!client.processID) return;
      // 尽力而为：取消失败（语句恰好刚结束、连接断了）不影响调用方，调用方已经以信号的 reason 失败
      cancelling = run(this.canceller, 'SELECT pg_cancel_backend($1)', [client.processID]).catch(
        () => undefined,
      );
    };
    signal.addEventListener('abort', cancel, { once: true });
    try {
      return await run(client, sql, params);
    } finally {
      signal.removeEventListener('abort', cancel);
      await cancelling;
      own?.release();
    }
  }

  /**
   * 游标流：在事务里 DECLARE 一个游标，再一批批 FETCH。直接用池时借一条连接开临时事务；
   * 已经在事务里（target 是 PoolClient）就直接在这个事务里声明游标。不需要额外的 pg-cursor 依赖。
   */
  async *stream(
    sql: string,
    params: readonly unknown[],
    batchSize: number,
  ): AsyncGenerator<Record<string, unknown>[]> {
    const own = this.pool ? await this.pool.connect() : undefined;
    const client: Target = own ?? this.target;
    const cursor = `eqts_cursor_${(cursors += 1)}`;
    try {
      if (own) await run(client, 'BEGIN', []);
      await run(client, `DECLARE ${cursor} NO SCROLL CURSOR FOR ${sql}`, params);
      for (;;) {
        const { rows } = await run(client, `FETCH ${batchSize} FROM ${cursor}`, []);
        if (rows.length > 0) yield rows as Record<string, unknown>[];
        if (rows.length < batchSize) break;
      }
    } finally {
      try {
        await run(client, `CLOSE ${cursor}`, []);
        if (own) await run(client, 'COMMIT', []);
      } finally {
        own?.release();
      }
    }
  }

  async execute(
    sql: string,
    params: readonly unknown[],
    signal?: AbortSignal,
  ): Promise<ExecuteResult> {
    const result = await this.cancellable(sql, params, signal);
    return { affected: result.rowCount ?? 0, insertId: undefined };
  }
}

const ISOLATION = {
  'read uncommitted': 'READ UNCOMMITTED',
  'read committed': 'READ COMMITTED',
  'repeatable read': 'REPEATABLE READ',
  serializable: 'SERIALIZABLE',
} as const;

class PostgresDriver extends PostgresSession implements Driver {
  private readonly source: PgPool;

  constructor(pool: PgPool) {
    super(pool, pool, pool);
    this.source = pool;
  }

  async transaction<T>(
    work: (session: Session) => Promise<T>,
    options?: TransactionOptions,
  ): Promise<T> {
    const client = await this.source.connect();
    try {
      await run(
        client,
        `BEGIN${options?.isolation ? ` ISOLATION LEVEL ${ISOLATION[options.isolation]}` : ''}${options?.readOnly ? ' READ ONLY' : ''}`,
        [],
      );
      try {
        const result = await work(new PostgresSession(client, this.source));
        await run(client, 'COMMIT', []);
        return result;
      } catch (error) {
        await run(client, 'ROLLBACK', []);
        throw error;
      }
    } finally {
      client.release();
    }
  }
}

/** listen 用到的连接：pg 与 Neon 的 PoolClient 都满足 */
interface ListenClient {
  query(sql: string): Promise<unknown>;
  on(
    event: 'notification',
    listener: (message: { channel: string; payload?: string }) => void,
  ): unknown;
  off(
    event: 'notification',
    listener: (message: { channel: string; payload?: string }) => void,
  ): unknown;
  release(): void;
}

/**
 * 收听 NOTIFY（ROADMAP 19.10，与 db.notify 配对）：从池里借一条专用连接 LISTEN 这个频道，每条通知调一次 handler(payload)；
 * 返回的函数 UNLISTEN 并归还连接。连接断了不会自动重连，要重新 listen
 * ```ts
 * const stop = await listen(pool, 'cache_evict', (key) => cache.delete(key))
 * await db.notify('cache_evict', 'user:7')   // 在事务里时随提交发出
 * ```
 */
export async function listen(
  // 只要 connect：pg 与 Neon 的 PoolClient 的 on 是一组重载，按结构类型对不上，借出来之后按 ListenClient 用
  pool: { connect(): Promise<unknown> },
  channel: string,
  handler: (payload: string) => void,
): Promise<() => Promise<void>> {
  const client = (await pool.connect()) as ListenClient;
  const name = `"${channel.replace(/"/g, '""')}"`;
  const onNotification = (message: { channel: string; payload?: string }) => {
    if (message.channel === channel) handler(message.payload ?? '');
  };
  client.on('notification', onNotification);
  try {
    await client.query(`LISTEN ${name}`);
  } catch (error) {
    client.off('notification', onNotification);
    client.release();
    throw error;
  }
  return async () => {
    client.off('notification', onNotification);
    try {
      await client.query(`UNLISTEN ${name}`);
    } finally {
      client.release();
    }
  };
}

export function postgres(pool: PgPool): Adapter {
  return { dialect: new PostgresDialect(), driver: new PostgresDriver(pool) };
}

/** openGauss / GaussDB（PG 协议，驱动同样是 pg） */
export function opengauss(pool: PgPool): Adapter {
  return { dialect: new OpenGaussDialect(), driver: new PostgresDriver(pool) };
}

/** 人大金仓 KingbaseES（PG 模式，驱动同样是 pg） */
export function kingbase(pool: PgPool): Adapter {
  return { dialect: new KingbaseDialect(), driver: new PostgresDriver(pool) };
}
