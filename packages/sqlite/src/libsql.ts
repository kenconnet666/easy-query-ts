/**
 * libSQL / Turso（ROADMAP 18.3.5）：用 @libsql/client 的 Client，按结构类型对接（本包不依赖它）。
 * 本地文件、内存库、远端 Turso 都是同一个 Client：
 * ```ts
 * import { createClient } from '@libsql/client'
 * const db = createDb({ schema, adapter: libsql(createClient({ url: 'libsql://….turso.io', authToken })) })
 * ```
 * 事务用 client.transaction()（交互式，远端时占着一条流直到提交），同一个 Client 的事务按顺序排队（SQLite 只有一个写者，
 * 本地文件库并发开写事务会直接 SQLITE_BUSY）；只读事务用 'read' 模式并打开 query_only。
 * 整数读成什么由 Client 的 intMode 决定：存雪花 id 之类的大整数时建 Client 传 `intMode: 'bigint'`
 */
import type {
  Adapter,
  Driver,
  ExecuteResult,
  Session,
  TransactionOptions,
  Without,
} from '@zerodep-dev/easy-query-ts';
import { SqliteDialect } from './dialect.ts';

/** 一条语句的结果：rows 是按位置取值的数组（也带列名属性），columns 是列名 */
interface LibsqlResult {
  readonly columns: readonly string[];
  readonly rows: readonly ArrayLike<unknown>[];
  readonly rowsAffected: number;
  readonly lastInsertRowid: bigint | undefined;
}

interface LibsqlExecutor {
  execute(statement: { sql: string; args: never[] }): Promise<LibsqlResult>;
}

interface LibsqlTransaction extends LibsqlExecutor {
  commit(): Promise<void>;
  rollback(): Promise<void>;
  close(): void;
}

/** 用到的 @libsql/client Client 的部分；createClient(...) 的返回值可以直接传 */
export interface LibsqlClient extends LibsqlExecutor {
  transaction(mode: 'write' | 'read'): Promise<LibsqlTransaction>;
}

class LibsqlSession implements Session {
  protected readonly target: LibsqlExecutor;

  constructor(target: LibsqlExecutor) {
    this.target = target;
  }

  private run(sql: string, params: readonly unknown[]): Promise<LibsqlResult> {
    // libSQL 不接受 undefined
    return this.target.execute({ sql, args: params.map((p) => p ?? null) as never[] });
  }

  async query(sql: string, params: readonly unknown[]): Promise<Record<string, unknown>[]> {
    const { columns, rows } = await this.run(sql, params);
    return rows.map((row) => {
      const out: Record<string, unknown> = {};
      for (let i = 0; i < columns.length; i++) out[columns[i]!] = row[i];
      return out;
    });
  }

  async execute(sql: string, params: readonly unknown[]): Promise<ExecuteResult> {
    const result = await this.run(sql, params);
    return { affected: result.rowsAffected, insertId: result.lastInsertRowid };
  }
}

function queryOnly(tx: LibsqlExecutor, on: boolean): Promise<unknown> {
  return tx.execute({ sql: `PRAGMA query_only = ${on ? 'ON' : 'OFF'}`, args: [] });
}

class LibsqlDriver extends LibsqlSession implements Driver {
  private readonly client: LibsqlClient;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(client: LibsqlClient) {
    super(client);
    this.client = client;
  }

  transaction<T>(work: (session: Session) => Promise<T>, options?: TransactionOptions): Promise<T> {
    const run = () => this.inTransaction(work, options);
    const next = this.queue.then(run, run);
    this.queue = next.catch(() => undefined);
    return next;
  }

  private async inTransaction<T>(
    work: (session: Session) => Promise<T>,
    options?: TransactionOptions,
  ): Promise<T> {
    const tx = await this.client.transaction(options?.readOnly ? 'read' : 'write');
    const readOnly = options?.readOnly === true;
    try {
      // 'read' 模式在本地库上不拒绝写入，另开 query_only
      if (readOnly) await queryOnly(tx, true);
      let result: T;
      try {
        result = await work(new LibsqlSession(tx));
      } finally {
        // commit / rollback 之后连接就还回 Client 的池里了，在那之前复原
        if (readOnly) await queryOnly(tx, false);
      }
      await tx.commit();
      return result;
    } catch (error) {
      await tx.rollback();
      throw error;
    } finally {
      tx.close();
    }
  }
}

/** libSQL 与 SQLite 一样没有 SELECT … FOR UPDATE（lock() 用写锁模拟，照常可用） */
export function libsql(
  client: LibsqlClient,
): Adapter<Without<'forUpdate' | 'skipLocked' | 'noWait'>> {
  return { dialect: new SqliteDialect(), driver: new LibsqlDriver(client) };
}
