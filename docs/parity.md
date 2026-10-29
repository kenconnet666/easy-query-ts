# easy-query TS 与 Java 版的对照

2026-10-28 初版（ROADMAP 11b.1），2026-10-29 补齐缺口后重核。Java 版的能力取自 `easy-query` 仓库 `EntityQueryable`、`ClientQueryable` 的方法清单与 `sql-test` 用例；
TS 版的状态按 `packages/easy-query/core/src` 的实现核过。"写法不同"指能力有、只是按 TS 的长处换了写法（多半更短）。
状态：✓ 已有｜≈ 写法不同｜✗ 缺｜— 不做。

## 查询与执行

| Java                                                                  | TS                                                                              | 状态 | 说明                                                          |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------------- | ---- | ------------------------------------------------------------- |
| `toList`                                                              | `toList()`                                                                      | ✓    |                                                               |
| `firstOrNull` / `singleOrNull`                                        | `first()`（没有时 undefined）/ `single()`（不是恰好一行就抛错）                 | ≈    |                                                               |
| `firstNotNull` / `singleNotNull` / `required()`（没有就抛带说明的错） | `firstOrThrow(message)` 抛 `NotFoundError`；`single()` 本来就抛                 | ✓    |                                                               |
| `findOrNull(id)` / `findNotNull(id)`、`whereById` / `whereByIds`      | `find(key)` / `findOrThrow(key)`、`whereKey(key)` / `whereKeys(keys)`           | ✓    | 复合主键传 `{ 列: 值 }`                                       |
| `toPageResult`                                                        | `toPage(page, size)` → `{ rows, total, page, size }`                            | ✓    | 接组件库的表格用 `table(request)`，见下                       |
| `toStreamResult` / `streamBy` / `forEach`                             | `stream()`（`for await`）                                                       | ✓    |                                                               |
| `toChunk` / `offsetChunk`                                             | `stream()`                                                                      | ≈    | 分批处理用流式读取                                            |
| `toMap` / `toMaps`                                                    | 行本来就是普通对象                                                              | ≈    | 按某列建 Map 用 `new Map(rows.map(…))`                        |
| `count` / `any` / 聚合                                                | `count()`、`any()`、`sum` / `avg` / `max` / `min`                               | ✓    |                                                               |
| `sumOrNull` / `sumOrDefault`                                          | `sum(...)` 没有行（或全为 NULL）时是 `null`；要默认值写 `(await q.sum(…)) ?? 0` | ≈    | 已核：根聚合、导航上的聚合、groupJoin 都是 null；`count` 是 0 |
| `toSQL`                                                               | `toSQL()`                                                                       | ✓    |                                                               |
| `cloneQueryable`                                                      | 查询对象不可变，天然可以复用                                                    | ≈    |                                                               |

## 条件、排序、分页、连接

| Java                                                                         | TS                                                                | 状态 | 说明                                                                    |
| ---------------------------------------------------------------------------- | ----------------------------------------------------------------- | ---- | ----------------------------------------------------------------------- |
| `where`（lambda、多表 `whereMerge`）                                         | `where((a, b) => …)`，join 后的 lambda 收到全部表                 | ✓    |                                                                         |
| `filterConfigure(NotNullOrEmptyValueFilter)`（空值的条件不生效）             | 条件写成数组，`name && u.name.like(name)` 这类短路为假的项忽略    | ≈    | 比 Java 版更直接                                                        |
| `whereObject`（按对象的注解生成条件）                                        | `table(parseTableRequest(query))`：表头筛选、关键字、条件树、区间 | ≈    | 只认结果里的列（白名单），对接组件库的 `useTableQuery` / FilterBar      |
| `orderBy` / `orderByAsc` / `orderByDesc`                                     | `orderBy(u => [u.age.desc(), …])`                                 | ✓    |                                                                         |
| `orderByObject`（`ObjectSort` 动态排序）                                     | `table(request)` 的 `sort=-amount,name`                           | ≈    | 同上，只放行结果里的列                                                  |
| `limit` / `distinct` / `groupBy` / `having` / `rollup` / `cube` / `grouping` | 同名                                                              | ✓    |                                                                         |
| `union` / `unionAll` / `toCteAs` / 派生表 `asTable`                          | `union`、`unionAll`、`db.with`、`asTable()`                       | ✓    |                                                                         |
| `innerJoin` / `leftJoin`                                                     | 同名                                                              | ✓    |                                                                         |
| `rightJoin` / `crossJoin`                                                    | 同名                                                              | ✓    | right join 之后此前各表的列在类型上变成可空；它们的拦截器条件进这个 ON  |
| `forUpdate` / `forUpdateNoWait` / `forUpdateSkipLocked`                      | 同名；锁一行用 `tx.lock(Entity, key)`                             | ✓    |                                                                         |
| `noInterceptor` / `useInterceptor`                                           | `noInterceptor(name)`                                             | ✓    |                                                                         |
| `useLogicDelete(false)`                                                      | `noInterceptor('softDelete')`                                     | ≈    |                                                                         |
| `asTable(name)`（换表名）                                                    | `db.mapTables({ Post: 't_post_2025' })`，导航与隐式子查询都跟着换 | ≈    | 比 Java 版的 `asTable` 覆盖得全                                         |
| `asSchema`                                                                   | `db.inSchema('archive')`、`db.inSchema('hot', ['Post'])`          | ≈    | 整个 Db 换，不用逐条查询写                                              |
| `asTableLink`                                                                | —                                                                 | —    | 跨库链接各库写法不一（HANA 的 remote source、PG 的 FDW），交给 `db.sql` |

## 导航、DTO / VO、对象树

| Java                                                        | TS                                                                             | 状态 | 说明                                                   |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------ | ---- | ------------------------------------------------------ |
| `@Navigate`（一对一、多对一、一对多、多对多）、复合键       | `r.one` / `r.many` / `r.manyToMany`，`from` / `to` 可以是列元组                | ✓    |                                                        |
| 隐式 join（`u.company().name()`）                           | `u.company.name`                                                               | ✓    |                                                        |
| 隐式子查询（`any` / `none` / `count` / `sum` …）            | `u.posts.any(…)` 等                                                            | ✓    |                                                        |
| 隐式分区（每组取第一条）                                    | `u.posts.orderBy(…).first(…)`、`limit(n).toList(…)`                            | ✓    |                                                        |
| 导航上写固定条件（`extraFilter`）                           | `r.many('Post', …, { where: (p) => … })`                                       | ✓    |                                                        |
| `@Navigate(directMapping)`（跨几段导航的直达关系）          | `r.path('Menu', ['roles', 'menus'])`、`r.pathOne('City', ['company', 'city'])` | ✓    | 经几条路径到达同一目标只算一次；导航名与终点定义时核对 |
| `include` / `includes`（带出导航，可嵌套）                  | `include(u => ({ posts: u.posts.toList() }))`，嵌套在 `toList` 里继续选        | ✓    |                                                        |
| `selectAutoInclude(DTO.class)`（按 DTO 的结构自动带出导航） | `select(View)`：`defineView` 声明列与导航，类型自动推出                        | ≈    | 不用写 DTO 类与注解；视图可以嵌套、复用                |
| `@NavigateFlat`（把导航上的列平铺进 DTO）                   | 在形状里直接写 `company: u.company.name`                                       | ≈    |                                                        |
| VO 映射（`select(VO.class)`，同名属性对应）                 | `select(u => ({ … }))` 或 `defineView`；结果类型由形状推出                     | ≈    |                                                        |
| 对象树（一对多多层带出）                                    | 形状里嵌套 `toList`，一次查询拼成对象树                                        | ✓    |                                                        |
| 对象树的 VO（树上每层都是投影）                             | 嵌套视图：`posts: u.posts.toList(PostCard)`                                    | ✓    |                                                        |
| `toTreeList`（自关联的表拼成树）                            | `toTree({ id, parent })`                                                       | ✓    |                                                        |
| `asTreeCTE`（递归取子树 / 祖先）                            | `db.descendantsOf(...)` / `db.ancestorsOf(...)`                                | ✓    | 递归 CTE；HANA 没有 WITH RECURSIVE                     |
| `fillOne` / `fillMany`（填充不是导航的关联）                | `query.fillMany((l) => l.orderNo, o.no)` / `fillOne(...)`，放在 select 里      | ✓    | 被填充的查询可以来自另一个 Db（另一个库）              |
| `subQueryToGroupJoin`（每行一个子查询改成分组 join）        | `u.posts.groupJoin().count()` / `.sum(…)`                                      | ✓    | 同一个导航上的几个聚合共用一个分组 join                |

## 列与写入

| Java                                                                                     | TS                                                                                                      | 状态 | 说明                                                                  |
| ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- | ---- | --------------------------------------------------------------------- |
| `insertable` / `updatable` / `deletable`、批量                                           | `insert` / `update` / `delete`，`update(X).entity(row)`、`entities(rows)`                               | ✓    |                                                                       |
| `onConflictThen`（upsert）                                                               | `onConflict(...).merge / ignore`（HANA 为 MERGE）                                                       | ✓    |                                                                       |
| 级联保存                                                                                 | `db.save(…, { include })`、`db.remove`（多层、多对多、removed）                                         | ✓    |                                                                       |
| `INSERT … SELECT`                                                                        | `insert(X).fromQuery(query)`                                                                            | ✓    |                                                                       |
| 返回生成的键、整行                                                                       | `returnId()`、`returnEntity()`、`returning`                                                             | ✓    |                                                                       |
| 乐观锁 `@Version`、逻辑删除、加密列、`@InsertIgnore` / `@UpdateIgnore`、默认值           | 列修饰器 `version` / `softDelete` / `encrypted` / `insertOnly` / `$default` / `$onUpdate`               | ✓    |                                                                       |
| `@ValueObject`（几列合成一个嵌套对象）                                                   | `address: embed({ city: col.string(), … })`，查询里 `c.address.city`                                    | ✓    | 列名默认 `address_city`；更新可以只给其中几项                         |
| `ColumnValueSQLConverter`（列值在 SQL 里转换）                                           | `col.string().sqlConvert({ read, write })`                                                              | ✓    | 读的地方（select、where、排序）与写进去的值都包一层；RETURNING 拿不到 |
| 改到的行数检查                                                                           | `expectRows(n, () => error)`                                                                            | ✓    |                                                                       |
| 追踪（`asTracking`，按差异更新）                                                         | `update(X).changes(before, after)`                                                                      | ≈    | 不要追踪上下文：before 由调用方给，按列的类型比较（决定 0003）        |
| 版本策略（int、long、UUID、时间戳）、`withVersion`、`ignoreVersion`、`deletable(entity)` | `version()`、`version({ initial, next })`、`withVersion(v)`、`ignoreVersion()`、`delete(X).entity(row)` | ✓    |                                                                       |
| 逻辑删除时写删除人（自定义逻辑删除策略）                                                 | 列修饰 `$onDelete(() => user)`                                                                          | ≈    | 与 `$onUpdate` 对称                                                   |
| 加密列模糊搜索 `supportQueryLike`                                                        | `encrypted({ …, searchable: true })`                                                                    | ✓    | 不可分段的策略上 like 直接报错                                        |
| 内置 AES / SM4 加密策略（含可分段的 Safe 版）                                            | `@zerodep-dev/easy-query-ts-crypto`：`aesEncryption` / `sm4Encryption({ searchable })`                  | ✓    | 分段与 Base64 与 Java 版一致，能读 Java 版写的密文                    |
| 数据库函数生成列 `generatedSQLColumnGenerator`                                           | 插入值或 `$default` 返回 `sql` 片段                                                                     | ≈    |                                                                       |

## 其他

| Java                                                                                        | TS                                                                                                     | 状态 | 说明                                          |
| ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ | ---- | --------------------------------------------- |
| 值转换器、JSON 列                                                                           | `col.custom` / `codec`、`col.json` 接 Standard Schema（zod）                                           | ✓    |                                               |
| 函数库 `SQLFunc`、窗口函数、方言专属函数                                                    | 函数库、`win.*`、`MySQL` / `Pg` / `Hana` 入口                                                          | ✓    |                                               |
| 原生 SQL 片段                                                                               | `db.sql` 标签模板                                                                                      | ✓    |                                               |
| 拦截器（租户、更新时间、自定义）                                                            | `tenant`、`touch`、自定义                                                                              | ✓    |                                               |
| `noInterceptor` / `useInterceptor`、`enable`、`ProtectedInterceptor`、`relationLogicDelete` | 语句、Db（`withInterceptors`）、一对多导航、join 的表上 `{ use, skip }`；`enabled: false`、`protected` | ✓    | 名字登记在 `InterceptorNames`，写错编译期报错 |
| 审计日志（替换 `EntityExpressionExecutor`）                                                 | `afterWrite` 的事件带插入的行、更新的 set、语句                                                        | ≈    |                                               |
| `deleteThrow`、`resultSizeLimit`                                                            | `createDb({ hardDelete: 'forbid', maxRows })`                                                          | ≈    | maxRows 超了报错，不截断                      |
| 事务提交后的回调                                                                            | `tx.afterCommit` / `afterRollback`                                                                     | ✓    |                                               |
| 分库分表、二级缓存                                                                          | —                                                                                                      | —    | 不做                                          |
| DTO 代码生成插件                                                                            | —                                                                                                      | —    | 不需要：结果类型由形状推出                    |

## 剩下的

对照表里已经没有"✗"。不做或换了写法的几项（追踪上下文、分库与跨库归并、二级缓存、跨库链接、代理类与 DTO 生成）的理由与可行性见决定 0002、0003。
