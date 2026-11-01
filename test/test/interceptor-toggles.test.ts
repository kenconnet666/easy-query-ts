// 拦截器的开关：语句、Db、导航、join 上开关，默认关着的按需打开，全关时受保护的（租户）不关，条件按语句种类区分
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { describe, it } from 'vitest';
import {
  col,
  createDb,
  defineSchema,
  entity,
  tenant,
  refColumn,
  type Expr,
  type Interceptor,
} from '@zerodep-dev/easy-query-ts';
import { sqlite } from '@zerodep-dev/easy-query-ts-sqlite';

declare module '@zerodep-dev/easy-query-ts' {
  interface InterceptorNames {
    dataScope: true;
    writeGuard: true;
  }
}

const Customer = entity('t_customer', {
  id: col.int().primaryKey(),
  tenantId: col.int(),
  ownerId: col.int(),
  deleted: col.boolean().softDelete(),
});
const Order = entity('t_order', {
  id: col.int().primaryKey(),
  tenantId: col.int(),
  customerId: col.int(),
  deleted: col.boolean().softDelete(),
});
const schema = defineSchema(
  { Customer, Order },
  { Customer: (r) => ({ orders: r.many('Order', { from: 'id', to: 'customerId' }) }) },
);

// 默认关着：只在打开它的接口里按负责人过滤
const dataScope: Interceptor = {
  name: 'dataScope',
  enabled: false,
  filter: (ref, entity) =>
    'ownerId' in entity.columns && (refColumn(ref, 'ownerId') as Expr<number>).eq(42),
};
// 只给改、删加条件：已归档的行不让改
const writeGuard: Interceptor = {
  name: 'writeGuard',
  filter: (ref, entity, { kind }) =>
    kind !== 'select' &&
    'ownerId' in entity.columns &&
    (refColumn(ref, 'ownerId') as Expr<number>).gt(0),
};

const db = createDb({
  schema,
  adapter: sqlite(new DatabaseSync(':memory:')),
  interceptors: [tenant('tenantId', () => 7), dataScope, writeGuard],
});
const where = (sql: string) => sql.slice(sql.indexOf(' WHERE ') + 7);

describe('sqlite: interceptor toggles', () => {
  it('全关时受保护的租户仍在；之后的 use 再打开；Db 级与语句级叠加', () => {
    assert.equal(
      where(db.queryable(Customer).interceptors({ skip: 'all' }).toSQL().sql),
      't0."tenant_id" = ?',
    );
    assert.equal(
      where(
        db
          .queryable(Customer)
          .interceptors({ skip: 'all', use: ['softDelete'] })
          .toSQL().sql,
      ),
      't0."deleted" = ? AND t0."tenant_id" = ?',
    );
    const admin = db.withInterceptors({ skip: ['tenant'] });
    assert.equal(where(admin.queryable(Customer).toSQL().sql), 't0."deleted" = ?');
    // 语句上的在后：Db 关了租户，这条语句再打开
    assert.equal(
      where(admin.queryable(Customer).useInterceptor('tenant').toSQL().sql),
      't0."deleted" = ? AND t0."tenant_id" = ?',
    );
  });

  it('默认关着的拦截器按需打开', () => {
    assert.doesNotMatch(where(db.queryable(Customer).toSQL().sql), /owner_id/);
    assert.match(
      db.queryable(Customer).useInterceptor('dataScope').toSQL().sql,
      /t0\."owner_id" = \?/,
    );
  });

  it('filter 拿到语句种类：只给改、删加的条件不进查询', () => {
    assert.doesNotMatch(where(db.queryable(Customer).toSQL().sql), /owner_id/);
    const update = db
      .update(Customer)
      .set({ ownerId: 1 })
      .where((c) => c.id.eq(1))
      .toSQL().sql;
    assert.match(update, /"owner_id" > \?/);
    const del = db
      .delete(Customer)
      .where((c) => c.id.eq(1))
      .toSQL().sql;
    assert.match(del, /"owner_id" > \?/);
    // 写入语句上也能关
    assert.doesNotMatch(
      db
        .update(Customer)
        .noInterceptor('writeGuard')
        .set({ ownerId: 1 })
        .where((c) => c.id.eq(1))
        .toSQL().sql,
      /owner_id" >/,
    );
    assert.deepEqual(
      db
        .insert(Customer)
        .noInterceptor('tenant')
        .values({ id: 1, tenantId: 9, ownerId: 1 })
        .toSQL()[0]!.params,
      [1, 9, 1, 0],
    );
  });

  it('只在一个导航、一张 join 的表上关', () => {
    const counts = db
      .queryable(Customer)
      .select((c) => ({
        all: c.orders.noInterceptor('softDelete').count(),
        live: c.orders.count(),
      }))
      .toSQL().sql;
    const [all, live] = counts.split('AS "c0"');
    assert.doesNotMatch(all!, /t1\."deleted"/);
    assert.match(live!, /"deleted" = \?/);

    const joined = db
      .queryable(Customer)
      .leftJoin(Order, (c, o) => o.customerId.eq(c.id), { skip: ['softDelete'] })
      .select((c, o) => ({ id: c.id, order: o.id }))
      .toSQL().sql;
    assert.match(
      joined,
      /LEFT JOIN "t_order" t1 ON t1\."customer_id" = t0\."id" AND t1\."tenant_id" = \? WHERE/,
    );
  });

  it('名字写错在编译期报出来', () => {
    // @ts-expect-error 没登记的名字
    db.queryable(Customer).noInterceptor('tenatn');
  });
});
