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

/** 从池里借出的连接 */
interface PgPoolClient extends Target {
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
  /** 连接池（事务里的会话没有）：流式读取时用它借一条连接开临时事务 */
  protected readonly pool: PgPool | undefined;

  constructor(target: Target, pool?: PgPool) {
    this.target = target;
    this.pool = pool;
  }

  async query(sql: string, params: readonly unknown[]): Promise<Record<string, unknown>[]> {
    const result = await run(this.target, sql, params);
    return result.rows as Record<string, unknown>[];
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

  async execute(sql: string, params: readonly unknown[]): Promise<ExecuteResult> {
    const result = await run(this.target, sql, params);
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
    super(pool, pool);
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
        const result = await work(new PostgresSession(client));
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
