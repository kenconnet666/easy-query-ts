# TS：二级缓存（`@zerodep-dev/easy-query-ts-cache`）

对应官方的 easy-cache（cache/\*）：kv 模式按主键缓存单行，all 模式缓存整张表。

```ts
import { createCache } from '@zerodep-dev/easy-query-ts-cache';

const cache = createCache({ entities: [User, Province], store: redisStore, ttlMs: 300_000 });
const db = createDb({ schema, adapter, interceptors: [cache.interceptor] });
const cached = cache.of(db);

await cached.kv(User).find(1); // 先查缓存，没有再查库并写回
await cached.kv(User).findMany([1, 2, 3]); // 没命中的用一条 IN 补上
await cached
  .kv(User)
  .where((u) => u.enabled.eq(true))
  .find(1); // 条件是缓存字段的一部分
await cached
  .all(Province)
  .where((p) => p.name.startsWith('浙'))
  .toPage(1, 20); // 整表缓存，内存分页
```

## 一致性

- **失效走拦截器**：insert 按插入的主键；update / delete 按改之前的行——拦截器对缓存的实体声明 `before`（写成按实体判断的函数，只有缓存的实体多读一次），
  核心先按同样的条件读出受影响的行。所以 `update(User).set(…).where(…)` 这种表达式更新也知道该删哪些键；官方要自己实现 `CacheKeysProvider` 按更新时间回查。
- **延迟双删**：写入时删一次，`event.afterCommit` 在事务提交后再删一次（事务里别的请求可能把旧值读回缓存）。回滚时第二次不删，第一次删掉的只是少命中一次。
- 查不到的行也缓存（`nullTtlMs`，默认 10 秒）防穿透；写入时一并删掉。
- 绕过本库的写入（直接改库、别的服务）不会触发失效：靠过期时间兜底，或在 CDC 消费里调 `cache.evict(Entity, keys)`。
- 读的拦截器（租户、逻辑删除）照常生效，它们加的条件进了缓存字段：不同租户各缓存各的。

## 存储

`CacheStore` 是"一个键下多个字段、按键删除"的接口（与官方的 hash 结构相同），默认进程内的 `memoryStore()`；多实例部署换成共享存储，Redis（ioredis）大致是：

```ts
const redisStore: CacheStore = {
  get: async (key, field) => (await redis.hget(key, field)) ?? undefined,
  set: async (key, field, value, ttlMs) => {
    await redis.multi().hset(key, field, value).pexpire(key, ttlMs).exec();
  },
  delete: async (keys) => {
    if (keys.length > 0) await redis.del(...keys);
  },
};
```

键是 `CACHE:表名:主键`（kv）与 `CACHE:表名:all`（all），字段是条件 SQL 与参数的指纹；值按列的编码序列化，日期、大整数、二进制、值对象都原样读回。

浏览器里跑 easy-query（PGlite、SQLite WASM）时，前端存储包 `@zerodep-dev/storage` 的 `cacheStore(driver)` 把 IndexedDB、localStorage、内存驱动变成 `CacheStore`：

```ts
import { cacheStore, indexedDbDriver } from '@zerodep-dev/storage';
const cache = createCache({
  entities: [Province],
  store: cacheStore(indexedDbDriver({ store: 'orm-cache' })),
});
```

## 失效通知

`onEvict(keys)` 在失效之后收到删掉的键：写入时在事务提交后的那次删除之后（回滚不通知），`evict` 时在删除之后。多实例各用进程内缓存时，经 PG 的 NOTIFY 转给别的实例；也可以推给浏览器，让前端缓存跟着失效：

```ts
const cache = createCache({
  entities: [User],
  onEvict: (keys) => db.notify('cache_evict', JSON.stringify(keys)),
});
await listen(pool, 'cache_evict', (payload) => store.delete(JSON.parse(payload))); // 每个实例
```

## 与官方的差异

- 官方用注解（`CacheKvEntity` / `CacheAllEntity`）标实体；这里在 `createCache({ entities })` 里列出，两种模式都能用。
- 官方的多级缓存（Redis + Caffeine）可以写一个先查进程内、再查 Redis 的 `CacheStore` 组合实现。
- kv 只支持单列主键（与官方相同）。

SQLite 上测试（`cache.test.ts`）：命中、表达式更新与删除失效、只给缓存的实体多读、提交后再删、条件字段、findMany、all 分页与插入失效、过期、onEvict、以前端存储包的 cacheStore 为存储。
