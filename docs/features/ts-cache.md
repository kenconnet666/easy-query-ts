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

`CacheStore` 是"一个键下多个字段、按键删除"的接口（与官方的 hash 结构相同）。内置三种：

- `memoryStore()`：进程内，默认。
- `redisStore(redis)`：ioredis（或形状相同的客户端）的 HGET / HSET + PEXPIRE / DEL。过期时间设在整个键上，键被失效时整个删掉。
- `tieredStore({ local, shared, localTtlMs })`：先本机、再共享，共享命中时回填本机；本机层的过期时间更短（默认 30 秒），消息丢了时本机层最多旧这么久。

键是 `CACHE:表名:主键`（kv）与 `CACHE:表名:all`（all），字段是条件 SQL 与参数的指纹；值按列的编码序列化，日期、大整数、二进制、值对象都原样读回。

浏览器里跑 easy-query（PGlite、SQLite WASM）时，前端存储包 `@zerodep-dev/storage` 的 `cacheStore(driver)` 把 IndexedDB、localStorage、内存驱动变成 `CacheStore`。

## 多实例与最终一致

四层：浏览器（前端存储包）→ 每个实例的本机内存 → Redis → 数据库。失效经消息通道传到每个实例与它连着的浏览器：

```ts
const bus = createBus(pgTransport(pool)); // 或 redisTransport({ publisher, subscriber })，或自己的 MQ
const CacheOutbox = outboxTable(); // 可选：放进 schema
const cache = createCache({
  entities: [User, Province],
  store: tieredStore({ local: memoryStore(), shared: redisStore(redis) }),
  bus,
  lateEvictMs: 1000,
  outbox: { db, table: CacheOutbox },
});
await cache.ready();
const db = createDb({ schema, adapter, interceptors: [cache.interceptor, tableChanges(bus)] });
relayOutbox({ db, bus, table: CacheOutbox });

// kit：每个实例把通道上的表名推给连着自己的浏览器
const hub = createInvalidationHub();
await bus.subscribe(
  (message) => hub.publish(message.tables),
  () => hub.reset(),
);
```

一次写入之后：

1. 提交前删一次本机与 Redis，提交后再删一次（延迟双删），发消息；配了发件箱时消息还和写入在同一个事务里落一行。
2. 别的实例收到后只删本机层（Redis 写入的实例已经删过），再把表名推给自己的浏览器。
3. 浏览器按表名标签失效，正显示着的 `useRequest` 重新请求。

保证：经 ORM 的写入提交后，各层在"消息送达"与"过期时间"两者较早的那个时间内变新。具体的风险与应对：

| 风险                     | 应对                                                                                                                             |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------- |
| 消息重复                 | 收到后做的都是删除，重复无害                                                                                                     |
| 消息丢了、通道断过       | 每层的过期时间兜底；传输重连时报 reset，本机层清空、浏览器全部失效                                                               |
| 提交后、发消息前进程挂了 | 发件箱：消息和写入同一个事务，`relayOutbox` 保底发出（重复无害，每个实例跑一个也行）                                             |
| 读到旧值后写回           | 写回守卫：读库前记下代数，期间这个键被失效过（本机的或收到的）就不写回；`lateEvictMs` 再删一次，挡住从库延迟与收到消息之前的写回 |
| 绕过 ORM 改库            | CDC（Canal、Debezium）消费里调 `cache.evict`，或直接 `bus.publish`                                                               |

余额、库存这类要强一致的数据，不放本机层与浏览器缓存。

### 消息通道

`createBus(transport)` 每个实例一个，消息发给所有实例（包括自己），收的一方知道是不是自己发的；超出传输的字节上限（PG 的 NOTIFY 不到 8000）时切成几条。传输只要两个方法：

```ts
const bus = createBus({
  send: (text) =>
    producer.send({ topic: 'cache-evict', messages: [{ value: text }] }).then(() => {}),
  listen: async (onText, onReset) => {
    // Kafka 每个实例一个消费组才是广播；重平衡、重连时调 onReset
    await consumer.subscribe({ topic: 'cache-evict' });
    await consumer.run({ eachMessage: async ({ message }) => onText(String(message.value)) });
    return () => consumer.disconnect();
  },
});
```

内置：`memoryTransport()`（进程内、测试）、`redisTransport`（发布订阅，两条连接）、PG 包的 `pgTransport(pool)`（NOTIFY / LISTEN；监听连接断了按 1、2、4…最多 30 秒重连，重连后报 reset）。

### 失效通知

`onEvict({ keys, tables })` 在每次失效之后调用（本实例的提交后、`evict`、收到别的实例的消息）。`onEvict` 只管缓存了的实体；前端缓存依赖的表不一定在后端缓存里，`tableChanges(bus | onChange)` 是单独的拦截器，经本库的每次写入在提交之后报出表名（回滚不报）。

## 与官方的差异

- 官方用注解（`CacheKvEntity` / `CacheAllEntity`）标实体；这里在 `createCache({ entities })` 里列出，两种模式都能用。
- 官方的多级缓存（Redis + Caffeine）对应 `tieredStore`；本机层的同步走消息通道，官方要自己接。
- kv 只支持单列主键（与官方相同）。

SQLite 上测试（`cache.test.ts`）：命中、表达式更新与删除失效、只给缓存的实体多读、提交后再删、条件字段、findMany、all 分页与插入失效、过期、onEvict、tableChanges、以前端存储包的 cacheStore 为存储；多实例（`distributed-cache.test.ts`）：两个实例经进程内通道失效、写回守卫、reset、lateEvictMs、发件箱、消息切分、tieredStore。
实库（`pg/test/distributed.live.test.ts`，PG 17 + Redis 8.2）：两个实例分别经 PG NOTIFY 与 Redis 发布订阅失效，发件箱的一行在事务里，监听连接被断开后重连。
