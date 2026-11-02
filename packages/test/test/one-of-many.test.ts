// 对多导航里取一条当一对一：最新的书、最贵的书
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { describe, it } from 'vitest';
import { col, createDb, defineSchema, entity } from '@zerodep-dev/easy-query-ts';
import { sqlite } from '@zerodep-dev/easy-query-ts-sqlite';

const Author = entity('t_author', { id: col.int().primaryKey(), name: col.string() });
const Book = entity('t_book', {
  id: col.int().primaryKey(),
  authorId: col.int(),
  title: col.string(),
  price: col.int(),
  year: col.int(),
  published: col.boolean(),
});
const Shelf = entity('t_shelf', {
  id: col.int().primaryKey(),
  bookId: col.int(),
  floor: col.int(),
});

const schema = defineSchema(
  { Author, Book, Shelf },
  {
    Author: (r) => ({
      books: r.many('Book', { from: 'id', to: 'authorId' }),
      latestBook: r.oneOfMany('Book', 'books', { orderBy: (b) => b.year.desc() }),
      newestRow: r.oneOfMany('Book', 'books', { orderBy: (b) => b.id.desc() }),
      priciestBook: r.oneOfMany('Book', 'books', { orderBy: (b) => b.price.desc() }),
      latestPublished: r.oneOfMany('Book', 'books', {
        orderBy: (b) => b.year.desc(),
        where: (b) => b.published.eq(true),
      }),
    }),
    Book: (r) => ({
      author: r.one('Author', { from: 'authorId', to: 'id' }),
      shelves: r.many('Shelf', { from: 'id', to: 'bookId' }),
      lowestShelf: r.oneOfMany('Shelf', 'shelves', { orderBy: (s) => s.floor }),
    }),
  },
);

async function open() {
  const db = createDb({ schema, adapter: sqlite(new DatabaseSync(':memory:')) });
  await db.createTables();
  await db
    .insert(Author)
    .values([
      { id: 1, name: 'ann' },
      { id: 2, name: 'ben' },
      { id: 3, name: 'cat' },
    ])
    .execute();
  const book = (id: number, authorId: number, price: number, year: number, published = true) => ({
    id,
    authorId,
    title: `b${id}`,
    price,
    year,
    published,
  });
  await db
    .insert(Book)
    .values([
      book(1, 1, 30, 2020),
      book(2, 1, 80, 2022),
      book(3, 1, 50, 2024, false),
      book(4, 2, 20, 2021),
      // 同一年：按主键定下第一条
      book(5, 2, 20, 2021),
    ])
    .execute();
  await db
    .insert(Shelf)
    .values([
      { id: 1, bookId: 1, floor: 3 },
      { id: 2, bookId: 1, floor: 1 },
    ])
    .execute();
  return db;
}

describe('sqlite: r.oneOfMany', () => {
  it('像一对一一样点列：最新的、最贵的，没有子项时为 null', async () => {
    const db = await open();
    const rows = await db
      .queryable(Author)
      .orderBy((a) => a.id)
      .select((a) => ({
        name: a.name,
        latest: a.latestBook.title,
        priciest: a.priciestBook.title,
      }))
      .toList();
    assert.deepEqual(rows, [
      { name: 'ann', latest: 'b3', priciest: 'b2' },
      { name: 'ben', latest: 'b4', priciest: 'b4' },
      { name: 'cat', latest: null, priciest: null },
    ]);
  });

  it('where 在取之前过滤，不是把取到的那条再筛掉', async () => {
    const db = await open();
    const rows = await db
      .queryable(Author)
      .orderBy((a) => a.id)
      .select((a) => a.latestPublished.title)
      .toList();
    assert.deepEqual(rows, ['b2', 'b4', null]);
  });

  it('能放进条件、排序，也能接着导航', async () => {
    const db = await open();
    const names = await db
      .queryable(Author)
      .where((a) => a.priciestBook.price.ge(50))
      .select((a) => a.name)
      .toList();
    assert.deepEqual(names, ['ann']);
    const sorted = await db
      .queryable(Author)
      .where((a) => a.books.any())
      .orderBy((a) => a.latestBook.year.desc())
      .select((a) => a.name)
      .toList();
    assert.deepEqual(sorted, ['ann', 'ben']);
    const floors = await db
      .queryable(Author)
      .where((a) => a.id.eq(1))
      .select((a) => a.priciestBook.lowestShelf.floor)
      .toList();
    assert.deepEqual(floors, [null]);
    const lowest = await db
      .queryable(Book)
      .where((b) => b.id.eq(1))
      .select((b) => b.lowestShelf.floor)
      .toList();
    assert.deepEqual(lowest, [1]);
  });

  it('include 带出整行，一条语句，不把父行乘出好几倍', async () => {
    const db = await open();
    const query = db
      .queryable(Author)
      .orderBy((a) => a.id)
      .include((a) => ({ latestBook: a.latestBook }));
    const rows = await query.toList();
    assert.equal(rows.length, 3);
    assert.equal(rows[0]!.latestBook?.title, 'b3');
    assert.equal(rows[2]!.latestBook, null);
    const { sql } = query.toSQL();
    assert.match(sql, /LEFT JOIN \(SELECT .*ROW_NUMBER\(\) OVER \(PARTITION BY .*\) AS "eq_rn"/);
    assert.match(sql, /"eq_rn" = 1/);
  });

  it('排序相同时按主键定下一条；已按主键排序时不重复写这一列', async () => {
    const db = await open();
    const tie = db.queryable(Author).select((a) => a.latestBook.title);
    assert.match(tie.toSQL().sql, /ORDER BY [^)]*"year" DESC, [^)]*"id" ASC\)/);
    const byId = db.queryable(Author).select((a) => a.newestRow.title);
    assert.match(byId.toSQL().sql, /ORDER BY [^,)]*"id" DESC\)/);
    assert.deepEqual(await byId.orderBy((a) => a.id).toList(), ['b3', 'b5', null]);
  });

  it('定义时就报出写错的导航', () => {
    const define = (navigation: string) =>
      defineSchema(
        { Author, Book },
        {
          Author: (r) => ({
            books: r.many('Book', { from: 'id', to: 'authorId' }),
            bad: r.oneOfMany('Book', navigation, { orderBy: (b) => b.id }),
          }),
          Book: (r) => ({ author: r.one('Author', { from: 'authorId', to: 'id' }) }),
        },
      );
    assert.ok(define('books'));
    assert.throws(() => define('nope'), /has no navigation 'nope'/);
  });

  it('不能保存', async () => {
    const db = await open();
    await assert.rejects(
      db.save(Author, { id: 9, name: 'x', latestBook: { title: 't' } } as never, {
        include: { latestBook: true } as never,
      }),
      /cannot be saved/,
    );
  });
});
