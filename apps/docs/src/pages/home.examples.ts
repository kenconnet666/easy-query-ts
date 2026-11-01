/** 首页的示例 */
import { example } from '../site/example.ts';
import { Company } from '../site/model.ts';

export const hero = example((db) =>
  db
    .queryable(Company)
    .where((c) =>
      c.users.any((u) =>
        u.posts.any((p) => p.views.ge(2000)),
      ),
    )
    .select((c) => ({
      name: c.name,
      users: c.users
        .orderBy((u) => u.id)
        .toList((u) => ({
          name: u.name,
          posts: u.posts.count(),
        })),
    }))
    .toList(),
);
