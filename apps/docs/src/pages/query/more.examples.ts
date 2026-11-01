/** JSON 列、计算属性、复用查询的示例 */
import {
  defineScope,
  parseTableRequest,
} from '@zerodep-dev/easy-query-ts';
import { example } from '../../site/example.ts';
import {
  Comment,
  Post,
  Profile,
  User,
} from '../../site/model.ts';

// ---- JSON 列

export const jsonRead = example((db) =>
  db
    .queryable(Profile)
    .select((p) => ({
      name: p.user.name,
      skills: p.skills,
    }))
    .toList(),
);

export const jsonLength = example((db) =>
  db
    .queryable(Profile)
    .where((p) => p.skills.jsonLength().ge(2))
    .select((p) => ({
      name: p.user.name,
      count: p.skills.jsonLength(),
    }))
    .toList(),
);

export const jsonPath = example((db) =>
  db
    .queryable(Profile)
    .where((p) => p.skills.jsonText(0).eq('Vue'))
    .select((p) => ({
      name: p.user.name,
      first: p.skills.jsonText(0),
    }))
    .toList(),
);

export const jsonWrite = example((db) =>
  db
    .update(Profile)
    .set({ skills: ['SQL', 'TypeScript', 'Rust'] })
    .where((p) => p.userId.eq(1))
    .execute(),
);

// ---- 计算属性

export const computedSelect = example((db) =>
  db
    .queryable(User)
    .select((u) => ({
      label: u.label,
      stage: u.stage,
      posts: u.postCount,
    }))
    .toList(),
);

export const computedWhere = example((db) =>
  db
    .queryable(User)
    .where((u) => [u.stage.eq('成年'), u.postCount.ge(2)])
    .orderBy((u) => u.postCount.desc())
    .select((u) => ({ name: u.name, posts: u.postCount }))
    .toList(),
);

export const computedTable = example(async (db) => {
  const request = parseTableRequest({
    sort: '-posts',
    'filter.stage': ['成年'],
    pageSize: '3',
  });

  return db
    .queryable(User)
    .select((u) => ({
      name: u.name,
      stage: u.stage,
      posts: u.postCount,
    }))
    .table(request);
});

// ---- 复用

export const reuse = example(async (db) => {
  // 查询对象不可变：每一步都返回新的，同一段条件放心复用
  const published = db
    .queryable(Post)
    .where((p) => p.status.eq('published'));

  return {
    total: await published.count(),
    hot: await published
      .where((p) => p.views.ge(2000))
      .select((p) => p.title)
      .toList(),
    latest: await published
      .orderBy((p) => p.publishedAt.desc())
      .select((p) => p.title)
      .first(),
  };
});

export const scope = example(async (db) => {
  // 只依赖 authorId 一列：任何有这一列的实体都能用
  const writtenBy = defineScope<
    { authorId: number },
    [authorId: number]
  >((row, authorId) => row.authorId.eq(authorId));

  return {
    posts: await db
      .queryable(Post)
      .apply(writtenBy, 1)
      .select((p) => p.title)
      .toList(),
    comments: await db
      .queryable(Comment)
      .apply(writtenBy, 1)
      .select((c) => c.body)
      .toList(),
  };
});

export const prepare = example(async (db) => {
  // SQL 只渲染一次，之后每次只换参数
  const byAuthor = db.prepare((p: { author: number }) =>
    db
      .queryable(Post)
      .where((q) => q.authorId.eq(p.author))
      .select((q) => ({ title: q.title })),
  );

  return [
    await byAuthor.toList({ author: 1 }),
    await byAuthor.toList({ author: 3 }),
  ];
});
