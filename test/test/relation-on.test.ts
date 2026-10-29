// 任意条件的关系（对应官方 navigate/dotcolumn 逗号分隔列、pathcolumn 路径左匹配、many2many2 无中间表）
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { describe, it } from 'vitest';
import { col, createDb, defineSchema, entity } from '@zerodep-dev/easy-query-ts';
import { sqlite } from '@zerodep-dev/easy-query-ts-sqlite';

const Reader = entity('t_reader', {
  id: col.int().primaryKey(),
  name: col.string(),
  // 逗号分隔存的书号
  bookIds: col.string(),
});
const Book = entity('t_book', { id: col.int().primaryKey(), title: col.string() });
// 路径存的部门树：/1/、/1/2/、/1/2/3/
const Dept = entity('t_path_dept', {
  id: col.int().primaryKey(),
  path: col.string(),
  name: col.string(),
});

const schema = defineSchema(
  { Reader, Book, Dept },
  {
    Reader: (r) => ({ books: r.manyOn('Book', (reader, book) => book.id.inCsv(reader.bookIds)) }),
    Book: (r) => ({ readers: r.manyOn('Reader', (book, reader) => book.id.inCsv(reader.bookIds)) }),
    Dept: (r) => ({
      // 全部下级：路径以我的路径开头（不含自己）
      descendants: r.manyOn('Dept', (d, c) => [c.path.startsWith(d.path), c.id.ne(d.id)]),
      parent: r.oneOn('Dept', (d, p) => [
        d.path.startsWith(p.path),
        p.path.length().eq(d.path.length().minus(2)),
      ]),
    }),
  },
);

async function open() {
  const db = createDb({ schema, adapter: sqlite(new DatabaseSync(':memory:')) });
  await db.createTables();
  await db
    .insert(Book)
    .values([1, 2, 3].map((id) => ({ id, title: `b${id}` })))
    .execute();
  await db
    .insert(Reader)
    .values([
      { id: 1, name: 'ann', bookIds: '1,3' },
      { id: 2, name: 'ben', bookIds: '2' },
      { id: 3, name: 'cat', bookIds: '' },
    ])
    .execute();
  await db
    .insert(Dept)
    .values([
      { id: 1, path: '/1/', name: 'root' },
      { id: 2, path: '/1/2/', name: 'dev' },
      { id: 3, path: '/1/2/3/', name: 'web' },
      { id: 4, path: '/4/', name: 'other' },
    ])
    .execute();
  return db;
}

describe('sqlite: relations on any condition', () => {
  it('逗号分隔列：两边都能查、能数、能拼成对象树', async () => {
    const db = await open();
    const readers = await db
      .queryable(Reader)
      .orderBy((r) => r.id)
      .select((r) => ({
        name: r.name,
        count: r.books.count(),
        titles: r.books.orderBy((b) => b.id).toList((b) => b.title),
      }))
      .toList();
    assert.deepEqual(readers, [
      { name: 'ann', count: 2, titles: ['b1', 'b3'] },
      { name: 'ben', count: 1, titles: ['b2'] },
      { name: 'cat', count: 0, titles: [] },
    ]);
    const popular = await db
      .queryable(Book)
      .where((b) => b.readers.any((r) => r.name.eq('ann')))
      .orderBy((b) => b.id)
      .select((b) => b.title)
      .toList();
    assert.deepEqual(popular, ['b1', 'b3']);
  });

  it('路径左匹配：全部下级与上级', async () => {
    const db = await open();
    const rows = await db
      .queryable(Dept)
      .orderBy((d) => d.id)
      .select((d) => ({
        name: d.name,
        below: d.descendants.orderBy((c) => c.id).toList((c) => c.name),
        parent: d.parent.name,
      }))
      .toList();
    assert.deepEqual(rows, [
      { name: 'root', below: ['dev', 'web'], parent: null },
      { name: 'dev', below: ['web'], parent: 'root' },
      { name: 'web', below: [], parent: 'dev' },
      { name: 'other', below: [], parent: null },
    ]);
  });
});
