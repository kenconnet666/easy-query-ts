/** 完整例子：社区首页 */
import { caseWhen, win } from '@zerodep-dev/easy-query-ts';
import { example } from '../../site/example.ts';
import {
  Comment,
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
      comments: p.comments
        .orderBy((c) => c.id)
        .toList((c) => ({
          body: c.body,
          author: c.author.name,
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
        { postId: id, tagId: 2 },
      ])
      .execute();
    await tx
      .insert(Comment)
      .values({ postId: id, authorId: 1, body: '沙发' })
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
