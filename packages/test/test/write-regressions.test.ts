// 查出来改完再存时 $onUpdate 要填新值；save 只给主键时，子项的关联列要从库里的行取
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
  { Note, Author, Book },
  { Author: (r) => ({ books: r.many('Book', { from: 'name', to: 'authorName' }) }) },
);

async function open() {
  const db = createDb({ schema, adapter: sqlite(new DatabaseSync(':memory:')) });
  await db.createTables();
  return db;
}

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
