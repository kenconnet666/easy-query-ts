/** 二级缓存：三种部署 */
import { _component } from '@zerodep-dev/vue-tsx-pro-tsx';
import { CodeBlock } from '@zerodep-dev/vue-tsx-pro-ui';
import { DocPage, Note, P, Points, Section, SimpleTable } from '../../site/content';

const basic = `import { createCache } from '@zerodep-dev/easy-query-ts-cache';

const cache = createCache({ entities: [User, Province] });
const db = createDb({ schema, adapter, interceptors: [cache.interceptor] });
const cached = cache.of(db);

await cached.kv(User).find(1); // 先查缓存，没有再查库并写回
await cached.kv(User).findMany([1, 2, 3]); // 没命中的用一条 IN 补上
await cached.all(Province).where((p) => p.name.startsWith('浙')).toPage(1, 20); // 整表缓存，内存分页`;

const store = `// 用 ioredis 实现存储：一个键下多个字段，按键删除
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
    evictLocal: () => Promise.resolve(),
  };
}

const cache = createCache({ entities: [User], store: redisStore(redis) });`;

const tiered = `// 失效通知只要两个方法；这里用 Kafka，每个实例一个消费组才是广播
const transport: CacheTransport = {
  send: (text) => producer.send({ topic: 'cache-evict', messages: [{ value: text }] }).then(() => {}),
  listen: async (onText, onReset) => {
    await consumer.subscribe({ topic: 'cache-evict' });
    await consumer.run({ eachMessage: async ({ message }) => onText(String(message.value)) });
    return () => consumer.disconnect();
  },
};

const cache = createCache({
  entities: [User],
  store: tieredStore({ local: memoryStore(), shared: redisStore(redis) }),
  transport,
  lateEvictMs: 1000,
});
await cache.ready();`;

export default _component(() => () => (
  <DocPage>
    <Section id="modes" title="kv 与 all">
      <P text="kv 模式按主键缓存单行，all 模式缓存整张小表。写入时由拦截器失效：表达式更新也知道该删哪些键，因为拦截器会先按同样的条件读出受影响的行。" />
      <CodeBlock code={basic} lang="ts" />
    </Section>
    <Section id="deployments" title="三种部署">
      <SimpleTable
        head={['部署', '配置', '要实现什么']}
        rows={[
          ['单实例，本机缓存', '`createCache({ entities })`', '不用，默认 `memoryStore()`'],
          ['多实例，只用外部 Redis', '再传 `store`', '`CacheStore`'],
          [
            '多实例，本机 + 外部 Redis',
            '`tieredStore` 加 `transport`',
            '`CacheStore`、`CacheTransport`',
          ],
        ]}
      />
      <Note text="本库不带 Redis 驱动和 MQ 通知，后两种按自己的客户端实现接口。下面的完整示例在仓库的 packages/test/src/redis-cache.ts，测试里接真的 Redis 跑过。" />
    </Section>
    <Section id="redis" title="多实例：只用 Redis">
      <CodeBlock code={store} lang="ts" />
    </Section>
    <Section id="tiered" title="多实例：本机 + Redis">
      <P text="有本机层时要让别的实例跟着失效，所以多一个失效通知。消息至少送达一次就够：收到后做的都是删除，重复无害。" />
      <CodeBlock code={tiered} lang="ts" />
    </Section>
    <Section id="consistency" title="一致性">
      <Points
        items={[
          '延迟双删：写入时删一次，事务提交后再删一次；回滚时第二次不删，第一次只是少命中一次。',
          '写回守卫：读库前记下代数，期间这个键被失效过就不写回，挡住“读到旧值后写回”。',
          '`lateEvictMs`：提交后隔一会儿再删一次，挡住从库延迟。',
          '通知丢了靠本机层的过期时间兜底；传输重连时调 `onReset`，本机层清空。',
          '绕过 ORM 改库不会触发失效：在 CDC 消费里调 `cache.evict`。余额、库存这类要强一致的数据不要放本机层。',
        ]}
      />
    </Section>
  </DocPage>
));
