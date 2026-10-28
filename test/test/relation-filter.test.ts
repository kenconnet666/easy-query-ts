// 关系上固定的条件（对应 Java 版导航的 extraFilter）：定义关系时声明，每次用到这个导航都带上
import assert from 'node:assert/strict';
import { describe, it } from 'vitest';
import { createDb, defineSchema } from '@zerodep-dev/easy-query-ts';
import { Company, Post, seed, User } from '../src/fixture.ts';
import { memoryDb } from '../src/sqlite-env.ts';

// 同一批表上另一份 schema：大额的文章、只认 acme 这家公司
const schema = defineSchema(
  { Company, User, Post },
  {
    User: (r) => ({
      posts: r.many('Post', { from: 'id', to: 'userId' }),
      bigPosts: r.many('Post', { from: 'id', to: 'userId' }, { where: (p) => p.amount.gt('100') }),
      acme: r.one('Company', { from: 'companyId', to: 'id' }, { where: (c) => c.name.eq('acme') }),
    }),
  },
);

describe('sqlite: relation filters', async () => {
  const env = await seed(await memoryDb());
  const db = createDb({ schema, adapter: env.adapter });

  it('一对多：count、any、toList 都只算满足条件的子项；之后的 where 叠加在上面', async () => {
    const rows = await db
      .queryable(User)
      .where((u) => u.posts.any())
      .orderBy((u) => u.id)
      .select((u) => ({
        name: u.name,
        all: u.posts.count(),
        big: u.bigPosts.count(),
        titles: u.bigPosts.toList((p) => p.title),
        bigOrm: u.bigPosts.where((p) => p.title.startsWith('orm')).count(),
      }))
      .toList();
    assert.deepEqual(rows, [
      { name: 'alice', all: 2, big: 1, titles: ['sql 100%'], bigOrm: 0 },
      { name: 'bob', all: 2, big: 0, titles: [], bigOrm: 0 },
    ]);
    const owners = await db
      .queryable(User)
      .where((u) => u.bigPosts.any())
      .select((u) => u.name)
      .toList();
    assert.deepEqual(owners, ['alice']);
  });

  it('多对一：条件写进 JOIN 的 ON，不满足时导航为空（不把主表的行过滤掉）', async () => {
    const rows = await db
      .queryable(User)
      .orderBy((u) => u.id)
      .select((u) => ({ name: u.name, company: u.acme.name }))
      .toList();
    assert.deepEqual(rows, [
      { name: 'alice', company: 'acme' },
      { name: 'bob', company: 'acme' },
      { name: 'carol', company: null },
    ]);
    assert.match(
      db
        .queryable(User)
        .select((u) => u.acme.name)
        .toSQL().sql,
      /LEFT JOIN "t_company" t\d ON t\d\."id" = t0\."company_id" AND t\d\."name" = \?/,
    );
  });
});
