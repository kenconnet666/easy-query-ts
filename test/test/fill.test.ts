// 按键填充（对应 Java 版的 fillMany / fillOne）：不需要声明关系，查询可以来自另一个库
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { describe, it } from 'vitest';
import { col, createDb, defineSchema, entity } from '@zerodep-dev/easy-query-ts';
import { sqlite } from '@zerodep-dev/easy-query-ts-sqlite';
import { Company, Post, seed, User } from '../src/fixture.ts';
import { memoryDb } from '../src/sqlite-env.ts';

// 另一个库里的表：按用户名关联，不在主库的 schema 里
const Badge = entity('t_badge', {
  id: col.int().primaryKey().generated(),
  userName: col.string(),
  label: col.string(),
});

function badgeDb() {
  const database = new DatabaseSync(':memory:');
  database.exec(
    'CREATE TABLE t_badge (id INTEGER PRIMARY KEY AUTOINCREMENT, user_name TEXT NOT NULL, label TEXT NOT NULL)',
  );
  const statements: string[] = [];
  const db = createDb({
    schema: defineSchema({ Badge }),
    adapter: sqlite(database),
    log: (s) => statements.push(s.sql),
  });
  return { db, statements };
}

describe('sqlite: fillMany / fillOne', async () => {
  const env = await seed(await memoryDb());
  const { db } = env;

  it('按键拼成数组或一行，嵌套的 toList 照常；一批键只查一次', async () => {
    const posts = db
      .queryable(Post)
      .orderBy((p) => p.id)
      .select((p) => ({ title: p.title, comments: p.comments.toList((c) => c.body) }));
    const companies = db.queryable(Company).select((c) => ({ name: c.name }));
    env.statements.length = 0;
    const rows = await db
      .queryable(User)
      .orderBy((u) => u.id)
      .select((u) => ({
        name: u.name,
        posts: posts.fillMany((p) => p.userId, u.id),
        company: companies.fillOne((c) => c.id, u.companyId),
      }))
      .toList();
    assert.deepEqual(rows, [
      {
        name: 'alice',
        posts: [
          { title: 'orm tips', comments: ['nice', 'thanks'] },
          { title: 'sql 100%', comments: [] },
        ],
        company: { name: 'acme' },
      },
      {
        name: 'bob',
        posts: [
          { title: 'orm_v2', comments: [] },
          { title: 'hello', comments: [] },
        ],
        company: { name: 'acme' },
      },
      { name: 'carol', posts: [], company: null },
    ]);
    // 主查询、帖子、帖子的评论、公司：各一条
    assert.equal(env.statements.length, 4);
    assert.match(env.statements[3]!.sql, /"id" IN \(\?\)/);
  });

  it('查询来自另一个库；include 里也能用；不能带 limit', async () => {
    const other = badgeDb();
    await other.db
      .insert(Badge)
      .values([
        { userName: 'alice', label: 'gold' },
        { userName: 'alice', label: 'early' },
        { userName: 'bob', label: 'silver' },
      ])
      .execute();
    const badges = other.db
      .queryable(Badge)
      .orderBy((b) => b.label)
      .select((b) => b.label);
    const rows = await db
      .queryable(User)
      .where((u) => u.name.ne('carol'))
      .orderBy((u) => u.id)
      .include((u) => ({ badges: badges.fillMany((b) => b.userName, u.name) }))
      .toList();
    assert.deepEqual(
      rows.map((r) => [r.name, r.badges]),
      [
        ['alice', ['early', 'gold']],
        ['bob', ['silver']],
      ],
    );
    assert.equal(other.statements.length, 2);

    await assert.rejects(
      db
        .queryable(User)
        .select((u) => ({ badges: badges.limit(1).fillMany((b) => b.userName, u.name) }))
        .toList(),
      /cannot use limit/,
    );
  });
});
