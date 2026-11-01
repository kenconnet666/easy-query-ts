# TS：只读 Db 与请求上下文

## db.readonly()

报表、只读接口、只连从库的服务不该有写入。`db.readonly()` 返回的 Db 在类型上就没有写方法：

```ts
const reader = createDb({ schema, adapter: replica }).readonly();

await reader.queryable(Order).toList(); // 照常
await reader.transaction(async (tx) => tx.queryable(Order).count()); // 读一致的快照，照常
reader.insert(Order); // 类型错误：'error: this Db does not support': "write"
reader.queryable(Order).forUpdate(); // 类型错误：加锁也算写
```

- 去掉的能力：`write`（insert、delete、save、remove、createTables / syncTables / dropTables、migrate）、`update`、
  `lock`、`forUpdate`、`skipLocked`、`noWait`。走的是方言能力那套类型（见 ts-capabilities.md），派生出来的 Db
  （`withSignal`、`usePrimary`、`with`、事务里的 `tx`）仍是只读的。
- 运行时兜底：断言掉类型、从 JS 调用时，写入、DDL、`db.sql.execute` 直接报错 `this Db is read-only`。
  `db.sql.execute` 在类型上不受限，只在运行时报错。
- 原来的 Db 不受影响；读写分离（`replicas`）照旧，`readonly()` 管的是"这段代码能不能写"。

## requestContext()

拦截器要拿当前请求的租户、用户。`requestContext<T>()` 给 AsyncLocalStorage 包一层，值的类型在声明处写一次：

```ts
import { requestContext } from '@zerodep-dev/easy-query-ts/context';

const request = requestContext<{ tenantId: number; userId: string }>();
const db = createDb({
  schema,
  adapter,
  interceptors: [tenant('tenantId', () => request.get().tenantId)],
});

app.use((req, res, next) => request.run({ tenantId: req.tenant, userId: req.user }, next));
```

- `get()` 不在 `run` 里时报错（忘了包中间件、后台任务没设上下文），`find()` 返回 `undefined`；`run` 可以嵌套，里层覆盖外层。
- 单独一个入口 `@zerodep-dev/easy-query-ts/context`：核心不依赖 `node:async_hooks`；Node、Bun、Deno、开了 `nodejs_compat` 的
  Workers 都有 AsyncLocalStorage。

测试见 `test/test/readonly.test.ts`。
