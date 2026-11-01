// 多实例缓存（ROADMAP 23）：两个"实例"共用一个 SQLite 库与进程内的消息通道，各有自己的本机层
import assert from 'node:assert/strict';
import { describe, it } from 'vitest';
import { createDb, defineSchema } from '@zerodep-dev/easy-query-ts';
import {
  createBus,
  createCache,
  memoryStore,
  memoryTransport,
  outboxTable,
  relayOutbox,
  tableChanges,
  tieredStore,
  type BusTransport,
  type EvictMessage,
} from '@zerodep-dev/easy-query-ts-cache';
import { schema, seed, User } from '../src/fixture.ts';
import { memoryDb } from '../src/sqlite-env.ts';

const settle = () => new Promise((resolve) => setTimeout(resolve, 10));

/** 一个库、一条通道上的两个实例 */
async function twoInstances(options: { lateEvictMs?: number } = {}) {
  const env = await seed(await memoryDb());
  const transport = memoryTransport();
  const instance = () => {
    const local = memoryStore();
    const cache = createCache({
      entities: [User],
      store: local,
      bus: createBus(transport),
      ...options,
    });
    const db = createDb({ schema, adapter: env.adapter, interceptors: [cache.interceptor] });
    return { cache, db, local, users: cache.of(db).kv(User) };
  };
  const a = instance();
  const b = instance();
  await Promise.all([a.cache.ready(), b.cache.ready()]);
  return { a, b, transport, env };
}

describe('多实例：消息通道让别的实例的本机层失效', () => {
  it('A 改了一行，B 的本机缓存跟着失效，再读是新值', async () => {
    const { a, b } = await twoInstances();
    assert.equal((await b.users.find(1))!.name, 'alice');
    await a.db
      .update(User)
      .set({ name: 'alice2' })
      .where((u) => u.id.eq(1))
      .execute();
    await settle();
    assert.equal((await b.users.find(1))!.name, 'alice2');
    await Promise.all([a.cache.close(), b.cache.close()]);
  });

  it('onEvict 在两个实例上都收到（本实例的与收到的）', async () => {
    const env = await seed(await memoryDb());
    const transport = memoryTransport();
    const seen: string[] = [];
    const make = (name: string) => {
      const cache = createCache({
        entities: [User],
        bus: createBus(transport),
        onEvict: (message) => seen.push(`${name}:${message.tables.join()}`),
      });
      return {
        cache,
        db: createDb({ schema, adapter: env.adapter, interceptors: [cache.interceptor] }),
      };
    };
    const a = make('a');
    const b = make('b');
    await Promise.all([a.cache.ready(), b.cache.ready()]);
    await a.db
      .delete(User)
      .where((u) => u.id.eq(3))
      .execute();
    await settle();
    assert.deepEqual(seen.sort(), ['a:t_user', 'b:t_user']);
  });

  it('写回守卫：读库期间这个键被失效过（本机的或收到的），读到的不写回', async () => {
    const { a, b } = await twoInstances();
    const key = 'CACHE:t_user:1';
    const since = b.cache.since();
    await a.cache.evict(User, [1]);
    await settle();
    await b.cache.write(key, 'f', 'stale', since);
    assert.equal(await b.local.get(key, 'f'), undefined);
    // 失效之后才开始的读照常写回
    await b.cache.write(key, 'f', 'fresh', b.cache.since());
    assert.equal(await b.local.get(key, 'f'), 'fresh');
  });

  it('通道断过（reset）：清空本机层，之前开始的读不写回', async () => {
    const { b, transport } = await twoInstances();
    await b.users.find(1);
    const since = b.cache.since();
    transport.reset();
    await settle();
    assert.equal(await b.local.get('CACHE:t_user:1', 'any'), undefined);
    await b.cache.write('CACHE:t_user:2', 'f', 'x', since);
    assert.equal(await b.local.get('CACHE:t_user:2', 'f'), undefined);
  });

  it('lateEvictMs：提交后隔一会儿再删一次、再发一次', async () => {
    const { a, b, transport } = await twoInstances({ lateEvictMs: 20 });
    const received: EvictMessage[] = [];
    const stop = await createBus(transport).subscribe((message) => received.push(message));
    await a.db
      .update(User)
      .set({ name: 'x' })
      .where((u) => u.id.eq(2))
      .execute();
    await settle();
    // 这期间 B 把旧值写回了本机层（模拟慢请求）
    await b.local.set('CACHE:t_user:2', 'f', 'old', 60_000);
    await new Promise((resolve) => setTimeout(resolve, 40));
    assert.equal(received.length, 2);
    assert.equal(await b.local.get('CACHE:t_user:2', 'f'), undefined);
    await stop();
  });

  it('tableChanges(bus)：表的变更发给所有实例，收的一方知道是不是自己发的', async () => {
    const env = await seed(await memoryDb());
    const transport = memoryTransport();
    const busA = createBus(transport);
    const busB = createBus(transport);
    const seen: [readonly string[], boolean][] = [];
    await busA.subscribe((message, fromSelf) => seen.push([message.tables, fromSelf]));
    await busB.subscribe((message, fromSelf) => seen.push([message.tables, fromSelf]));
    const db = createDb({ schema, adapter: env.adapter, interceptors: [tableChanges(busA)] });
    await db
      .update(User)
      .set({ name: 'y' })
      .where((u) => u.id.eq(1))
      .execute();
    await settle();
    assert.deepEqual(seen, [
      [['t_user'], true],
      [['t_user'], false],
    ]);
  });
});

describe('发件箱', () => {
  async function withOutbox() {
    const env = await seed(await memoryDb());
    const CacheOutbox = outboxTable();
    const outboxDb = createDb({ schema: defineSchema({ CacheOutbox }), adapter: env.adapter });
    await outboxDb.createTables();
    const bus = createBus(memoryTransport());
    const outbox = { db: outboxDb, table: CacheOutbox };
    const cache = createCache({ entities: [User], bus, outbox });
    const db = createDb({
      schema,
      adapter: env.adapter,
      interceptors: [cache.interceptor, tableChanges(bus, { outbox })],
    });
    const rows = () =>
      outboxDb
        .queryable(CacheOutbox)
        .orderBy((o) => o.id)
        .toList();
    return { bus, outbox, db, rows };
  }

  it('失效消息和写入在同一个事务里落一行；回滚了就没有', async () => {
    const { db, rows } = await withOutbox();
    await assert.rejects(
      db.transaction(async (tx) => {
        await tx
          .update(User)
          .set({ name: 'x' })
          .where((u) => u.id.eq(1))
          .execute();
        throw new Error('rollback');
      }),
      /rollback/,
    );
    assert.equal((await rows()).length, 0);
    await db.transaction(async (tx) => {
      await tx
        .update(User)
        .set({ name: 'y' })
        .where((u) => u.id.eq(1))
        .execute();
    });
    assert.deepEqual(
      (await rows()).map((row) => row.message),
      [
        { keys: ['CACHE:t_user:all', 'CACHE:t_user:1'], tables: ['t_user'] },
        { keys: [], tables: ['t_user'] },
      ],
    );
  });

  it('relayOutbox 按顺序发进通道再删掉；删发件箱本身不生出新的消息', async () => {
    const { bus, outbox, db, rows } = await withOutbox();
    const received: EvictMessage[] = [];
    await bus.subscribe((message) => received.push(message));
    await db
      .update(User)
      .set({ name: 'z' })
      .where((u) => u.id.eq(2))
      .execute();
    await settle();
    // 提交后马上发的那两条
    assert.equal(received.length, 2);
    const relay = relayOutbox({ ...outbox, bus, intervalMs: 60_000, batch: 1 });
    await relay.drain();
    await settle();
    assert.equal(received.length, 4);
    assert.deepEqual(received.slice(2), received.slice(0, 2));
    assert.equal((await rows()).length, 0);
    await relay.stop();
  });
});

describe('createBus', () => {
  it('超出传输的字节上限时切成几条：键分到各段，表只跟第一段', async () => {
    const texts: string[] = [];
    const transport: BusTransport = {
      maxBytes: 120,
      send: (text) => {
        texts.push(text);
        return Promise.resolve();
      },
      listen: () => Promise.resolve(() => Promise.resolve()),
    };
    const keys = Array.from({ length: 10 }, (_, i) => `CACHE:t_user:${i}`);
    await createBus(transport).publish({ keys, tables: ['t_user'] });
    assert.ok(texts.length > 1);
    assert.ok(texts.every((text) => new TextEncoder().encode(text).length <= 120));
    const parsed = texts.map((text) => JSON.parse(text) as { k: string[]; t: string[] });
    assert.deepEqual(
      parsed.flatMap((m) => m.k),
      keys,
    );
    assert.deepEqual(
      parsed.flatMap((m) => m.t),
      ['t_user'],
    );
  });

  it('全部退订后停止收；收到解析不了的文字时跳过', async () => {
    let listening = 0;
    let deliver: (text: string) => void = () => {};
    const transport: BusTransport = {
      send: () => Promise.resolve(),
      listen: (onText) => {
        listening++;
        deliver = onText;
        return Promise.resolve(() => {
          listening--;
          return Promise.resolve();
        });
      },
    };
    const bus = createBus(transport);
    const seen: EvictMessage[] = [];
    const stop1 = await bus.subscribe((message) => seen.push(message));
    const stop2 = await bus.subscribe(() => {});
    assert.equal(listening, 1);
    deliver('not json');
    deliver(JSON.stringify({ o: 'x', k: ['k'], t: [] }));
    assert.deepEqual(seen, [{ keys: ['k'], tables: [] }]);
    await stop1();
    assert.equal(listening, 1);
    await stop2();
    assert.equal(listening, 0);
  });
});

describe('tieredStore', () => {
  it('先本机、再共享（命中时回填本机，过期时间取较短的）；evictLocal 只删本机层', async () => {
    let time = 0;
    const local = memoryStore(() => time);
    const shared = memoryStore(() => time);
    const store = tieredStore({ local, shared, localTtlMs: 100 });
    await shared.set('k', 'f', 'v', 10_000);
    assert.equal(await store.get('k', 'f'), 'v');
    assert.equal(await local.get('k', 'f'), 'v');
    time = 100;
    assert.equal(await local.get('k', 'f'), undefined);
    await store.set('k2', 'f', 'w', 50);
    await store.evictLocal!(['k2']);
    assert.equal(await local.get('k2', 'f'), undefined);
    assert.equal(await shared.get('k2', 'f'), 'w');
    await store.evictLocal!(undefined);
    await store.delete(['k', 'k2']);
    assert.equal(await shared.get('k', 'f'), undefined);
  });
});
