// schema 组合：按模块各写一份 schema，mergeSchemas 合成一份，或在已有的 Db 上 mount 另一组
import assert from 'node:assert/strict';
import { describe, it } from 'vitest';
import { createDb, defineSchema, mergeSchemas } from '@zerodep-dev/easy-query-ts';
import { Comment, Company, Post, Role, seed, User, UserRole } from '../src/fixture.ts';
import { memoryDb } from '../src/sqlite-env.ts';

// 账号模块：公司、用户、角色
const accounts = defineSchema(
  { Company, User, Role, UserRole },
  {
    Company: (r) => ({ users: r.many('User', { from: 'id', to: 'companyId' }) }),
    User: (r) => ({
      company: r.one('Company', { from: 'companyId', to: 'id' }),
      roles: r.manyToMany('Role', {
        through: 'UserRole',
        throughFrom: 'userId',
        throughTo: 'roleId',
      }),
    }),
  },
);

// 内容模块：帖子、评论；不知道账号模块
const content = defineSchema(
  { Post, Comment },
  { Post: (r) => ({ comments: r.many('Comment', { from: 'id', to: 'postId' }) }) },
);

describe('schema 组合', async () => {
  const env = await seed(await memoryDb());

  it('mergeSchemas：两组的实体、各自的导航与跨组导航都能用', async () => {
    const schema = mergeSchemas([accounts, content], {
      Post: (r) => ({ author: r.one('User', { from: 'userId', to: 'id' }) }),
      User: (r) => ({
        posts: r.many('Post', { from: 'id', to: 'userId' }),
        // 直达关系经过别的模块的导航
        comments: r.path('Comment', ['posts', 'comments']),
      }),
      Company: (r) => ({ posts: r.path('Post', ['users', 'posts']) }),
    });
    const db = createDb({ schema, adapter: env.adapter });
    const rows = await db
      .queryable(User)
      .where((u) => u.posts.any((p) => p.comments.any()))
      .orderBy((u) => u.id)
      .select((u) => ({
        name: u.name,
        company: u.company.name,
        posts: u.posts.count(),
        comments: u.comments.count(),
      }))
      .toList();
    assert.deepEqual(rows[0], { name: 'alice', company: 'acme', posts: 2, comments: 2 });
    const authors = await db
      .queryable(Post)
      .orderBy((p) => p.id)
      .select((p) => p.author.name)
      .toList();
    assert.equal(authors[0], 'alice');
    assert.equal(
      await db
        .queryable(Company)
        .where((c) => c.name.eq('acme'))
        .select((c) => c.posts.count())
        .single(),
      await db
        .queryable(Post)
        .where((p) => p.author.company.name.eq('acme'))
        .count(),
    );
  });

  it('mount：在已有的 Db 上挂另一组，共用事务', async () => {
    const base = createDb({ schema: accounts, adapter: env.adapter });
    const before = await base.queryable(Post).count();
    await assert.rejects(
      base.transaction(async (tx) => {
        const all = tx.mount(content, {
          Post: (r) => ({ author: r.one('User', { from: 'userId', to: 'id' }) }),
        });
        await all.insert(Post).values({ userId: 1, title: 'draft', amount: '1.00' }).execute();
        assert.equal(await all.queryable(Post).count(), before + 1);
        throw new Error('rollback');
      }),
      /rollback/,
    );
    // 挂上去的实体也在同一个事务里：回滚后没有新帖子
    assert.equal(await base.queryable(Post).count(), before);
    const all = base.mount(content, {
      User: (r) => ({ posts: r.many('Post', { from: 'id', to: 'userId' }) }),
      Company: (r) => ({ posts: r.path('Post', ['users', 'posts']) }),
    });
    assert.deepEqual(
      await all
        .queryable(Company)
        .orderBy((c) => c.id)
        .select((c) => ({ name: c.name, posts: c.posts.count() }))
        .toList(),
      [
        { name: 'acme', posts: before },
        { name: 'globex', posts: 0 },
      ],
    );
  });

  it('重名在调用处就报类型错误，运行时也拦住', () => {
    assert.throws(
      // @ts-expect-error 实体键 Company 在两组里都有
      () => mergeSchemas([accounts, defineSchema({ Company })]),
      /entity 'Company' appears in more than one schema/,
    );
    const base = createDb({ schema: accounts, adapter: env.adapter });
    assert.throws(
      // @ts-expect-error 已经挂着 User
      () => base.mount(defineSchema({ User })),
      /entity 'User' appears in more than one schema/,
    );
    assert.throws(
      () => mergeSchemas([accounts, defineSchema({ Author: User })]),
      /same entity object is registered as both 'User' and 'Author'/,
    );
    assert.throws(
      () =>
        // @ts-expect-error User 已经有导航 company
        mergeSchemas([accounts, content], {
          User: (r) => ({ company: r.one('Company', { from: 'companyId', to: 'id' }) }),
        }),
      /User already has a navigation named 'company'/,
    );
    assert.throws(
      () =>
        // @ts-expect-error 导航不能与列重名
        mergeSchemas([accounts, content], {
          User: (r) => ({ name: r.many('Post', { from: 'id', to: 'userId' }) }),
        }),
      /has the same name as a column/,
    );
  });
});
