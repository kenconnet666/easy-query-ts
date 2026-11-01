/** 显式 join 一章的示例 */
import { sql } from '@zerodep-dev/easy-query-ts';
import { example } from '../../site/example.ts';
import {
  Company,
  Doc,
  Follow,
  Order,
  Post,
  Tag,
  User,
} from '../../site/model.ts';

// ---- 四种 join

export const innerJoin = example((db) =>
  db
    .queryable(User)
    .innerJoin(Post, (u, p) => p.authorId.eq(u.id))
    .where((_u, p) => p.views.ge(2000))
    .select((u, p) => ({ name: u.name, title: p.title }))
    .toList(),
);

export const wholeRows = example((db) =>
  db
    .queryable(User)
    .innerJoin(Post, (u, p) => p.authorId.eq(u.id))
    .where((_u, p) => p.views.ge(3000))
    .toList(),
);

export const leftJoin = example((db) =>
  db
    .queryable(Company)
    .leftJoin(User, (c, u) => u.companyId.eq(c.id))
    .orderBy((c, u) => [c.id, u.id])
    .select((c, u) => ({
      company: c.name,
      user: u.name,
    }))
    .toList(),
);

export const antiJoin = example((db) =>
  db
    .queryable(Company)
    .leftJoin(User, (c, u) => u.companyId.eq(c.id))
    .where((_c, u) => u.id.isNull())
    .select((c) => c.name)
    .toList(),
);

export const rightJoin = example((db) =>
  db
    .queryable(User)
    .rightJoin(Company, (u, c) => c.id.eq(u.companyId))
    .orderBy((u, c) => [c.id, u.id])
    .select((u, c) => ({
      user: u.name,
      company: c.name,
    }))
    .toList(),
);

export const crossJoin = example((db) =>
  db
    .queryable(Company)
    .crossJoin(Tag)
    .where((c, t) => [c.id.le(2), t.id.le(2)])
    .select((c, t) => ({ company: c.name, tag: t.name }))
    .toList(),
);

// ---- 条件

export const onConditions = example((db) =>
  db
    .queryable(User)
    .leftJoin(Post, (u, p) => [
      p.authorId.eq(u.id),
      p.views.ge(2000),
    ])
    .orderBy((u) => u.id)
    .select((u, p) => ({ name: u.name, hot: p.title }))
    .toList(),
);

export const whereConditions = example((db) =>
  db
    .queryable(User)
    .leftJoin(Post, (u, p) => p.authorId.eq(u.id))
    .where((_u, p) => p.views.ge(2000))
    .orderBy((u) => u.id)
    .select((u, p) => ({ name: u.name, hot: p.title }))
    .toList(),
);

export const threeTables = example((db) =>
  db
    .queryable(Order)
    .innerJoin(User, (o, u) => u.id.eq(o.userId))
    .leftJoin(Company, (_o, u, c) => c.id.eq(u.companyId))
    .where((o) => o.status.eq('paid'))
    .select((o, u, c) => ({
      order: o.id,
      user: u.name,
      company: c.name,
    }))
    .toList(),
);

export const noRelation = example((db) =>
  db
    .queryable(Doc)
    .leftJoin(User, (d, u) => u.name.eq(d.createdBy))
    .select((d, u) => ({
      title: d.title,
      author: u.name,
      level: u.level,
    }))
    .toList(),
);

// ---- 同一张表 join 多次

export const selfJoin = example((db) =>
  db
    .queryable(User)
    .innerJoin(User, (u, manager) =>
      manager.id.eq(u.managerId),
    )
    .orderBy((u) => u.id)
    .select((u, manager) => ({
      name: u.name,
      manager: manager.name,
    }))
    .toList(),
);

export const sameTableTwice = example((db) =>
  db
    .queryable(Follow)
    .innerJoin(User, (f, fan) => fan.id.eq(f.followerId))
    .innerJoin(User, (f, _fan, star) =>
      star.id.eq(f.followeeId),
    )
    .where((_f, _fan, star) => star.name.eq('陈默'))
    .select((_f, fan, star) => ({
      fan: fan.name,
      star: star.name,
    }))
    .toList(),
);

// ---- join 子查询

export const joinSubquery = example((db) => {
  const stats = db
    .queryable(Post)
    .groupBy((p) => ({ authorId: p.authorId }))
    .select((g) => ({
      authorId: g.key.authorId,
      posts: g.count(),
      views: g.sum((p) => p.views),
    }));

  return db
    .queryable(User)
    .leftJoin(stats, (u, s) => s.authorId.eq(u.id))
    .orderBy((u) => u.id)
    .select((u, s) => ({
      name: u.name,
      posts: s.posts,
      views: s.views,
    }))
    .toList();
});

// ---- join 之后

export const joinNavigation = example((db) =>
  db
    .queryable(User)
    .innerJoin(Post, (u, p) => p.authorId.eq(u.id))
    .where((_u, p) => p.views.ge(2000))
    .select((u, p) => ({
      name: u.name,
      company: u.company.name,
      title: p.title,
      category: p.category.name,
    }))
    .toList(),
);

export const joinGroup = example((db) =>
  db
    .queryable(Company)
    .innerJoin(User, (c, u) => u.companyId.eq(c.id))
    .innerJoin(Post, (_c, u, p) => p.authorId.eq(u.id))
    .groupBy((c) => ({ company: c.name }))
    .select((g) => ({
      company: g.key.company,
      posts: g.count(),
      views: g.sum((_c, _u, p) => p.views),
    }))
    .toList(),
);

export const joinPage = example((db) =>
  db
    .queryable(User)
    .innerJoin(Post, (u, p) => p.authorId.eq(u.id))
    .orderBy((_u, p) => p.views.desc())
    .select((u, p) => ({ name: u.name, title: p.title }))
    .toPage(1, 3),
);

// ---- 别名

export const rawAlias = example((db) =>
  db
    .queryable(User)
    .innerJoin(
      Post,
      (u, p) => sql<boolean>`${p.authorId} = ${u.id}`,
    )
    .where((_u, p) => sql<boolean>`${p.views} % 2 = 0`)
    .select((u, p) => ({ name: u.name, title: p.title }))
    .toList(),
);
