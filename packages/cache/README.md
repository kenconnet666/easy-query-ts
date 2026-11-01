# @zerodep-dev/easy-query-ts-cache

二级缓存：kv 模式按主键缓存单行、all 模式缓存整张表；写入时由拦截器失效（表达式更新按改之前的行找到键），事务提交后再删一次。

```ts
const cache = createCache({ entities: [User, Province] });
const db = createDb({ schema, adapter, interceptors: [cache.interceptor] });
await cache.of(db).kv(User).find(1);
```

三种部署：单实例用默认的本机缓存；多实例只用外部 Redis（实现 `CacheStore`）；多实例本机 + 外部 Redis（`tieredStore`，再实现失效通知 `CacheTransport`）。
本包不带 Redis 与 MQ 的驱动，接法与完整示例见仓库 [easy-query-ts](https://github.com/kenconnet666/easy-query-ts) 的 `docs/features/ts-cache.md`。需要同时安装核心包。许可证：Apache-2.0。
