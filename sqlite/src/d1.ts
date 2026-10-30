/**
 * Cloudflare D1（ROADMAP 18.3.5）：Worker 里的 SQLite，用 Worker 绑定的 D1Database，按结构类型对接（不依赖 workers-types）：
 * ```ts
 * export default {
 *   async fetch(request, env) {
 *     const db = createDb({ schema, adapter: d1(env.DB) })
 *     return Response.json(await db.queryable(User).toList())
 *   },
 * }
 * ```
 * D1 没有交互式事务（不能 BEGIN … COMMIT）：类型上没有 transaction / begin / lock / forUpdate；
 * 库内部要事务的地方（save、syncTables、迁移）依次执行，出错时不回滚
 */
import type { Adapter, Driver, ExecuteResult, Session, Without } from '@zerodep-dev/easy-query-ts';
import { SqliteDialect } from './dialect.ts';

/** 用到的 D1Database 的部分；Worker 的 `env.DB` 可以直接传 */
export interface D1Binding {
  prepare(sql: string): D1Statement;
}

interface D1Statement {
  bind(...values: unknown[]): D1Statement;
  all(): Promise<{
    results: Record<string, unknown>[];
    meta: { changes?: number; last_row_id?: number };
  }>;
}

/** D1 能绑定的值：null、数字、文字、ArrayBuffer；bigint 安全时转成数字，否则转成文字 */
function bindable(value: unknown): unknown {
  if (value === undefined) return null;
  if (typeof value === 'bigint')
    return Number.isSafeInteger(Number(value)) ? Number(value) : value.toString();
  if (value instanceof Uint8Array)
    return value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength);
  return value;
}

class D1Driver implements Driver {
  private readonly binding: D1Binding;

  constructor(binding: D1Binding) {
    this.binding = binding;
  }

  private run(sql: string, params: readonly unknown[]) {
    return this.binding
      .prepare(sql)
      .bind(...params.map(bindable))
      .all();
  }

  async query(sql: string, params: readonly unknown[]): Promise<Record<string, unknown>[]> {
    return (await this.run(sql, params)).results;
  }

  async execute(sql: string, params: readonly unknown[]): Promise<ExecuteResult> {
    const { meta } = await this.run(sql, params);
    return { affected: meta.changes ?? 0, insertId: meta.last_row_id };
  }

  /** 没有事务：依次执行 */
  async transaction<T>(work: (session: Session) => Promise<T>): Promise<T> {
    return work(this);
  }
}

/** D1 缺的能力：没有交互式事务与行锁 */
export type D1Adapter = Adapter<
  Without<'transactions' | 'lock' | 'forUpdate' | 'skipLocked' | 'noWait'>
>;

export function d1(binding: D1Binding): D1Adapter {
  return { dialect: new SqliteDialect(), driver: new D1Driver(binding) };
}
