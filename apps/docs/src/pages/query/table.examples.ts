/** 列表页查询的示例 */
import { parseTableRequest } from '@zerodep-dev/easy-query-ts';
import { example } from '../../site/example.ts';
import { Post, User } from '../../site/model.ts';

export const filterBy = example(async (db) => {
  // 查询栏提交上来的表单：没填的跳过
  const form = { keyword: '迁移', minViews: 1000 };

  return db
    .queryable(Post)
    .filterBy(form, {
      keyword: {
        op: 'like',
        column: (p) => [p.title, p.author.name],
      },
      minViews: { op: 'ge', column: (p) => p.views },
    })
    .select((p) => ({ title: p.title, views: p.views }))
    .toList();
});

export const range = example((db) =>
  db
    .queryable(User)
    .filterBy(
      { age: [18, 30] as const },
      { age: { op: 'between', column: (u) => u.age } },
    )
    .select((u) => ({ name: u.name, age: u.age }))
    .toList(),
);

export const sortBy = example(async (db) => {
  // 前端传来的排序：减号是倒序；没登记的名字直接报错
  const sort = '-views';

  return db
    .queryable(Post)
    .sortBy(sort, {
      views: (p) => p.views,
      author: (p) => p.author.name,
    })
    .select((p) => ({ title: p.title, views: p.views }))
    .limit(3)
    .toList();
});

export const table = example(async (db) => {
  // GET /posts?page=1&pageSize=2&sort=-views&filter.status=published&search.author=林
  const request = parseTableRequest(
    new URLSearchParams(
      'page=1&pageSize=2&sort=-views&filter.status=published&search.author=林',
    ),
  );

  return db
    .queryable(Post)
    .select((p) => ({
      id: p.id,
      title: p.title,
      status: p.status,
      views: p.views,
      author: p.author.name,
    }))
    .table(request);
});

export const whitelist = example(async (db) => {
  const request = parseTableRequest({
    sort: '-views',
    'filter.status': ['published'],
  });

  return db
    .queryable(Post)
    .select((p) => ({
      title: p.title,
      status: p.status,
      views: p.views,
    }))
    .table(request, {
      filterable: ['status'],
      sortable: ['views'],
    });
});
