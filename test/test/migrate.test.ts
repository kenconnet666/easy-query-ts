// 迁移历史（ROADMAP 18.2.3）：db.migrate 按 id 顺序执行没执行过的迁移，记校验和；migrationSource 生成迁移文件
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { describe, it } from 'vitest';
import {
  col,
  createDb,
  defineMigration,
  defineSchema,
  entity,
  migrationSource,
} from '@zerodep-dev/easy-query-ts';
import { sqlite } from '@zerodep-dev/easy-query-ts-sqlite';

const Note = entity('t_note2', {
  id: col.int().primaryKey().generated(),
  body: col.string(),
  tag: col.string().nullable(),
});

const init = defineMigration({
  id: '20261030000000_init',
  up: ['CREATE TABLE t_note2 (id INTEGER PRIMARY KEY AUTOINCREMENT, body TEXT NOT NULL)'],
});
const addTag = defineMigration({
  id: '20261030000100_add_tag',
  up: ['ALTER TABLE t_note2 ADD COLUMN tag TEXT'],
});
const seed = defineMigration({
  id: '20261030000200_seed',
  up: async (db) => {
    await db.sql.execute`INSERT INTO t_note2 (body, tag) VALUES (${'hello'}, ${'greeting'})`;
  },
});

describe('migrate', () => {
  const database = new DatabaseSync(':memory:');
  const db = createDb({ schema: defineSchema({ Note }), adapter: sqlite(database) });

  it('按 id 顺序执行（不看传入的顺序），记进历史表；再跑一遍什么都不做', async () => {
    assert.deepEqual(await db.migrate([seed, init, addTag]), [init.id, addTag.id, seed.id]);
    assert.deepEqual(
      await db
        .queryable(Note)
        .select((n) => ({ body: n.body, tag: n.tag }))
        .toList(),
      [{ body: 'hello', tag: 'greeting' }],
    );
    assert.deepEqual(await db.migrate([init, addTag, seed]), []);
    // 库已经与实体一致
    assert.deepEqual((await db.planSync()).statements, []);
  });

  it('已经执行过的迁移被改了：报错；id 重复：报错', async () => {
    const edited = defineMigration({
      id: addTag.id,
      up: ['ALTER TABLE t_note2 ADD COLUMN tag2 TEXT'],
    });
    await assert.rejects(
      db.migrate([init, edited]),
      /'20261030000100_add_tag' was changed after it was applied/,
    );
    await assert.rejects(db.migrate([init, init]), /listed twice/);
    assert.throws(() => defineMigration({ id: 'bad id', up: [] }), /may only contain/);
  });

  it('migrationSource：语句写成字符串，不会自动改的差异写成注释', () => {
    const source = migrationSource('20261030000300_x', {
      statements: ['ALTER TABLE "t" ADD COLUMN "a" TEXT'],
      differences: ['t.b: type is text, declared INTEGER'],
    });
    assert.match(
      source,
      /id: "20261030000300_x",\n {2}up: \[\n {4}"ALTER TABLE \\"t\\" ADD COLUMN \\"a\\" TEXT",\n {2}\],/,
    );
    assert.match(source, /\/\/ - t\.b: type is text, declared INTEGER\n$/);
  });
});
