/**
 * 类型化的请求上下文（ROADMAP 18.3.3）：AsyncLocalStorage 包一层，值的类型在声明处写一次，拦截器、onExecute 里直接取：
 * ```ts
 * import { requestContext } from '@zerodep-dev/easy-query-ts/context'
 *
 * const request = requestContext<{ tenantId: number; userId: string }>()
 * const db = createDb({ schema, adapter, interceptors: [tenant('tenantId', () => request.get().tenantId)] })
 *
 * app.use((req, res, next) => request.run({ tenantId: req.tenant, userId: req.user }, next))
 * ```
 * 单独一个入口：核心不依赖 node:async_hooks，只有用到它的应用才引入（Node、Bun、Deno、开了 nodejs_compat 的 Workers 都有）
 */
import { AsyncLocalStorage } from 'node:async_hooks';

export interface RequestContext<T> {
  /** 在这个值下执行 fn；fn 里（含它发起的异步调用）get() 都拿到这个值。可以嵌套，里层覆盖外层 */
  run<R>(value: T, fn: () => R): R;
  /** 当前的值；不在 run 里时报错（忘了包中间件、后台任务没设上下文） */
  get(): T;
  /** 当前的值；不在 run 里时 undefined */
  find(): T | undefined;
}

/** 声明一个请求上下文；name 用在报错信息里 */
export function requestContext<T>(name = 'request context'): RequestContext<T> {
  const storage = new AsyncLocalStorage<{ readonly value: T }>();
  return {
    run: (value, fn) => storage.run({ value }, fn),
    get: () => {
      const box = storage.getStore();
      if (!box) throw new Error(`${name} is not set: call run() around this code`);
      return box.value;
    },
    find: () => storage.getStore()?.value,
  };
}
