/** 建表一章的示例 */
import { col, entity } from '@zerodep-dev/easy-query-ts';
import { example } from '../../site/example.ts';
import { Post } from '../../site/model.ts';

export const createOne = example(async (db) => {
  const Article = entity('t_article', {
    id: col.bigint().primaryKey().generated(),
    title: col.string(100).comment('标题'),
    tags: col.json<string[]>(),
    price: col.decimal(10, 2).nullable(),
    publishedAt: col.datetime().nullable(),
  });

  return db.createTablesSql(Article);
});

export const fromSchema = example((db) =>
  db.createTablesSql(Post),
);
