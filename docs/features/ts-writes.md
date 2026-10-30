# TS：写入补全（`save`、`returnEntity`、批量更新、`afterWrite`）

## `save` / `remove`：聚合保存一棵对象树

对应官方的 savable。官方靠追踪上下文算差异；这里不需要上下文：在事务里按父键把现有子项查出来，与提交的树比较。保存哪些导航写在带类型的 `include` 树里：

```ts
const saved = await db.save(
  User,
  {
    id: 1,
    name: 'alice2',
    company: { name: 'initech' },
    posts: [{ id: 5, title: 'changed', comments: [{ body: 'new' }] }, { title: 'new' }],
    roles: [{ id: 2 }, { name: 'ops' }],
  },
  {
    include: {
      company: true, // 多对一：先存公司，再设外键
      posts: { removed: 'delete', include: { comments: true } }, // 一对多：不在列表里的帖子连评论一起删
      roles: true, // 多对多：只增删中间表里变了的行
    },
  },
);
await db.remove(User, 1, { include: { posts: { include: { comments: true } }, roles: true } });
```

- **类型**：`include` 的键由实体的关系推出，输入里能写哪些导航、值是数组还是对象由 `include` 决定；写错导航名、没写进 `include` 就给导航赋值、`key` 不是目标的列，都在编译期报错（官方的 `savePath` 是字符串）。
- **整个过程在一个事务里**（已经在事务里就用当前的）：任何一步失败，父行也不会留下。返回保存后重新读出的父行。
- **本行**：有库里的原行（子项匹配到了）时按差异更新，没变化不发语句；带完整主键时存在就**只更新给出的列**（没给的保持原值，`$onUpdate` 照常生效），不存在就插入；没给主键（自增）就插入并取回新主键。
- **一对多、一对一（外键在对方）**：子项按主键认出原来的行；没给主键时可以用 `key: 'title'` 按业务列认（对应 SaveKey）。认出的按差异更新，其余插入，关联列自动设成父行的值（换父也行）。
- **移除的子项**（`removed`）：`'delete'` 删除（沿 `include` 先删它的子项）、`'unlink'` 外键置空、`'keep'` 不动。没写时外键可空就置空；不可空且确实有要移除的行就报错，不会默认删数据。
- **多对一（外键在本表）**：先保存目标再设外键；给 `null` 时外键置空，目标不动。
- **多对多**：只给了关联列的项只连中间表；带了别的字段先保存目标。中间表按现状比较，只插入新的、删除去掉的（不删了重建，中间表上的业务列不受影响）。`removed: 'delete'` 时连目标一起删。
- 输入里没出现的导航不动；直达关系（`path`）、任意条件的关系（`manyOn` / `oneOn`）不能保存。
- `remove(entity, key, { include })`：删一棵树，行不存在返回 false；逻辑删除的实体照常是逻辑删除。
- 必填列的检查交给数据库：插入新行时少了必填列会报错（连带整个事务回滚）。
- 为什么"先查再改"而不是 upsert：`INSERT … ON CONFLICT` 先校验新行的 NOT NULL，只给部分列时，即使行已存在也会失败。代价是并发插入同一主键时可能撞唯一约束。

## `returnEntity`：插入并拿回完整的行

```ts
const doc = await db
  .insert(Doc)
  .values({ title: 't', createdBy: 'x', secret: 'hush' })
  .returnEntity();
// doc.id（自增）、doc.status（库里的默认值）、doc.token（$default）、doc.version（乐观锁初值）都在里面
```

PG、SQLite 用 `RETURNING` 一条语句；MySQL、HANA 先插入拿到主键再按主键查回来（走拦截器过滤，逻辑删除、租户等照常）。`$default` 生成的值（如随机 uuid）只算一次，插入和回查用同一份。需要单行；没有主键的实体不能用。

## 批量更新

`db.update(Post).entities(rows).execute()`：每行按主键一条 `entity(row)` 语句（带乐观锁条件、跳过 `insertOnly` 列），返回总更新行数。不自带事务，要原子请放进 `db.transaction`。批量删除用已有的 `delete(X).where(x => x.id.in(ids))`。

`.batch()` 把写的列相同的行合成一条语句（对应官方的 `batch()`）：

```sql
UPDATE t_post SET title = CASE WHEN id = ? THEN ? WHEN id = ? THEN ? ELSE title END, ...
WHERE (id = ? AND version = ?) OR (id = ? AND version = ?)
```

官方靠 JDBC 的批量接口（同一条 SQL 多组参数）；Node 的驱动没有统一的等价物，所以直接合成一条，各库都是一次往返，按方言的绑定参数上限切块。带版本列时逐行带版本条件，改到的行数不足就抛 `optimistic lock failed: n of m`。`ELSE 原列` 不会走到（条件只选中这些行），是给 PG 推断 CASE 类型用的。插入本来就是多行 `VALUES` 一条语句。

## 大批量写入（ROADMAP 19.5）

```ts
await db.insert(Event).values(rows).execute(); // PG：100 行起一条 unnest 语句插完
await db
  .insert(Doc)
  .values(row)
  .onConflict((d) => d.id)
  .merge(undefined, { onlyIf: (current, incoming) => current.version.lt(incoming.version) }); // 只在新版本更大时覆盖
while (
  (await db
    .delete(Log)
    .where((l) => l.at.lt(cutoff))
    .orderBy((l) => l.id)
    .limit(1000)
    .execute()) > 0
) {}
```

- **PG 的 unnest**：一次插入达到 100 行、所有值都是参数时，每列绑一个数组参数（`INSERT … SELECT * FROM unnest(CAST($1 AS 类型[]), …)`），
  一条语句插完：不受 65535 个参数的限制、只解析一次。数组字面量由方言自己拼（不依赖驱动怎么序列化数组），数组列、表达式值照旧写成 VALUES；
  openGauss 没有多参数的 unnest，照旧 VALUES。
- **MySQL 按包大小切分**：批量插入在按参数个数切块之后，再按估计的字节数切，不超过 `max_allowed_packet` 的四分之三；
  `mysql.detect` 读服务器的实际值，`mysql(pool)` 默认按 4 MiB（`mysql(pool, { maxPacket })` 可改）。
- **带条件的 upsert**：`merge(列, { onlyIf: (现有行, 新行) => 条件 })` 渲染成 `ON CONFLICT … DO UPDATE … WHERE`（PG、SQLite；
  现有行用 `INSERT INTO t AS t0` 的别名，新行是 `excluded`）。没有这种写法的库（MySQL、openGauss 等）构建时报不支持。
- **分批改、删**：update / delete 的 `orderBy(…).limit(n)` 只动前 n 行，循环到 0 就把大表分批处理完、不开长事务。MySQL 写成
  `ORDER BY … LIMIT`，别的库写成"主键 IN (按同样条件排序取前 n 行的主键)"（要单列主键）；不能与导航、分表一起用。
- 没做 PG 15 的 `MERGE`：插入或更新已由 upsert 覆盖，`MERGE` 的多分支（匹配时改 / 删、不匹配时插）要一套新的 API，留到有具体需求时再加。

## 写哪些列（对应 `SQLExecuteStrategyEnum`）

TS 里"没给"（`undefined`）与"写 null"本来就分得开：没给的列一律不写。另外可以按值挑：

```ts
await db.insert(User).values(form, { columns: 'notNull' }).execute(); // null 也不写，交给库里的默认值
await db.update(User).entity(form, { columns: 'notNull' }).execute(); // 表单里没填的保持原值
await db.update(User).entity(row, { columns: 'null' }).execute(); // 只把 null 的列写成 NULL
await db.update(Post).entities(rows, { columns: 'notNull' }).batch().execute();
```

主键、版本、只插入的列不受策略影响（本来就不由它写）；`$onUpdate`、拦截器在挑完之后照常补值。

## `afterWrite` 拦截器钩子

```ts
const audit: Interceptor = {
  name: 'audit', // 名字登记在 InterceptorNames 里
  afterWrite: (e) => {
    switch (e.kind) {
      case 'insert':
        return log('insert', e.entity.table, e.rows); // 补好默认值的各行
      case 'update':
        return log('update', e.entity.table, e.set); // 写进去的值
      case 'delete':
        return log(e.soft ? 'soft delete' : 'delete', e.entity.table);
    }
  },
};
createDb({ schema, adapter, interceptors: [audit] });
```

`insert / update / delete`（含 `returnId`、`returning`、`fromQuery`、批量更新、逻辑删除）成功执行之后调用。事件是判别联合：
`insert` 带插入的各行（INSERT … SELECT 时为空）、`update` 带 set、`delete` 带是否逻辑删除，都带执行的语句与参数（条件在里面）和影响的行数。
**钩子在同一个事务里**，抛错会让这次写入失败、事务回滚——可以当作"否决"用；做审计日志也在这里。写入语句上同样可以 `noInterceptor(name)`。

审计要前后对比时，拦截器声明 `before: true`：update / delete（含逻辑删除、`returning`、批量）执行前，核心按这条语句同样的条件（含拦截器给 update / delete 加的租户、逻辑删除条件）先读一次整行，放进 `e.before`（已解码、值对象是嵌套对象）。
多一条查询，所以只在有生效的拦截器声明时才读，`before` 也可以写成按实体判断的函数（`(entity) => cached.has(entity.table)`），只给认的实体读；官方没有对应的现成能力（要自己替换执行器）。

`e.afterCommit(task)` 登记提交之后做的事（清缓存、发消息）：在事务里等提交（回滚就不做），不在事务里时在这条语句之后马上做。二级缓存的延迟双删就用它。

```ts
const diff: Interceptor = {
  name: 'audit',
  before: true,
  afterWrite: (e) => {
    if (e.kind === 'update') for (const row of e.before ?? []) log(row, e.set);
  },
};
```

## 差异更新：`changes(before, after)`

```ts
const before = await tx.queryable(User).findOrThrow(id);
await tx.update(User).changes(before, form).execute(); // 只 set 变了的列；没有变化返回 0、不发语句
```

对应 Java 版追踪模式下的差异更新，但不需要追踪上下文：按列的编码比较（日期比时刻、JSON 比内容、decimal.js 比文字、值对象逐项），
按 before 的主键（与版本）定位，after 可以只是表单提交的几项。表达式更新要乐观锁时写 `.withVersion(current)`。

## 更新 / 删除里用导航（对应官方 UpdateDeleteJoinTest）

```ts
await db
  .update(Post)
  .set((p) => ({ title: p.user.name }))
  .where((p) => p.user.name.eq('bob'))
  .execute();
await db
  .delete(Comment)
  .where((c) => c.post.user.name.eq('alice'))
  .execute();
```

条件、set 里的多对一导航照查询时一样生成 LEFT JOIN（拦截器条件进 ON），按方言渲染：

| 库         | 更新                                                                                   | 删除                                                        |
| ---------- | -------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| MySQL      | `UPDATE t AS t0 LEFT JOIN u t1 ON … SET t0.c = … WHERE …`                              | `DELETE t0 FROM t AS t0 LEFT JOIN … WHERE …`                |
| PG、SQLite | `UPDATE t AS t0_w SET c = … FROM t t0 LEFT JOIN u t1 ON … WHERE t0_w.id = t0.id AND …` | `DELETE FROM t AS t0_w WHERE EXISTS (SELECT 1 FROM t t0 …)` |

官方在 PG 上把导航放进 `FROM`、条件放进 `WHERE`，等于 INNER JOIN——目标不存在的行不会被更新。这里 PG / SQLite 用自连接（目标表另起别名，按主键对上），
LEFT JOIN 的语义与查询一致：`where(u => u.company.name.isNull())` 也会选中没有公司的用户。代价是要有主键；`returning()` 不能与导航一起用（自连接里列名重名）。
可空导航写进不可空列时编译期报错，要 `orElse(…)` 兜底。

## 验证与限制

SQLite、MySQL 8.0.18 / 8.4、PG 17 实测（含 `save` 失败整体回滚、afterWrite 抛错回滚事务）。
