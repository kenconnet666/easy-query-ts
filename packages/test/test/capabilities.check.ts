/**
 * 方言能力进类型（ROADMAP 18.1.2）：只参与 tsc，不运行。正例照常能调；负例用 @ts-expect-error 固定"必须报错"。
 */
import { createDb, type Adapter, type Without } from '@zerodep-dev/easy-query-ts';
import { Post, schema, User } from '../src/fixture.ts';

declare const full: Adapter;
declare const tsdb: Adapter<
  Without<
    | 'update'
    | 'transactions'
    | 'lock'
    | 'forUpdate'
    | 'skipLocked'
    | 'noWait'
    | 'returning'
    | 'generatedKeys'
    | 'upsertIgnore'
  >
>;
declare const analytic: Adapter<
  Without<
    | 'transactions'
    | 'lock'
    | 'forUpdate'
    | 'skipLocked'
    | 'noWait'
    | 'returning'
    | 'generatedKeys'
    | 'upsert'
    | 'upsertIgnore'
  >
>;
declare const mysqlLike: Adapter<Without<'returning'>>;

export async function capabilities() {
  // 能力齐全：全部能调
  const db = createDb({ schema, adapter: full });
  db.update(User);
  await db.transaction(async (tx) => {
    await tx.lock(User, 1);
    tx.queryable(User).forUpdateSkipLocked();
  });
  db.insert(Post).values({ userId: 1, title: 't', amount: '1' }).returning('id');
  db.insert(User)
    .values({ name: 'a', createdAt: new Date() })
    .onConflict((u) => u.id)
    .ignore();

  // 没有 UPDATE、事务、行锁、RETURNING、自增、ignore 的库
  const t = createDb({ schema, adapter: tsdb });
  // @ts-expect-error update
  t.update(User);
  // @ts-expect-error transactions
  await t.transaction(async () => undefined);
  // @ts-expect-error transactions
  await t.begin();
  // @ts-expect-error lock
  await t.lock(User, 1);
  // @ts-expect-error forUpdate
  t.queryable(User).forUpdate();
  // @ts-expect-error returning
  t.delete(User)
    .where((u) => u.id.eq(1))
    .returning();
  // @ts-expect-error generatedKeys
  await t.insert(User).values({ name: 'a', createdAt: new Date() }).returnId();
  const upsert = t
    .insert(User)
    .values({ name: 'a', createdAt: new Date() })
    .onConflict((u) => u.id);
  upsert.merge();
  // @ts-expect-error upsertIgnore
  upsert.ignore();
  // 查询、删除、插入照常
  t.queryable(User).where((u) => u.age.ge(18));
  t.delete(User).where((u) => u.id.eq(1));

  // 没有 upsert 的库：onConflict 整个不能用；能力跟着 with / mount 走
  const c = createDb({ schema, adapter: analytic });
  // @ts-expect-error upsert
  c.insert(User)
    .values({ name: 'a', createdAt: new Date() })
    .onConflict((u) => u.id);
  c.update(User);
  const cte = c.with(
    'adults',
    c.queryable(User).select((u) => ({ id: u.id })),
  );
  // @ts-expect-error forUpdate（CTE 之后的 Db 保留能力）
  cte.queryable(User).forUpdate();

  // MySQL：只缺 RETURNING
  const m = createDb({ schema, adapter: mysqlLike });
  // @ts-expect-error returning
  m.update(User)
    .set({ age: 1 })
    .where((u) => u.id.eq(1))
    .returning('id');
  m.queryable(User).forUpdateNoWait();
}
