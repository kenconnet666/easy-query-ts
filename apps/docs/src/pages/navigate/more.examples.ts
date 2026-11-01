/** 导航几章新增的示例 */
import {
  defineView,
  type ViewOf,
} from '@zerodep-dev/easy-query-ts';
import { example } from '../../site/example.ts';
import {
  Category,
  Comment,
  Company,
  Department,
  Order,
  Post,
  Product,
  schema,
  Tag,
  User,
} from '../../site/model.ts';

// ---- 对一

export const toOneWhere = example((db) =>
  db
    .queryable(User)
    .where((u) => u.company.city.eq('杭州'))
    .select((u) => u.name)
    .toList(),
);

export const toOneOrder = example((db) =>
  db
    .queryable(User)
    .where((u) => u.companyId.isNotNull())
    .orderBy((u) => [u.company.city, u.name])
    .select((u) => ({
      city: u.company.city,
      name: u.name,
    }))
    .toList(),
);

export const toOneJoinedOnce = example((db) =>
  db
    .queryable(User)
    .where((u) => u.company.city.ne('北京'))
    .orderBy((u) => u.company.name)
    .select((u) => ({
      company: u.company.name,
      city: u.company.city,
    }))
    .distinct()
    .toList(),
);

export const toOneNullCheck = example((db) =>
  db
    .queryable(User)
    .where((u) => u.company.id.isNull())
    .select((u) => u.name)
    .toList(),
);

export const toOneGroup = example((db) =>
  db
    .queryable(User)
    .groupBy((u) => ({ city: u.company.city }))
    .select((g) => ({
      city: g.key.city.orElse('没有公司'),
      users: g.count(),
    }))
    .toList(),
);

export const toOneWholeRow = example((db) =>
  db
    .queryable(User)
    .where((u) => u.id.eq(1))
    .select((u) => ({
      name: u.name,
      company: u.company,
      department: u.department,
    }))
    .first(),
);

export const deepSelfRelation = example((db) =>
  db
    .queryable(Department)
    .where((d) => d.parentId.isNotNull())
    .select((d) => ({
      name: d.name,
      parent: d.parent.name,
      grandparent: d.parent.parent.name,
      company: d.company.name,
    }))
    .toList(),
);

export const commentChain = example((db) =>
  db
    .queryable(Comment)
    .where((c) => c.parentId.isNotNull())
    .select((c) => ({
      body: c.body,
      by: c.author.name,
      replyTo: c.parent.author.name,
      post: c.post.title,
      postAuthorCompany: c.post.author.company.name,
    }))
    .toList(),
);

// ---- 对多

export const anyWithoutFilter = example((db) =>
  db
    .queryable(User)
    .where((u) => u.posts.any())
    .select((u) => u.name)
    .toList(),
);

export const allChildren = example((db) =>
  db
    .queryable(User)
    .where((u) => [
      u.posts.any(),
      u.posts.all((p) => p.status.eq('published')),
    ])
    .select((u) => u.name)
    .toList(),
);

export const noneWithFilter = example((db) =>
  db
    .queryable(User)
    .where((u) => [
      u.posts.any(),
      u.posts.none((p) => p.views.ge(1000)),
    ])
    .select((u) => u.name)
    .toList(),
);

export const aggregateInWhere = example((db) =>
  db
    .queryable(User)
    .where((u) => u.posts.sum((p) => p.views).ge(2000))
    .select((u) => ({
      name: u.name,
      views: u.posts.sum((p) => p.views),
    }))
    .toList(),
);

export const allAggregates = example((db) =>
  db
    .queryable(Post)
    .where((p) => p.comments.any())
    .select((p) => ({
      title: p.title,
      comments: p.comments.count(),
      likes: p.comments.sum((c) => c.likes),
      average: p.comments.avg((c) => c.likes),
      most: p.comments.max((c) => c.likes),
      least: p.comments.min((c) => c.likes),
    }))
    .toList(),
);

export const whereThenAggregate = example((db) =>
  db
    .queryable(User)
    .where((u) => u.posts.any())
    .select((u) => ({
      name: u.name,
      hot: u.posts.where((p) => p.views.ge(1000)).count(),
      top: u.posts
        .where((p) => p.status.eq('published'))
        .max((p) => p.views),
    }))
    .toList(),
);

export const joiningChildren = example((db) =>
  db
    .queryable(User)
    .where((u) => u.posts.any())
    .select((u) => ({
      name: u.name,
      titles: u.posts.joining((p) => p.title, {
        separator: '、',
        orderBy: (p) => p.id,
      }),
    }))
    .toList(),
);

export const childOfChild = example((db) =>
  db
    .queryable(User)
    .where((u) =>
      u.posts.any((p) =>
        p.comments.any((c) => c.likes.ge(15)),
      ),
    )
    .select((u) => u.name)
    .toList(),
);

export const navigationInChild = example((db) =>
  db
    .queryable(Company)
    .where((c) =>
      c.users.any((u) => u.department.name.eq('后端组')),
    )
    .select((c) => c.name)
    .toList(),
);

export const groupJoinWhere = example((db) =>
  db
    .queryable(User)
    .where((u) => u.posts.any())
    .select((u) => ({
      name: u.name,
      published: u.posts
        .where((p) => p.status.eq('published'))
        .groupJoin()
        .count(),
      views: u.posts
        .where((p) => p.status.eq('published'))
        .groupJoin()
        .sum((p) => p.views),
    }))
    .toList(),
);

// ---- 多对多

export const countTags = example((db) =>
  db
    .queryable(Post)
    .where((p) => p.tags.count().ge(2))
    .select((p) => ({
      title: p.title,
      tags: p.tags.count(),
    }))
    .toList(),
);

export const tagsFiltered = example((db) =>
  db
    .queryable(Post)
    .where((p) => [
      p.tags.any((t) => t.name.eq('架构')),
      p.tags.none((t) => t.name.eq('缓存')),
    ])
    .select((p) => p.title)
    .toList(),
);

export const tagCloud = example((db) =>
  db
    .queryable(Tag)
    .where((t) => t.posts.any())
    .orderBy((t) => t.posts.sum((p) => p.views).desc())
    .select((t) => ({
      name: t.name,
      posts: t.posts.count(),
      views: t.posts.sum((p) => p.views),
      topPost: t.posts
        .orderBy((p) => p.views.desc())
        .first((p) => p.title),
    }))
    .toList(),
);

export const mutualFollow = example((db) =>
  db
    .queryable(User)
    .where((u) => u.followers.any())
    .select((u) => ({
      name: u.name,
      followers: u.followers
        .orderBy((f) => f.id)
        .toList((f) => ({
          name: f.name,
          company: f.company.name,
        })),
    }))
    .limit(3)
    .toList(),
);

export const orderProducts = example((db) =>
  db
    .queryable(Order)
    .where((o) => o.products.any((p) => p.price.ge('999')))
    .select((o) => ({
      id: o.id,
      products: o.products.toList((p) => p.name),
    }))
    .toList(),
);

// ---- 直达关系

export const pathWhere = example((db) =>
  db
    .queryable(User)
    .where((u) =>
      u.products.any((p) => p.name.eq('数据库实战课')),
    )
    .select((u) => u.name)
    .toList(),
);

export const pathAggregate = example((db) =>
  db
    .queryable(User)
    .where((u) => u.orders.any())
    .orderBy((u) => u.products.count().desc())
    .select((u) => ({
      name: u.name,
      kinds: u.products.count(),
      priciest: u.products.max((p) => p.price),
    }))
    .toList(),
);

export const pathTree = example((db) =>
  db
    .queryable(Company)
    .where((c) => c.posts.any())
    .select((c) => ({
      name: c.name,
      best: c.posts
        .orderBy((p) => p.views.desc())
        .limit(2)
        .toList((p) => ({
          title: p.title,
          views: p.views,
        })),
    }))
    .toList(),
);

// ---- 对象树

export const wholeChildren = example((db) =>
  db
    .queryable(Category)
    .where((c) => c.id.eq(2))
    .select((c) => ({
      name: c.name,
      children: c.children.toList(),
    }))
    .toList(),
);

export const includeChildren = example((db) =>
  db
    .queryable(User)
    .where((u) => u.id.eq(1))
    .include((u) => ({
      company: u.company,
      posts: u.posts.toList(),
    }))
    .first(),
);

export const includeThenFilter = example((db) =>
  db
    .queryable(Company)
    .where((c) => c.id.le(2))
    .include((c) => ({
      staff: c.users.count(),
      seniors: c.users
        .where((u) => u.level.ne('junior'))
        .orderBy((u) => u.id)
        .toList((u) => u.name),
    }))
    .toList(),
);

export const countsInTree = example((db) =>
  db
    .queryable(Company)
    .where((c) => c.users.any())
    .select((c) => ({
      name: c.name,
      users: c.users.toList((u) => ({
        name: u.name,
        company: u.company.city,
        posts: u.posts.count(),
        best: u.posts.max((p) => p.views),
      })),
    }))
    .toList(),
);

export const oneInTree = example((db) =>
  db
    .queryable(User)
    .where((u) => u.profile.bio.isNotNull())
    .limit(3)
    .select((u) => ({
      name: u.name,
      profile: u.profile,
    }))
    .toList(),
);

export const firstWholeRow = example((db) =>
  db
    .queryable(Post)
    .where((p) => p.comments.any())
    .limit(2)
    .select((p) => ({
      title: p.title,
      topComment: p.comments
        .orderBy((c) => c.likes.desc())
        .first(),
    }))
    .toList(),
);

export const treeFourLevels = example((db) =>
  db
    .queryable(Company)
    .where((c) => c.id.eq(1))
    .select((c) => ({
      company: c.name,
      departments: c.departments
        .where((d) => d.parentId.isNull())
        .toList((d) => ({
          name: d.name,
          children: d.children.toList((child) => ({
            name: child.name,
            users: child.users.toList((u) => ({
              name: u.name,
              posts: u.posts.toList((p) => p.title),
            })),
          })),
        })),
    }))
    .first(),
);

export const treeWithPage = example((db) =>
  db
    .queryable(Post)
    .where((p) => p.status.eq('published'))
    .orderBy((p) => p.views.desc())
    .select((p) => ({
      title: p.title,
      author: p.author.name,
      tags: p.tags.toList((t) => t.name),
      topComments: p.comments
        .orderBy((c) => c.likes.desc())
        .limit(2)
        .toList((c) => c.body),
    }))
    .toPage(1, 2),
);

// ---- 视图

export const viewList = example((db) => {
  const ProductCard = defineView(schema, Product, (p) => ({
    name: p.name,
    price: p.price,
    sold: p.items.sum((i) => i.quantity),
  }));

  return db
    .queryable(Product)
    .select(ProductCard)
    .limit(2)
    .toList();
});

export const viewWhere = example((db) => {
  const ProductCard = defineView(schema, Product, (p) => ({
    name: p.name,
    price: p.price,
    sold: p.items.sum((i) => i.quantity),
  }));

  return db
    .queryable(Product)
    .where((p) => p.price.ge('199'))
    .orderBy((p) => p.price.desc())
    .select(ProductCard)
    .toPage(1, 2);
});

export const viewFirst = example((db) => {
  const ProductCard = defineView(schema, Product, (p) => ({
    name: p.name,
    price: p.price,
    sold: p.items.sum((i) => i.quantity),
  }));

  return db
    .queryable(Product)
    .whereKey(3)
    .select(ProductCard)
    .first();
});

export const viewInNavigation = example((db) => {
  const Tagged = defineView(schema, Tag, (t) => ({
    tag: t.name,
  }));

  return db
    .queryable(Post)
    .where((p) => p.id.eq(4))
    .select((p) => ({
      title: p.title,
      tags: p.tags.toList(Tagged),
    }))
    .first();
});

export const viewReturnType = example(async (db) => {
  const ProductCard = defineView(schema, Product, (p) => ({
    name: p.name,
    price: p.price,
    sold: p.items.sum((i) => i.quantity),
  }));
  type Card = ViewOf<typeof ProductCard>;

  // 接口的返回值类型直接用形状，不用另写一个类
  const cards: Card[] = await db
    .queryable(Product)
    .select(ProductCard)
    .limit(1)
    .toList();
  return cards;
});

export const viewThreeLevels = example((db) => {
  const CommentCard = defineView(schema, Comment, (c) => ({
    body: c.body,
    by: c.author.name,
  }));
  const PostCard = defineView(schema, Post, (p) => ({
    title: p.title,
    comments: p.comments
      .orderBy((c) => c.likes.desc())
      .limit(1)
      .toList(CommentCard),
  }));
  const AuthorCard = defineView(schema, User, (u) => ({
    name: u.name,
    posts: u.posts.toList(PostCard),
  }));

  return db
    .queryable(User)
    .whereKeys([1, 3])
    .select(AuthorCard)
    .toList();
});

// ---- 树形数据

export const descendantsWhere = example((db) =>
  db
    .descendantsOf(Department, 1, {
      parent: (d) => d.parentId,
    })
    .where((d) => d.id.ne(1))
    .select((d) => ({
      name: d.name,
      staff: d.users.count(),
    }))
    .toList(),
);

export const descendantUsers = example((db) => {
  const team = db
    .descendantsOf(Department, 1, {
      parent: (d) => d.parentId,
    })
    .select((d) => d.id);

  return db
    .queryable(User)
    .where((u) => u.departmentId.in(team))
    .select((u) => ({
      name: u.name,
      department: u.department.name,
    }))
    .toList();
});

export const ancestorsWithSelf = example((db) =>
  db
    .ancestorsOf(Category, 4, {
      parent: (c) => c.parentId,
    })
    .select((c) => ({ id: c.id, name: c.name }))
    .toList(),
);

export const orgChart = example((db) =>
  db
    .queryable(Department)
    .where((d) => d.companyId.eq(1))
    .orderBy((d) => d.id)
    .select((d) => ({
      id: d.id,
      parentId: d.parentId,
      name: d.name,
      staff: d.users.count(),
    }))
    .toTree({ id: 'id', parent: 'parentId' }),
);

export const reportsTree = example((db) =>
  db
    .queryable(User)
    .where((u) => u.companyId.eq(1))
    .orderBy((u) => u.id)
    .select((u) => ({
      id: u.id,
      managerId: u.managerId,
      name: u.name,
    }))
    .toTree({
      id: 'id',
      parent: 'managerId',
      children: 'reports',
    }),
);

// ---- 按键填充

export const fillFiltered = example((db) =>
  db
    .queryable(User)
    .whereKeys([1, 7])
    .select((u) => ({
      name: u.name,
      hotPosts: db
        .queryable(Post)
        .where((p) => p.views.ge(1000))
        .orderBy((p) => p.views.desc())
        .select((p) => ({
          title: p.title,
          views: p.views,
        }))
        .fillMany((p) => p.authorId, u.id),
    }))
    .toList(),
);

export const fillWithTree = example((db) =>
  db
    .queryable(User)
    .whereKeys([3])
    .select((u) => ({
      name: u.name,
      posts: db
        .queryable(Post)
        .select((p) => ({
          title: p.title,
          tags: p.tags.toList((t) => t.name),
        }))
        .fillMany((p) => p.authorId, u.id),
    }))
    .toList(),
);

export const fillInclude = example((db) =>
  db
    .queryable(Order)
    .whereKeys([1, 3])
    .include((o) => ({
      buyer: db
        .queryable(User)
        .select((u) => ({
          name: u.name,
          level: u.level,
        }))
        .fillOne((u) => u.id, o.userId),
    }))
    .toList(),
);

export const fillMissing = example((db) =>
  db
    .queryable(User)
    .whereKeys([1, 6])
    .select((u) => ({
      name: u.name,
      company: db
        .queryable(Company)
        .select((c) => c.name)
        .fillOne((c) => c.id, u.companyId),
    }))
    .toList(),
);
