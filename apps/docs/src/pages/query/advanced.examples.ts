/** 分组、窗口、子查询一章的示例 */
import {
  caseWhen,
  sql,
  win,
} from '@zerodep-dev/easy-query-ts';
import { example } from '../../site/example.ts';
import {
  Department,
  Order,
  OrderItem,
  Post,
  User,
} from '../../site/model.ts';

export const group = example((db) =>
  db
    .queryable(Post)
    .groupBy((p) => ({ status: p.status }))
    .select((g) => ({
      status: g.key.status,
      posts: g.count(),
    }))
    .toList(),
);

export const groupAggregates = example((db) =>
  db
    .queryable(Post)
    .where((p) => p.status.eq('published'))
    .groupBy((p) => ({ category: p.category.name }))
    .select((g) => ({
      category: g.key.category,
      posts: g.count(),
      total: g.sum((p) => p.views),
      average: g.avg((p) => p.views),
      top: g.max((p) => p.views),
    }))
    .toList(),
);

export const having = example((db) =>
  db
    .queryable(Post)
    .groupBy((p) => ({ author: p.author.name }))
    .having((g) => g.count().ge(2))
    .select((g) => ({
      author: g.key.author,
      titles: g.joining((p) => p.title, {
        separator: '、',
      }),
    }))
    .toList(),
);

export const salesByProduct = example((db) =>
  db
    .queryable(OrderItem)
    .where((i) => i.order.status.in(['paid', 'shipped']))
    .groupBy((i) => ({ product: i.product.name }))
    .having((g) => g.sum((i) => i.quantity).ge(2))
    .select((g) => ({
      product: g.key.product,
      sold: g.sum((i) => i.quantity),
      revenue: g.sum((i) => i.price.times(i.quantity)),
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

export const caseInGroup = example((db) =>
  db
    .queryable(Post)
    .groupBy((p) => ({
      level: caseWhen(p.views.ge(1000), '过千').else(
        '未过千',
      ),
    }))
    .select((g) => ({
      level: g.key.level,
      posts: g.count(),
    }))
    .toList(),
);

export const rowNumber = example((db) =>
  db
    .queryable(Post)
    .where((p) => p.status.eq('published'))
    .select((p) => ({
      title: p.title,
      rank: win.rowNumber((w) => w.orderBy(p.views.desc())),
    }))
    .toList(),
);

export const window = example((db) =>
  db
    .queryable(Post)
    .where((p) => p.status.eq('published'))
    .select((p) => ({
      author: p.author.name,
      title: p.title,
      rank: win.rowNumber((w) =>
        w.partitionBy(p.authorId).orderBy(p.views.desc()),
      ),
      total: win.sum(p.views, (w) =>
        w.partitionBy(p.authorId),
      ),
      previous: win.lag(p.views, (w) =>
        w.partitionBy(p.authorId).orderBy(p.id),
      ),
    }))
    .toList(),
);

export const topPerGroup = example((db) =>
  db
    .queryable(Post)
    .where((p) => p.status.eq('published'))
    .select((p) => ({
      title: p.title,
      authorId: p.authorId,
      views: p.views,
      rank: win.rowNumber((w) =>
        w.partitionBy(p.authorId).orderBy(p.views.desc()),
      ),
    }))
    .asTable()
    .where((t) => t.rank.eq(1))
    .select((t) => ({ title: t.title, views: t.views }))
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

export const scalar = example(async (db) => {
  const average = db
    .queryable(Post)
    .groupBy(() => ({}))
    .select((g) => g.avg((p) => p.views));

  return db
    .queryable(Post)
    .where((p) => p.views.gt(average))
    .select((p) => ({ title: p.title, views: p.views }))
    .toList();
});

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

export const cte = example(async (db) => {
  const withHot = db.with(
    'hot',
    db
      .queryable(Post)
      .where((p) => p.views.ge(1000))
      .select((p) => ({
        authorId: p.authorId,
        views: p.views,
      })),
  );

  return withHot
    .queryable(User)
    .innerJoin(withHot.entity('hot'), (u, h) =>
      h.authorId.eq(u.id),
    )
    .select((u, h) => ({ name: u.name, views: h.views }))
    .toList();
});

export const recursive = example(async (db) => {
  // 从研发部开始，一层层找到全部下级部门，记下深度
  const tree = db.withRecursive(
    'tree',
    db
      .queryable(Department)
      .where((d) => d.id.eq(1))
      .select((d) => ({
        id: d.id,
        name: d.name,
        depth: sql<number>`0`,
      })),
    (rdb, self) =>
      rdb
        .queryable(Department)
        .innerJoin(self, (d, t) => d.parentId.eq(t.id))
        .select((d, t) => ({
          id: d.id,
          name: d.name,
          depth: t.depth.plus(1),
        })),
  );

  return tree
    .queryable(tree.entity('tree'))
    .orderBy((t) => [t.depth, t.id])
    .toList();
});

export const groupByMonth = example((db) =>
  db
    .queryable(Order)
    .groupBy((o) => ({
      month: o.createdAt.dateTrunc('month'),
    }))
    .orderBy((g) => g.key.month)
    .select((g) => ({
      month: g.key.month,
      orders: g.count(),
    }))
    .toList(),
);

export const ntile = example((db) =>
  db
    .queryable(Post)
    .where((p) => p.status.eq('published'))
    .select((p) => ({
      title: p.title,
      views: p.views,
      tier: win.ntile(3, (w) => w.orderBy(p.views.desc())),
    }))
    .toList(),
);
