/** 基础查询的示例：从查一行到动态条件 */
import { and, not, or } from '@zerodep-dev/easy-query-ts';
import { example } from '../../site/example.ts';
import { OrderItem, Post, User } from '../../site/model.ts';

export const all = example((db) =>
  db.queryable(User).limit(3).toList(),
);

export const find = example((db) =>
  db.queryable(User).find(1),
);

export const whereKey = example((db) =>
  db
    .queryable(User)
    .whereKey(2)
    .select((u) => u.name)
    .first(),
);

export const whereKeys = example((db) =>
  db
    .queryable(User)
    .whereKeys([1, 2, 3])
    .select((u) => u.name)
    .toList(),
);

export const compositeKey = example((db) =>
  db
    .queryable(OrderItem)
    .whereKey({ orderId: 1, productId: 6 })
    .first(),
);

export const rootAggregates = example(async (db) => {
  const published = db
    .queryable(Post)
    .where((p) => p.status.eq('published'));

  return {
    total: await published.sum((p) => p.views),
    average: await published.avg((p) => p.views),
    top: await published.max((p) => p.views),
    bottom: await published.min((p) => p.views),
    authors: await published.countDistinct(
      (p) => p.authorId,
    ),
  };
});

export const notInList = example((db) =>
  db
    .queryable(User)
    .where((u) => u.level.notIn(['lead']))
    .select((u) => u.name)
    .limit(3)
    .toList(),
);

export const nullSafe = example((db) => {
  const expected: number | null = null;

  return db
    .queryable(User)
    .where((u) => u.age.eqNullSafe(expected))
    .select((u) => u.name)
    .toList();
});

export const orElse = example((db) =>
  db
    .queryable(User)
    .where((u) => u.id.in([5, 6]))
    .select((u) => ({
      name: u.name,
      age: u.age.orElse(0),
    }))
    .toList(),
);

export const pickColumns = example((db) =>
  db
    .queryable(User)
    .where((u) => u.companyId.eq(1))
    .select((u) => ({ name: u.name, age: u.age }))
    .toList(),
);

export const oneColumn = example((db) =>
  db
    .queryable(User)
    .where((u) => u.level.eq('lead'))
    .select((u) => u.name)
    .toList(),
);

export const count = example((db) =>
  db
    .queryable(Post)
    .where((p) => p.status.eq('published'))
    .count(),
);

export const exists = example((db) =>
  db
    .queryable(User)
    .where((u) => u.age.lt(18))
    .any(),
);

export const first = example((db) =>
  db
    .queryable(Post)
    .orderBy((p) => p.views.desc())
    .select((p) => ({ title: p.title, views: p.views }))
    .first(),
);

export const distinct = example((db) =>
  db
    .queryable(Post)
    .select((p) => p.status)
    .distinct()
    .toList(),
);

export const filter = example((db) =>
  db
    .queryable(User)
    .where((u) => [u.age.ge(18), u.name.startsWith('林')])
    .toList(),
);

export const operators = example((db) =>
  db
    .queryable(Post)
    .where((p) => [
      p.views.between(500, 2000),
      p.authorId.in([1, 2, 7]),
      not(p.title.like('组件')),
      p.publishedAt.isNotNull(),
    ])
    .select((p) => ({ title: p.title, views: p.views }))
    .toList(),
);

export const orCondition = example((db) =>
  db
    .queryable(User)
    .where((u) => or(u.age.lt(18), u.age.isNull()))
    .toList(),
);

export const nested = example((db) =>
  db
    .queryable(Post)
    .where((p) =>
      and(
        p.status.eq('published'),
        or(
          p.views.ge(2000),
          and(p.views.ge(500), p.title.like('缓存')),
        ),
        not(p.authorId.eq(9)),
      ),
    )
    .select((p) => ({ title: p.title, views: p.views }))
    .toList(),
);

export const dynamic = example(async (db) => {
  // 页面上的筛选条件：没填的是 undefined
  const keyword = '林' as string | undefined;
  const minAge = undefined as number | undefined;

  return db
    .queryable(User)
    .where((u) => [
      keyword && u.name.startsWith(keyword),
      minAge && u.age.ge(minAge),
    ])
    .toList();
});

export const sort = example((db) =>
  db
    .queryable(User)
    .orderBy((u) => [u.level.desc(), u.age.asc(), u.id])
    .select((u) => ({
      name: u.name,
      level: u.level,
      age: u.age,
    }))
    .toList(),
);

export const limitOffset = example((db) =>
  db
    .queryable(Post)
    .orderBy((p) => p.id)
    .offset(4)
    .limit(3)
    .select((p) => ({ id: p.id, title: p.title }))
    .toList(),
);

export const sortPage = example((db) =>
  db
    .queryable(Post)
    .where((p) => p.status.eq('published'))
    .orderBy((p) => [p.views.desc(), p.id])
    .select((p) => ({ title: p.title, views: p.views }))
    .toPage(2, 3),
);
