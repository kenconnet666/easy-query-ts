/** 基础查询、条件、排序与分页几章新增的示例 */
import { and, not, or } from '@zerodep-dev/easy-query-ts';
import { example } from '../../site/example.ts';
import {
  Comment,
  Post,
  Product,
  User,
} from '../../site/model.ts';

// ---- 终结方法

export const firstMissing = example(async (db) => {
  const first = await db
    .queryable(User)
    .where((u) => u.name.eq('不存在的人'))
    .first();
  const found = await db.queryable(User).find(999);

  return {
    firstIsUndefined: first === undefined,
    foundIsUndefined: found === undefined,
  };
});

export const findThrows = example((db) =>
  db
    .queryable(User)
    .findOrThrow(999)
    .catch((error: Error) => error.name),
);

// ---- 选列

export const selectExpressions = example((db) =>
  db
    .queryable(Post)
    .where((p) => p.status.eq('published'))
    .select((p) => ({
      title: p.title.upper(),
      nextViews: p.views.plus(1),
      isHot: p.views.ge(2000),
    }))
    .limit(3)
    .toList(),
);

export const selectNested = example((db) =>
  db
    .queryable(Post)
    .limit(2)
    .select((p) => ({
      title: p.title,
      stats: { views: p.views, status: p.status },
      author: {
        name: p.author.name,
        company: p.author.company.name,
      },
    }))
    .toList(),
);

export const selectNavigationRow = example((db) =>
  db
    .queryable(Post)
    .where((p) => p.id.eq(1))
    .select((p) => ({ title: p.title, author: p.author }))
    .first(),
);

export const distinctRows = example((db) =>
  db
    .queryable(Post)
    .select((p) => ({
      authorId: p.authorId,
      status: p.status,
    }))
    .distinct()
    .orderBy((r) => r.authorId)
    .limit(4)
    .toList(),
);

// ---- 条件

export const whereChain = example((db) =>
  db
    .queryable(User)
    .where((u) => u.age.ge(18))
    .where((u) => u.companyId.eq(1))
    .select((u) => u.name)
    .toList(),
);

export const compareColumns = example((db) =>
  db
    .queryable(Comment)
    .where((c) => c.authorId.eq(c.post.authorId))
    .select((c) => ({ body: c.body, by: c.author.name }))
    .toList(),
);

export const likeFamily = example((db) =>
  db
    .queryable(Post)
    .where((p) =>
      or(
        p.title.like('缓存'),
        p.title.startsWith('把'),
        p.title.endsWith('入门'),
        p.title.like('sql', { ignoreCase: true }),
      ),
    )
    .select((p) => p.title)
    .toList(),
);

export const likeLiteral = example((db) =>
  db
    .queryable(Post)
    .where((p) => p.title.like('N+1'))
    .select((p) => p.title)
    .toList(),
);

export const notConditions = example((db) =>
  db
    .queryable(User)
    .where((u) => [
      not(u.level.eq('lead')),
      u.level.ne('junior'),
      u.name.notLike('林'),
      u.age.isNotNull(),
    ])
    .select((u) => ({ name: u.name, level: u.level }))
    .toList(),
);

export const orOfArrays = example((db) =>
  db
    .queryable(User)
    .where((u) =>
      or(
        [u.level.eq('lead'), u.age.ge(40)],
        [u.level.eq('junior'), u.age.lt(18)],
      ),
    )
    .select((u) => ({
      name: u.name,
      level: u.level,
      age: u.age,
    }))
    .toList(),
);

export const emptyIn = example(async (db) => {
  const ids: number[] = [];

  return db
    .queryable(User)
    .where((u) => u.id.in(ids))
    .count();
});

export const dynamicForm = example(async (db) => {
  // 接口收到的表单：填了关键字和状态，没填作者
  const form = {
    keyword: '缓存',
    status: 'published' as const,
    authorId: undefined as number | undefined,
    onlyHot: false,
  };

  return db
    .queryable(Post)
    .where((p) => [
      form.keyword && p.title.like(form.keyword),
      form.status && p.status.eq(form.status),
      form.authorId !== undefined &&
        p.authorId.eq(form.authorId),
      form.onlyHot && p.views.ge(2000),
    ])
    .select((p) => ({ title: p.title, views: p.views }))
    .toList();
});

export const dynamicOr = example((db) => {
  const keyword = '架构' as string | undefined;

  return db
    .queryable(Post)
    .where((p) =>
      and(
        p.status.eq('published'),
        keyword &&
          or(
            p.title.like(keyword),
            p.tags.any((t) => t.name.eq(keyword)),
          ),
      ),
    )
    .select((p) => p.title)
    .toList();
});

export const zeroTrap = example((db) => {
  const minViews = 0 as number | undefined;

  return db
    .queryable(Post)
    .where((p) => [
      // 0 是假值，minViews && ... 会把条件跳过；数字用 !== undefined
      minViews !== undefined && p.views.ge(minViews),
    ])
    .count();
});

// ---- 排序

export const orderByNavigation = example((db) =>
  db
    .queryable(Post)
    .orderBy((p) => [
      p.author.company.name.desc(),
      p.views.desc(),
    ])
    .select((p) => ({
      company: p.author.company.name,
      title: p.title,
    }))
    .limit(4)
    .toList(),
);

export const orderByExpression = example((db) =>
  db
    .queryable(Product)
    .orderBy((p) => p.price.times(p.stock).desc())
    .select((p) => ({
      name: p.name,
      value: p.price.times(p.stock),
    }))
    .limit(3)
    .toList(),
);

export const orderByCount = example((db) =>
  db
    .queryable(User)
    .orderBy((u) => [u.followers.count().desc(), u.id])
    .select((u) => ({
      name: u.name,
      followers: u.followers.count(),
    }))
    .limit(3)
    .toList(),
);

export const nullsLast = example((db) =>
  db
    .queryable(User)
    .orderBy((u) => [u.age.isNull().asc(), u.age.desc()])
    .select((u) => ({ name: u.name, age: u.age }))
    .toList(),
);

export const dynamicOrder = example((db) => {
  const sort = 'views' as 'views' | 'title';

  return db
    .queryable(Post)
    .orderBy((p) =>
      sort === 'views' ? p.views.desc() : p.title.asc(),
    )
    .select((p) => p.title)
    .limit(2)
    .toList();
});

// ---- 分页

export const pageEmpty = example((db) =>
  db
    .queryable(Post)
    .where((p) => p.views.ge(100000))
    .toPage(1, 10),
);

export const pageBeyond = example((db) =>
  db
    .queryable(Post)
    .orderBy((p) => p.id)
    .select((p) => p.id)
    .toPage(100, 10),
);

export const pageWithNavigation = example((db) =>
  db
    .queryable(Post)
    .where((p) => p.author.company.city.eq('杭州'))
    .orderBy((p) => p.id)
    .select((p) => ({
      title: p.title,
      author: p.author.name,
      comments: p.comments.count(),
    }))
    .toPage(1, 2),
);

export const pageWithTree = example((db) =>
  db
    .queryable(User)
    .where((u) => u.posts.any())
    .orderBy((u) => u.id)
    .select((u) => ({
      name: u.name,
      titles: u.posts.toList((p) => p.title),
    }))
    .toPage(1, 2),
);

export const cursorPage = example(async (db) => {
  // 接着上一页的最后一行往下取：排序后面自动补上主键，next 原样交给前端、下一页带回来
  const latest = db
    .queryable(Post)
    .orderBy((p) => p.views.desc())
    .select((p) => ({
      id: p.id,
      title: p.title,
      views: p.views,
    }));

  const first = await latest.toCursorPage({ size: 3 });
  const second = await latest.toCursorPage({
    size: 3,
    after: first.next,
  });
  return { first, second };
});
