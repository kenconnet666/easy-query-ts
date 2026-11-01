/** 原生 SQL 一章的示例 */
import { sql, text } from '@zerodep-dev/easy-query-ts';
import { example } from '../../site/example.ts';
import { Post, User } from '../../site/model.ts';

export const fragmentWhere = example((db) =>
  db
    .queryable(Post)
    .where((p) => sql<boolean>`${p.views} % 2 = 0`)
    .select((p) => p.title)
    .toList(),
);

export const fragmentSelect = example((db) =>
  db
    .queryable(Post)
    .where((p) => p.status.eq('published'))
    .select((p) => ({
      title: p.title,
      thousands: sql<number>`${p.views} / 1000`,
    }))
    .toList(),
);

export const fragmentParam = example((db) => {
  const threshold = 2000;

  return db
    .queryable(Post)
    .where((p) => sql<boolean>`${p.views} >= ${threshold}`)
    .select((p) => p.title)
    .toList();
});

export const textTemplate = example((db) =>
  db
    .queryable(User)
    .where((u) => u.companyId.isNotNull())
    .select((u) => ({
      label: text`${u.name}（${u.company.name}）`,
    }))
    .limit(3)
    .toList(),
);

export const customFunction = example((db) =>
  db
    .queryable(User)
    .where((u) => u.id.le(3))
    .select((u) => ({
      name: u.name,
      age: sql<number>`COALESCE(${u.age}, ${0})`,
    }))
    .toList(),
);

export const rawStatement = example((db) => {
  const minViews = 2000;

  return db.sql<{ title: string }>`
    SELECT title FROM t_post WHERE views >= ${minViews} ORDER BY id
  `;
});

export const rawArray = example(
  (db) =>
    db.sql<{ name: string }>`
    SELECT name FROM t_user WHERE id IN (${[1, 2, 3]}) ORDER BY id
  `,
);

export const rawIdent = example(
  (db) =>
    db.sql<{ name: string }>`
    SELECT ${db.sql.ident('name')} FROM ${db.sql.ident('t_tag')} ORDER BY id
  `,
);

export const rawExecute = example(
  (db) =>
    db.sql
      .execute`UPDATE t_post SET views = views + ${1} WHERE id = ${1}`,
);

export const rawInTransaction = example((db) =>
  db.transaction(async (tx) => {
    await tx.sql
      .execute`UPDATE t_post SET views = 0 WHERE id = ${1}`;
    const rows = await tx.sql<{ views: number }>`
      SELECT views FROM t_post WHERE id = ${1}
    `;
    return rows[0];
  }),
);

export const toSql = example((db) => {
  const statement = db
    .queryable(User)
    .where((u) => u.age.ge(18))
    .select((u) => u.name)
    .toSQL();

  return [statement.sql];
});

export const optimizerHint = example((db) =>
  db
    .queryable(User)
    .optimizerHint('MAX_EXECUTION_TIME(1000)')
    .where((u) => u.age.ge(30))
    .select((u) => u.name)
    .toList(),
);
