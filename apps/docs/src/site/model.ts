/**
 * 全站示例共用的业务模型：一个技术社区。公司有员工，用户发帖、评论，帖子打标签。
 * 文档里每段代码都跑在这套模型与下面的示例数据上：构建时算出 SQL 与结果，浏览器里点“运行”时真的执行
 */
import { col, defineSchema, entity, type Db } from '@zerodep-dev/easy-query-ts';

export const Company = entity('t_company', {
  id: col.bigint().primaryKey().generated(),
  name: col.string(50),
  city: col.string(20),
});

export const User = entity('t_user', {
  id: col.bigint().primaryKey().generated(),
  name: col.string(50),
  age: col.int().nullable(),
  companyId: col.bigint().nullable(),
  joinedAt: col.date(),
});

export const Post = entity('t_post', {
  id: col.bigint().primaryKey().generated(),
  authorId: col.bigint(),
  title: col.string(100),
  status: col.enum(['draft', 'published'] as const),
  views: col.int(),
});

export const Comment = entity('t_comment', {
  id: col.bigint().primaryKey().generated(),
  postId: col.bigint(),
  authorId: col.bigint(),
  body: col.string(200),
});

export const Tag = entity('t_tag', {
  id: col.bigint().primaryKey().generated(),
  name: col.string(30),
});

export const PostTag = entity('t_post_tag', {
  postId: col.bigint().primaryKey(),
  tagId: col.bigint().primaryKey(),
});

export const schema = defineSchema(
  { Company, User, Post, Comment, Tag, PostTag },
  {
    Company: (r) => ({ users: r.many('User', { from: 'id', to: 'companyId' }) }),
    User: (r) => ({
      company: r.one('Company', { from: 'companyId', to: 'id' }),
      posts: r.many('Post', { from: 'id', to: 'authorId' }),
      comments: r.many('Comment', { from: 'id', to: 'authorId' }),
    }),
    Post: (r) => ({
      author: r.one('User', { from: 'authorId', to: 'id' }),
      comments: r.many('Comment', { from: 'id', to: 'postId' }),
      tags: r.manyToMany('Tag', { through: 'PostTag', throughFrom: 'postId', throughTo: 'tagId' }),
    }),
    Comment: (r) => ({
      post: r.one('Post', { from: 'postId', to: 'id' }),
      author: r.one('User', { from: 'authorId', to: 'id' }),
    }),
    Tag: (r) => ({
      posts: r.manyToMany('Post', {
        through: 'PostTag',
        throughFrom: 'tagId',
        throughTo: 'postId',
      }),
    }),
  },
);

/** 放进示例数据：建好表之后调用，主键从 1 起 */
export async function seed(db: Db<typeof schema>): Promise<void> {
  await db
    .insert(Company)
    .values([
      { name: '星河科技', city: '杭州' },
      { name: '云帆软件', city: '上海' },
      { name: '北辰数据', city: '北京' },
    ])
    .execute();
  await db
    .insert(User)
    .values([
      { name: '林晓', age: 29, companyId: 1, joinedAt: '2023-03-14' },
      { name: '周航', age: 34, companyId: 1, joinedAt: '2022-07-01' },
      { name: '陈默', age: 41, companyId: 2, joinedAt: '2021-11-20' },
      { name: '苏宁', age: 26, companyId: 2, joinedAt: '2024-02-08' },
      { name: '方圆', age: null, companyId: 3, joinedAt: '2024-09-30' },
      { name: '顾言', age: 17, companyId: null, joinedAt: '2025-01-12' },
    ])
    .execute();
  await db
    .insert(Post)
    .values([
      { authorId: 1, title: '隐式 join 是怎么生成的', status: 'published', views: 1280 },
      { authorId: 1, title: '把 N+1 查询改成一条', status: 'published', views: 860 },
      { authorId: 2, title: '分库分表的路由设计', status: 'published', views: 2140 },
      { authorId: 3, title: '从 MySQL 迁到 PostgreSQL', status: 'published', views: 3320 },
      { authorId: 3, title: '窗口函数入门', status: 'draft', views: 0 },
      { authorId: 4, title: '二级缓存的一致性', status: 'published', views: 640 },
    ])
    .execute();
  await db
    .insert(Comment)
    .values([
      { postId: 1, authorId: 2, body: '终于看懂了别名的规则' },
      { postId: 1, authorId: 3, body: '多层导航也是这样吗' },
      { postId: 3, authorId: 1, body: '按月分表时怎么裁剪' },
      { postId: 4, authorId: 2, body: '踩过同样的坑' },
      { postId: 4, authorId: 4, body: '类型映射那段很有用' },
      { postId: 4, authorId: 5, body: '求一份迁移清单' },
      { postId: 6, authorId: 1, body: '延迟双删的时间怎么定' },
    ])
    .execute();
  await db
    .insert(Tag)
    .values([{ name: 'ORM' }, { name: 'PostgreSQL' }, { name: '架构' }, { name: '缓存' }])
    .execute();
  await db
    .insert(PostTag)
    .values([
      { postId: 1, tagId: 1 },
      { postId: 2, tagId: 1 },
      { postId: 3, tagId: 3 },
      { postId: 4, tagId: 2 },
      { postId: 4, tagId: 3 },
      { postId: 5, tagId: 2 },
      { postId: 6, tagId: 4 },
      { postId: 6, tagId: 3 },
    ])
    .execute();
}
