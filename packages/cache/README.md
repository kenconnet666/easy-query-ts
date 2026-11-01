# @zerodep-dev/easy-query-ts-cache

二级缓存：kv 模式按主键缓存单行、all 模式缓存整张表；写入时由拦截器失效（表达式更新按改之前的行找到键），事务提交后再删一次。

```ts
const cache = createCache({ entities: [User, Province] });
const db = createDb({ schema, adapter, interceptors: [cache.interceptor] });
await cache.of(db).kv(User).find(1);
```

存储默认进程内，多实例部署实现 `CacheStore`（如 Redis 的 HGET / HSET / DEL）。详见仓库 `packages/easy-query/docs/features/ts-cache.md`。需要同时安装核心包。许可证：Apache-2.0。
