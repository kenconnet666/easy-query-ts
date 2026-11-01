/**
 * 接真的 Redis 跑多实例的两种部署：只用 Redis；本机 + Redis 再加失效通知。两个"实例"共用一个 SQLite 库，
 * 存储与传输是 src/redis-cache.ts 的示例实现。要 EQTS_REDIS_URL（.local/db.env），没设时跳过。
 */
import assert from 'node:assert/strict';
import { afterAll, describe, it } from 'vitest';
import { createDb, type Db } from '@zerodep-dev/easy-query-ts';
import {
  createCache,
  memoryStore,
  tieredStore,
  type CacheOptions,
} from '@zerodep-dev/easy-query-ts-cache';
import { Redis } from 'ioredis';
import { schema, seed, User } from '../src/fixture.ts';
import { redisStore, redisTransport } from '../src/redis-cache.ts';
import { memoryDb } from '../src/sqlite-env.ts';

const redisUrl = process.env['EQTS_REDIS_URL'];

/** 等条件成立，最多 timeout 毫秒 */
async function until(check: () => boolean | Promise<boolean>, timeout = 5000): Promise<void> {
  const started = Date.now();
  while (!(await check())) {
    if (Date.now() - started > timeout) throw new Error('timed out');
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

if (!redisUrl) {
  describe('cache on Redis (live)', () => {
    it('skipped: set EQTS_REDIS_URL to run', { skip: true }, () => {});
  });
} else {
  const clients: Redis[] = [];
  const redis = () => {
    const client = new Redis(redisUrl);
    clients.push(client);
    return client;
  };
  afterAll(() => {
    for (const client of clients) client.disconnect();
  });

  /** 同一个库上的两个实例；each 给出每个实例的缓存选项 */
  async function twoInstances(each: () => Pick<CacheOptions, 'store' | 'transport'>) {
    const env = await seed(await memoryDb());
    // 键带上时间：Redis 里没有上一次跑剩下的
    const keyPrefix = `T${Date.now()}${Math.random().toString(36).slice(2, 6)}`;
    const instance = async () => {
      const cache = createCache({ entities: [User], keyPrefix, ...each() });
      await cache.ready();
      const db: Db<typeof schema> = createDb({
        schema,
        adapter: env.adapter,
        interceptors: [cache.interceptor],
      });
      return { cache, db, users: cache.of(db).kv(User) };
    };
    return { a: await instance(), b: await instance(), key: `${keyPrefix}:t_user:1` };
  }

  describe('多实例：只用 Redis', () => {
    it('B 读到 A 缓存的行；A 改了之后 Redis 里的键没了，B 再读是新值', async () => {
      const shared = redis();
      const { a, b, key } = await twoInstances(() => ({ store: redisStore(shared) }));
      assert.equal((await a.users.find(1))!.name, 'alice');
      assert.equal(await shared.exists(key), 1);
      assert.equal((await b.users.find(1))!.name, 'alice');
      await a.db
        .update(User)
        .set({ name: 'alice2' })
        .where((u) => u.id.eq(1))
        .execute();
      assert.equal(await shared.exists(key), 0);
      assert.equal((await b.users.find(1))!.name, 'alice2');
    });
  });

  describe('多实例：本机 + Redis，再加失效通知', () => {
    it('A 改了一行：Redis 的键马上没了，B 的本机层收到通知后也没了', async () => {
      const shared = redis();
      const channel = `eqts-test-${Date.now()}`;
      const { a, b, key } = await twoInstances(() => ({
        store: tieredStore({
          local: memoryStore(),
          shared: redisStore(shared),
          // 本机层存得够久：B 能很快读到新值只可能是通知起了作用
          localTtlMs: 60_000,
        }),
        transport: redisTransport({ publisher: redis(), subscriber: redis(), channel }),
      }));
      assert.equal((await b.users.find(1))!.name, 'alice');
      await a.db
        .update(User)
        .set({ name: 'alice3' })
        .where((u) => u.id.eq(1))
        .execute();
      assert.equal(await shared.exists(key), 0);
      await until(async () => (await b.users.find(1))!.name === 'alice3');
      await Promise.all([a.cache.close(), b.cache.close()]);
    });

    it('订阅的连接断过又连上：报 reset，之后的消息照常收到', async () => {
      const channel = `eqts-test-reset-${Date.now()}`;
      const subscriber = redis();
      const transport = redisTransport({ publisher: redis(), subscriber, channel });
      const texts: string[] = [];
      let resets = 0;
      const stop = await transport.listen(
        (text) => texts.push(text),
        () => resets++,
      );
      await transport.send('before');
      await until(() => texts.includes('before'));
      // 带 reconnect：ioredis 按连接丢了处理，重连并重新订阅
      subscriber.disconnect(true);
      await until(() => resets === 1, 10_000);
      await transport.send('after');
      await until(() => texts.includes('after'));
      await stop();
    });
  });
}
