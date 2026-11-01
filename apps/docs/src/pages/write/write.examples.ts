/** 写入一章的示例 */
import { validators } from '@zerodep-dev/easy-query-ts';
import { example } from '../../site/example.ts';
import {
  Category,
  Comment,
  Company,
  Order,
  OrderItem,
  Post,
  Product,
  Tag,
  User,
} from '../../site/model.ts';

// ---- 插入

export const insertOne = example((db) =>
  db
    .insert(Company)
    .values({ name: '青石科技', city: '成都' })
    .returnId(),
);

export const returnEntity = example((db) =>
  db
    .insert(Tag)
    .values({ name: 'TypeScript' })
    .returnEntity(),
);

export const insertMany = example((db) =>
  db
    .insert(Tag)
    .values([{ name: 'TypeScript' }, { name: '性能' }])
    .execute(),
);

export const upsert = example((db) =>
  db
    .insert(Tag)
    .values({ id: 1, name: 'ORM 框架' })
    .onConflict((t) => t.id)
    .merge((t) => [t.name])
    .execute(),
);

export const insertIgnore = example((db) =>
  db
    .insert(Tag)
    .values({ id: 1, name: 'ORM 框架' })
    .onConflict((t) => t.id)
    .ignore()
    .execute(),
);

export const conditionalMerge = example((db) =>
  db
    .insert(Product)
    .values({
      id: 1,
      name: '年度会员',
      price: '259.00',
      stock: 1,
    })
    .onConflict((p) => p.id)
    .merge((p) => [p.price, p.stock], {
      onlyIf: (current, incoming) =>
        current.stock.lt(incoming.stock),
    })
    .execute(),
);

export const insertFromQuery = example((db) =>
  db
    .insert(Tag)
    .fromQuery(
      db
        .queryable(Category)
        .where((c) => c.parentId.isNull())
        .select((c) => ({ name: c.name })),
    )
    .execute(),
);

export const insertColumns = example((db) =>
  db
    .insert(User)
    .values(
      {
        name: '新同学',
        age: null,
        level: 'junior',
        joinedAt: '2026-01-05',
      },
      { columns: 'notNull' },
    )
    .execute(),
);

export const insertReturning = example((db) =>
  db
    .insert(Tag)
    .values([{ name: 'TypeScript' }, { name: '性能' }])
    .returning('id', 'name')
    .execute(),
);

// ---- 更新

export const updateReturning = example((db) =>
  db
    .update(Post)
    .set((p) => ({ views: p.views.plus(1) }))
    .where((p) => p.authorId.eq(1))
    .returning('id', 'views')
    .execute(),
);

export const updateColumns = example(async (db) => {
  const user = await db.queryable(User).findOrThrow(5);

  // 表单里没填的是 null：不写，保持原值
  return db
    .update(User)
    .entity(
      { ...user, name: '方圆圆', age: null },
      { columns: 'notNull' },
    )
    .execute();
});

export const updateLimit = example((db) =>
  db
    .update(Post)
    .set({ status: 'draft' })
    .where((p) => p.status.eq('published'))
    .orderBy((p) => p.views)
    .limit(2)
    .execute(),
);

export const updateSimple = example((db) =>
  db
    .update(User)
    .set({ age: 30 })
    .where((u) => u.id.eq(1))
    .execute(),
);

export const update = example((db) =>
  db
    .update(Post)
    .set((p) => ({ views: p.views.plus(1) }))
    .where((p) => p.id.eq(1))
    .execute(),
);

export const updateByNavigation = example((db) =>
  db
    .update(Post)
    .set({ status: 'draft' })
    .where((p) => p.author.company.city.eq('北京'))
    .execute(),
);

export const updateBySubquery = example((db) =>
  db
    .update(User)
    .set({ level: 'senior' })
    .where((u) => [
      u.level.eq('junior'),
      u.posts.any((p) => p.views.ge(500)),
    ])
    .execute(),
);

export const updateEntity = example(async (db) => {
  const user = await db.queryable(User).findOrThrow(1);

  return db
    .update(User)
    .entity({ ...user, age: 30 })
    .execute();
});

export const changes = example(async (db) => {
  const before = await db.queryable(User).findOrThrow(1);
  const after = { ...before, age: 30 };

  // 只更新变了的列
  return db.update(User).changes(before, after).execute();
});

export const batch = example(async (db) => {
  const rows = await db
    .queryable(Product)
    .where((p) => p.id.in([1, 2]))
    .toList();

  return db
    .update(Product)
    .entities(
      rows.map((p) => ({ ...p, stock: p.stock - 1 })),
    )
    .batch()
    .execute();
});

export const expectRows = example((db) =>
  db
    .update(Post)
    .set({ status: 'published' })
    .where((p) => [p.id.eq(5), p.status.eq('draft')])
    .expectRows(1, () => new Error('已经发布过了'))
    .execute(),
);

// ---- 删除

export const remove = example((db) =>
  db
    .delete(Post)
    .where((p) => [p.status.eq('draft'), p.views.eq(0)])
    .execute(),
);

export const removeByNavigation = example((db) =>
  db
    .delete(Comment)
    .where((c) => c.post.status.eq('draft'))
    .execute(),
);

export const removeTree = example((db) =>
  db.remove(Post, 6, {
    include: { comments: true },
  }),
);

export const removeReturning = example((db) =>
  db
    .delete(Comment)
    .where((c) => c.likes.le(2))
    .returning('id', 'body')
    .execute(),
);

export const removeInBatches = example(async (db) => {
  let total = 0;
  let removed = 0;

  // 每次只动前 3 行，循环到 0：大表分批删，不开长事务
  do {
    removed = await db
      .delete(Comment)
      .where((c) => c.likes.lt(10))
      .orderBy((c) => c.id)
      .limit(3)
      .execute();
    total += removed;
  } while (removed > 0);

  return total;
});

// ---- 聚合保存

export const saveByKey = example((db) =>
  db.save(
    Post,
    {
      id: 1,
      comments: [
        {
          authorId: 2,
          body: '终于看懂了别名的规则',
          likes: 99,
        },
        { authorId: 4, body: '收藏了', likes: 0 },
      ],
    },
    {
      include: {
        comments: { key: 'body', removed: 'keep' },
      },
    },
  ),
);

export const saveUnlink = example(async (db) => {
  await db.save(
    Company,
    { id: 3, users: [{ id: 5 }] },
    { include: { users: { removed: 'unlink' } } },
  );

  return db
    .queryable(User)
    .where((u) => u.id.in([5, 10]))
    .select((u) => ({
      name: u.name,
      companyId: u.companyId,
    }))
    .toList();
});

export const saveManyToOne = example((db) =>
  db.save(
    User,
    {
      id: 6,
      company: { name: '青石科技', city: '成都' },
    },
    { include: { company: true } },
  ),
);

export const save = example((db) =>
  db.save(
    User,
    {
      id: 8,
      name: '李雷',
      age: 26,
      level: 'junior',
      joinedAt: '2025-03-18',
      posts: [
        {
          id: 11,
          authorId: 8,
          categoryId: 3,
          title: '我的第一个开源组件（修订）',
          status: 'published',
          views: 180,
        },
      ],
    },
    { include: { posts: { removed: 'delete' } } },
  ),
);

export const saveNew = example((db) =>
  db.save(
    User,
    {
      name: '新同学',
      level: 'junior',
      joinedAt: '2026-01-05',
      profile: {
        bio: '刚入职',
        skills: ['SQL'],
      },
    },
    { include: { profile: true } },
  ),
);

export const saveManyToMany = example((db) =>
  db.save(
    Post,
    {
      id: 1,
      tags: [{ id: 1 }, { id: 6 }, { name: '查询优化' }],
    },
    { include: { tags: true } },
  ),
);

export const saveDeep = example((db) =>
  db.save(
    Order,
    {
      id: 7,
      items: [
        {
          orderId: 7,
          productId: 3,
          quantity: 2,
          price: '179.00',
        },
        {
          orderId: 7,
          productId: 1,
          quantity: 1,
          price: '299.00',
        },
      ],
    },
    { include: { items: { removed: 'delete' } } },
  ),
);

// ---- 事务

export const transaction = example((db) =>
  db.transaction(async (tx) => {
    const id = Number(
      await tx
        .insert(Company)
        .values({ name: '青石科技', city: '成都' })
        .returnId(),
    );
    await tx
      .update(User)
      .set({ companyId: id })
      .where((u) => u.companyId.isNull())
      .execute();
    return tx
      .queryable(User)
      .where((u) => u.companyId.eq(id))
      .count();
  }),
);

export const rollback = example(async (db) => {
  const before = await db.queryable(Company).count();

  const failed = await db
    .transaction(async (tx) => {
      await tx
        .insert(Company)
        .values({ name: '青石科技', city: '成都' })
        .execute();
      throw new Error('后面出错了');
    })
    .catch((error: Error) => error.message);

  return {
    failed,
    before,
    after: await db.queryable(Company).count(),
  };
});

export const placeOrder = example((db) =>
  db.transaction(async (tx) => {
    // 扣库存：库存不够时改不到行，整个事务回滚
    await tx
      .update(Product)
      .set((p) => ({ stock: p.stock.minus(1) }))
      .where((p) => [p.id.eq(5), p.stock.ge(1)])
      .expectRows(1, () => new Error('库存不足'))
      .execute();
    const orderId = Number(
      await tx
        .insert(Order)
        .values({
          userId: 1,
          status: 'pending',
          createdAt: new Date('2026-01-01T00:00:00Z'),
        })
        .returnId(),
    );
    await tx
      .insert(OrderItem)
      .values({
        orderId,
        productId: 5,
        quantity: 1,
        price: '1299.00',
      })
      .execute();
    return orderId;
  }),
);

export const afterCommit = example(async (db) => {
  const events: string[] = [];

  await db.transaction(async (tx) => {
    await tx
      .update(Post)
      .set({ status: 'published' })
      .where((p) => p.id.eq(5))
      .execute();
    tx.afterCommit(() => {
      events.push('提交了，发通知');
    });
    events.push('事务里');
  });

  return events;
});

export const lock = example((db) =>
  db.transaction(async (tx) => {
    const post = await tx
      .queryable(Post)
      .where((p) => p.id.eq(1))
      .forUpdate()
      .first();
    await tx
      .update(Post)
      .set({ views: (post?.views ?? 0) + 1 })
      .where((p) => p.id.eq(1))
      .execute();
  }),
);

export const nested = example((db) =>
  db.transaction(async (tx) => {
    await tx.insert(Tag).values({ name: '外层' }).execute();
    const failed = await tx
      .transaction(async (inner) => {
        await inner
          .insert(Tag)
          .values({ name: '内层' })
          .execute();
        throw new Error('内层出错了');
      })
      .catch((error: Error) => error.message);

    return {
      failed,
      tags: await tx
        .queryable(Tag)
        .where((t) => t.name.in(['外层', '内层']))
        .select((t) => t.name)
        .toList(),
    };
  }),
);

export const beginCommit = example(async (db) => {
  const tx = await db.begin();
  await tx
    .update(Post)
    .set({ status: 'published' })
    .where((p) => p.id.eq(5))
    .execute();
  await tx.commit();

  return db
    .queryable(Post)
    .where((p) => p.id.eq(5))
    .select((p) => p.status)
    .first();
});

export const beginRollback = example(async (db) => {
  const tx = await db.begin();
  await tx
    .update(Post)
    .set({ status: 'published' })
    .where((p) => p.id.eq(5))
    .execute();
  await tx.rollback();

  return db
    .queryable(Post)
    .where((p) => p.id.eq(5))
    .select((p) => p.status)
    .first();
});

export const afterRollback = example(async (db) => {
  const events: string[] = [];

  await db
    .transaction(async (tx) => {
      tx.afterCommit(() => {
        events.push('提交了');
      });
      tx.afterRollback(() => {
        events.push('回滚了，补偿一下');
      });
      throw new Error('出错了');
    })
    .catch(() => undefined);

  return { events };
});

export const readOnly = example((db) =>
  db.transaction(
    async (tx) => ({
      users: await tx.queryable(User).count(),
      posts: await tx.queryable(Post).count(),
    }),
    { readOnly: true },
  ),
);

export const lockRow = example((db) =>
  db.transaction(async (tx) => {
    const found = await tx.lock(Product, 5);
    if (!found) throw new Error('商品不存在');

    return tx
      .update(Product)
      .set((p) => ({ stock: p.stock.minus(1) }))
      .where((p) => p.id.eq(5))
      .execute();
  }),
);

// ---- 校验

export const validate = example(async (_db) => {
  const insert = validators(User).insert;

  return {
    ok: await insert['~standard'].validate({
      name: '新同学',
      level: 'junior',
      joinedAt: '2026-01-05',
    }),
    bad: await insert['~standard'].validate({
      name: 'x'.repeat(60),
      level: 'boss',
    }),
  };
});
