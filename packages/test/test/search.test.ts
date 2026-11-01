// 官方 search 扩展的参数约定（EasySearchBaseOpTests、EasySearchBaseCommonTests）：解析成 TableRequest 交给 table()
import assert from 'node:assert/strict';
import { describe, it } from 'vitest';
import { parseSearchRequest } from '@zerodep-dev/easy-query-ts';
import { Post, seed, User } from '../src/fixture.ts';
import { memoryDb } from '../src/sqlite-env.ts';

const fields = ['id', 'title', 'amount', 'author'];

async function search(query: Record<string, string | string[]>) {
  const { db } = await seed(await memoryDb());
  const page = await db
    .queryable(Post)
    .select((p) => ({ id: p.id, title: p.title, amount: p.amount, author: p.user.name }))
    .table(parseSearchRequest({ sort: 'id:asc', ...query }, { fields }));
  return page.rows.map((p) => p.id);
}

describe('search: official parameter convention', () => {
  it('比较方式：eq ne gt ge lt le、lk nl、lml nlml、lmr nlmr、in ni', async () => {
    assert.deepEqual(await search({ author: 'bob' }), [3, 4]);
    assert.deepEqual(await search({ author: 'bob', 'author-op': 'ne' }), [1, 2]);
    assert.deepEqual(await search({ amount: '3.00', 'amount-op': 'gt' }), [1, 2]);
    assert.deepEqual(await search({ amount: '3.00', 'amount-op': 'ge' }), [1, 2, 4]);
    assert.deepEqual(await search({ amount: '3.00', 'amount-op': 'lt' }), [3]);
    assert.deepEqual(await search({ amount: '3.00', 'amount-op': 'le' }), [3, 4]);
    assert.deepEqual(await search({ title: 'orm', 'title-op': 'lk' }), [1, 3]);
    assert.deepEqual(await search({ title: 'orm', 'title-op': 'nl' }), [2, 4]);
    assert.deepEqual(await search({ title: 'orm', 'title-op': 'lml' }), [1, 3]);
    assert.deepEqual(await search({ title: 'orm', 'title-op': 'nlml' }), [2, 4]);
    assert.deepEqual(await search({ title: 'tips', 'title-op': 'lmr' }), [1]);
    assert.deepEqual(await search({ title: 'tips', 'title-op': 'nlmr' }), [2, 3, 4]);
    assert.deepEqual(await search({ id: ['1', '3'], 'id-op': 'in' }), [1, 3]);
    assert.deepEqual(await search({ id: '1', 'id-1': '3', 'id-op': 'ni' }), [2, 4]);
  });

  it('区间：rc ro roc rco 与 nrc …；两端用 -1 / -2，缺一端不限', async () => {
    const range = (op: string, low = '3.00', high = '2000.00') =>
      search({ 'amount-1': low, 'amount-2': high, 'amount-op': op });
    assert.deepEqual(await range('rc'), [1, 2, 4]);
    assert.deepEqual(await range('ro'), [1]);
    assert.deepEqual(await range('roc'), [1, 2]);
    assert.deepEqual(await range('rco'), [1, 4]);
    assert.deepEqual(await range('nrc'), [3]);
    assert.deepEqual(await search({ 'amount-1': '10.00', 'amount-op': 'rc' }), [1, 2]);
  });

  it('inn、排序、分页、默认排序；严格模式拒绝不认识的字段与比较方式', async () => {
    const { db } = await seed(await memoryDb());
    const users = db.queryable(User).select((u) => ({ name: u.name, age: u.age }));
    const names = async (query: Record<string, string>) =>
      (await users.table(parseSearchRequest(query, { defaultSort: ['name:desc'] }))).rows.map(
        (u) => u.name,
      );
    assert.deepEqual(await names({ age: 'false', 'age-op': 'inn' }), ['bob']);
    assert.deepEqual(await names({ age: 'true', 'age-op': 'inn' }), ['carol', 'alice']);
    assert.deepEqual(await names({ sort: 'age:ascend', current: '2', pageSize: '1' }), ['carol']);
    assert.throws(
      () => parseSearchRequest({ secret: '1' }, { fields }),
      /cannot search by 'secret'/,
    );
    assert.throws(
      () => parseSearchRequest({ id: '1', 'id-op': 'zz' }, { fields }),
      /unknown search op/,
    );
    assert.deepEqual(
      parseSearchRequest({ id: '1', 'id-op': 'zz' }, { strict: false }).condition,
      undefined,
    );
  });
});
