// 二级缓存（对应官方 cache/*：kvStorage、allStorage、写入后失效）
import assert from 'node:assert/strict';
import { describe, it } from 'vitest';
import { createDb } from '@zerodep-dev/easy-query-ts';
import {
  createCache,
  memoryStore,
  tableChanges,
  type CacheOptions,
  type EvictMessage,
} from '@zerodep-dev/easy-query-ts-cache';
import { cacheStore, memoryDriver } from '@zerodep-dev/storage';
import { Company, Post, schema, seed, User } from '../src/fixture.ts';
import { memoryDb } from '../src/sqlite-env.ts';

async function setup(now?: () => number, options: Partial<CacheOptions> = {}) {
  const env = await seed(await memoryDb());
  const cache = createCache({
    entities: [User, Company],
    store: memoryStore(now),
    ttlMs: 1000,
    ...options,
  });
  const db = createDb({
    schema,
    adapter: env.adapter,
    interceptors: [cache.interceptor],
    log: (statement) => env.statements.push(statement),
  });
  const reads = () => env.statements.filter((s) => /^SELECT/i.test(s.sql)).length;
  env.statements.length = 0;
  return { db, cache, cached: cache.of(db), reads, statements: env.statements };
}

describe('cache: kv and all modes', () => {
  it('kv：第二次读走缓存，类型原样读回', async () => {
    const { cached, reads } = await setup();
    const first = await cached.kv(User).find(1);
    const second = await cached.kv(User).find(1);
    assert.equal(reads(), 1);
    assert.deepEqual(second, first);
    assert.ok(second!.createdAt instanceof Date);
    assert.deepEqual(second!.attrs, { tags: ['vip'] });
  });

  it('表达式更新、删除按改之前的行失效；查不到的也缓存', async () => {
    const { db, cached, reads } = await setup();
    await cached.kv(User).find(2);
    await db
      .update(User)
      .set({ name: 'bobby' })
      .where((u) => u.age.isNull())
      .execute();
    assert.equal((await cached.kv(User).find(2))!.name, 'bobby');
    await db
      .delete(Post)
      .where((p) => p.userId.eq(2))
      .execute();
    await db
      .delete(User)
      .where((u) => u.id.eq(2))
      .execute();
    assert.equal(await cached.kv(User).find(2), null);
    const before = reads();
    assert.equal(await cached.kv(User).find(2), null);
    assert.equal(reads(), before);
  });

  it('只给缓存的实体多读改之前的行', async () => {
    const { db, statements } = await setup();
    await db
      .update(Post)
      .set({ title: 'x' })
      .where((p) => p.id.eq(1))
      .execute();
    assert.equal(statements.length, 1);
    await db
      .update(User)
      .set({ age: 31 })
      .where((u) => u.id.eq(1))
      .execute();
    assert.equal(statements.length, 3);
  });

  it('事务提交后再删一次：事务里读回缓存的值不会留到提交之后', async () => {
    const { db, cached, reads } = await setup();
    await db.transaction(async (tx) => {
      await tx
        .update(User)
        .set({ name: 'alice2' })
        .where((u) => u.id.eq(1))
        .execute();
      // 事务里有人把值读回了缓存
      await cached.kv(User).find(1);
    });
    const before = reads();
    assert.equal((await cached.kv(User).find(1))!.name, 'alice2');
    assert.equal(reads(), before + 1);
  });

  it('where 条件是缓存字段的一部分；findMany 按给出的顺序、跳过没有的', async () => {
    const { cached } = await setup();
    assert.equal(
      await cached
        .kv(User)
        .where((u) => u.age.ge(18))
        .find(3),
      null,
    );
    assert.equal((await cached.kv(User).find(3))!.name, 'carol');
    const rows = await cached.kv(User).findMany([3, 99, 1]);
    assert.deepEqual(
      rows.map((u) => u.name),
      ['carol', 'alice'],
    );
  });

  it('all：整表缓存，内存分页；插入后失效', async () => {
    const { db, cached, reads } = await setup();
    const page = await cached.all(Company).toPage(1, 1);
    assert.deepEqual([page.rows.map((c) => c.name), page.total], [['acme'], 2]);
    await cached.all(Company).toList();
    assert.equal(reads(), 1);
    await db.insert(Company).values({ name: 'initech' }).execute();
    assert.deepEqual(
      (
        await cached
          .all(Company)
          .where((c) => c.name.ne('acme'))
          .toList()
      ).map((c) => c.name),
      ['globex', 'initech'],
    );
  });

  it('过期之后重新查；没登记的实体不能用', async () => {
    let clock = 0;
    const { cached, reads } = await setup(() => clock);
    await cached.kv(User).find(1);
    clock = 999;
    await cached.kv(User).find(1);
    assert.equal(reads(), 1);
    clock = 1000;
    await cached.kv(User).find(1);
    assert.equal(reads(), 2);
    assert.throws(() => cached.kv(Post), /list t_post in createCache/);
  });

  it('onEvict 收到删掉的键与改了的表：事务里的写入等提交之后，evict 在删除之后', async () => {
    const evicted: EvictMessage[] = [];
    const { db, cache } = await setup(undefined, { onEvict: (event) => evicted.push(event) });
    await db.transaction(async (tx) => {
      await tx
        .update(User)
        .set({ name: 'alice2' })
        .where((u) => u.id.eq(1))
        .execute();
      assert.equal(evicted.length, 0);
    });
    assert.deepEqual(evicted, [
      { keys: ['CACHE:t_user:all', 'CACHE:t_user:1'], tables: ['t_user'] },
    ]);
    await cache.evict(Company, [3]);
    assert.deepEqual(evicted[1], {
      keys: ['CACHE:t_company:all', 'CACHE:t_company:3'],
      tables: ['t_company'],
    });
  });

  it('前端存储包的 cacheStore 当存储：驱动换成 IndexedDB 等用法不变', async () => {
    const { cached, db, reads } = await setup(undefined, { store: cacheStore(memoryDriver()) });
    await cached.kv(User).find(1);
    assert.equal((await cached.kv(User).find(1))!.name, 'alice');
    assert.equal(reads(), 1);
    await db
      .update(User)
      .set({ name: 'alice3' })
      .where((u) => u.id.eq(1))
      .execute();
    assert.equal((await cached.kv(User).find(1))!.name, 'alice3');
    assert.equal(reads(), 3);
  });

  it('tableChanges：每次写入在提交之后报出表名，回滚的不报，不限于缓存的实体', async () => {
    const env = await seed(await memoryDb());
    const changed: (readonly string[])[] = [];
    const db = createDb({
      schema,
      adapter: env.adapter,
      interceptors: [tableChanges((tables) => changed.push(tables))],
    });
    await db
      .update(Post)
      .set({ title: 'x' })
      .where((p) => p.id.eq(1))
      .execute();
    await assert.rejects(
      db.transaction(async (tx) => {
        await tx
          .delete(User)
          .where((u) => u.id.eq(2))
          .execute();
        throw new Error('rollback');
      }),
      /rollback/,
    );
    await db.transaction(async (tx) => {
      await tx
        .update(User)
        .set({ name: 'z' })
        .where((u) => u.id.eq(1))
        .execute();
      assert.equal(changed.length, 1);
    });
    assert.deepEqual(changed, [['t_post'], ['t_user']]);
  });
});
