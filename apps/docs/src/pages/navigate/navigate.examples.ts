/** 导航一章的示例 */
import { defineView } from '@zerodep-dev/easy-query-ts';
import { example } from '../../site/example.ts';
import {
  Company,
  Post,
  schema,
  Tag,
  User,
} from '../../site/model.ts';

export const multiLevel = example((db) =>
  db
    .queryable(Post)
    .where((p) => p.author.company.city.eq('杭州'))
    .orderBy((p) => p.author.name)
    .select((p) => ({
      title: p.title,
      author: p.author.name,
      company: p.author.company.name,
    }))
    .toList(),
);

export const any = example((db) =>
  db
    .queryable(User)
    .where((u) => u.posts.any((p) => p.views.ge(2000)))
    .select((u) => u.name)
    .toList(),
);

export const none = example((db) =>
  db
    .queryable(User)
    .where((u) => u.posts.none())
    .select((u) => u.name)
    .toList(),
);

export const aggregates = example((db) =>
  db
    .queryable(User)
    .orderBy((u) => u.posts.sum((p) => p.views).desc())
    .select((u) => ({
      name: u.name,
      posts: u.posts.count(),
      views: u.posts.sum((p) => p.views),
    }))
    .limit(3)
    .toList(),
);

export const groupJoin = example((db) =>
  db
    .queryable(User)
    .select((u) => {
      const posts = u.posts.groupJoin();
      return {
        name: u.name,
        posts: posts.count(),
        views: posts.sum((p) => p.views),
      };
    })
    .toList(),
);

export const manyToMany = example((db) =>
  db
    .queryable(Post)
    .where((p) => p.tags.any((t) => t.name.eq('架构')))
    .select((p) => ({
      title: p.title,
      tags: p.tags.toList((t) => t.name),
    }))
    .toList(),
);

export const tree = example((db) =>
  db
    .queryable(Company)
    .select((c) => ({
      name: c.name,
      users: c.users
        .where((u) => u.age.ge(18))
        .orderBy((u) => u.id)
        .toList((u) => ({
          name: u.name,
          posts: u.posts
            .orderBy((p) => p.views.desc())
            .toList((p) => ({
              title: p.title,
              views: p.views,
            })),
        })),
    }))
    .toList(),
);

export const firstOfMany = example((db) =>
  db
    .queryable(User)
    .where((u) => u.posts.any())
    .select((u) => ({
      name: u.name,
      top: u.posts
        .orderBy((p) => p.views.desc())
        .first((p) => ({ title: p.title, views: p.views })),
    }))
    .toList(),
);

export const include = example((db) =>
  db
    .queryable(Tag)
    .select((t) => ({
      name: t.name,
      posts: t.posts.count(),
    }))
    .toList(),
);

export const view = example(async (db) => {
  const CompanyCard = defineView(schema, Company, (c) => ({
    name: c.name,
    staff: c.users.count(),
  }));

  return db.queryable(Company).select(CompanyCard).toList();
});

export const nestedView = example(async (db) => {
  const PostCard = defineView(schema, Post, (p) => ({
    title: p.title,
    views: p.views,
  }));
  const Author = defineView(schema, User, (u) => ({
    name: u.name,
    posts: u.posts.toList(PostCard),
  }));

  return db
    .queryable(User)
    .where((u) => u.posts.any())
    .select(Author)
    .toList();
});
