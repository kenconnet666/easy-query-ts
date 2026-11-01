// 读写分离：事务外的读按轮询走从库，写入、事务、usePrimary、introspect 走主库
import assert from 'node:assert/strict';
import { describe, it } from 'vitest';
import { createDb } from '@zerodep-dev/easy-query-ts';
import { schema, seed, User } from '../src/fixture.ts';
import { memoryDb } from '../src/sqlite-env.ts';

/** 三个各自独立的库：主库与两个从库，alice 的名字各不相同，看读落在哪个库 */
async function setup() {
  const [primary, replicaA, replicaB] = await Promise.all([1, 2, 3].map(() => memoryDb()));
  for (const [env, name] of [
    [primary!, 'primary'],
    [replicaA!, 'replica-a'],
    [replicaB!, 'replica-b'],
  ] as const) {
    await seed(env);
    await env.db
      .update(User)
      .set({ name })
      .where((u) => u.id.eq(1))
      .execute();
  }
  const db = createDb({
    schema,
    adapter: primary!.adapter,
    replicas: [replicaA!.adapter, replicaB!.adapter],
  });
  const alice = async (d = db) => (await d.queryable(User).findOrThrow(1)).name;
  return { db, alice, primary: primary!.db };
}

describe('sqlite: read replicas', () => {
  it('事务外的读按轮询分给从库', async () => {
    const { alice } = await setup();
    assert.deepEqual(
      [await alice(), await alice(), await alice()],
      ['replica-a', 'replica-b', 'replica-a'],
    );
  });

  it('写入、事务里的读、usePrimary 走主库', async () => {
    const { db, alice, primary } = await setup();
    await db
      .update(User)
      .set({ age: 99 })
      .where((u) => u.id.eq(1))
      .execute();
    assert.equal((await primary.queryable(User).findOrThrow(1)).age, 99);
    assert.equal(await db.transaction((tx) => alice(tx)), 'primary');
    assert.equal(await alice(db.usePrimary()), 'primary');
    // returnEntity 插入后按主键回查：也在主库
    const inserted = await db
      .insert(User)
      .values({ name: 'dave', createdAt: new Date(), attrs: { tags: [] } })
      .returnEntity();
    assert.equal(inserted.name, 'dave');
  });

  it('从库要是同一种库', async () => {
    const env = await memoryDb();
    assert.throws(
      () =>
        createDb({
          schema,
          adapter: env.adapter,
          replicas: [{ driver: env.adapter.driver, dialect: { name: 'mysql' } as never }],
        }),
      /same dialect/,
    );
  });
});
