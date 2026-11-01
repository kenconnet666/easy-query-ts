/**
 * 多实例缓存的实测（ROADMAP 23.6）：两个实例共用 PG 与 Redis，各有本机层（tieredStore），失效消息分别走 PG 的 NOTIFY 与 Redis 的发布订阅。
 * 要 EQTS_PG_URLS 与 EQTS_REDIS_URL（.local/db.env），没设时跳过。
 */
import assert from 'node:assert/strict';
import { afterAll, describe, it } from 'vitest';
import pg from 'pg';
import { Redis } from 'ioredis';
import { col, createDb, defineSchema, entity } from '@zerodep-dev/easy-query-ts';
import {
  createBus,
  createCache,
  memoryStore,
  outboxTable,
  redisStore,
  redisTransport,
  tieredStore,
  type BusTransport,
} from '@zerodep-dev/easy-query-ts-cache';
import { pgTransport, postgres } from '../src/index.ts';

const pgUrl = (process.env['EQTS_PG_URLS'] ?? '').split(',')[0]?.trim();
const redisUrl = process.env['EQTS_REDIS_URL'];

/** 等条件成立，最多 timeout 毫秒 */
async function until(check: () => boolean | Promise<boolean>, timeout = 5000): Promise<void> {
  const started = Date.now();
  while (!(await check())) {
    if (Date.now() - started > timeout) throw new Error('timed out');
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

const Item = entity('t_dc_item', {
  id: col.int().primaryKey(),
  name: col.string(),
});
const schema = defineSchema({ Item });

if (!pgUrl || !redisUrl) {
  describe('distributed cache (live)', () => {
    it('skipped: set EQTS_PG_URLS and EQTS_REDIS_URL to run', { skip: true }, () => {});
  });
} else {
  const pool = new pg.Pool({ connectionString: pgUrl, max: 8, options: '-c search_path=eqts' });
  const redises: Redis[] = [];
  const redis = () => {
    const client = new Redis(redisUrl, { lazyConnect: false });
    redises.push(client);
    return client;
  };
  const admin = createDb({ schema, adapter: postgres(pool) });

  afterAll(async () => {
    await pool.end();
    for (const client of redises) client.disconnect();
  });

  /** 一个实例：本机内存 + 共享的 Redis，失效走给的传输 */
  async function instance(transport: BusTransport, prefix: string) {
    const local = memoryStore();
    const cache = createCache({
      entities: [Item],
      store: tieredStore({ local, shared: redisStore(redis()), localTtlMs: 60_000 }),
      bus: createBus(transport),
      keyPrefix: prefix,
    });
    await cache.ready();
    const db = createDb({ schema, adapter: postgres(pool), interceptors: [cache.interceptor] });
    return { cache, db, local, items: cache.of(db).kv(Item) };
  }

  async function reset() {
    await pool.query('CREATE SCHEMA IF NOT EXISTS eqts');
    await pool.query('DROP TABLE IF EXISTS eqts.t_dc_item');
    await admin.createTables();
    await admin
      .insert(Item)
      .values([{ id: 1, name: 'one' }])
      .execute();
  }

  const transports: [string, () => BusTransport][] = [
    ['PG NOTIFY', () => pgTransport(pool, 'eqts_dc_test')],
    [
      'Redis pub/sub',
      () => redisTransport({ publisher: redis(), subscriber: redis(), channel: 'eqts:dc-test' }),
    ],
  ];

  describe.each(transports)('distributed cache over %s (live)', (name, transport) => {
    it('A 改了一行：Redis 与 B 的本机层都失效，B 再读是新值', async () => {
      await reset();
      const prefix = `DC${name.length}${Date.now()}`;
      const a = await instance(transport(), prefix);
      const b = await instance(transport(), prefix);
      const shared = redis();
      assert.equal((await b.items.find(1))!.name, 'one');
      assert.equal(await shared.exists(`${prefix}:t_dc_item:1`), 1);
      await a.db
        .update(Item)
        .set({ name: 'uno' })
        .where((i) => i.id.eq(1))
        .execute();
      // Redis 由 A 提交后删；B 的本机层（60 秒）由消息清掉，所以很快就读到新值
      assert.equal(await shared.exists(`${prefix}:t_dc_item:1`), 0);
      await until(async () => (await b.items.find(1))!.name === 'uno');
      await Promise.all([a.cache.close(), b.cache.close()]);
    });
  });

  describe('outbox (live)', () => {
    it('发件箱的一行在写入的事务里：提交前别的连接看不到，回滚了没有', async () => {
      await reset();
      const CacheOutbox = outboxTable('t_dc_outbox');
      const outboxDb = createDb({ schema: defineSchema({ CacheOutbox }), adapter: postgres(pool) });
      await pool.query('DROP TABLE IF EXISTS eqts.t_dc_outbox');
      await outboxDb.createTables();
      const cache = createCache({ entities: [Item], outbox: { db: outboxDb, table: CacheOutbox } });
      const db = createDb({ schema, adapter: postgres(pool), interceptors: [cache.interceptor] });
      const count = async () =>
        Number((await pool.query('SELECT count(*) AS n FROM eqts.t_dc_outbox')).rows[0].n);
      await assert.rejects(
        db.transaction(async (tx) => {
          await tx
            .update(Item)
            .set({ name: 'x' })
            .where((i) => i.id.eq(1))
            .execute();
          assert.equal(await count(), 0, '还没提交，别的连接看不到');
          throw new Error('rollback');
        }),
        /rollback/,
      );
      assert.equal(await count(), 0);
      await db.transaction((tx) =>
        tx
          .update(Item)
          .set({ name: 'y' })
          .where((i) => i.id.eq(1))
          .execute(),
      );
      assert.equal(await count(), 1);
    });
  });

  describe('pgTransport (live)', () => {
    it('监听连接被断开后自己重连、报 reset，之后的消息照常收到', async () => {
      const channel = `eqts_dc_reconnect_${Date.now()}`;
      const transport = pgTransport(pool, channel);
      const texts: string[] = [];
      let resets = 0;
      const stop = await transport.listen(
        (text) => texts.push(text),
        () => resets++,
      );
      await transport.send('before');
      await until(() => texts.includes('before'));
      await pool.query(`SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE query = $1`, [
        `LISTEN "${channel}"`,
      ]);
      await until(() => resets === 1, 10_000);
      await transport.send('after');
      await until(() => texts.includes('after'));
      await stop();
    });
  });
}
