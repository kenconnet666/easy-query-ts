// 聚合改成分组 join（对应 Java 版的 subQueryToGroupJoin）
import assert from 'node:assert/strict';
import { describe, it } from 'vitest';
import { seed, User } from '../src/fixture.ts';
import { memoryDb } from '../src/sqlite-env.ts';

describe('sqlite: groupJoin', async () => {
  const { db } = await seed(await memoryDb());

  it('同一个导航上的几个聚合共用一个分组 join，结果与关联子查询一致', async () => {
    const grouped = db
      .queryable(User)
      .orderBy((u) => u.id)
      .select((u) => ({
        name: u.name,
        posts: u.posts.groupJoin().count(),
        orm: u.posts.groupJoin().count((p) => p.title.startsWith('orm')),
        total: u.posts.groupJoin().sum((p) => p.amount),
        top: u.posts.groupJoin().max((p) => p.amount),
      }));
    const correlated = db
      .queryable(User)
      .orderBy((u) => u.id)
      .select((u) => ({
        name: u.name,
        posts: u.posts.count(),
        orm: u.posts.count((p) => p.title.startsWith('orm')),
        total: u.posts.sum((p) => p.amount),
        top: u.posts.max((p) => p.amount),
      }));
    const { sql } = grouped.toSQL();
    assert.equal(sql.match(/LEFT JOIN \(SELECT/g)?.length, 1);
    assert.match(sql, /GROUP BY t\d+\."user_id"\) t\d+ ON t\d+\."g0" = t0\."id"/);
    assert.doesNotMatch(sql, /\(SELECT COUNT/);
    const rows = await grouped.toList();
    assert.deepEqual(rows, await correlated.toList());
    assert.deepEqual(rows.at(-1), { name: 'carol', posts: 0, orm: 0, total: null, top: null });
  });

  it('导航的 where 进分组的语句；where、orderBy 里也能用', async () => {
    const rows = await db
      .queryable(User)
      .where((u) => u.posts.groupJoin().count().ge(1))
      .orderBy((u) =>
        u.posts
          .where((p) => p.amount.gt('2'))
          .groupJoin()
          .count()
          .desc(),
      )
      .select((u) => ({
        name: u.name,
        big: u.posts
          .where((p) => p.amount.gt('2'))
          .groupJoin()
          .count(),
      }))
      .toList();
    assert.deepEqual(rows, [
      { name: 'alice', big: 2 },
      { name: 'bob', big: 1 },
    ]);
  });
});
