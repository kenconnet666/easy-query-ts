// 差异更新 changes(before, after)、表达式更新的 withVersion、自定义版本规则
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { describe, it } from 'vitest';
import { col, createDb, defineSchema, entity } from '@zerodep-dev/easy-query-ts';
import { sqlite } from '@zerodep-dev/easy-query-ts-sqlite';
import { Doc, seed, User } from '../src/fixture.ts';
import { memoryDb } from '../src/sqlite-env.ts';

describe('sqlite: changes / withVersion', () => {
  it('只 set 变了的列；没有变化不发语句；按列的类型比较', async () => {
    const env = await seed(await memoryDb());
    const { db, statements } = env;
    const before = await db.queryable(User).findOrThrow(1);
    statements.length = 0;
    // 内容相同的新对象：日期比时刻、JSON 比内容，都算没变
    const same = {
      ...before,
      createdAt: new Date(before.createdAt.getTime()),
      attrs: { tags: [...before.attrs.tags] },
    };
    assert.equal(await db.update(User).changes(before, same).execute(), 0);
    assert.equal(statements.length, 0);
    assert.throws(() => db.update(User).changes(before, same).toSQL(), /nothing changed/);

    // 只给表单提交的几项
    assert.equal(await db.update(User).changes(before, { name: 'alice2', age: 30 }).execute(), 1);
    assert.equal(statements.length, 1);
    assert.match(statements[0]!.sql, /^UPDATE "t_user" AS t0 SET "name" = \? WHERE t0\."id" = \?$/);

    assert.throws(
      () => db.update(User).changes(before, { id: 2 }),
      /primary key 'id' of t_user cannot change/,
    );
  });

  it('带版本列时按 before 的版本定位，写入下一个版本；旧的 before 再保存就抛错', async () => {
    const { db } = await memoryDb();
    await db.insert(Doc).values({ title: 'a', createdBy: 'u', secret: 's' }).execute();
    const before = await db.queryable(Doc).findOrThrow(1);
    await db.update(Doc).changes(before, { title: 'b' }).execute();
    const after = await db.queryable(Doc).findOrThrow(1);
    assert.equal(after.title, 'b');
    assert.equal(after.version, 1);
    await assert.rejects(
      db.update(Doc).changes(before, { title: 'c' }).execute(),
      /optimistic lock failed/,
    );
  });

  it('表达式更新 withVersion：条件带版本、写入下一个；版本对不上就抛错', async () => {
    const { db } = await memoryDb();
    await db.insert(Doc).values({ title: 'a', createdBy: 'u', secret: 's' }).execute();
    const sql = db
      .update(Doc)
      .set({ title: 'b' })
      .where((d) => d.id.eq(1))
      .withVersion(0)
      .toSQL();
    assert.match(sql.sql, /SET .*"version" = \?.* WHERE .* AND t0\."version" = \?$/);
    await db
      .update(Doc)
      .set({ title: 'b' })
      .where((d) => d.id.eq(1))
      .withVersion(0)
      .execute();
    await assert.rejects(
      db
        .update(Doc)
        .set({ title: 'c' })
        .where((d) => d.id.eq(1))
        .withVersion(0)
        .execute(),
      /optimistic lock failed/,
    );
    assert.equal((await db.queryable(Doc).findOrThrow(1)).version, 1);
  });

  it('自定义版本规则：UUID 版本', async () => {
    let n = 0;
    const Note = entity('t_vnote', {
      id: col.int().primaryKey().generated(),
      body: col.string(),
      rev: col.string().version({ initial: 'r0', next: () => `r${++n}` }),
    });
    const db = createDb({
      schema: defineSchema({ Note }),
      adapter: sqlite(new DatabaseSync(':memory:')),
    });
    await db.createTables();
    await db.insert(Note).values({ body: 'a' }).execute();
    const before = await db.queryable(Note).findOrThrow(1);
    assert.equal(before.rev, 'r0');
    await db.update(Note).changes(before, { body: 'b' }).execute();
    assert.equal((await db.queryable(Note).findOrThrow(1)).rev, 'r1');
    // 表达式更新没给 withVersion：照样换成下一个版本
    await db
      .update(Note)
      .set({ body: 'c' })
      .where((x) => x.id.eq(1))
      .execute();
    assert.equal((await db.queryable(Note).findOrThrow(1)).rev, 'r2');
    assert.throws(() => entity('t_x', { v: col.string().version() }), /needs \{ initial, next \}/);
  });
});
