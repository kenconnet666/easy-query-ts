import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { describe, it } from 'vitest';
import { col, createDb, defineSchema, entity, tenant } from '@zerodep-dev/easy-query-ts';
import { sqlite } from '@zerodep-dev/easy-query-ts-sqlite';

const Order = entity('t_order', {
  id: col.bigint().primaryKey().generated(),
  tenantId: col.int(),
  customerId: col.int(),
});
const Customer = entity('t_customer', {
  id: col.int().primaryKey(),
  tenantId: col.int(),
  name: col.string(),
});
const schema = defineSchema(
  { Order, Customer },
  {
    Order: (r) => ({ customer: r.one('Customer', { from: 'customerId', to: 'id' }) }),
    Customer: (r) => ({ orders: r.many('Order', { from: 'id', to: 'customerId' }) }),
  },
);

describe('sqlite: tenant()', () => {
  let current = 7;
  const db = createDb({
    schema,
    adapter: sqlite(new DatabaseSync(':memory:')),
    interceptors: [tenant('tenantId', () => current)],
  });

  it('filters the root, joins and subqueries with the current tenant', () => {
    const s = db
      .queryable(Customer)
      .where((c) => c.orders.any((o) => o.customer.name.eq('x')))
      .select((c) => ({ id: c.id }))
      .toSQL();
    assert.equal(
      s.sql,
      'SELECT t0."id" AS "c0" FROM "t_customer" t0 WHERE EXISTS (SELECT 1 FROM "t_order" t1' +
        ' LEFT JOIN "t_customer" t2 ON t2."id" = t1."customer_id" AND t2."tenant_id" = ?' +
        ' WHERE t1."customer_id" = t0."id" AND t1."tenant_id" = ? AND t2."name" = ?) AND t0."tenant_id" = ?',
    );
    assert.deepEqual(s.params, [7, 7, 'x', 7]);
  });

  it('puts the tenant condition of an explicitly joined table into its ON clause', () => {
    // 租户条件放在 ON 里：left join 不会因此丢掉主表的行；主表的租户条件仍在 WHERE
    const s = db
      .queryable(Customer)
      .leftJoin(Order, (c, o) => o.customerId.eq(c.id))
      .select((c, o) => ({ name: c.name, order: o.id }))
      .toSQL();
    assert.equal(
      s.sql,
      'SELECT t0."name" AS "c0", t1."id" AS "c1" FROM "t_customer" t0' +
        ' LEFT JOIN "t_order" t1 ON t1."customer_id" = t0."id" AND t1."tenant_id" = ? WHERE t0."tenant_id" = ?',
    );
    assert.deepEqual(s.params, [7, 7]);
  });

  it('moves the tenant conditions of earlier tables into the ON of a right join', () => {
    // 主表的租户条件若留在 WHERE，只有右表的行（主表一侧为 NULL）就被过滤掉了
    const s = db
      .queryable(Order)
      .rightJoin(Customer, (o, c) => c.id.eq(o.customerId))
      .select((o, c) => ({ order: o.id, name: c.name }))
      .toSQL();
    assert.equal(
      s.sql,
      'SELECT t0."id" AS "c0", t1."name" AS "c1" FROM "t_order" t0' +
        ' RIGHT JOIN "t_customer" t1 ON t1."id" = t0."customer_id" AND t1."tenant_id" = ? AND t0."tenant_id" = ?',
    );
    const cross = db
      .queryable(Order)
      .crossJoin(Customer)
      .select((o, c) => ({ order: o.id, name: c.name }))
      .toSQL();
    assert.equal(
      cross.sql,
      'SELECT t0."id" AS "c0", t1."name" AS "c1" FROM "t_order" t0 CROSS JOIN "t_customer" t1' +
        ' WHERE t0."tenant_id" = ? AND t1."tenant_id" = ?',
    );
  });

  it('inSchema puts every table (or the listed ones) under another schema', () => {
    const archived = db.inSchema('archive');
    assert.match(
      archived
        .queryable(Order)
        .select((o) => o.customer.name)
        .toSQL().sql,
      /FROM "archive"\."t_order" t0 LEFT JOIN "archive"\."t_customer"/,
    );
    const some = archived.inSchema('hot', ['Customer']);
    assert.match(
      some
        .queryable(Order)
        .select((o) => o.customer.name)
        .toSQL().sql,
      /FROM "archive"\."t_order" t0 LEFT JOIN "hot"\."t_customer"/,
    );
  });

  it('evaluates the tenant per statement and fills it on insert', () => {
    current = 8;
    assert.deepEqual(
      db
        .insert(Order)
        .values({ customerId: 1 } as never)
        .toSQL()[0]!.params,
      [8, 1],
    );
    assert.deepEqual(
      db
        .delete(Order)
        .where((o) => o.id.eq(1))
        .toSQL().params,
      [1, 8],
    );
  });

  it('still refuses writes whose only condition is the tenant', () => {
    assert.throws(() => db.delete(Order).toSQL(), /all\(\)/);
  });
});
