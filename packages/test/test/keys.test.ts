// 按主键查（对应 Java 版的 findOrNull / findNotNull / whereById / whereByIds）与查不到就抛错（firstNotNull）
import assert from 'node:assert/strict';
import { describe, it } from 'vitest';
import { NotFoundError } from '@zerodep-dev/easy-query-ts';
import { Member, seed, User } from '../src/fixture.ts';
import { memoryDb } from '../src/sqlite-env.ts';

describe('sqlite: primary keys', async () => {
  const { db } = await seed(await memoryDb());
  await db
    .insert(Member)
    .values([
      { tenantId: 1, id: 7, name: 'ann' },
      { tenantId: 2, id: 7, name: 'ben' },
    ])
    .execute();
  const alice = (
    await db
      .queryable(User)
      .where((u) => u.name.eq('alice'))
      .single()
  ).id;

  it('find：单列主键传值，复合主键传 { 列: 值 }；没有时 undefined', async () => {
    assert.equal((await db.queryable(User).find(alice))?.name, 'alice');
    assert.equal(await db.queryable(User).find(-1), undefined);
    assert.equal((await db.queryable(Member).find({ tenantId: 2, id: 7 }))?.name, 'ben');
  });

  it('find 之前可以 select、where，按主键再筛一次', async () => {
    const card = await db
      .queryable(User)
      .select((u) => ({ id: u.id, company: u.company.name }))
      .find(alice);
    assert.deepEqual(card, { id: alice, company: 'acme' });
  });

  it('whereKey / whereKeys：渲染成主键条件；一组主键是 IN，复合主键是 OR，空数组一行都不匹配', async () => {
    assert.match(db.queryable(User).whereKey(1).toSQL().sql, /WHERE t0\."id" = \?$/);
    assert.match(db.queryable(User).whereKeys([1, 2]).toSQL().sql, /WHERE t0\."id" IN \(\?, \?\)$/);
    const members = await db
      .queryable(Member)
      .whereKeys([
        { tenantId: 1, id: 7 },
        { tenantId: 2, id: 7 },
      ])
      .orderBy((m) => m.tenantId)
      .toList();
    assert.deepEqual(
      members.map((m) => m.name),
      ['ann', 'ben'],
    );
    assert.deepEqual(await db.queryable(User).whereKeys([]).toList(), []);
  });

  it('复合主键少了列、或只传了一个值时报错，说明要传哪些列', () => {
    assert.throws(() => db.queryable(Member).whereKey(7).toSQL(), /tenantId, id/);
    assert.throws(() => db.queryable(Member).whereKey({ tenantId: 1 }).toSQL(), /missing 'id'/);
  });

  it('firstOrThrow / findOrThrow：查不到时抛 NotFoundError，带上说明', async () => {
    assert.equal(
      (
        await db
          .queryable(User)
          .where((u) => u.id.eq(alice))
          .firstOrThrow()
      ).name,
      'alice',
    );
    await assert.rejects(db.queryable(User).findOrThrow(-1, '用户不存在'), (error: unknown) => {
      assert.ok(error instanceof NotFoundError);
      assert.equal(error.message, '用户不存在');
      return true;
    });
    await assert.rejects(
      db
        .queryable(User)
        .where((u) => u.id.eq(-1))
        .firstOrThrow(),
      NotFoundError,
    );
  });
});
