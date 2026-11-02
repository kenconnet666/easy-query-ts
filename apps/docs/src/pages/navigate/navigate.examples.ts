/** 导航与对象树的示例 */
import { defineView } from '@zerodep-dev/easy-query-ts';
import { example } from '../../site/example.ts';
import {
  Category,
  Comment,
  Company,
  Department,
  Post,
  Profile,
  schema,
  Tag,
  User,
} from '../../site/model.ts';

// ---- 一对多里取一条

export const oneOfMany = example((db) =>
  db
    .queryable(User)
    .where((u) => u.posts.any())
    .orderBy((u) => u.id)
    .select((u) => ({
      name: u.name,
      latest: u.latestPost.title,
      top: u.topPost.title,
      topViews: u.topPost.views,
    }))
    .limit(5)
    .toList(),
);

export const oneOfManyWhere = example((db) =>
  db
    .queryable(User)
    .where((u) => u.topPost.views.ge(2000))
    .orderBy((u) => u.topPost.views.desc())
    .select((u) => ({
      name: u.name,
      top: u.topPost.title,
      views: u.topPost.views,
    }))
    .toList(),
);

export const oneOfManyRow = example((db) =>
  db
    .queryable(User)
    .where((u) => u.id.le(2))
    .orderBy((u) => u.id)
    .select((u) => ({
      name: u.name,
      latestPost: u.latestPost,
    }))
    .toList(),
);

// ---- 对一

export const toOne = example((db) =>
  db
    .queryable(User)
    .select((u) => ({
      name: u.name,
      company: u.company.name,
    }))
    .toList(),
);

export const required = example((db) =>
  db
    .queryable(Profile)
    .select((p) => ({
      name: p.user.name,
      bio: p.bio,
    }))
    .toList(),
);

export const oneToOne = example((db) =>
  db
    .queryable(User)
    .where((u) => u.profile.website.isNotNull())
    .select((u) => ({
      name: u.name,
      bio: u.profile.bio,
      website: u.profile.website,
    }))
    .toList(),
);

export const reverseOne = example((db) =>
  db
    .queryable(Profile)
    .where((p) => p.user.company.city.eq('杭州'))
    .select((p) => ({
      name: p.user.name,
      bio: p.bio,
    }))
    .toList(),
);

export const multiLevel = example((db) =>
  db
    .queryable(Post)
    .where((p) => p.author.company.city.eq('杭州'))
    .orderBy((p) => p.author.name)
    .select((p) => ({
      title: p.title,
      author: p.author.name,
      company: p.author.company.name,
      category: p.category.parent.name,
    }))
    .toList(),
);

export const selfManager = example((db) =>
  db
    .queryable(User)
    .where((u) => u.manager.manager.name.eq('周航'))
    .select((u) => ({
      name: u.name,
      manager: u.manager.name,
      managersManager: u.manager.manager.name,
    }))
    .toList(),
);

// ---- 对多

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

export const nestedAny = example((db) =>
  db
    .queryable(Company)
    .where((c) =>
      c.users.any((u) =>
        u.posts.any((p) =>
          p.tags.any((t) => t.name.eq('架构')),
        ),
      ),
    )
    .select((c) => c.name)
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
      best: u.posts.max((p) => p.views),
    }))
    .limit(3)
    .toList(),
);

export const conditionalCount = example((db) =>
  db
    .queryable(User)
    .where((u) => u.posts.any())
    .select((u) => ({
      name: u.name,
      published: u.posts.count((p) =>
        p.status.eq('published'),
      ),
      drafts: u.posts.count((p) => p.status.eq('draft')),
    }))
    .toList(),
);

export const groupJoin = example((db) =>
  db
    .queryable(User)
    .where((u) => u.posts.any())
    .select((u) => ({
      name: u.name,
      posts: u.posts.groupJoin().count(),
      views: u.posts.groupJoin().sum((p) => p.views),
    }))
    .toList(),
);

export const fixedCondition = example((db) =>
  db
    .queryable(User)
    .where((u) => u.hotPosts.any())
    .select((u) => ({
      name: u.name,
      hot: u.hotPosts.count(),
    }))
    .toList(),
);

// ---- 多对多

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

export const reverseManyToMany = example((db) =>
  db
    .queryable(Tag)
    .orderBy((t) => t.posts.count().desc())
    .select((t) => ({
      name: t.name,
      posts: t.posts.count(),
    }))
    .toList(),
);

export const selfManyToMany = example((db) =>
  db
    .queryable(User)
    .where((u) => u.followers.count().ge(2))
    .select((u) => ({
      name: u.name,
      followers: u.followers.count(),
      following: u.following.toList((f) => f.name),
    }))
    .toList(),
);

export const mutual = example((db) =>
  db
    .queryable(User)
    .where((u) =>
      u.following.any((f) => f.company.city.eq('上海')),
    )
    .select((u) => u.name)
    .toList(),
);

// ---- 直达关系

export const path = example((db) =>
  db
    .queryable(Company)
    .select((c) => ({
      name: c.name,
      posts: c.posts.count(),
      views: c.posts.sum((p) => p.views),
    }))
    .toList(),
);

export const pathProducts = example((db) =>
  db
    .queryable(User)
    .where((u) => u.orders.any())
    .select((u) => ({
      name: u.name,
      products: u.products.toList((p) => p.name),
    }))
    .toList(),
);

// ---- 取第几个、去重计数、全是多对一的直达

export const nthChild = example((db) =>
  db
    .queryable(User)
    .where((u) => u.posts.any())
    .select((u) => ({
      name: u.name,
      top: u.posts.orderBy((p) => p.views.desc()).at(0)
        .title,
    }))
    .toList(),
);

export const nthInWhere = example((db) =>
  db
    .queryable(User)
    .where((u) =>
      u.posts
        .orderBy((p) => p.views.desc())
        .at(0)
        .views.ge(2000),
    )
    .select((u) => u.name)
    .toList(),
);

export const countDistinctNav = example((db) =>
  db
    .queryable(User)
    .where((u) => u.posts.any())
    .select((u) => ({
      name: u.name,
      categories: u.posts.countDistinct(
        (p) => p.categoryId,
      ),
    }))
    .toList(),
);

export const pathOne = example((db) =>
  db
    .queryable(User)
    .where((u) => u.departmentId.isNotNull())
    .select((u) => ({
      name: u.name,
      company: u.departmentCompany.name,
    }))
    .limit(3)
    .toList(),
);

// ---- 按键填充

export const fillManyRows = example((db) =>
  db
    .queryable(Company)
    .where((c) => c.id.le(2))
    .select((c) => ({
      name: c.name,
      departments: db
        .queryable(Department)
        .orderBy((d) => d.id)
        .select((d) => ({ name: d.name }))
        .fillMany((d) => d.companyId, c.id),
    }))
    .toList(),
);

export const fillOneRow = example((db) =>
  db
    .queryable(Post)
    .where((p) => p.id.le(3))
    .select((p) => ({
      title: p.title,
      category: db
        .queryable(Category)
        .fillOne((c) => c.id, p.categoryId),
    }))
    .toList(),
);

// ---- 对象树

export const treeOneLevel = example((db) =>
  db
    .queryable(Company)
    .select((c) => ({
      name: c.name,
      users: c.users.toList((u) => u.name),
    }))
    .toList(),
);

export const tree = example((db) =>
  db
    .queryable(Company)
    .where((c) => c.users.any())
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

export const limitPerParent = example((db) =>
  db
    .queryable(User)
    .where((u) => u.posts.any())
    .select((u) => ({
      name: u.name,
      latest: u.posts
        .orderBy((p) => p.id.desc())
        .limit(1)
        .toList((p) => p.title),
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

export const deepTree = example((db) =>
  db
    .queryable(Post)
    .where((p) => p.id.eq(4))
    .select((p) => ({
      title: p.title,
      author: p.author.name,
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

export const orderTree = example((db) =>
  db
    .queryable(User)
    .where((u) => u.orders.any())
    .select((u) => ({
      name: u.name,
      orders: u.orders
        .orderBy((o) => o.id)
        .toList((o) => ({
          status: o.status,
          items: o.items.toList((i) => ({
            product: i.product.name,
            quantity: i.quantity,
            price: i.price,
          })),
        })),
    }))
    .toList(),
);

// ---- 视图

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

// ---- 树形数据

export const descendants = example((db) =>
  db
    .descendantsOf(Department, 1, {
      parent: (d) => d.parentId,
    })
    .orderBy((d) => d.id)
    .select((d) => d.name)
    .toList(),
);

export const ancestors = example((db) =>
  db
    .ancestorsOf(Department, 4, {
      parent: (d) => d.parentId,
      self: false,
    })
    .select((d) => d.name)
    .toList(),
);

export const toTree = example((db) =>
  db
    .queryable(Category)
    .orderBy((c) => c.id)
    .select((c) => ({
      id: c.id,
      parentId: c.parentId,
      name: c.name,
      posts: c.posts.count(),
    }))
    .toTree({ id: 'id', parent: 'parentId' }),
);

export const commentThread = example((db) =>
  db
    .queryable(Comment)
    .where((c) => c.postId.eq(4))
    .orderBy((c) => c.id)
    .select((c) => ({
      id: c.id,
      parentId: c.parentId,
      body: c.body,
      by: c.author.name,
    }))
    .toTree({
      id: 'id',
      parent: 'parentId',
      children: 'replies',
    }),
);
