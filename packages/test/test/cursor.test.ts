// 键集分页（toCursorPage）：生成的 SQL、游标的往返与各种拒绝；各库的行为在 suite.ts 里
import assert from 'node:assert/strict';
import { describe, it } from 'vitest';
import { InvalidCursorError } from '@zerodep-dev/easy-query-ts';
import { Member, Post, seed, User } from '../src/fixture.ts';
import { memoryDb } from '../src/sqlite-env.ts';

describe('sqlite: cursor pages', async () => {
  const env = await seed(await memoryDb());
  const { db } = env;
  /** 从这一刻起执行的 SQL */
  const record = () => {
    const from = env.statements.length;
    return () => env.statements.slice(from).map((s) => s.sql);
  };

  it('条件按排序键逐级展开，排序补上主键，不用 OFFSET', async () => {
    const seen = record();
    const query = db.queryable(Post).orderBy((p) => p.amount.desc());
    const first = await query.toCursorPage({ size: 2 });
    assert.deepEqual(
      first.rows.map((p) => p.amount),
      ['2000', '10.5'],
    );
    assert.ok(first.next);
    const second = await query.toCursorPage({ size: 2, after: first.next });
    assert.deepEqual(
      second.rows.map((p) => p.amount),
      ['3', '1.25'],
    );
    // 正好取完：没有下一页
    assert.equal(second.next, undefined);
    const [one, two] = seen();
    assert.match(one!, /ORDER BY t0\."amount" DESC, t0\."id" ASC LIMIT 3$/);
    assert.match(
      two!,
      /WHERE \(t0\."amount" < \? OR \(t0\."amount" = \? AND t0\."id" > \?\)\) ORDER BY/,
    );
    assert.doesNotMatch(two!, /OFFSET/);
  });

  it('复合主键的各列都补上；已经写进排序的主键不重复补', async () => {
    const seen = record();
    await db
      .queryable(Member)
      .orderBy((m) => m.name)
      .toCursorPage({ size: 1 });
    await db
      .queryable(User)
      .orderBy((u) => [u.id.desc(), u.name])
      .toCursorPage({ size: 1 });
    const [members, users] = seen();
    assert.match(members!, /ORDER BY t0\."name" ASC, t0\."tenant_id" ASC, t0\."id" ASC LIMIT/);
    assert.match(users!, /ORDER BY t0\."id" DESC, t0\."name" ASC LIMIT/);
  });

  it('游标带着时刻这样 JSON 表示不了的值也能往返', async () => {
    const byTime = db.queryable(User).orderBy((u) => u.createdAt);
    const first = await byTime.toCursorPage({ size: 1 });
    const rest = await byTime.toCursorPage({ size: 5, after: first.next });
    assert.deepEqual(
      [...first.rows, ...rest.rows].map((u) => u.name),
      ['alice', 'bob', 'carol'],
    );
  });

  it('不是它给出的游标、别的查询的游标：InvalidCursorError', async () => {
    const posts = db.queryable(Post).orderBy((p) => p.amount);
    await assert.rejects(
      posts.toCursorPage({ size: 2, after: 'not a cursor' }),
      InvalidCursorError,
    );
    await assert.rejects(
      posts.toCursorPage({ size: 2, after: btoa('{"a":1}') }),
      InvalidCursorError,
    );
    const other = await db.queryable(Post).toCursorPage({ size: 1 });
    await assert.rejects(
      posts.toCursorPage({ size: 2, after: other.next }),
      /belongs to a different query/,
    );
  });

  it('size 不是正整数、自己写了 limit、分组之后直接分页都拒绝', async () => {
    await assert.rejects(db.queryable(Post).toCursorPage({ size: 0 }), RangeError);
    await assert.rejects(db.queryable(Post).limit(3).toCursorPage({ size: 2 }), /sets the limit/);
    await assert.rejects(db.queryable(Post).distinct().toCursorPage({ size: 2 }), /asTable\(\)/);
    // 分组的结果包成派生表之后可以分页：它没有主键，排序要自己写到唯一
    const totals = db
      .queryable(Post)
      .groupBy((p) => ({ userId: p.userId }))
      .select((g) => ({ userId: g.key.userId, total: g.sum((p) => p.amount) }))
      .asTable()
      .orderBy((t) => t.userId.desc());
    const first = await totals.toCursorPage({ size: 1 });
    const second = await totals.toCursorPage({ size: 1, after: first.next });
    assert.deepEqual(
      [...first.rows, ...second.rows].map((t) => t.userId),
      [2, 1],
    );
    await assert.rejects(
      db
        .queryable(Post)
        .select((p) => ({ title: p.title }))
        .asTable()
        .toCursorPage({ size: 1 }),
      /needs an orderBy/,
    );
  });
});
