// DTO 筛选与排序（对应官方 dto-query/filter、sort：whereObject + @EasyWhereCondition、orderByObject）
import assert from 'node:assert/strict';
import { describe, it } from 'vitest';
import { parseTableRequest } from '@zerodep-dev/easy-query-ts';
import { Post, seed, User } from '../src/fixture.ts';
import { memoryDb } from '../src/sqlite-env.ts';

interface PostForm {
  title?: string;
  minAmount?: string;
  author?: string;
  keyword?: string;
  ids?: number[];
  created?: [string?, string?];
}

describe('sqlite: filterBy / sortBy / table whitelists', () => {
  it('按输入对象筛选：没填的跳过、同名列直接写比较方式、多列任一满足、经过导航', async () => {
    const { db } = await seed(await memoryDb());
    const search = (form: PostForm) =>
      db
        .queryable(Post)
        .filterBy(form, {
          title: 'startsWith',
          minAmount: { op: 'ge', column: (p) => p.amount },
          author: { op: 'eq', column: (p) => p.user.name },
          keyword: { op: 'like', column: (p) => [p.title, p.user.name] },
          ids: { op: 'in', column: (p) => p.id },
        })
        .orderBy((p) => p.id)
        .select((p) => p.title)
        .toList();
    assert.deepEqual(await search({}), ['orm tips', 'sql 100%', 'orm_v2', 'hello']);
    assert.deepEqual(await search({ title: 'orm', minAmount: '5' }), ['orm tips']);
    assert.deepEqual(await search({ author: 'bob', title: '  ' }), ['orm_v2', 'hello']);
    assert.deepEqual(await search({ keyword: 'ali' }), ['orm tips', 'sql 100%']);
    assert.deepEqual(await search({ ids: [] }), ['orm tips', 'sql 100%', 'orm_v2', 'hello']);
    assert.deepEqual(await search({ ids: [2, 3] }), ['sql 100%', 'orm_v2']);
  });

  it('不同名的键必须写 column（编译期检查）', () => {
    void (async () => {
      const { db } = await memoryDb();
      // @ts-expect-error minAmount 不是列，要写 { op, column }
      db.queryable(Post).filterBy({ minAmount: '5' }, { minAmount: 'ge' });
    });
  });

  it('区间：任一端为空不限', async () => {
    const { db } = await seed(await memoryDb());
    const names = await db
      .queryable(User)
      .filterBy({ age: [18, undefined] as const }, { age: { op: 'between', column: (u) => u.age } })
      .select((u) => u.name)
      .toList();
    assert.deepEqual(names, ['alice']);
  });

  it('动态排序只认登记的名字', async () => {
    const { db } = await seed(await memoryDb());
    const sorted = (sort: string) =>
      db
        .queryable(Post)
        .sortBy(sort, { amount: (p) => p.amount, author: (p) => p.user.name })
        .orderBy((p) => p.id)
        .select((p) => p.title)
        .toList();
    assert.deepEqual(await sorted('-amount'), ['sql 100%', 'orm tips', 'hello', 'orm_v2']);
    assert.deepEqual(await sorted('author desc'), ['orm_v2', 'hello', 'orm tips', 'sql 100%']);
    assert.throws(
      () => db.queryable(Post).sortBy('title', { amount: (p) => p.amount }),
      /cannot sort by 'title'/,
    );
  });

  it('table() 的 filterable / sortable 白名单', async () => {
    const { db } = await seed(await memoryDb());
    const q = db.queryable(Post).select((p) => ({ id: p.id, title: p.title, amount: p.amount }));
    const page = await q.table(parseTableRequest({ 'search.title': 'orm', sort: '-amount' }), {
      filterable: ['title'],
      sortable: ['amount'],
    });
    assert.deepEqual(
      page.rows.map((r) => r.title),
      ['orm tips', 'orm_v2'],
    );
    await assert.rejects(
      q.table(parseTableRequest({ 'filter.amount': '1.25' }), { filterable: ['title'] }),
      /cannot filter by amount/,
    );
    await assert.rejects(
      q.table(parseTableRequest({ sort: 'id' }), { sortable: ['amount'] }),
      /cannot sort by id/,
    );
  });
});
