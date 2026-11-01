/**
 * 二级缓存接 Redis 的示例：缓存包不带 Redis 驱动，使用方照这里实现 CacheStore 与 CacheTransport（ioredis；别的客户端照改）。
 * 只给测试与文档用，不发布；redis-cache.live.test.ts 用真的 Redis 跑过这两个实现。
 */
import type { CacheStore, CacheTransport } from '@zerodep-dev/easy-query-ts-cache';
import type { Redis } from 'ioredis';

/**
 * Redis 的存储：一个缓存键是一个 hash，字段是查询条件。过期时间设在整个键上（每次写入续到这一次的时长），
 * 字段各自过期要 Redis 7.4 的 HPEXPIRE，这里不依赖它：键被失效时整个删掉
 */
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

/**
 * Redis 发布订阅的传输。订阅中的连接不能再发别的命令，所以要两条连接：publisher 发、subscriber 收。
 * ioredis 断线后自己重连并重新订阅；重连好（ready）时报 reset，断开期间的消息 Redis 不保留
 */
export function redisTransport(options: {
  publisher: Redis;
  subscriber: Redis;
  channel?: string;
}): CacheTransport {
  const { publisher, subscriber, channel = 'cache-evict' } = options;
  return {
    async send(text) {
      await publisher.publish(channel, text);
    },
    async listen(onText, onReset) {
      const onMessage = (from: string, text: string) => {
        if (from === channel) onText(text);
      };
      let connected = true;
      const onClose = () => (connected = false);
      const onReady = () => {
        if (connected) return;
        connected = true;
        onReset();
      };
      subscriber.on('message', onMessage);
      subscriber.on('close', onClose);
      subscriber.on('ready', onReady);
      await subscriber.subscribe(channel);
      return async () => {
        subscriber.off('message', onMessage);
        subscriber.off('close', onClose);
        subscriber.off('ready', onReady);
        await subscriber.unsubscribe(channel);
      };
    },
  };
}
