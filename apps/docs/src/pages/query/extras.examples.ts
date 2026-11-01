/** JSON、计算属性、复用查询、值对象几章新增的示例 */
import {
  defineScope,
  parseTableRequest,
  type Query,
} from '@zerodep-dev/easy-query-ts';
import { example } from '../../site/example.ts';
import {
  Comment,
  Post,
  Profile,
  Shop,
  User,
} from '../../site/model.ts';

// ---- JSON

export const jsonReadWhole = example((db) =>
  db
    .queryable(Profile)
    .where((p) => p.userId.eq(1))
    .first(),
);

export const jsonOrderBy = example((db) =>
  db
    .queryable(Profile)
    .orderBy((p) => p.skills.jsonLength().desc())
    .select((p) => ({
      name: p.user.name,
      skills: p.skills.jsonLength(),
    }))
    .toList(),
);

export const jsonHasIndex = example((db) =>
  db
    .queryable(Profile)
    .where((p) => p.skills.jsonHas(2))
    .select((p) => ({
      name: p.user.name,
      third: p.skills.jsonText(2),
    }))
    .toList(),
);

export const jsonAppend = example(async (db) => {
  await db
    .update(Profile)
    .set((p) => ({
      skills: p.skills.jsonAppend([], 'Rust'),
    }))
    .where((p) => p.userId.eq(1))
    .execute();

  return db.queryable(Profile).findOrThrow(1);
});

export const jsonSetItem = example(async (db) => {
  await db
    .update(Profile)
    .set((p) => ({
      skills: p.skills.jsonSet([0], 'PostgreSQL'),
    }))
    .where((p) => p.userId.eq(1))
    .execute();

  return db.queryable(Profile).findOrThrow(1);
});

export const jsonRemoveItem = example(async (db) => {
  await db
    .update(Profile)
    .set((p) => ({ skills: p.skills.jsonRemove(0) }))
    .where((p) => p.userId.eq(1))
    .execute();

  return db.queryable(Profile).findOrThrow(1);
});

// ---- 计算属性

export const computedInGroup = example((db) =>
  db
    .queryable(User)
    .groupBy((u) => ({ stage: u.stage }))
    .select((g) => ({
      stage: g.key.stage,
      users: g.count(),
    }))
    .toList(),
);

export const computedInNavigation = example((db) =>
  db
    .queryable(Post)
    .where((p) => p.author.postCount.ge(2))
    .select((p) => ({
      title: p.title,
      author: p.author.label,
    }))
    .toList(),
);

export const computedInTree = example((db) =>
  db
    .queryable(Comment)
    .where((c) => c.postId.eq(4))
    .select((c) => ({
      body: c.body,
      by: c.author.label,
      stage: c.author.stage,
    }))
    .toList(),
);

export const computedPage = example((db) =>
  db
    .queryable(User)
    .where((u) => u.postCount.ge(1))
    .orderBy((u) => [u.postCount.desc(), u.id])
    .select((u) => ({
      label: u.label,
      posts: u.postCount,
    }))
    .toPage(1, 3),
);

export const computedSortRequest = example((db) =>
  db
    .queryable(User)
    .select((u) => ({
      label: u.label,
      posts: u.postCount,
    }))
    .table(
      parseTableRequest({
        sort: '-posts',
        pageSize: '2',
      }),
    ),
);

// ---- 复用

export const reuseSelect = example(async (db) => {
  // 公共部分存到变量，分页和导出共用
  const rows = db
    .queryable(Post)
    .where((p) => p.status.eq('published'))
    .orderBy((p) => p.views.desc())
    .select((p) => ({ title: p.title, views: p.views }));

  return {
    page: await rows.toPage(1, 2),
    top: await rows.first(),
  };
});

export const queryFunction = example(async (db) => {
  // 返回还没执行的查询：调用方接着数、接着选列
  const searchPosts = (keyword?: string) =>
    db
      .queryable(Post)
      .where((p) => [
        p.status.eq('published'),
        keyword && p.title.like(keyword),
      ]);

  return {
    count: await searchPosts('缓存').count(),
    titles: await searchPosts('缓存')
      .select((p) => p.title)
      .toList(),
  };
});

export const reuseAsSubquery = example((db) => {
  const hotAuthors: Query<number> = db
    .queryable(Post)
    .where((p) => p.views.ge(2000))
    .select((p) => p.authorId);

  return db
    .queryable(Comment)
    .where((c) => c.authorId.in(hotAuthors))
    .select((c) => c.body)
    .toList();
});

export const scopeTwoArgs = example((db) => {
  const inCompanies = defineScope<
    { companyId: number | null },
    [ids: number[]]
  >((row, ids) => row.companyId.in(ids));

  return db
    .queryable(User)
    .apply(inCompanies, [1, 2])
    .select((u) => u.name)
    .toList();
});

export const scopeAndMore = example((db) => {
  const inCompanies = defineScope<
    { companyId: number | null },
    [ids: number[]]
  >((row, ids) => row.companyId.in(ids));

  return db
    .queryable(User)
    .apply(inCompanies, [1])
    .where((u) => u.age.ge(30))
    .orderBy((u) => u.age.desc())
    .select((u) => ({ name: u.name, age: u.age }))
    .toList();
});

export const prepareSeveral = example(async (db) => {
  const byStatus = db.prepare(
    (p: { status: 'draft' | 'published' }) =>
      db
        .queryable(Post)
        .where((q) => q.status.eq(p.status))
        .select((q) => q.title),
  );

  return {
    sql: byStatus.sql,
    drafts: await byStatus.toList({ status: 'draft' }),
  };
});

// ---- 值对象

export const embedUpdatePart = example(async (db) => {
  await db
    .update(Shop)
    .set({ address: { street: '学院路 1 号' } })
    .where((s) => s.id.eq(2))
    .execute();

  return db.queryable(Shop).find(2);
});

export const embedUpdateExpr = example(async (db) => {
  await db
    .update(Shop)
    .set((s) => ({
      name: s.name.concat('（', s.address.city, '）'),
    }))
    .where((s) => s.id.eq(1))
    .execute();

  return db.queryable(Shop).find(1);
});

export const embedTable = example((db) =>
  db
    .queryable(Shop)
    .select((s) => ({
      name: s.name,
      city: s.address.city,
    }))
    .table(
      parseTableRequest({
        'filter.city': ['杭州'],
        sort: 'name',
      }),
    ),
);

export const embedWholeObject = example((db) =>
  db
    .queryable(Shop)
    .where((s) => s.id.eq(3))
    .select((s) => ({
      name: s.name,
      address: s.address,
    }))
    .first(),
);

export const embedSave = example((db) =>
  db.save(Shop, {
    id: 1,
    address: {
      city: '杭州',
      street: '黄龙路 2 号',
      geo: { lat: 30.27, lng: 120.15 },
    },
  }),
);

export const embedDdl = example((db) =>
  db.createTablesSql(Shop),
);
