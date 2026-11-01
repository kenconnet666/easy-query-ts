// SQL 快照的样例定义（test/test/snapshot.test.ts 用它跑 eqts snapshot）
import { defineSnapshots } from '@zerodep-dev/easy-query-ts';
import { SqliteDialect } from '@zerodep-dev/easy-query-ts-sqlite';
import { Post, schema, User } from './fixture.ts';

export default defineSnapshots({
  schema,
  dialects: { sqlite: new SqliteDialect() },
  queries: {
    adults: (db) =>
      db
        .queryable(User)
        .where((u) => u.age.ge(18))
        .select((u) => ({ name: u.name })),
    postsByAuthor: (db) =>
      db
        .queryable(Post)
        .groupBy((p) => ({ userId: p.userId }))
        .rollup()
        .select((g) => ({ userId: g.key.userId, total: g.count() })),
    renameUser: (db) =>
      db
        .update(User)
        .set({ name: 'x' })
        .where((u) => u.id.eq(1)),
  },
});
