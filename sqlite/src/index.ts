/**
 * SQLite：基于 Node 自带的 node:sqlite（无需安装驱动），主要用于测试与本地工具。
 * ```ts
 * import { DatabaseSync } from 'node:sqlite'
 * const db = createDb({ schema, adapter: sqlite(new DatabaseSync(':memory:')) })
 * ```
 * 注意：同一个 DatabaseSync 只有一条连接，事务进行中其它异步代码发出的语句也会落在这个事务里；事务之间按顺序排队。
 */
import type { DatabaseSync, SQLInputValue } from 'node:sqlite';
import {
  type Adapter,
  type Without,
  type Driver,
  type ExecuteResult,
  type Session,
  type TransactionOptions,
} from '@zerodep-dev/easy-query-ts';
import { SqliteDialect } from './dialect.ts';

export { SqliteDialect } from './dialect.ts';

export interface SqliteOptions {
  /**
   * 整数列按 bigint 读出（再由列的 codec 转成 number / bigint / string）。
   * SQLite 的整数是 64 位，node:sqlite 默认读成 JS number，超过 2^53 会丢精度；用 `col.bigint({ mode: 'bigint' })` 存雪花 id 之类的大整数时要打开。
   * 默认关闭：打开后没有 codec 的原生片段（`sql\`...\``）读出的整数也是 bigint。
   */
  readonly bigInts?: boolean;
}

class SqliteSession implements Session {
  protected readonly database: DatabaseSync;
  private readonly bigInts: boolean;

  constructor(database: DatabaseSync, options: SqliteOptions = {}) {
    this.database = database;
    this.bigInts = options.bigInts ?? false;
  }

  async query(sql: string, params: readonly unknown[]): Promise<Record<string, unknown>[]> {
    const statement = this.database.prepare(sql);
    if (this.bigInts) statement.setReadBigInts(true);
    return statement.all(...(params as SQLInputValue[])) as Record<string, unknown>[];
  }

  /** node:sqlite 的 iterate：逐行从游标取，按批产出 */
  async *stream(
    sql: string,
    params: readonly unknown[],
    batchSize: number,
  ): AsyncGenerator<Record<string, unknown>[]> {
    const statement = this.database.prepare(sql);
    if (this.bigInts) statement.setReadBigInts(true);
    let batch: Record<string, unknown>[] = [];
    for (const row of statement.iterate(...(params as SQLInputValue[]))) {
      batch.push(row as Record<string, unknown>);
      if (batch.length >= batchSize) {
        yield batch;
        batch = [];
      }
    }
    if (batch.length > 0) yield batch;
  }

  async execute(sql: string, params: readonly unknown[]): Promise<ExecuteResult> {
    const result = this.database.prepare(sql).run(...(params as SQLInputValue[]));
    return { affected: Number(result.changes), insertId: result.lastInsertRowid };
  }
}

class SqliteDriver extends SqliteSession implements Driver {
  private queue: Promise<unknown> = Promise.resolve();

  async transaction<T>(
    work: (session: Session) => Promise<T>,
    options?: TransactionOptions,
  ): Promise<T> {
    const run = async (): Promise<T> => {
      // 只读事务：SQLite 没有 READ ONLY 事务，用 query_only 让写入被拒绝；不需要写锁，所以用普通的 BEGIN
      this.database.exec(options?.readOnly ? 'PRAGMA query_only = ON' : 'BEGIN IMMEDIATE');
      if (options?.readOnly) this.database.exec('BEGIN');
      try {
        const result = await work(this);
        this.database.exec('COMMIT');
        return result;
      } catch (error) {
        this.database.exec('ROLLBACK');
        throw error;
      } finally {
        if (options?.readOnly) this.database.exec('PRAGMA query_only = OFF');
      }
    };
    const next = this.queue.then(run, run);
    this.queue = next.catch(() => undefined);
    return next;
  }
}

/** SQLite 没有 SELECT … FOR UPDATE（lock() 用写锁模拟，照常可用） */
export function sqlite(
  database: DatabaseSync,
  options: SqliteOptions = {},
): Adapter<Without<'forUpdate' | 'skipLocked' | 'noWait'>> {
  return { dialect: new SqliteDialect(), driver: new SqliteDriver(database, options) };
}
