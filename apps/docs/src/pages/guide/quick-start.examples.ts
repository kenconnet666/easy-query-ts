/** 快速开始的示例 */
import { example } from '../../site/example.ts';
import { Company, Post } from '../../site/model.ts';

export const firstQuery = example((db) =>
  db
    .queryable(Post)
    .where((p) => [
      p.status.eq('published'),
      p.views.ge(1000),
    ])
    .orderBy((p) => p.views.desc())
    .select((p) => ({
      title: p.title,
      views: p.views,
      author: p.author.name,
    }))
    .toList(),
);

export const tree = example((db) =>
  db
    .queryable(Company)
    .where((c) =>
      c.users.any((u) =>
        u.posts.any((p) => p.views.ge(2000)),
      ),
    )
    .select((c) => ({
      name: c.name,
      authors: c.users.count(),
      users: c.users
        .orderBy((u) => u.id)
        .toList((u) => ({
          name: u.name,
          posts: u.posts.count(),
        })),
    }))
    .toList(),
);
