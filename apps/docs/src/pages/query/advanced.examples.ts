/** 分组、窗口、子查询一章的示例 */
import {
  caseWhen,
  sql,
  win,
} from '@zerodep-dev/easy-query-ts';
import { example } from '../../site/example.ts';
import { Post, User } from '../../site/model.ts';

export const group = example((db) =>
  db
    .queryable(Post)
    .groupBy((p) => ({ status: p.status }))
    .select((g) => ({
      status: g.key.status,
      posts: g.count(),
      views: g.sum((p) => p.views),
    }))
    .toList(),
);

export const having = example((db) =>
  db
    .queryable(Post)
    .groupBy((p) => ({ authorId: p.authorId }))
    .having((g) => g.count().ge(2))
    .select((g) => ({
      authorId: g.key.authorId,
      titles: g.joining((p) => p.title, {
        separator: '、',
      }),
    }))
    .toList(),
);

export const caseExpr = example((db) =>
  db
    .queryable(Post)
    .select((p) => ({
      title: p.title,
      level: caseWhen(p.views.ge(2000), '热门')
        .when(p.views.ge(500), '普通')
        .else('冷门'),
    }))
    .toList(),
);

export const window = example((db) =>
  db
    .queryable(Post)
    .where((p) => p.status.eq('published'))
    .select((p) => ({
      title: p.title,
      rank: win.rowNumber((w) =>
        w.partitionBy(p.authorId).orderBy(p.views.desc()),
      ),
      total: win.sum(p.views, (w) =>
        w.partitionBy(p.authorId),
      ),
    }))
    .toList(),
);

export const inSubquery = example((db) =>
  db
    .queryable(User)
    .where((u) =>
      u.id.in(
        db
          .queryable(Post)
          .where((p) => p.views.ge(2000))
          .select((p) => p.authorId),
      ),
    )
    .select((u) => u.name)
    .toList(),
);

export const union = example((db) =>
  db
    .queryable(User)
    .where((u) => u.age.lt(18))
    .select((u) => ({ name: u.name }))
    .union(
      db
        .queryable(User)
        .where((u) => u.age.gt(40))
        .select((u) => ({ name: u.name })),
    )
    .toList(),
);

export const rawFragment = example((db) =>
  db
    .queryable(Post)
    .where((p) => sql<boolean>`${p.views} % 2 = 0`)
    .select((p) => p.title)
    .toList(),
);
