/**
 * 开发环境的查询检查（ROADMAP 18.3.4）：一个请求里同一条 SQL 反复执行（N+1）、单条语句太慢，都报出来：
 * ```ts
 * import { queryWatch } from '@zerodep-dev/easy-query-ts/observe'
 *
 * const watch = queryWatch({ repeat: 5, slowMs: 200 })
 * const db = createDb({ schema, adapter, onExecute: watch.onExecute })
 * app.use((req, res, next) => watch.run(next))   // 每个请求一个统计范围
 * ```
 * 同一条 SQL 指 SQL 文本相同（参数不同）：循环里逐个查导航、逐行 find 就是这样。只统计读；不在 run 里时只报慢查询。
 * 单独一个入口：用到 node:async_hooks，核心不依赖它
 */
import { AsyncLocalStorage } from 'node:async_hooks';
import type { ExecutionEvent } from './session.ts';

/** 报出来的问题 */
export type QueryWarning =
  | { readonly kind: 'slow'; readonly sql: string; readonly durationMs: number }
  /** 同一个 run 范围里这条 SQL 执行到了 count 次（到 repeat 时报一次） */
  | { readonly kind: 'repeated'; readonly sql: string; readonly count: number };

export interface QueryWatchOptions {
  /** 同一条读 SQL 在一个范围里执行到这么多次就报；默认 5 */
  readonly repeat?: number;
  /** 耗时到这么多毫秒就报；默认 500 */
  readonly slowMs?: number;
  /** 怎么报；默认 console.warn */
  readonly report?: (warning: QueryWarning) => void;
}

export interface QueryWatch {
  /** 传给 createDb 的 onExecute */
  readonly onExecute: (event: ExecutionEvent) => void;
  /** 一个统计范围（一个请求、一个任务）：fn 里（含它发起的异步调用）执行的语句一起计数 */
  run<R>(fn: () => R): R;
}

export function queryWatch(options: QueryWatchOptions = {}): QueryWatch {
  const { repeat = 5, slowMs = 500 } = options;
  const report =
    options.report ??
    ((w: QueryWarning) =>
      console.warn(
        w.kind === 'slow'
          ? `[easy-query] slow query (${Math.round(w.durationMs)} ms): ${w.sql}`
          : `[easy-query] the same query ran ${w.count} times in one scope (N+1?): ${w.sql}`,
      ));
  const scopes = new AsyncLocalStorage<Map<string, number>>();
  return {
    onExecute: (event) => {
      const { sql } = event.statement;
      if (event.durationMs >= slowMs) report({ kind: 'slow', sql, durationMs: event.durationMs });
      const counts = scopes.getStore();
      if (!counts || event.kind !== 'query') return;
      const count = (counts.get(sql) ?? 0) + 1;
      counts.set(sql, count);
      if (count === repeat) report({ kind: 'repeated', sql, count });
    },
    run: (fn) => scopes.run(new Map(), fn),
  };
}
