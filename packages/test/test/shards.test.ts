// 分库：按分片键路由到库，跨库查询在内存里归并（对应官方 sharding-datasource）
import assert from 'node:assert/strict';
import { describe, it } from 'vitest';
import { byMod, createDb, shardDatabases, type Statement } from '@zerodep-dev/easy-query-ts';
import { Post, schema } from '../src/fixture.ts';
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
