/** 查询一章的示例 */
import { or } from '@zerodep-dev/easy-query-ts';
import { example } from '../../site/example.ts';
import { Company, Post, User } from '../../site/model.ts';

export const filter = example((db) =>
  db
    .queryable(User)
    .where((u) => [u.age.ge(18), u.name.startsWith('林')])
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

export const orCondition = example((db) =>
  db
    .queryable(User)
    .where((u) => or(u.age.lt(18), u.age.isNull()))
    .toList(),
);

export const sortPage = example((db) =>
  db
    .queryable(Post)
    .where((p) => p.status.eq('published'))
    .orderBy((p) => [p.views.desc(), p.id])
    .toPage(1, 3),
);

export const implicitJoin = example((db) =>
  db
    .queryable(User)
    .where((u) => u.company.city.eq('杭州'))
    .select((u) => ({
      name: u.name,
      company: u.company.name,
    }))
    .toList(),
);

export const implicitSubquery = example((db) =>
  db
    .queryable(Company)
    .where((c) => c.users.any((u) => u.age.lt(30)))
    .select((c) => ({
      name: c.name,
      staff: c.users.count(),
    }))
    .toList(),
);

export const objectTree = example((db) =>
  db
    .queryable(Company)
    .select((c) => ({
      name: c.name,
      users: c.users
        .orderBy((u) => u.id)
        .toList((u) => ({ id: u.id, name: u.name })),
    }))
    .toList(),
);
