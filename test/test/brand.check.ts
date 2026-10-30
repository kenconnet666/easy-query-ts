/**
 * 带品牌的主键与外键（ROADMAP 18.1.3）：只参与 tsc，不运行。
 */
import {
  col,
  createDb,
  defineSchema,
  entity,
  type Adapter,
  type Branded,
  type Row,
} from '@zerodep-dev/easy-query-ts';

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
function expect<T extends true>(): T | void {}

const Customer = entity('t_customer', {
  id: col.bigint().primaryKey().generated().brand<'CustomerId'>(),
  name: col.string(),
});
const Order = entity('t_order', {
  id: col.bigint().primaryKey().generated().brand<'OrderId'>(),
  customerId: col.bigint().brand<'CustomerId'>(),
  // 没打品牌的列
  sellerId: col.bigint(),
  total: col.decimal(12, 2),
});

type CustomerId = Row<typeof Customer>['id'];
type OrderId = Row<typeof Order>['id'];
expect<Equal<CustomerId, Branded<number, 'CustomerId'>>>();

const schema = defineSchema(
  { Customer, Order },
  {
    Order: (r) => ({
      customer: r.one('Customer', { from: 'customerId', to: 'id' }),
      // @ts-expect-error 品牌对不上：OrderId 指向 CustomerId
      wrong: r.one('Customer', { from: 'id', to: 'id' }),
      // @ts-expect-error 没品牌的列不能指向带品牌的主键
      seller: r.one('Customer', { from: 'sellerId', to: 'id' }),
    }),
    Customer: (r) => ({ orders: r.many('Order', { from: 'id', to: 'customerId' }) }),
  },
);

declare const adapter: Adapter;
const db = createDb({ schema, adapter });

export async function brands(customerId: CustomerId, orderId: OrderId) {
  // 结果里的值带品牌
  const rows = await db
    .queryable(Order)
    .select((o) => ({ id: o.id, customer: o.customerId }))
    .toList();
  expect<Equal<(typeof rows)[number]['customer'], CustomerId>>();

  // 品牌一致的条件、join
  db.queryable(Order).where((o) => o.customerId.eq(customerId));
  db.queryable(Order).where((o) => o.customer.id.eq(customerId));
  // @ts-expect-error OrderId 不能当 CustomerId 用
  db.queryable(Order).where((o) => o.customerId.eq(orderId));
  // @ts-expect-error 没品牌的数字也不行：值要从查询结果来，或显式断言
  db.queryable(Order).where((o) => o.customerId.eq(1));
  db.queryable(Order).where((o) => o.customerId.eq(1 as CustomerId));

  // find 的主键参数带品牌
  await db.queryable(Order).find(orderId);

  // 品牌值照常参与运算，另一边可以是普通数字
  db.queryable(Order).select((o) => o.id.plus(1));
}
