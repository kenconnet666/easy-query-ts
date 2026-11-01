/** 性能、动态表名两章的示例 */
import { example } from '../../site/example.ts';
import { Post, User } from '../../site/model.ts';

// ---- 性能

export const pushDown = example((db) =>
  db
    .queryable(Post)
    .select((p) => ({
      id: p.id,
      title: p.title,
      views: p.views,
    }))
    .asTable()
    .where((t) => t.views.ge(2000))
    .toList(),
);

export const existsNotCount = example((db) =>
  db
    .queryable(User)
    .where((u) => u.posts.any((p) => p.views.ge(2000)))
    .select((u) => u.name)
    .toList(),
);

export const streamRows = example(async (db) => {
  const titles: string[] = [];

  for await (const post of db
    .queryable(Post)
    .orderBy((p) => p.id)
    .select((p) => ({ title: p.title }))
    .stream({ batchSize: 5 })) {
    titles.push(post.title);
    if (titles.length === 3) break;
  }

  return { titles };
});

// ---- 动态表名

export const mapTable = example((db) => {
  const archive = db.mapTables({ Post: 't_post_2025' });
  const statement = archive
    .queryable(Post)
    .where((p) => p.views.ge(1000))
    .select((p) => ({
      title: p.title,
      author: p.author.name,
    }))
    .toSQL();

  return [statement.sql];
});

export const mapTableRun = example(async (db) => {
  await db.sql
    .execute`CREATE TABLE t_post_2025 AS SELECT * FROM t_post WHERE id <= 2`;

  const archive = db.mapTables({ Post: 't_post_2025' });
  await archive
    .update(Post)
    .set({ status: 'draft' })
    .where((p) => p.id.eq(1))
    .execute();
  const rows = await archive
    .queryable(Post)
    .orderBy((p) => p.id)
    .select((p) => ({
      title: p.title,
      status: p.status,
      author: p.author.name,
    }))
    .toList();
  await db.sql.execute`DROP TABLE t_post_2025`;

  return rows;
});

export const useSchema = example((db) => {
  const statement = db
    .inSchema('archive_2025')
    .queryable(Post)
    .select((p) => ({
      title: p.title,
      author: p.author.name,
    }))
    .toSQL();

  return [statement.sql];
});

export const useSchemaOnly = example((db) => {
  const statement = db
    .inSchema('archive_2025', ['Post'])
    .queryable(Post)
    .select((p) => ({
      title: p.title,
      author: p.author.name,
    }))
    .toSQL();

  return [statement.sql];
});

export const tableLink = example((db) => {
  const statement = db
    .withTableLink('remote_db')
    .queryable(User)
    .select((u) => u.name)
    .toSQL();

  return [statement.sql];
});
