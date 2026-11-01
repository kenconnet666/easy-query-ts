// 二级缓存的三种部署：单实例本机缓存；多实例只用外部 Redis；多实例本机 + 外部 Redis。
// 这里用进程内的存储与传输代替 Redis，两个"实例"共用一个 SQLite 库；接真的 Redis 见 redis-cache.live.test.ts
import assert from 'node:assert/strict';
import { describe, it } from 'vitest';
import { createDb } from '@zerodep-dev/easy-query-ts';
import {
  createCache,
  memoryStore,
  memoryTransport,
  tieredStore,
  type CacheOptions,
  type CacheTransport,
} from '@zerodep-dev/easy-query-ts-cache';
import { schema, seed, User } from '../src/fixture.ts';
import { memoryDb } from '../src/sqlite-env.ts';

const settle = () => new Promise((resolve) => setTimeout(resolve, 10));

/** 一个库上的两个实例；each 给出每个实例的缓存选项 */
async function twoInstances(each: () => Partial<CacheOptions>) {
  const env = await seed(await memoryDb());
  const instance = () => {
    const cache = createCache({ entities: [User], ...each() });
    const db = createDb({ schema, adapter: env.adapter, interceptors: [cache.interceptor] });
    return { cache, db, users: cache.of(db).kv(User) };
  };
  const a = instance();
  const b = instance();
  await Promise.all([a.cache.ready(), b.cache.ready()]);
  return { a, b };
}

describe('多实例：只用外部 Redis', () => {
  it('共用一个存储：B 读得到 A 缓存的；A 改了之后两边都读到新值，不用失效通知', async () => {
    const redis = memoryStore();
    let writes = 0;
    const set = redis.set.bind(redis);
    redis.set = (...args) => {
      writes++;
      return set(...args);
    };
    const { a, b } = await twoInstances(() => ({ store: redis }));
    assert.equal((await a.users.find(1))!.name, 'alice');
    assert.equal((await b.users.find(1))!.name, 'alice');
    assert.equal(writes, 1, 'B 命中了 A 写的缓存，没有再查库写回');
    await a.db
      .update(User)
      .set({ name: 'alice2' })
      .where((u) => u.id.eq(1))
      .execute();
    assert.equal((await b.users.find(1))!.name, 'alice2');
  });
});

describe('多实例：本机 + 外部 Redis，再加失效通知', () => {
  /** 两个实例：各有本机层，共用一个"Redis"与一条通知通道 */
  async function setup(options: Partial<CacheOptions> = {}) {
    const redis = memoryStore();
    const transport = memoryTransport();
    const locals: ReturnType<typeof memoryStore>[] = [];
    const instances = await twoInstances(() => {
      const local = memoryStore();
      locals.push(local);
      return {
        store: tieredStore({ local, shared: redis, localTtlMs: 60_000 }),
        transport,
        ...options,
      };
    });
    return { ...instances, redis, transport, localA: locals[0]!, localB: locals[1]! };
  }

  it('A 改了一行，B 的本机层收到通知后失效，再读是新值', async () => {
    const { a, b } = await setup();
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

  it('没配失效通知：B 的本机层要等过期才变新（所以这种部署要配 transport）', async () => {
    const redis = memoryStore();
    let clock = 0;
    const now = () => clock;
    const { a, b } = await twoInstances(() => ({
      store: tieredStore({ local: memoryStore({ now }), shared: redis, localTtlMs: 1000 }),
    }));
    await b.users.find(1);
    await a.db
      .update(User)
      .set({ name: 'alice2' })
      .where((u) => u.id.eq(1))
      .execute();
    await settle();
    assert.equal((await b.users.find(1))!.name, 'alice');
    clock = 1000;
    assert.equal((await b.users.find(1))!.name, 'alice2');
  });

  it('写回守卫：读库期间这个键被失效过（本机的或收到的），读到的不写回', async () => {
    const { a, b, localB } = await setup();
    const key = 'CACHE:t_user:1';
    const since = b.cache.since();
    await a.cache.evict(User, [1]);
    await settle();
    await b.cache.write(key, 'f', 'stale', since);
    assert.equal(await localB.get(key, 'f'), undefined);
    // 失效之后才开始的读照常写回
    await b.cache.write(key, 'f', 'fresh', b.cache.since());
    assert.equal(await localB.get(key, 'f'), 'fresh');
  });

  it('通知断过（reset）：清空本机层，之前开始的读不写回', async () => {
    const { b, transport, localB } = await setup();
    await localB.set('CACHE:t_user:1', 'f', 'x', 60_000);
    const since = b.cache.since();
    transport.reset();
    await settle();
    assert.equal(await localB.get('CACHE:t_user:1', 'f'), undefined);
    await b.cache.write('CACHE:t_user:2', 'f', 'x', since);
    assert.equal(await localB.get('CACHE:t_user:2', 'f'), undefined);
  });

  it('lateEvictMs：提交后隔一会儿再删一次、再发一次', async () => {
    const { a, transport, localB } = await setup({ lateEvictMs: 20 });
    const texts: string[] = [];
    const stop = await transport.listen(
      (text) => texts.push(text),
      () => {},
    );
    await a.db
      .update(User)
      .set({ name: 'x' })
      .where((u) => u.id.eq(2))
      .execute();
    await settle();
    // 这期间 B 把旧值写回了本机层（模拟慢请求）
    await localB.set('CACHE:t_user:2', 'f', 'old', 60_000);
    await new Promise((resolve) => setTimeout(resolve, 40));
    assert.equal(texts.length, 2);
    assert.equal(await localB.get('CACHE:t_user:2', 'f'), undefined);
    await stop();
  });
});

describe('CacheTransport', () => {
  /** 记下发出的文字；deliver 模拟收到一条 */
  function recording(maxBytes?: number) {
    const texts: string[] = [];
    let deliver: (text: string) => void = () => {};
    let listening = 0;
    const transport: CacheTransport = {
      ...(maxBytes === undefined ? {} : { maxBytes }),
      send: (text) => {
        texts.push(text);
        return Promise.resolve();
      },
      listen: (onText) => {
        listening++;
        deliver = onText;
        return Promise.resolve(() => {
          listening--;
          return Promise.resolve();
        });
      },
    };
    return {
      transport,
      texts,
      deliver: (text: string) => deliver(text),
      listening: () => listening,
    };
  }

  it('超出传输的字节上限时切成几条，键都在', async () => {
    const { transport, texts } = recording(120);
    const cache = createCache({ entities: [User], transport });
    await cache.evict(
      User,
      Array.from({ length: 10 }, (_, i) => i),
    );
    assert.ok(texts.length > 1);
    assert.ok(texts.every((text) => new TextEncoder().encode(text).length <= 120));
    const keys = texts.flatMap((text) => (JSON.parse(text) as { k: string[] }).k);
    assert.equal(keys.length, 11);
    assert.equal(keys[0], 'CACHE:t_user:all');
    await cache.close();
  });

  it('收到解析不了的文字、自己发的消息时跳过；别的实例的消息删本机层；close 后停止收', async () => {
    const { transport, deliver, listening } = recording();
    const store = memoryStore();
    const cache = createCache({ entities: [User], store, transport });
    await cache.ready();
    assert.equal(listening(), 1);
    await store.set('k', 'f', 'v', 60_000);
    deliver('not json');
    assert.equal(await store.get('k', 'f'), 'v');
    deliver(JSON.stringify({ o: 'another-instance', k: ['k'] }));
    await settle();
    assert.equal(await store.get('k', 'f'), undefined);
    await cache.close();
    assert.equal(listening(), 0);
  });
});

describe('存储', () => {
  it('memoryStore：键数超过上限时删最久没用过的', async () => {
    const store = memoryStore({ maxKeys: 2 });
    await store.set('a', 'f', '1', 60_000);
    await store.set('b', 'f', '2', 60_000);
    // 读过的 a 不是最久没用的
    assert.equal(await store.get('a', 'f'), '1');
    await store.set('c', 'f', '3', 60_000);
    assert.equal(await store.get('b', 'f'), undefined);
    assert.equal(await store.get('a', 'f'), '1');
    assert.equal(await store.get('c', 'f'), '3');
  });

  it('tieredStore：先本机、再共享（命中时回填本机，过期时间取较短的）；evictLocal 只删本机层', async () => {
    let time = 0;
    const now = () => time;
    const local = memoryStore({ now });
    const shared = memoryStore({ now });
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
