// 跨导航的直达关系（对应 Java 版的 directMapping）：r.path / r.pathOne
import assert from 'node:assert/strict';
import { describe, it } from 'vitest';
import { createDb, defineSchema } from '@zerodep-dev/easy-query-ts';
import { Comment, Company, Post, Role, seed, User, UserRole } from '../src/fixture.ts';
import { memoryDb } from '../src/sqlite-env.ts';

const schema = defineSchema(
  { Company, User, Post, Comment, Role, UserRole },
  {
    Company: (r) => ({
      users: r.many('User', { from: 'id', to: 'companyId' }),
      posts: r.path('Post', ['users', 'posts']),
      comments: r.path('Comment', ['users', 'posts', 'comments']),
    }),
    User: (r) => ({
      company: r.one('Company', { from: 'companyId', to: 'id' }),
      posts: r.many('Post', { from: 'id', to: 'userId' }),
      roles: r.manyToMany('Role', {
        through: 'UserRole',
        throughFrom: 'userId',
        throughTo: 'roleId',
      }),
      // 有共同角色的人（含自己）：经两段多对多
      peers: r.path('User', ['roles', 'users']),
    }),
    Role: (r) => ({
      users: r.manyToMany('User', {
        through: 'UserRole',
        throughFrom: 'roleId',
        throughTo: 'userId',
      }),
    }),
    Post: (r) => ({
      user: r.one('User', { from: 'userId', to: 'id' }),
      comments: r.many('Comment', { from: 'id', to: 'postId' }),
      company: r.pathOne('Company', ['user', 'company']),
    }),
  },
);

describe('sqlite: path relations', async () => {
  const env = await seed(await memoryDb());
  const db = createDb({ schema, adapter: env.adapter });
  // alice 是 admin 与 dev，bob 是 dev
  await db
    .insert(Role)
    .values([{ name: 'admin' }, { name: 'dev' }])
    .execute();
  await db
    .insert(UserRole)
    .values([
      { userId: 1, roleId: 1 },
      { userId: 1, roleId: 2 },
      { userId: 2, roleId: 2 },
    ])
    .execute();

  it('一对多的直达关系：count、any、toList 与普通导航一样用', async () => {
    const rows = await db
      .queryable(Company)
      .orderBy((c) => c.id)
      .select((c) => ({
        name: c.name,
        posts: c.posts.count(),
        big: c.posts.any((p) => p.amount.gt('1000')),
        comments: c.comments.count(),
        titles: c.posts.orderBy((p) => p.id).toList((p) => p.title),
        latest: c.posts.orderBy((p) => p.id.desc()).first((p) => p.title),
      }))
      .toList();
    assert.deepEqual(rows, [
      {
        name: 'acme',
        posts: 4,
        big: true,
        comments: 2,
        titles: ['orm tips', 'sql 100%', 'orm_v2', 'hello'],
        latest: 'hello',
      },
      { name: 'globex', posts: 0, big: false, comments: 0, titles: [], latest: null },
    ]);
  });

  it('经几条路径到达同一个目标只算一次', async () => {
    const rows = await db
      .queryable(User)
      .orderBy((u) => u.id)
      .select((u) => ({
        name: u.name,
        peers: u.peers.count(),
        names: u.peers.orderBy((p) => p.id).toList((p) => p.name),
      }))
      .toList();
    assert.deepEqual(rows, [
      { name: 'alice', peers: 2, names: ['alice', 'bob'] },
      { name: 'bob', peers: 2, names: ['alice', 'bob'] },
      { name: 'carol', peers: 0, names: [] },
    ]);
  });

  it('多对一的直达关系等同于一段段访问导航，共用同样的 JOIN', async () => {
    const query = db
      .queryable(Post)
      .orderBy((p) => p.id)
      .select((p) => ({ title: p.title, company: p.company.name, again: p.user.company.name }));
    assert.equal(query.toSQL().sql.match(/LEFT JOIN/g)?.length, 2);
    const rows = await query.toList();
    assert.deepEqual(rows[0], { title: 'orm tips', company: 'acme', again: 'acme' });
  });

  it('定义时核对导航名、终点与种类', () => {
    assert.throws(
      () =>
        defineSchema(
          { Company, User },
          {
            Company: (r) => ({ users: r.many('User', { from: 'id', to: 'companyId' }) }),
            User: (r) => ({ x: r.path('Company', ['nope', 'users']) }),
          },
        ),
      /User has no navigation 'nope'/,
    );
    assert.throws(
      () =>
        defineSchema(
          { Company, User },
          {
            Company: (r) => ({ users: r.many('User', { from: 'id', to: 'companyId' }) }),
            User: (r) => ({
              company: r.one('Company', { from: 'companyId', to: 'id' }),
              x: r.path('Company', ['company', 'users']),
            }),
          },
        ),
      /ends at User, not Company/,
    );
    assert.throws(
      () =>
        defineSchema(
          { Company, User },
          {
            Company: (r) => ({ users: r.many('User', { from: 'id', to: 'companyId' }) }),
            User: (r) => ({
              company: r.one('Company', { from: 'companyId', to: 'id' }),
              x: r.pathOne('User', ['company', 'users']),
            }),
          },
        ),
      /use r\.path/,
    );
  });
});
