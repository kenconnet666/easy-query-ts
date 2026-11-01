# TS：多态实体（一张表存几种子类型）

支付方式、消息、事件这类"几种子类型共用一张表"的数据，用 `entity.union` 声明：

```ts
const Payment = entity.union('t_payment', 'kind', {
  base: { id: col.int().primaryKey().generated(), amount: col.decimal(12, 2) },
  variants: {
    card: { cardNo: col.string(19), holder: col.string().nullable() },
    wechat: { openId: col.string() },
  },
});

const rows = await db.queryable(Payment).toList();
for (const p of rows) if (p.kind === 'card') p.cardNo; // 按判别列收窄：string

const cards = await db.queryable(Payment).variant('card').toList(); // 只查这一种，结果类型也收窄
await db.insert(Payment).values({ kind: 'wechat', amount: '2.50', openId: 'o-1' }).execute();
```

- 读出的行、插入的形状是按判别列区分的联合：插入先选子类型，再给它自己的列；别的子类型的列不能给值（类型错误）。
- 表里：判别列存子类型名；各子类型的列在表里都可空（别的子类型的行里是 NULL），声明时的可空性用于读出的类型、插入与校验器。
- `variant(name)` 在 select 之前用：加上判别列的条件，结果类型收窄到这一种；名字写错是类型错误。
- `validators(Payment).insert` 按判别列选子类型检查：它自己的必填列要给，别的子类型的列不能有值。
- 子类型的列名不能重复、不能用 `embed()`。

官方 easy-query 没有对应能力（Java 侧通常用继承 + 多张表或手写判别）。测试见 `test/test/union.test.ts`。
