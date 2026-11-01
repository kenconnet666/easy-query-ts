# TS：显式 join（`innerJoin` / `leftJoin` / `rightJoin` / `crossJoin`）与换 schema

导航（`u.company.name`）只能沿着声明过的关系隐式 LEFT JOIN。显式 join 补上三件事：内连接、join 没声明过关系的表、把一对多**展平**成"父子对"。

```ts
const rows = await db
  .queryable(User)
  .innerJoin(Post, (u, p) => p.userId.eq(u.id)) // on 收到此前所有表引用加上新表引用
  .leftJoin(Comment, (_u, p, c) => c.postId.eq(p.id)) // 第三张表；c 的列都可空
  .where((u, p, c) => [u.age.ge(18), p.amount.gt('5')]) // 之后的 lambda 按 join 顺序收到所有表引用
  .orderBy((_u, p) => p.id)
  .select((u, p, c) => ({ name: u.name, title: p.title, body: c.body })) // body: string | null
  .toPage(1, 20);
```

- **结果类型**：`select` 里按用到的引用推导，left join 那张表的列可空。不写 `select` 时是每张表的整行，按实体名分组：`{ User: Row, Post: Row, Comment: Row | null }`（left join 没匹配上时整行是 `null`）。
- **自连接 / 同一实体 join 两次**：必须写 `select` 来命名列，否则报 `the same entity is joined more than once`。
- **聚合与分组**：`groupBy((u, p) => …)`、`g.sum((u, p) => p.amount)`、根聚合 `sum((u, p) => …)`、`count()`、`toPage` 都认 join。注意内连接一对多后 `count()` 数的是连接后的行数。
- **导航照常**：join 来的表上也能用导航（`p.user.name`），隐式 join 排在显式 join 之后。
- **拦截器**（租户等）作用在每张 join 的表上，条件放进它自己的 `ON`：left join 不会因此丢掉主表的行。
- **ON 必须有条件**：条件全被跳过时报错，免得悄悄变成笛卡尔积。
- **顺序**：`innerJoin / leftJoin` 必须在 `select` 之前调用（之后形状已经定死），否则报错。

## 方言

只用标准的 `INNER` / `LEFT` / `RIGHT` / `CROSS JOIN`，各库写法一致：SQLite、MySQL 8.0.18 / 8.4、PG 17 实测通过；HANA 随 CI 验证。

## 右连接与交叉连接

```ts
// globex 没有员工也在结果里，用户一侧为 null；之后的 lambda 里 u 的列都是可空的
db.queryable(User)
  .rightJoin(Company, (u, c) => c.id.eq(u.companyId))
  .select((u, c) => ({ user: u.name, company: c.name })); // { user: string | null; company: string }[]

db.queryable(Company)
  .crossJoin(Company)
  .where((a, b) => a.id.lt(b.id)); // 笛卡尔积，条件写在 where
```

- `rightJoin` 之后此前各表的表引用变成可空（类型与没写 select 时的整行都跟着变）；它们的拦截器条件（租户、逻辑删除）放进这个 `ON`，只有右表的行才不会被过滤掉。
- `crossJoin` 没有 `ON`，拦截器条件留在 `WHERE`。
- SQLite 3.39 起支持 `RIGHT JOIN`（`node:sqlite` 自带的版本够新）。

## 换 schema

`db.inSchema('archive_2025')` 返回一个把所有表放到另一个 schema（MySQL 是库）下的 Db，`db.inSchema('hot', ['Post'])` 只换这几个实体；
表名已带 schema 前缀的换掉前缀。对应 Java 版的 `asSchema`，底下就是 `mapTables`，导航、子查询都跟着换。

## 限制

- 导航本身的 inner 语义（`u.company` 强制内连接）没做；要内连接请显式 `innerJoin(Company, …)`。
- 更新 / 删除里仍不允许 join（各库写法不一致），用一对多的 `any()`。
