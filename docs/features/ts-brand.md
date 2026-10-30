# TS：带品牌的主键与外键

主键、外键都是数字或字符串，传错了（把订单号当客户号）类型上看不出来。列上打品牌之后，值类型互不相容：

```ts
const Customer = entity('t_customer', {
  id: col.bigint().primaryKey().generated().brand<'CustomerId'>(),
  name: col.string(),
});
const Order = entity('t_order', {
  id: col.bigint().primaryKey().generated().brand<'OrderId'>(),
  customerId: col.bigint().brand<'CustomerId'>(),
});
type CustomerId = Row<typeof Customer>['id']; // Branded<number, 'CustomerId'>
```

- 查询结果、`find`、`returnId` 拿到的值带品牌；条件里 `o.customerId.eq(orderId)` 报错，裸数字也要显式断言（`1 as CustomerId`）。
- 关系的 `from` / `to` 品牌对不上在定义处报错：`r.one('Customer', { from: 'id', to: 'id' })`（OrderId 指向 CustomerId）、
  没品牌的外键指向带品牌的主键，都编译不过。复合外键不核对品牌。
- 品牌只在类型里，运行时就是原来的值；算术照常（`o.id.plus(1)`，另一边可以是普通数字）。
- 局限：`find(key)` 接受行里任何一列的值类型（实体类型上没有标出哪几列是主键），所以别的品牌的值在这里拦不住。

类型测试见 `test/test/brand.check.ts`。
