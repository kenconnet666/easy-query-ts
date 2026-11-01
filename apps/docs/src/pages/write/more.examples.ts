/** 写入几章新增的示例 */
import {
  caseWhen,
  validators,
} from '@zerodep-dev/easy-query-ts';
import { example } from '../../site/example.ts';
import {
  Comment,
  Company,
  Doc,
  OrderItem,
  Post,
  PostTag,
  Product,
  Tag,
  User,
} from '../../site/model.ts';

// ---- 插入

export const insertNullable = example((db) =>
  db
    .insert(User)
    .values({
      name: '新同学',
      level: 'junior',
      joinedAt: '2026-01-05',
    })
    .returnEntity(),
);

export const insertJson = example((db) =>
  db
    .insert(Comment)
    .values({
      postId: 1,
      authorId: 3,
      parentId: 1,
      body: '补充一点',
      likes: 0,
    })
    .returnId(),
);

export const insertManyMixed = example((db) =>
  db
    .insert(User)
    .values([
      {
        name: '甲',
        level: 'junior',
        joinedAt: '2026-01-05',
      },
      {
        name: '乙',
        age: 30,
        level: 'senior',
        joinedAt: '2026-01-06',
      },
    ])
    .execute(),
);

export const insertThenRead = example(async (db) => {
  const id = await db
    .insert(Company)
    .values({ name: '青石科技', city: '成都' })
    .returnId();
  await db
    .insert(User)
    .values({
      name: '创始人',
      companyId: Number(id),
      level: 'lead',
      joinedAt: '2026-01-05',
    })
    .execute();

  return db
    .queryable(Company)
    .where((c) => c.id.eq(Number(id)))
    .select((c) => ({
      name: c.name,
      users: c.users.toList((u) => u.name),
    }))
    .first();
});

export const insertSelectWithExpression = example((db) =>
  db
    .insert(Product)
    .fromQuery(
      db
        .queryable(Product)
        .where((p) => p.id.eq(1))
        .select((p) => ({
          name: p.name.concat('（团购）'),
          price: p.price.times('0.8'),
          stock: p.stock,
        })),
    )
    .execute(),
);

// ---- upsert

export const mergeAll = example((db) =>
  db
    .insert(Product)
    .values({
      id: 1,
      name: '年度会员',
      price: '259.00',
      stock: 500,
    })
    .onConflict((p) => p.id)
    .merge()
    .execute(),
);

export const mergeInsertsNew = example(async (db) => {
  await db
    .insert(Tag)
    .values({ id: 100, name: '新标签' })
    .onConflict((t) => t.id)
    .merge((t) => [t.name])
    .execute();

  return db.queryable(Tag).find(100);
});

export const compositeConflict = example((db) =>
  db
    .insert(PostTag)
    .values({ postId: 1, tagId: 1 })
    .onConflict((t) => [t.postId, t.tagId])
    .ignore()
    .execute(),
);

export const compositeMerge = example((db) =>
  db
    .insert(OrderItem)
    .values({
      orderId: 1,
      productId: 1,
      quantity: 3,
      price: '299.00',
    })
    .onConflict((i) => [i.orderId, i.productId])
    .merge((i) => [i.quantity])
    .execute(),
);

export const upsertMany = example((db) =>
  db
    .insert(Tag)
    .values([
      { id: 1, name: 'ORM 框架' },
      { id: 200, name: '新的' },
    ])
    .onConflict((t) => t.id)
    .merge((t) => [t.name])
    .execute(),
);

// ---- 更新

export const setMany = example((db) =>
  db
    .update(User)
    .set({ age: 30, level: 'senior' })
    .where((u) => u.id.eq(1))
    .execute(),
);

export const setToNull = example((db) =>
  db
    .update(User)
    .set({ managerId: null })
    .where((u) => u.id.eq(1))
    .execute(),
);

export const setExpressions = example((db) =>
  db
    .update(Product)
    .set((p) => ({
      stock: p.stock.minus(1),
      price: p.price.times('0.9'),
      name: p.name.concat('（促销）'),
    }))
    .where((p) => p.id.eq(1))
    .execute(),
);

export const setCase = example((db) =>
  db
    .update(User)
    .set((u) => ({
      level: caseWhen(u.age.ge(35), 'lead' as const)
        .when(u.age.ge(28), 'senior' as const)
        .else('junior' as const),
    }))
    .where((u) => u.age.isNotNull())
    .execute(),
);

export const setFromNavigation = example((db) =>
  db
    .update(Post)
    .set((p) => ({
      title: p.title.concat(
        '（',
        p.author.name.orElse('匿名'),
        '）',
      ),
    }))
    .where((p) => p.id.eq(1))
    .execute(),
);

export const updateWithExists = example((db) =>
  db
    .update(User)
    .set({ level: 'senior' })
    .where((u) =>
      u.posts.any((p) =>
        p.comments.any((c) => c.likes.ge(15)),
      ),
    )
    .execute(),
);

export const updateAll = example((db) =>
  db.update(Post).set({ views: 0 }).all().execute(),
);

export const dynamicSet = example((db) => {
  // 表单只改填了的字段：undefined 的列不写
  const form = {
    title: '新标题',
    views: undefined as number | undefined,
  };

  return db
    .update(Post)
    .set(form)
    .where((p) => p.id.eq(1))
    .execute();
});

export const entitiesEach = example(async (db) => {
  const rows = await db
    .queryable(Tag)
    .where((t) => t.id.in([1, 2]))
    .toList();

  return db
    .update(Tag)
    .entities(
      rows.map((t) => ({ ...t, name: `#${t.name}` })),
    )
    .execute();
});

// ---- 删除

export const deleteByKey = example((db) =>
  db
    .delete(Tag)
    .where((t) => t.id.eq(6))
    .execute(),
);

export const deleteBySubquery = example((db) =>
  db
    .delete(PostTag)
    .where((t) =>
      t.postId.in(
        db
          .queryable(Post)
          .where((p) => p.status.eq('draft'))
          .select((p) => p.id),
      ),
    )
    .execute(),
);

export const deleteWithExists = example((db) =>
  db
    .delete(Tag)
    .where((t) => t.posts.none())
    .execute(),
);

export const deleteEntity = example(async (db) => {
  const doc = await db.queryable(Doc).findOrThrow(1);

  return db.delete(Doc).entity(doc).execute();
});

export const deleteAll = example((db) =>
  db.delete(PostTag).all().execute(),
);

export const deleteExpect = example((db) =>
  db
    .delete(Tag)
    .where((t) => t.id.eq(999))
    .expectRows(1, () => new Error('标签不存在'))
    .execute()
    .catch((error: Error) => error.message),
);

// ---- 校验

export const validateMissing = example(async (_db) => {
  const insert = validators(User).insert;

  return insert['~standard'].validate({ age: 20 });
});

export const validateWrongType = example(async (_db) => {
  const insert = validators(User).insert;

  return insert['~standard'].validate({
    name: '小明',
    age: '二十',
    level: 'junior',
    joinedAt: '2026-01-05',
  });
});

export const validateEnum = example(async (_db) => {
  const insert = validators(User).insert;

  return insert['~standard'].validate({
    name: '小明',
    level: 'boss',
    joinedAt: '2026-01-05',
  });
});

export const validateDate = example(async (_db) => {
  const insert = validators(User).insert;

  return insert['~standard'].validate({
    name: '小明',
    level: 'junior',
    joinedAt: 'not a date',
  });
});

export const validateDecimal = example(async (_db) => {
  const insert = validators(Product).insert;

  return insert['~standard'].validate({
    name: '贴纸',
    price: '12345678901.123',
    stock: 1,
  });
});

export const validateUpdate = example(async (_db) => {
  const update = validators(User).update;

  return {
    partial: await update['~standard'].validate({
      age: 30,
    }),
    bad: await update['~standard'].validate({
      level: 'boss',
    }),
  };
});

export const validateThenWrite = example(async (db) => {
  const input: unknown = {
    name: '小明',
    level: 'junior',
    joinedAt: '2026-01-05',
  };
  const checked =
    await validators(User).insert['~standard'].validate(
      input,
    );
  if (checked.issues) return checked.issues;

  // 校验过的 value 类型就是插入的形状
  return db.insert(User).values(checked.value).returnId();
});

// ---- 锁

export const lockMissing = example((db) =>
  db.transaction((tx) => tx.lock(Product, 999)),
);

export const forUpdateThenWrite = example((db) =>
  db.transaction(async (tx) => {
    const rows = await tx
      .queryable(Product)
      .where((p) => p.stock.ge(100))
      .orderBy((p) => p.id)
      .limit(2)
      .forUpdate()
      .toList();

    return tx
      .update(Product)
      .set((p) => ({ stock: p.stock.minus(1) }))
      .where((p) => p.id.in(rows.map((r) => r.id)))
      .execute();
  }),
);
