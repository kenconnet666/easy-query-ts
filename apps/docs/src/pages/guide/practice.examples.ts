/** 完整例子：社区首页 */
import { caseWhen, win } from '@zerodep-dev/easy-query-ts';
import { example } from '../../site/example.ts';
import {
  Comment,
  Company,
  Department,
  OrderItem,
  Post,
  PostTag,
  User,
} from '../../site/model.ts';

export const feed = example((db) =>
  db
    .queryable(Post)
    .where((p) => p.status.eq('published'))
    .orderBy((p) => [p.views.desc(), p.id])
    .select((p) => ({
      id: p.id,
      title: p.title,
      views: p.views,
      author: p.author.name,
      company: p.author.company.name,
      comments: p.comments.count(),
      tags: p.tags.toList((t) => t.name),
    }))
    .toPage(1, 3),
);

export const detail = example((db) =>
  db
    .queryable(Post)
    .where((p) => p.id.eq(4))
    .select((p) => ({
      title: p.title,
      author: {
        name: p.author.name,
        city: p.author.company.city,
      },
      tags: p.tags.toList((t) => t.name),
      comments: p.comments
        .where((c) => c.parentId.isNull())
        .orderBy((c) => c.likes.desc())
        .toList((c) => ({
          body: c.body,
          by: c.author.name,
          replies: c.replies.toList((r) => ({
            body: r.body,
            by: r.author.name,
          })),
        })),
    }))
    .first(),
);

export const authorPage = example((db) =>
  db
    .queryable(User)
    .where((u) => u.id.eq(1))
    .select((u) => ({
      name: u.name,
      bio: u.profile.bio,
      skills: u.profile.skills,
      followers: u.followers.count(),
      posts: u.posts.count(),
      views: u.posts.sum((p) => p.views),
      latest: u.posts
        .orderBy((p) => p.id.desc())
        .limit(2)
        .toList((p) => ({
          title: p.title,
          views: p.views,
        })),
    }))
    .first(),
);

export const publish = example((db) =>
  db.transaction(async (tx) => {
    const id = Number(
      await tx
        .insert(Post)
        .values({
          authorId: 2,
          categoryId: 2,
          title: '写给新人的索引指南',
          status: 'published',
          views: 0,
        })
        .returnId(),
    );
    await tx
      .insert(PostTag)
      .values([
        { postId: id, tagId: 1 },
        { postId: id, tagId: 6 },
      ])
      .execute();
    await tx
      .insert(Comment)
      .values({
        postId: id,
        authorId: 1,
        body: '沙发',
        likes: 0,
      })
      .execute();
    return id;
  }),
);

export const ranking = example((db) =>
  db
    .queryable(User)
    .where((u) =>
      u.posts.any((p) => p.status.eq('published')),
    )
    .select((u) => {
      const views = u.posts.sum((p) => p.views).orElse(0);
      return {
        name: u.name,
        views,
        rank: win.rowNumber((w) => w.orderBy(views.desc())),
        level: caseWhen(views.ge(3000), '头部')
          .when(views.ge(1000), '活跃')
          .else('新人'),
      };
    })
    .toList(),
);

export const companyDashboard = example((db) =>
  db
    .queryable(Company)
    .select((c) => ({
      name: c.name,
      city: c.city,
      staff: c.users.count(),
      departments: c.departments.count(),
      posts: c.posts.count(),
      views: c.posts.sum((p) => p.views),
    }))
    .toList(),
);

export const orgChart = example((db) =>
  db
    .queryable(Department)
    .where((d) => [d.companyId.eq(1), d.parentId.isNull()])
    .select((d) => ({
      name: d.name,
      users: d.users.toList((u) => u.name),
      children: d.children.toList((c) => ({
        name: c.name,
        users: c.users.toList((u) => ({
          name: u.name,
          manager: u.manager.name,
        })),
      })),
    }))
    .toList(),
);

export const userOrders = example((db) =>
  db
    .queryable(User)
    .where((u) => u.id.eq(1))
    .select((u) => ({
      name: u.name,
      orders: u.orders
        .orderBy((o) => o.createdAt.desc())
        .toList((o) => ({
          status: o.status,
          createdAt: o.createdAt,
          items: o.items.toList((i) => ({
            product: i.product.name,
            quantity: i.quantity,
            subtotal: i.price.times(i.quantity),
          })),
        })),
    }))
    .first(),
);

export const revenue = example((db) =>
  db
    .queryable(OrderItem)
    .where((i) => i.order.status.in(['paid', 'shipped']))
    .groupBy((i) => ({
      city: i.order.user.company.city,
    }))
    .select((g) => ({
      city: g.key.city,
      items: g.sum((i) => i.quantity),
      revenue: g.sum((i) => i.price.times(i.quantity)),
      lines: g.count(),
    }))
    .toList(),
);
