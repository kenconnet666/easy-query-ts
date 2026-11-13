// 查出来改完再存时 $onUpdate 要填新值；save 只给主键时，子项的关联列要从库里的行取；returning 不绕过乐观锁；batch 的切块
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { describe, it } from 'vitest';
import { col, createDb, defineSchema, entity } from '@zerodep-dev/easy-query-ts';
import { sqlite } from '@zerodep-dev/easy-query-ts-sqlite';

const REFRESHED = new Date('2026-05-06T07:08:09.000Z');

const Note = entity('t_note', {
  id: col.int().primaryKey().generated(),
  title: col.string(50),
  updatedAt: col
    .datetime()
    .nullable()
    .$onUpdate(() => REFRESHED),
});

const Draft = entity('t_draft', {
  id: col.int().primaryKey(),
  title: col.string(50),
  version: col.int().version(),
});

const Author = entity('t_author', {
  id: col.int().primaryKey().generated(),
  name: col.string(50),
});

const Book = entity('t_book', {
  id: col.int().primaryKey().generated(),
  authorName: col.string(50),
  title: col.string(50),
});

const schema = defineSchema(
  { Note, Draft, Author, Book },
  { Author: (r) => ({ books: r.many('Book', { from: 'name', to: 'authorName' }) }) },
);

async function open() {
  const db = createDb({ schema, adapter: sqlite(new DatabaseSync(':memory:')) });
  await db.createTables();
  return db;
}

describe('sqlite: returning() keeps the guards of execute()', () => {
  it('乐观锁：版本对不上时带 returning 也抛错，而不是返回空数组', async () => {
    const db = await open();
    await db.insert(Draft).values({ id: 1, title: 'a' }).execute();
    const draft = await db.queryable(Draft).findOrThrow(1);
    await db
      .update(Draft)
      .entity({ ...draft, title: 'b' })
      .execute();
    await assert.rejects(
      db
        .update(Draft)
        .entity({ ...draft, title: 'c' })
        .returning('title')
        .execute(),
      /optimistic lock failed/,
    );
    await assert.rejects(
      db.delete(Draft).entity(draft).returning('id').execute(),
      /optimistic lock failed/,
    );
    assert.equal((await db.queryable(Draft).findOrThrow(1)).title, 'b');
  });

  it('expectRows：行数不对时带 returning 也抛调用方给的错误', async () => {
    const db = await open();
    await assert.rejects(
      db
        .update(Draft)
        .set({ title: 'x' })
        .where((d) => d.id.eq(404))
        .expectRows(1, (affected) => new Error(`handled already (${affected})`))
        .returning('id')
        .execute(),
      /handled already \(0\)/,
    );
  });
});

describe('sqlite: $onUpdate on rows read back', () => {
  it('entity(row) 不把读出来的旧值写回去', async () => {
    const db = await open();
    await db.insert(Note).values({ title: 'a' }).execute();
    const note = await db.queryable(Note).findOrThrow(1);
    await db
      .update(Note)
      .entity({ ...note, title: 'b' })
      .execute();
    const saved = await db.queryable(Note).findOrThrow(1);
    assert.equal(saved.title, 'b');
    assert.deepEqual(saved.updatedAt, REFRESHED);
  });

  it('entities(rows).batch() 也一样', async () => {
    const db = await open();
    await db
      .insert(Note)
      .values([{ title: 'a' }, { title: 'b' }])
      .execute();
    const rows = await db.queryable(Note).toList();
    await db
      .update(Note)
      .entities(rows.map((n) => ({ ...n, title: `${n.title}!` })))
      .batch()
      .execute();
    for (const row of await db.queryable(Note).toList()) assert.deepEqual(row.updatedAt, REFRESHED);
  });

  it('batch() 每条语句最多合并 500 行：1200 行在 SQLite 上不超出表达式的嵌套上限', async () => {
    const db = await open();
    await db
      .insert(Note)
      .values(Array.from({ length: 1200 }, (_, i) => ({ title: `n${i}` })))
      .execute();
    const rows = await db.queryable(Note).toList();
    const update = db
      .update(Note)
      .entities(rows.map((n) => ({ ...n, title: `${n.title}!` })))
      .batch();
    assert.equal(update.toSQL().length, 3);
    assert.equal(await update.execute(), 1200);
    assert.equal(
      await db
        .queryable(Note)
        .where((n) => n.title.endsWith('!'))
        .count(),
      1200,
    );
  });

  it('set 明确给的值照用', async () => {
    const db = await open();
    await db.insert(Note).values({ title: 'a' }).execute();
    const given = new Date('2020-01-01T00:00:00.000Z');
    await db
      .update(Note)
      .set({ updatedAt: given })
      .where((n) => n.id.eq(1))
      .execute();
    assert.deepEqual((await db.queryable(Note).findOrThrow(1)).updatedAt, given);
  });
});

describe('sqlite: save with a relation not on the primary key', () => {
  it('父行只给主键时，子项的关联列从库里的行取', async () => {
    const db = await open();
    await db
      .insert(Author)
      .values([{ name: '甲' }, { name: '乙' }])
      .execute();
    await db
      .insert(Book)
      .values([
        { authorName: '甲', title: '甲的旧书' },
        { authorName: '乙', title: '乙的书' },
      ])
      .execute();

    await db.save(
      Author,
      { id: 1, books: [{ title: '甲的新书' }] },
      { include: { books: { removed: 'keep' } } },
    );

    const titles = await db
      .queryable(Book)
      .where((b) => b.authorName.eq('甲'))
      .orderBy((b) => b.id)
      .select((b) => b.title)
      .toList();
    assert.deepEqual(titles, ['甲的旧书', '甲的新书']);
    assert.equal(await db.queryable(Book).count(), 3);
  });
});
