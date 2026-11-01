/** 建表一章的示例 */
import { col, entity } from '@zerodep-dev/easy-query-ts';
import { example } from '../../site/example.ts';
import {
  Post,
  PostTag,
  Product,
} from '../../site/model.ts';

export const createOne = example((db) => {
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

export const compositePrimaryKey = example((db) =>
  db.createTablesSql(PostTag),
);

export const manyTables = example((db) =>
  db.createTablesSql(Product, PostTag),
);

export const oneTable = example((db) => [
  db.createTableSql(Product),
]);

export const uniqueAndDefault = example((db) => {
  const Account = entity('t_account', {
    id: col.bigint().primaryKey().generated(),
    email: col.string(100).unique(),
    status: col.string(10).dbDefault("'active'"),
    score: col.int().dbDefault('0'),
    note: col.string(200).named('remark').nullable(),
  });

  return db.createTablesSql(Account);
});

export const generatedColumn = example((db) => {
  const Line = entity('t_line', {
    id: col.int().primaryKey(),
    qty: col.int(),
    price: col.int(),
    total: col.int().generatedAs('qty * price'),
  });

  return db.createTablesSql(Line);
});

export const tableIndexes = example((db) => {
  const Event = entity(
    't_event',
    {
      id: col.bigint().primaryKey().generated(),
      tenantId: col.int(),
      kind: col.string(20),
      createdAt: col.datetime(),
    },
    {
      comment: '事件',
      indexes: [
        { columns: ['tenantId', 'createdAt'] },
        { columns: ['tenantId', 'kind'], unique: true },
        {
          expressions: ['lower(kind)'],
          name: 't_event_kind_idx',
        },
        {
          columns: ['createdAt'],
          where: 'tenant_id > 0',
          name: 't_event_live_idx',
        },
      ],
    },
  );

  return db.createTablesSql(Event);
});
