// 不在 schema 里的实体（动态表、外部表，对应 mapQueryable 与动态表名）、表片段 tableHint（asTableSegment）、跨库链接（asTableLink）
import assert from 'node:assert/strict';
import { describe, it } from 'vitest';
import { col, entity } from '@zerodep-dev/easy-query-ts';
import { Post, seed, User } from '../src/fixture.ts';
import { memoryDb } from '../src/sqlite-env.ts';

/** 按月分的日志表：schema 里没有它，用到时临时定义 */
const logOf = (month: string) =>
  entity(`t_log_${month}`, {
    id: col.int().primaryKey().generated(),
    msg: col.string(),
  });

describe('sqlite: ad-hoc entities, table hints, table links', () => {
  it('不在 schema 里的实体也能查、能写，类型由列推出', async () => {
    const { db } = await seed(await memoryDb());
    const Log = logOf('202610');
    await db.sql
      .execute`CREATE TABLE t_log_202610 (id INTEGER PRIMARY KEY AUTOINCREMENT, msg TEXT NOT NULL)`;
    await db
      .insert(Log)
      .values([{ msg: 'a' }, { msg: 'b' }])
      .execute();
    await db
      .update(Log)
      .set({ msg: 'c' })
      .where((l) => l.id.eq(2))
      .execute();
    const rows = await db
      .queryable(Log)
      .orderBy((l) => l.id)
      .select((l) => l.msg)
      .toList();
    assert.deepEqual(rows, ['a', 'c']);
    assert.equal(
      await db
        .delete(Log)
        .where((l) => l.id.eq(1))
        .execute(),
      1,
    );
  });

  it('tableHint 跟在最近加入的表的别名后面', async () => {
    const { db } = await memoryDb();
    const { sql } = db
      .queryable(User)
      .tableHint('INDEXED BY idx_user_name')
      .innerJoin(Post, (u, p) => p.userId.eq(u.id))
      .tableHint('NOT INDEXED')
      .select((u, p) => ({ name: u.name, title: p.title }))
      .toSQL();
    assert.match(
      sql,
      /FROM "t_user" t0 INDEXED BY idx_user_name INNER JOIN "t_post" t1 NOT INDEXED ON t1\."user_id" = t0\."id"/,
    );
  });

  it('withTableLink 给表名加上 @链接', async () => {
    const { db } = await memoryDb();
    const remote = db.withTableLink('remote_db', ['Post']);
    const { sql } = remote
      .queryable(User)
      .select((u) => ({ name: u.name, n: u.posts.count() }))
      .toSQL();
    assert.match(sql, /FROM "t_post"@remote_db t1/);
    assert.match(sql, /FROM "t_user" t0/);
    assert.throws(() => db.withTableLink('bad link'), /not a valid link name/);
  });
});
