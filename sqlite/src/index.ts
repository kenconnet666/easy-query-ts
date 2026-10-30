/**
 * SQLite：同步的嵌入式驱动——Node 自带的 node:sqlite（无需安装驱动）或 Bun 的 bun:sqlite，按结构类型对接：
 * ```ts
 * import { DatabaseSync } from 'node:sqlite'
 * const db = createDb({ schema, adapter: sqlite(new DatabaseSync(':memory:')) })
 *
 * import { Database } from 'bun:sqlite'
 * const db = createDb({ schema, adapter: sqlite(new Database('app.db', { safeIntegers: true })) })
 * ```
 * 注意：同一个数据库对象只有一条连接，事务进行中其它异步代码发出的语句也会落在这个事务里；事务之间按顺序排队。
 * Cloudflare D1、libSQL / Turso 见 d1()、libsql()
 */
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
export { d1, type D1Adapter, type D1Binding } from './d1.ts';
export { libsql, type LibsqlClient } from './libsql.ts';

/** 用到的同步 SQLite 数据库的部分：node:sqlite 的 DatabaseSync、bun:sqlite 的 Database 都满足 */
export interface SqliteDatabase {
  prepare(sql: string): SqliteStatement;
  exec(sql: string): unknown;
}

/** 预编译的语句；参数按位置绑定 */
export interface SqliteStatement {
  all(...params: never[]): unknown[];
  run(...params: never[]): { changes: number | bigint; lastInsertRowid: number | bigint };
  iterate(...params: never[]): Iterable<unknown>;
  /** node:sqlite：整数读成 bigint（bun:sqlite 在打开库时传 safeIntegers） */
  setReadBigInts?(enabled: boolean): unknown;
}

export interface SqliteOptions {
  /**
   * 整数列按 bigint 读出（再由列的 codec 转成 number / bigint / string）。
   * SQLite 的整数是 64 位，node:sqlite 默认读成 JS number，超过 2^53 会丢精度；用 `col.bigint({ mode: 'bigint' })` 存雪花 id 之类的大整数时要打开。
   * 默认关闭：打开后没有 codec 的原生片段（`sql\`...\``）读出的整数也是 bigint。
   * 只对 node:sqlite 有用；bun:sqlite 在打开库时传 `{ safeIntegers: true }`
   */
  readonly bigInts?: boolean;
}

class SqliteSession implements Session {
  protected readonly database: SqliteDatabase;
  private readonly bigInts: boolean;

  constructor(database: SqliteDatabase, options: SqliteOptions = {}) {
    this.database = database;
    this.bigInts = options.bigInts ?? false;
  }

  async query(sql: string, params: readonly unknown[]): Promise<Record<string, unknown>[]> {
    const statement = this.database.prepare(sql);
    if (this.bigInts) statement.setReadBigInts?.(true);
    return statement.all(...(params as never[])) as Record<string, unknown>[];
  }

  /** node:sqlite 的 iterate：逐行从游标取，按批产出 */
  async *stream(
    sql: string,
    params: readonly unknown[],
    batchSize: number,
  ): AsyncGenerator<Record<string, unknown>[]> {
    const statement = this.database.prepare(sql);
    if (this.bigInts) statement.setReadBigInts?.(true);
    let batch: Record<string, unknown>[] = [];
    for (const row of statement.iterate(...(params as never[]))) {
      batch.push(row as Record<string, unknown>);
      if (batch.length >= batchSize) {
        yield batch;
        batch = [];
      }
    }
    if (batch.length > 0) yield batch;
  }

  async execute(sql: string, params: readonly unknown[]): Promise<ExecuteResult> {
    const result = this.database.prepare(sql).run(...(params as never[]));
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
  database: SqliteDatabase,
  options: SqliteOptions = {},
): Adapter<Without<'forUpdate' | 'skipLocked' | 'noWait'>> {
  return { dialect: new SqliteDialect(), driver: new SqliteDriver(database, options) };
}
