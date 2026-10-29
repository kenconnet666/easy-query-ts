# TS：多对多导航与复合外键

## 多对多

经中间表连接两个实体，中间表也是 schema 里的一个实体（常常是复合主键）：

```ts
const schema = defineSchema(
  { User, Role, UserRole },
  {
    User: (r) => ({
      roles: r.manyToMany('Role', {
        through: 'UserRole',
        throughFrom: 'userId',
        throughTo: 'roleId',
      }),
    }),
    Role: (r) => ({
      users: r.manyToMany('User', {
        through: 'UserRole',
        throughFrom: 'roleId',
        throughTo: 'userId',
      }),
    }),
  },
);

db.queryable(User).where((u) => u.roles.any((r) => r.name.eq('admin'))); // EXISTS，经中间表
db.queryable(User).select((u) => ({
  name: u.name,
  roles: u.roles.orderBy((r) => r.name).toList((r) => ({ name: r.name })), // 第二条查询把中间表 inner join 进来，按 IN 拼装
  top: u.roles.orderBy((r) => r.name.desc()).first((r) => ({ name: r.name })), // 每个用户最多一个
}));
```

`any / none / count / sum / … / toList / first / limit` 与一对多导航完全一样。`from` / `to` 是本表与目标表上被中间表引用的列，省略时用各自的主键；`throughFrom` / `throughTo` 是中间表上的列，类型检查只允许中间表的列名。拦截器（租户、逻辑删除等）也作用在中间表上，条件放进它的 ON。

## 复合外键

`from` / `to` 写成列的数组，两边个数必须相同（定义时检查），按位置一一对应：

```ts
Member: r => ({ notes: r.many('Note', { from: ['tenantId', 'id'], to: ['tenantId', 'memberId'] }) }),
Note: r => ({ member: r.one('Member', { from: ['tenantId', 'memberId'], to: ['tenantId', 'id'] }) }),
```

多对一的 JOIN、一对多的子查询、toList 的第二条查询都按整组列匹配。toList 的复合键写成 `(a = ? AND b = ?) OR …`，单列时仍是 `IN`（行值 `IN` 各库支持不一，这样处处可用）。多对一里任何一个 `from` 列可空，目标就可空。

## 验证与限制

SQLite、MySQL 8.0.18 / 8.4、PG 17 实测；HANA 随 CI 验证（只用标准 JOIN / EXISTS）。关系的 `from` / `to` 在运行时统一成数组，`Relation` 类型里是 `readonly string[]`。复合键个数不一致在类型层面检查不了，定义时报错。

## 直达关系（对应 directMapping）

沿着已经定义的导航走到目标，之后当一个普通导航用：

```ts
User: (r) => ({
  roles: r.manyToMany('Role', { through: 'UserRole', throughFrom: 'userId', throughTo: 'roleId' }),
  menus: r.path('Menu', ['roles', 'menus']),          // 经角色到菜单：用法同一对多
  city: r.pathOne('City', ['company', 'city']),       // 全是多对一：等同于 u.company.city，目标可空
}),
```

- `r.path` 把各段拼成一张去重（DISTINCT）的桥：`父键 → 目标键`，inner join 到目标表上。同一个菜单经两个角色到达也只算一次，`count`、`sum`、`toList` 都不重复。
- 各段的拦截器条件、中间各段的固定条件在桥里；最后一段的固定条件作用在目标上。
- `r.pathOne` 不建桥，就是一段段访问导航，与直接写 `u.company.city` 共用同样的 JOIN。
- 导航名、终点、种类（经过一对多就必须用 `path`）在 `defineSchema` 时核对；直达关系不能再引用直达关系；`save` 不能 cascade 它。

## 分组 join（对应 subQueryToGroupJoin）

`u.posts.count()` 是每行一个关联子查询；列表页行多时改成 `u.posts.groupJoin().count()`：子表按关联列分组一次，再 `LEFT JOIN` 回来。

```ts
select((u) => ({
  name: u.name,
  posts: u.posts.groupJoin().count(),
  total: u.posts.groupJoin().sum((p) => p.amount), // 与上一行共用同一个分组 join
}));
```

同一个导航（含它的 `where`）上的几个聚合共用一个分组 join；没有子项时 `count` 是 0，其余是 null，与子查询的写法一致。
分组 join 是独立的语句，导航的 `where` 里不能引用外层的表；`any` / `none` 仍是 `EXISTS`。

## 按键填充（对应 fillMany / fillOne）

不需要声明关系：按键从另一条查询填一个数组或一行，查询可以来自另一个 Db（另一个库）。

```ts
const logs = logDb
  .queryable(Log)
  .orderBy((l) => l.at)
  .select((l) => ({ at: l.at, text: l.text }));
db.queryable(Order).select((o) => ({
  no: o.no,
  logs: logs.fillMany((l) => l.orderNo, o.no), // { at; text }[]
  owner: db.queryable(Staff).fillOne((s) => s.code, o.ownerCode), // Row<Staff> | null
}));
```

主查询读完后按一批键（每批 500 个）各查一次；被填充的查询的 `where`、`orderBy`、`select`（含嵌套的 `toList`）照常生效，`include` 里也能用。
不能带 `limit` / `offset`（那是对整批的，不是每行的），键为 NULL 的行填不到东西。
