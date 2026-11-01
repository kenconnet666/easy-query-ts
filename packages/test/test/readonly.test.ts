// 只读 Db 与请求上下文（ROADMAP 18.3.3）：readonly() 在类型上去掉写方法，运行时兜底；requestContext 把请求的值交给拦截器
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { describe, it } from 'vitest';
import { col, createDb, defineSchema, entity, tenant, type Db } from '@zerodep-dev/easy-query-ts';
import { requestContext } from '@zerodep-dev/easy-query-ts/context';
import { sqlite } from '@zerodep-dev/easy-query-ts-sqlite';

const Order = entity('t_ro_order', {
  id: col.int().primaryKey().generated(),
  tenantId: col.int(),
  total: col.int(),
});
// tenantId 由 tenant 拦截器从请求上下文里补上
const schema = defineSchema({ Order });

const request = requestContext<{ tenantId: number }>('tenant context');

describe('readonly 与 requestContext', async () => {
  const db = createDb({
    schema,
    adapter: sqlite(new DatabaseSync(':memory:')),
    interceptors: [tenant('tenantId', () => request.get().tenantId)],
  });
  await db.createTables();
  await request.run({ tenantId: 1 }, () =>
    db
      .insert(Order)
      .values({ total: 10 } as never)
      .execute(),
  );
  await request.run({ tenantId: 2 }, () =>
    db
      .insert(Order)
      .values({ total: 20 } as never)
      .execute(),
  );
  const reader = db.readonly();

  it('只读的 Db 照常查询、开事务；类型上没有写方法', async () => {
    const totals = () =>
      reader
        .queryable(Order)
        .select((o) => o.total)
        .toList();
    assert.deepEqual(await request.run({ tenantId: 2 }, totals), [20]);
    assert.equal(
      await reader.transaction((tx) =>
        request.run({ tenantId: 1 }, () => tx.queryable(Order).count()),
      ),
      1,
    );
    // 派生出来的 Db 仍是只读的
    const derived = reader.withSignal(AbortSignal.timeout(5000)).usePrimary();
    if (Math.random() > 2) {
      // @ts-expect-error 派生出来的也是只读
      derived.insert(Order);
      // @ts-expect-error 只读
      reader.insert(Order);
      // @ts-expect-error 只读
      reader.update(Order);
      // @ts-expect-error 只读
      reader.delete(Order);
      // @ts-expect-error 只读
      void reader.save(Order, { total: 1, tenantId: 1 });
      // @ts-expect-error 只读
      void reader.syncTables();
      // @ts-expect-error 只读
      void reader.migrate([]);
      // @ts-expect-error 加锁也算写
      reader.queryable(Order).forUpdate();
    }
  });

  it('绕过类型的写入在运行时报错', async () => {
    const loose = reader as unknown as Db<typeof schema>;
    assert.throws(() => loose.insert(Order), /read-only/);
    assert.throws(() => loose.delete(Order), /read-only/);
    await assert.rejects(loose.sql.execute`DELETE FROM t_ro_order`, /read-only/);
    await assert.rejects(loose.dropTables(), /read-only/);
    await assert.rejects(loose.migrate([]), /read-only/);
    // 原来的 Db 不受影响
    assert.equal(
      await db
        .withInterceptors({ skip: ['tenant'] })
        .queryable(Order)
        .count(),
      2,
    );
  });

  it('不在 run 里：get 报错、find 是 undefined；嵌套时里层覆盖外层', () => {
    assert.throws(() => request.get(), /tenant context is not set/);
    assert.equal(request.find(), undefined);
    request.run({ tenantId: 1 }, () =>
      request.run({ tenantId: 3 }, () => assert.equal(request.get().tenantId, 3)),
    );
  });
});
