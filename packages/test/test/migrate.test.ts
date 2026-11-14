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
  MigrationError,
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

  it('函数写的迁移不校验：函数改了、历史里记的是旧版本按源码算的校验和，都不算"改过"', async () => {
    const rewritten = defineMigration({
      id: seed.id,
      up: async (db) => {
        await db.sql.execute`INSERT INTO t_note2 (body) VALUES (${'other'})`;
      },
    });
    assert.deepEqual(await db.migrate([init, addTag, rewritten]), []);
    // 0.4.0 及以前给函数记的是它源码文字的校验和：同一份迁移从源码跑与从构建产物跑算出来不一样
    database.exec(
      `UPDATE eqts_migrations SET checksum = 'a1b2c3d4e5f60718' WHERE id = '${seed.id}'`,
    );
    assert.deepEqual(await db.migrate([init, addTag, seed]), []);
    // 换成语句列表就有校验和了，对不上照常报错
    await assert.rejects(
      db.migrate([init, addTag, defineMigration({ id: seed.id, up: ['SELECT 1'] })]),
      /was changed after it was applied/,
    );
  });

  it('某条语句失败：MigrationError 带着是哪一条；SQLite 的 DDL 在事务里，整条迁移回滚', async () => {
    const broken = defineMigration({
      id: '20261030000400_broken',
      up: ['ALTER TABLE t_note2 ADD COLUMN extra TEXT', 'ALTER TABLE t_missing ADD COLUMN x TEXT'],
    });
    const error = await db.migrate([init, addTag, seed, broken]).then(
      () => undefined,
      (e: unknown) => e,
    );
    assert.ok(error instanceof MigrationError);
    assert.deepEqual(
      { id: error.id, statement: error.statement, rolledBack: error.rolledBack },
      { id: broken.id, statement: 2, rolledBack: true },
    );
    assert.match(error.message, /failed at statement 2 of 2: .*\(the migration was rolled back\)$/);
    const columns = database.prepare(`SELECT name FROM pragma_table_info('t_note2')`).all();
    assert.ok(!columns.some((c) => c['name'] === 'extra'));
    // 函数写的迁移失败时没有语句序号
    const thrower = defineMigration({
      id: '20261030000500_thrower',
      up: async () => {
        throw new Error('boom');
      },
    });
    const second = await db.migrate([init, addTag, seed, thrower]).then(
      () => undefined,
      (e: unknown) => e,
    );
    assert.ok(second instanceof MigrationError);
    assert.equal(second.statement, undefined);
    assert.match(second.message, /'20261030000500_thrower' failed: boom/);
  });
});
