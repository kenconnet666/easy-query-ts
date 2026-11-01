# TS：二级缓存（`@zerodep-dev/easy-query-ts-cache`）

对应官方的 easy-cache（cache/\*）：kv 模式按主键缓存单行，all 模式缓存整张表。

```ts
import { createCache } from '@zerodep-dev/easy-query-ts-cache';

const cache = createCache({ entities: [User, Province], ttlMs: 300_000 });
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

## 三种部署

| 部署                      | 配置                                                                          | 要实现什么                     |
| ------------------------- | ----------------------------------------------------------------------------- | ------------------------------ |
| 单实例，本机缓存          | `createCache({ entities })`                                                   | 不用，默认 `memoryStore()`     |
| 多实例，只用外部 Redis    | `createCache({ entities, store: redis })`                                     | `CacheStore`                   |
| 多实例，本机 + 外部 Redis | `createCache({ entities, store: tieredStore({ local, shared }), transport })` | `CacheStore`、`CacheTransport` |

本库不带 Redis 驱动和 MQ 通知，后两种由使用方按自己的客户端实现接口。完整的 ioredis 示例在 [packages/test/src/redis-cache.ts](../../packages/test/src/redis-cache.ts)，
[redis-cache.live.test.ts](../../packages/test/test/redis-cache.live.test.ts) 接真的 Redis 跑过这两种部署。

### 存储：`CacheStore`

一个键下多个字段（字段是查询条件）、按键删除，与官方的 hash 结构相同：

```ts
export function redisStore(redis: Redis): CacheStore {
  return {
    async get(key, field) {
      return (await redis.hget(key, field)) ?? undefined;
    },
    async set(key, field, value, ttlMs) {
      await redis.multi().hset(key, field, value).pexpire(key, ttlMs).exec();
    },
    async delete(keys) {
      if (keys.length > 0) await redis.del(...keys);
    },
    // 共享的一层：写入的实例已经删过，别的实例收到通知时什么也不用做
    evictLocal: () => Promise.resolve(),
  };
}
```

键是 `CACHE:表名:主键`（kv）与 `CACHE:表名:all`（all），字段是条件 SQL 与参数的指纹；值按列的编码序列化，日期、大整数、二进制、值对象都原样读回。

内置两个：

- `memoryStore({ maxKeys })`：进程内，默认。键数有上限（默认 10000），超出时删最久没用过的。
- `tieredStore({ local, shared, localTtlMs })`：先本机、再共享，共享命中时回填本机；本机层的过期时间更短（默认 30 秒），通知丢了时本机层最多旧这么久。

### 失效通知：`CacheTransport`

有本机层的多实例部署要让别的实例跟着失效。传输只要两个方法，消息至少送达一次就够（收到后做的都是删除，重复无害）：

```ts
const transport: CacheTransport = {
  send: (text) =>
    producer.send({ topic: 'cache-evict', messages: [{ value: text }] }).then(() => {}),
  listen: async (onText, onReset) => {
    // Kafka 每个实例一个消费组才是广播；重平衡、重连时调 onReset
    await consumer.subscribe({ topic: 'cache-evict' });
    await consumer.run({ eachMessage: async ({ message }) => onText(String(message.value)) });
    return () => consumer.disconnect();
  },
  maxBytes: 1_000_000, // 可选：超出时切成几条
};

const cache = createCache({
  entities: [User, Province],
  store: tieredStore({ local: memoryStore(), shared: redisStore(redis) }),
  transport,
  lateEvictMs: 1000,
});
await cache.ready(); // 启动阶段等订阅好，订阅失败在这里报出
```

消息发给所有实例（包括自己），缓存按来源标记跳过自己发的。`memoryTransport()` 是进程内的实现，测试里模拟几个实例。

## 一致性

- **失效走拦截器**：insert 按插入的主键；update / delete 按改之前的行——拦截器对缓存的实体声明 `before`（写成按实体判断的函数，只有缓存的实体多读一次），
  核心先按同样的条件读出受影响的行。所以 `update(User).set(…).where(…)` 这种表达式更新也知道该删哪些键；官方要自己实现 `CacheKeysProvider` 按更新时间回查。
- **延迟双删**：写入时删一次，`event.afterCommit` 在事务提交后再删一次（事务里别的请求可能把旧值读回缓存）。回滚时第二次不删，第一次删掉的只是少命中一次。
- 查不到的行也缓存（`nullTtlMs`，默认 10 秒）防穿透；写入时一并删掉。
- 绕过本库的写入（直接改库、别的服务）不会触发失效：靠过期时间兜底，或在 CDC 消费里调 `cache.evict(Entity, keys)`。
- 读的拦截器（租户、逻辑删除）照常生效，它们加的条件进了缓存字段：不同租户各缓存各的。

两级存储时，一次写入之后：提交前删一次本机与 Redis，提交后再删一次并发通知；别的实例收到后只删本机层（Redis 写入的实例已经删过）。
保证：经 ORM 的写入提交后，各层在“通知送达”与“过期时间”两者较早的那个时间内变新。

| 风险               | 应对                                                                                                                             |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------- |
| 通知重复           | 收到后做的都是删除，重复无害                                                                                                     |
| 通知丢了、通道断过 | 本机层的过期时间兜底；传输重连时调 `onReset`，本机层清空                                                                         |
| 读到旧值后写回     | 写回守卫：读库前记下代数，期间这个键被失效过（本机的或收到的）就不写回；`lateEvictMs` 再删一次，挡住从库延迟与收到通知之前的写回 |
| 绕过 ORM 改库      | CDC（Canal、Debezium）消费里调 `cache.evict`                                                                                     |

余额、库存这类要强一致的数据，不放本机层。

## 与官方的差异

- 官方用注解（`CacheKvEntity` / `CacheAllEntity`）标实体；这里在 `createCache({ entities })` 里列出，两种模式都能用。
- 官方的多级缓存（Redis + Caffeine）对应 `tieredStore`；本机层的同步走 `CacheTransport`，官方要自己接。
- kv 只支持单列主键（与官方相同）。

测试：`cache.test.ts`（命中、表达式更新与删除失效、只给缓存的实体多读、提交后再删、条件字段、findMany、all 分页与插入失效、过期）；
`cache-deployments.test.ts`（三种部署、写回守卫、reset、lateEvictMs、消息切分、存储）；`redis-cache.live.test.ts`（真的 Redis，要 `EQTS_REDIS_URL`）。
