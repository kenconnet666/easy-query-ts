// 分库：按分片键路由到库，跨库查询在内存里归并（对应官方 sharding-datasource）
import assert from 'node:assert/strict';
import { describe, it } from 'vitest';
import { byMod, createDb, shardDatabases, type Statement } from '@zerodep-dev/easy-query-ts';
import { SqliteDialect } from '@zerodep-dev/easy-query-ts-sqlite';
import { Post, schema, User } from '../src/fixture.ts';
import { memoryDb } from '../src/sqlite-env.ts';

async function setup() {
  const logs: Record<string, Statement[]> = { ds0: [], ds1: [] };
  const shards = Object.fromEntries(
    await Promise.all(
      (['ds0', 'ds1'] as const).map(async (name) => {
        const env = await memoryDb();
        return [
          name,
          createDb({ schema, adapter: env.adapter, log: (s) => logs[name]!.push(s) }),
        ] as const;
      }),
    ),
  );
  const sdb = shardDatabases({
    shards,
    routes: { Post: byMod('userId', 2, { table: (_, i) => `ds${i}` }) },
  });
  await sdb.insert(
    Post,
    [1, 2, 3, 4, 5, 6].map((n) => ({ userId: n, title: `p${n}`, amount: `${n + 0.5}` })),
  );
  for (const list of Object.values(logs)) list.length = 0;
  return { sdb, logs };
}

describe('sqlite: database sharding', () => {
  it('按分片键路由插入；等于条件只查一个库', async () => {
    const { sdb, logs } = await setup();
    assert.deepEqual(
      (
        await sdb
          .shard('ds0')
          .queryable(Post)
          .orderBy((p) => p.userId)
          .toList()
      ).map((p) => p.userId),
      [2, 4, 6],
    );
    logs.ds0!.length = 0;
    const rows = await sdb.query(Post, (q) => q.where((p) => p.userId.eq(3))).toList();
    assert.deepEqual(
      rows.map((p) => p.title),
      ['p3'],
    );
    assert.deepEqual([logs.ds0!.length, logs.ds1!.length], [0, 1]);
  });

  it('跨库排序分页、计数、求和（decimal 精确相加）、最值', async () => {
    const { sdb } = await setup();
    const page = await sdb
      .query(Post, (q) =>
        q.orderBy((p) => p.amount.desc()).select((p) => ({ title: p.title, amount: p.amount })),
      )
      .toPage(2, 2);
    assert.deepEqual([page.rows.map((p) => p.title), page.total], [['p4', 'p3'], 6]);
    assert.equal(await sdb.query(Post, (q) => q).count(), 6);
    assert.equal(Number(await sdb.query(Post, (q) => q).sum((p) => p.amount)), 24);
    assert.equal(await sdb.query(Post, (q) => q).max((p) => p.userId), 6);
    assert.equal(
      await sdb.query(Post, (q) => q.where((p) => p.userId.gt(3))).min((p) => p.userId),
      4,
    );
    await assert.rejects(() => sdb.query(Post, (q) => q.limit(2)).toList(), /use toPage/);
  });

  it('更新、删除在裁剪出的库上执行，行数合计', async () => {
    const { sdb, logs } = await setup();
    assert.equal(
      await sdb.update(Post, (u) => u.set({ title: 'x' }).where((p) => p.userId.in([1, 2]))),
      2,
    );
    assert.equal(await sdb.delete(Post, (d) => d.where((p) => p.userId.eq(5))), 1);
    assert.equal(logs.ds0!.filter((s) => /^DELETE/i.test(s.sql)).length, 0);
    assert.equal(await sdb.query(Post, (q) => q.where((p) => p.title.eq('x'))).count(), 2);
    assert.equal(await sdb.query(Post, (q) => q).count(), 5);
  });
});

describe('sqlite: merging across shards puts NULL where the database puts it', () => {
  const ages = [
    [1, null],
    [2, null],
    [3, 5],
    [4, 2],
    [5, 1],
  ] as const;

  /** 两个库按 id 取模；nullOrder 给出时，方言改成声明这个顺序（只验证归并的比较，不看库自己怎么排） */
  async function users(nullOrder?: 'largest' | 'last') {
    const shards = Object.fromEntries(
      await Promise.all(
        (['ds0', 'ds1'] as const).map(async (name) => {
          const { adapter } = await memoryDb();
          const dialect = nullOrder
            ? new (class extends SqliteDialect {
                override readonly nullOrder = nullOrder!;
              })()
            : adapter.dialect;
          return [name, createDb({ schema, adapter: { ...adapter, dialect } })] as const;
        }),
      ),
    );
    const sdb = shardDatabases({
      shards,
      routes: { User: byMod('id', 2, { table: (_, i) => `ds${i}` }) },
    });
    await sdb.insert(
      User,
      ages.map(([id, age]) => ({ id, name: `u${id}`, age, createdAt: new Date(0) })),
    );
    const sorted = (descending: boolean) =>
      sdb.query(User, (q) =>
        q.orderBy((u) => (descending ? u.age.desc() : u.age)).select((u) => ({ age: u.age })),
      );
    return async (descending: boolean) => (await sorted(descending).toList()).map((u) => u.age);
  }

  it('SQLite：NULL 当最小值，升序在前、降序在后；分页取到的就是库里那几行', async () => {
    const list = await users();
    assert.deepEqual(await list(false), [null, null, 1, 2, 5]);
    assert.deepEqual(await list(true), [5, 2, 1, null, null]);
  });

  it('声明 NULL 最大的方言：升序在后、降序在前；声明总在最后的：两个方向都在后', async () => {
    const largest = await users('largest');
    assert.deepEqual(await largest(false), [1, 2, 5, null, null]);
    assert.deepEqual(await largest(true), [null, null, 5, 2, 1]);
    const last = await users('last');
    assert.deepEqual(await last(false), [1, 2, 5, null, null]);
    assert.deepEqual(await last(true), [5, 2, 1, null, null]);
  });

  it('toPage 的页码、条数必须是正整数；first 取归并后的第一行', async () => {
    const { sdb } = await setup();
    const byAmount = sdb.query(Post, (q) =>
      q.orderBy((p) => p.amount.desc()).select((p) => ({ title: p.title, amount: p.amount })),
    );
    await assert.rejects(() => byAmount.toPage(0, 2), /page must be a positive integer/);
    assert.equal((await byAmount.first())?.title, 'p6');
  });
});
