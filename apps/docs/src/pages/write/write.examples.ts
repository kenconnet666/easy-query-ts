/** 写入一章的示例 */
import { example } from '../../site/example.ts';
import {
  Company,
  Post,
  Tag,
  User,
} from '../../site/model.ts';

export const insertOne = example((db) =>
  db
    .insert(Company)
    .values({ name: '远山网络', city: '成都' })
    .returnId(),
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

export const expectRows = example((db) =>
  db
    .update(Post)
    .set({ status: 'published' })
    .where((p) => [p.id.eq(5), p.status.eq('draft')])
    .expectRows(1, () => new Error('已经发布过了'))
    .execute(),
);

export const remove = example((db) =>
  db
    .delete(Post)
    .where((p) => [p.status.eq('draft'), p.views.eq(0)])
    .execute(),
);

export const save = example((db) =>
  db.save(
    User,
    {
      id: 1,
      name: '林晓',
      age: 30,
      companyId: 1,
      joinedAt: '2023-03-14',
      posts: [
        {
          id: 1,
          authorId: 1,
          title: '隐式 join 是怎么生成的（修订）',
          status: 'published',
          views: 1280,
        },
      ],
    },
    { include: { posts: { removed: 'delete' } } },
  ),
);

export const transaction = example((db) =>
  db.transaction(async (tx) => {
    const id = Number(
      await tx
        .insert(Company)
        .values({ name: '远山网络', city: '成都' })
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
