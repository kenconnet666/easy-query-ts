/** 分组、窗口、子查询、CTE 几章新增的示例 */
import { sql, win } from '@zerodep-dev/easy-query-ts';
import { example } from '../../site/example.ts';
import {
  Category,
  Comment,
  Department,
  Order,
  OrderItem,
  Post,
  User,
} from '../../site/model.ts';

// ---- 分组

export const groupMultiKey = example((db) =>
  db
    .queryable(Post)
    .groupBy((p) => ({
      author: p.author.name,
      status: p.status,
    }))
    .orderBy((g) => [g.key.author, g.key.status])
    .select((g) => ({
      author: g.key.author,
      status: g.key.status,
      posts: g.count(),
    }))
    .limit(5)
    .toList(),
);

export const groupWholeTable = example((db) =>
  db
    .queryable(Post)
    .groupBy(() => ({}))
    .select((g) => ({
      posts: g.count(),
      views: g.sum((p) => p.views),
      average: g.avg((p) => p.views),
      latest: g.max((p) => p.publishedAt),
    }))
    .first(),
);

export const groupCountIf = example((db) =>
  db
    .queryable(Post)
    .groupBy((p) => ({ author: p.author.name }))
    .select((g) => ({
      author: g.key.author,
      published: g.count((p) => p.status.eq('published')),
      drafts: g.count((p) => p.status.eq('draft')),
    }))
    .toList(),
);

export const groupDistinct = example((db) =>
  db
    .queryable(Comment)
    .groupBy((c) => ({ post: c.post.title }))
    .select((g) => ({
      post: g.key.post,
      comments: g.count(),
      people: g.countDistinct((c) => c.authorId),
    }))
    .toList(),
);

export const groupOrder = example((db) =>
  db
    .queryable(Post)
    .groupBy((p) => ({ category: p.category.name }))
    .orderBy((g) => g.sum((p) => p.views).desc())
    .select((g) => ({
      category: g.key.category,
      views: g.sum((p) => p.views),
    }))
    .limit(3)
    .toList(),
);

export const joiningOptions = example((db) =>
  db
    .queryable(Post)
    .where((p) => p.authorId.in([1, 3, 7]))
    .groupBy((p) => ({ author: p.author.name }))
    .select((g) => ({
      author: g.key.author,
      titles: g.joining((p) => p.title, {
        separator: ' / ',
        orderBy: (p) => p.views.desc(),
      }),
    }))
    .toList(),
);

export const havingMany = example((db) =>
  db
    .queryable(OrderItem)
    .groupBy((i) => ({ order: i.orderId }))
    .having((g) => [
      g.count().ge(2),
      g.sum((i) => i.price.times(i.quantity)).ge('300'),
    ])
    .select((g) => ({
      order: g.key.order,
      items: g.count(),
      total: g.sum((i) => i.price.times(i.quantity)),
    }))
    .toList(),
);

export const groupThenFilter = example((db) =>
  db
    .queryable(Post)
    .groupBy((p) => ({ authorId: p.authorId }))
    .select((g) => ({
      authorId: g.key.authorId,
      views: g.sum((p) => p.views),
    }))
    .asTable()
    .where((t) => t.views.ge(2000))
    .orderBy((t) => t.views.desc())
    .toPage(1, 2),
);

export const groupByYearMonth = example((db) =>
  db
    .queryable(Order)
    .where((o) => o.status.ne('cancelled'))
    .groupBy((o) => ({
      year: o.createdAt.year(),
      month: o.createdAt.month(),
    }))
    .orderBy((g) => [g.key.year, g.key.month])
    .select((g) => ({
      year: g.key.year,
      month: g.key.month,
      orders: g.count(),
    }))
    .toList(),
);

// ---- 窗口

export const rankCompare = example((db) =>
  db
    .queryable(Comment)
    .where((c) => c.likes.ge(5))
    .select((c) => ({
      city: c.author.company.city,
      likes: c.likes,
      rowNumber: win.rowNumber((w) =>
        w.orderBy(c.author.company.city.asc()),
      ),
      rank: win.rank((w) =>
        w.orderBy(c.author.company.city.asc()),
      ),
      denseRank: win.denseRank((w) =>
        w.orderBy(c.author.company.city.asc()),
      ),
    }))
    .toList(),
);

export const runningTotal = example((db) =>
  db
    .queryable(Order)
    .where((o) => o.status.ne('cancelled'))
    .select((o) => ({
      id: o.id,
      user: o.user.name,
      runningCount: win.count(o.id, (w) =>
        w.orderBy(o.createdAt),
      ),
      total: win.count(o.id),
    }))
    .toList(),
);

export const shareOfTotal = example((db) =>
  db
    .queryable(Post)
    .where((p) => p.authorId.in([1, 3, 7]))
    .select((p) => ({
      title: p.title,
      views: p.views,
      authorTotal: win.sum(p.views, (w) =>
        w.partitionBy(p.authorId),
      ),
      allTotal: win.sum(p.views),
    }))
    .toList(),
);

export const movingAverage = example((db) =>
  db
    .queryable(Post)
    .where((p) => p.status.eq('published'))
    .select((p) => ({
      title: p.title,
      views: p.views,
      // 当前行和前面两行的平均
      moving: win.avg(p.views, (w) =>
        w
          .orderBy(p.publishedAt)
          .rows({ preceding: 2 }, 'currentRow'),
      ),
    }))
    .toList(),
);

export const lagLead = example((db) =>
  db
    .queryable(Post)
    .where((p) => p.status.eq('published'))
    .select((p) => ({
      title: p.title,
      views: p.views,
      previous: win.lag(p.views, (w) =>
        w.orderBy(p.publishedAt),
      ),
      next: win.lead(p.views, (w) =>
        w.orderBy(p.publishedAt),
      ),
    }))
    .limit(4)
    .toList(),
);

export const firstLast = example((db) =>
  db
    .queryable(Post)
    .where((p) => p.status.eq('published'))
    .select((p) => ({
      title: p.title,
      author: p.author.name,
      best: win.firstValue(p.title, (w) =>
        w.partitionBy(p.authorId).orderBy(p.views.desc()),
      ),
      // lastValue 要写窗口范围：默认只到当前行
      worst: win.lastValue(p.title, (w) =>
        w
          .partitionBy(p.authorId)
          .orderBy(p.views.desc())
          .rows('unboundedPreceding', 'unboundedFollowing'),
      ),
    }))
    .limit(4)
    .toList(),
);

export const topThreePerAuthor = example((db) =>
  db
    .queryable(Comment)
    .select((c) => ({
      post: c.post.title,
      body: c.body,
      likes: c.likes,
      rank: win.rowNumber((w) =>
        w.partitionBy(c.postId).orderBy(c.likes.desc()),
      ),
    }))
    .asTable()
    .where((t) => t.rank.le(2))
    .orderBy((t) => [t.post, t.rank])
    .select((t) => ({
      post: t.post,
      body: t.body,
      likes: t.likes,
    }))
    .toList(),
);

// ---- 子查询

export const notInSubquery = example((db) =>
  db
    .queryable(User)
    .where((u) =>
      u.id.notIn(
        db.queryable(Post).select((p) => p.authorId),
      ),
    )
    .select((u) => u.name)
    .toList(),
);

export const subqueryWithNavigation = example((db) =>
  db
    .queryable(Post)
    .where((p) =>
      p.authorId.in(
        db
          .queryable(User)
          .where((u) => u.company.city.eq('杭州'))
          .select((u) => u.id),
      ),
    )
    .select((p) => p.title)
    .toList(),
);

export const scalarInSelect = example((db) => {
  const maxViews = db
    .queryable(Post)
    .groupBy(() => ({}))
    .select((g) => g.max((p) => p.views));

  return db
    .queryable(Post)
    .where((p) => p.views.ge(2000))
    .select((p) => ({
      title: p.title,
      views: p.views,
      gap: p.views.minus(maxViews),
    }))
    .toList();
});

export const derivedPage = example((db) =>
  db
    .queryable(Post)
    .select((p) => ({
      title: p.title,
      comments: p.comments.count(),
    }))
    .asTable()
    .where((t) => t.comments.ge(1))
    .orderBy((t) => t.comments.desc())
    .toPage(1, 2),
);

export const limitThenSort = example((db) =>
  db
    .queryable(Post)
    .orderBy((p) => p.views.desc())
    .limit(3)
    .select((p) => ({ title: p.title, views: p.views }))
    .asTable()
    .orderBy((t) => t.views)
    .toList(),
);

export const unionAllRows = example((db) =>
  db
    .queryable(Post)
    .select((p) => ({
      kind: sql<string>`'帖子'`,
      text: p.title,
      by: p.authorId,
    }))
    .unionAll(
      db.queryable(Comment).select((c) => ({
        kind: sql<string>`'评论'`,
        text: c.body,
        by: c.authorId,
      })),
    )
    .where((r) => r.by.eq(1))
    .orderBy((r) => r.text)
    .toList(),
);

export const unionPage = example((db) =>
  db
    .queryable(User)
    .where((u) => u.age.lt(25))
    .select((u) => ({ name: u.name }))
    .union(
      db
        .queryable(User)
        .where((u) => u.level.eq('lead'))
        .select((u) => ({ name: u.name })),
    )
    .orderBy((r) => r.name)
    .toPage(1, 3),
);

// ---- CTE

export const cteAggregate = example((db) => {
  const withStats = db.with(
    'stats',
    db
      .queryable(Post)
      .groupBy((p) => ({ authorId: p.authorId }))
      .select((g) => ({
        authorId: g.key.authorId,
        views: g.sum((p) => p.views),
      })),
  );

  return withStats
    .queryable(User)
    .leftJoin(withStats.entity('stats'), (u, s) =>
      s.authorId.eq(u.id),
    )
    .orderBy((u) => u.id)
    .select((u, s) => ({ name: u.name, views: s.views }))
    .limit(5)
    .toList();
});

export const cteChain = example((db) => {
  const withHot = db.with(
    'hot',
    db
      .queryable(Post)
      .where((p) => p.views.ge(1000))
      .select((p) => ({
        id: p.id,
        authorId: p.authorId,
      })),
  );
  const withAuthors = withHot.with(
    'authors',
    withHot
      .queryable(withHot.entity('hot'))
      .groupBy((h) => ({ authorId: h.authorId }))
      .select((g) => ({
        authorId: g.key.authorId,
        hot: g.count(),
      })),
  );

  return withAuthors
    .queryable(withAuthors.entity('authors'))
    .orderBy((a) => a.hot.desc())
    .toList();
});

export const recursiveUp = example((db) => {
  // 从基础架构小组往上找：起点是自己，每一步找上级
  const chain = db.withRecursive(
    'chain',
    db
      .queryable(Department)
      .where((d) => d.id.eq(4))
      .select((d) => ({
        id: d.id,
        parentId: d.parentId,
        name: d.name,
      })),
    (rdb, self) =>
      rdb
        .queryable(Department)
        .innerJoin(self, (d, t) => d.id.eq(t.parentId))
        .select((d) => ({
          id: d.id,
          parentId: d.parentId,
          name: d.name,
        })),
  );

  return chain.queryable(chain.entity('chain')).toList();
});

export const recursivePath = example((db) => {
  // 递归时把路径拼起来
  const tree = db.withRecursive(
    'tree',
    db
      .queryable(Category)
      .where((c) => c.parentId.isNull())
      .select((c) => ({
        id: c.id,
        name: c.name,
        path: c.name.cast('string'),
      })),
    (rdb, self) =>
      rdb
        .queryable(Category)
        .innerJoin(self, (c, t) => c.parentId.eq(t.id))
        .select((c, t) => ({
          id: c.id,
          name: c.name,
          path: t.path.concat(' / ', c.name),
        })),
  );

  return tree
    .queryable(tree.entity('tree'))
    .orderBy((t) => t.path)
    .select((t) => t.path)
    .toList();
});

export const recursiveReports = example((db) => {
  // 周航的全部下属，和每个人的层级
  const team = db.withRecursive(
    'team',
    db
      .queryable(User)
      .where((u) => u.id.eq(2))
      .select((u) => ({
        id: u.id,
        name: u.name,
        depth: sql<number>`0`,
      })),
    (rdb, self) =>
      rdb
        .queryable(User)
        .innerJoin(self, (u, t) => u.managerId.eq(t.id))
        .select((u, t) => ({
          id: u.id,
          name: u.name,
          depth: t.depth.plus(1),
        })),
  );

  return team
    .queryable(team.entity('team'))
    .orderBy((t) => [t.depth, t.id])
    .toList();
});
