/**
 * PGlite（ROADMAP 18.3.5）：编译成 WASM 的 PostgreSQL，跑在进程里（单测、浏览器、边缘函数都不用起数据库），按结构类型对接：
 * ```ts
 * import { PGlite } from '@electric-sql/pglite'
 * import { pglite } from '@zerodep-dev/easy-query-ts-pg/pglite'
 * const db = createDb({ schema, adapter: pglite(new PGlite()) })
 * ```
 * 单独一个入口：不用装 pg。方言与 postgres() 相同；日期时间、int8、numeric（及其数组）按文字读，再由列的 codec 解码（与 pg 驱动一致）。
 * PGlite 只有一条连接：事务进行中其它异步代码发出的语句会排在事务之后（PGlite 自己排队）
 */
import type {
  Adapter,
  Driver,
  ExecuteResult,
  Session,
  TransactionOptions,
} from '@zerodep-dev/easy-query-ts';
import { PostgresDialect, TEXT_TYPE_OIDS } from './dialect.ts';

const parsers = Object.fromEntries(TEXT_TYPE_OIDS.map((oid) => [oid, (value: string) => value]));

interface PgliteResult {
  readonly rows: Record<string, unknown>[];
  readonly affectedRows?: number;
}

interface PgliteExecutor {
  query(
    sql: string,
    params: unknown[],
    options: { parsers: Record<number, (value: string) => unknown> },
  ): Promise<PgliteResult>;
}

/** 用到的 PGlite 的部分；new PGlite() 可以直接传 */
export interface PgliteDatabase extends PgliteExecutor {
  transaction<T>(work: (tx: PgliteExecutor) => Promise<T>): Promise<T>;
}

const ISOLATION = {
  'read uncommitted': 'READ UNCOMMITTED',
  'read committed': 'READ COMMITTED',
  'repeatable read': 'REPEATABLE READ',
  serializable: 'SERIALIZABLE',
} as const;

class PgliteSession implements Session {
  protected readonly target: PgliteExecutor;

  constructor(target: PgliteExecutor) {
    this.target = target;
  }

  async query(sql: string, params: readonly unknown[]): Promise<Record<string, unknown>[]> {
    return (await this.target.query(sql, [...params], { parsers })).rows;
  }

  async execute(sql: string, params: readonly unknown[]): Promise<ExecuteResult> {
    const result = await this.target.query(sql, [...params], { parsers });
    return { affected: result.affectedRows ?? 0, insertId: undefined };
  }
}

class PgliteDriver extends PgliteSession implements Driver {
  private readonly database: PgliteDatabase;

  constructor(database: PgliteDatabase) {
    super(database);
    this.database = database;
  }

  transaction<T>(work: (session: Session) => Promise<T>, options?: TransactionOptions): Promise<T> {
    return this.database.transaction(async (tx) => {
      const session = new PgliteSession(tx);
      // PGlite 自己发 BEGIN：隔离级别、只读在事务的第一条语句里设
      const mode = [
        options?.isolation ? `ISOLATION LEVEL ${ISOLATION[options.isolation]}` : '',
        options?.readOnly ? 'READ ONLY' : '',
      ].filter(Boolean);
      if (mode.length > 0) await session.execute(`SET TRANSACTION ${mode.join(' ')}`, []);
      return work(session);
    });
  }
}

export function pglite(database: PgliteDatabase): Adapter {
  return { dialect: new PostgresDialect(), driver: new PgliteDriver(database) };
}
