# easy-query TS 与 Java 版的对照

2026-10-28 初版（ROADMAP 11b.1）。Java 版的能力取自 `easy-query` 仓库 `EntityQueryable`、`ClientQueryable` 的方法清单与 `sql-test` 用例；
TS 版的状态按 `packages/easy-query/core/src` 的实现核过。"写法不同"指能力有、只是按 TS 的长处换了写法（多半更短）。
状态：✓ 已有｜≈ 写法不同｜✗ 缺｜— 不做。缺的按"流程引擎、示例应用用得到的先做"排进 ROADMAP 11b。

## 查询与执行

| Java                                                                  | TS                                                              | 状态 | 说明                                          |
| --------------------------------------------------------------------- | --------------------------------------------------------------- | ---- | --------------------------------------------- |
| `toList`                                                              | `toList()`                                                      | ✓    |                                               |
| `firstOrNull` / `singleOrNull`                                        | `first()`（没有时 undefined）/ `single()`（不是恰好一行就抛错） | ≈    |                                               |
| `firstNotNull` / `singleNotNull` / `required()`（没有就抛带说明的错） | `firstOrThrow(message)` 抛 `NotFoundError`；`single()` 本来就抛 | ✓    | 2026-10-28 补                                 |
| `findOrNull(id)` / `findNotNull(id)`、`whereById` / `whereByIds`      | —                                                               | ✗    | 按主键查，复合主键也要支持                    |
| `toPageResult`                                                        | `toPage(page, size)` → `{ rows, total, page, size }`            | ✓    | 与组件库的 `useTableQuery` 对接见下           |
| `toStreamResult` / `streamBy` / `forEach`                             | `stream()`（`for await`）                                       | ✓    |                                               |
| `toChunk` / `offsetChunk`                                             | `stream()`                                                      | ≈    | 分批处理用流式读取                            |
| `toMap` / `toMaps`                                                    | 行本来就是普通对象                                              | ≈    | 按某列建 Map 用 `new Map(rows.map(…))`        |
| `count` / `any` / 聚合（`sumOrNull`、`sumOrDefault`…）                | `count()`、`any()`、`sum`/`avg`/`max`/`min`                     | ≈    | 没有行时的返回值（null 还是 0）待核，写进文档 |
| `toSQL`                                                               | `toSQL()`                                                       | ✓    |                                               |
| `cloneQueryable`                                                      | 查询对象不可变，天然可以复用                                    | ≈    |                                               |

## 条件、排序、分页

| Java                                                                         | TS                                                                | 状态 | 说明                                                                            |
| ---------------------------------------------------------------------------- | ----------------------------------------------------------------- | ---- | ------------------------------------------------------------------------------- |
| `where`（lambda、多表 `whereMerge`）                                         | `where((a, b) => …)`，join 后的 lambda 收到全部表                 | ✓    |                                                                                 |
| `filterConfigure(NotNullOrEmptyValueFilter)`（空值的条件不生效）             | 条件写成数组，`name && u.name.like(name)` 这类短路为假的项忽略    | ≈    | 比 Java 版更直接                                                                |
| `whereObject`（按对象的注解生成条件）                                        | —                                                                 | ✗    | 列表页的筛选表单直接交给查询；对接组件库 FilterBar / `useTableQuery` 的筛选参数 |
| `orderBy` / `orderByAsc` / `orderByDesc`                                     | `orderBy(u => [u.age.desc(), …])`                                 | ✓    |                                                                                 |
| `orderByObject`（`ObjectSort` 动态排序）                                     | —                                                                 | ✗    | 对接 `useTableQuery` 的 `-amount,name` 排序参数，只放行声明过的列               |
| `limit` / `distinct` / `groupBy` / `having` / `rollup` / `cube` / `grouping` | 同名                                                              | ✓    |                                                                                 |
| `union` / `unionAll` / `toCteAs` / 派生表 `asTable`                          | `union`、`unionAll`、`db.with`、`asTable()`                       | ✓    |                                                                                 |
| `innerJoin` / `leftJoin`                                                     | 同名                                                              | ✓    |                                                                                 |
| `rightJoin` / `crossJoin`                                                    | —                                                                 | ✗    | 低优先：对调表顺序写 leftJoin 即可（BACKLOG 已记）                              |
| `forUpdate` / `forUpdateNoWait` / `forUpdateSkipLocked`                      | 同名                                                              | ✓    |                                                                                 |
| `noInterceptor` / `useInterceptor`                                           | `noInterceptor(name)`                                             | ✓    |                                                                                 |
| `useLogicDelete(false)`                                                      | `noInterceptor('softDelete')`                                     | ≈    |                                                                                 |
| `asTable(name)`（换表名）                                                    | `db.mapTables({ Post: 't_post_2025' })`，导航与隐式子查询都跟着换 | ≈    | 比 Java 版的 `asTable` 覆盖得全                                                 |
| `asSchema` / `asTableLink`                                                   | —                                                                 | ✗    | 低优先，等用到                                                                  |

## 导航、DTO / VO、对象树

| Java                                                        | TS                                                                      | 状态 | 说明                                           |
| ----------------------------------------------------------- | ----------------------------------------------------------------------- | ---- | ---------------------------------------------- |
| `@Navigate`（一对一、多对一、一对多、多对多）、复合键       | `r.one` / `r.many` / `r.manyToMany`，`from` / `to` 可以是列元组         | ✓    |                                                |
| 隐式 join（`u.company().name()`）                           | `u.company.name`                                                        | ✓    |                                                |
| 隐式子查询（`any` / `none` / `count` / `sum` …）            | `u.posts.any(…)` 等                                                     | ✓    |                                                |
| 隐式分区（每组取第一条）                                    | `u.posts.orderBy(…).first(…)`                                           | ✓    |                                                |
| 导航上写固定条件（`extraFilter`，例如"有效的子项"）         | 只能在每次查询里写 `u.items.where(…)`                                   | ✗    | 定义关系时声明，查询处不用再写                 |
| `include` / `includes`（带出导航，可嵌套）                  | `include(u => ({ posts: u.posts.toList() }))`，嵌套在 `toList` 里继续选 | ✓    |                                                |
| `selectAutoInclude(DTO.class)`（按 DTO 的结构自动带出导航） | `select(View)`：`defineView` 声明列与导航，类型自动推出                 | ≈    | 不用写 DTO 类与注解；视图可以嵌套、复用        |
| `@NavigateFlat`（把导航上的列平铺进 DTO）                   | 在形状里直接写 `company: u.company.name`                                | ≈    |                                                |
| VO 映射（`select(VO.class)`，同名属性对应）                 | `select(u => ({ … }))` 或 `defineView`；结果类型由形状推出              | ≈    |                                                |
| 对象树（一对多多层带出）                                    | 形状里嵌套 `toList`，一次查询拼成对象树                                 | ✓    |                                                |
| 对象树的 VO（树上每层都是投影）                             | 嵌套视图：`posts: u.posts.toList(PostCard)`                             | ✓    |                                                |
| `toTreeList`（自关联的表拼成树：部门、分类）                | —                                                                       | ✗    | 补：按父子列把平铺的行拼成树，节点是视图的形状 |
| `asTreeCTE`（递归取子树 / 祖先）                            | 只有底层的 `db.withRecursive`                                           | ✗    | 补便捷写法：从某个节点取全部下级、全部上级     |
| `fillOne` / `fillMany`（填充不是导航的关联）                | —                                                                       | ✗    | 中优先：外部表或没有声明关系的列               |
| `subQueryToGroupJoin`（select 里每行一个计数改成分组 join） | —                                                                       | ✗    | 性能项：列表页每行显示子项数时用得上           |

## 写入

| Java                                                                           | TS                                                                                        | 状态 | 说明                      |
| ------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------- | ---- | ------------------------- |
| `insertable` / `updatable` / `deletable`、批量                                 | `insert` / `update` / `delete`，`update(X).entity(row)`                                   | ✓    |                           |
| `onConflictThen`（upsert）                                                     | `onConflict(...).merge / ignore`（HANA 为 MERGE）                                         | ✓    |                           |
| 级联保存                                                                       | `db.save(...)`（cascade / prune）                                                         | ✓    |                           |
| `INSERT … SELECT`                                                              | `insert(X).select(query)`                                                                 | ✓    |                           |
| 返回生成的键、整行                                                             | `returnId()`、`returnEntity()`、`returning`                                               | ✓    |                           |
| 乐观锁 `@Version`、逻辑删除、加密列、`@InsertIgnore` / `@UpdateIgnore`、默认值 | 列修饰器 `version` / `softDelete` / `encrypted` / `insertOnly` / `$default` / `$onUpdate` | ✓    |                           |
| 追踪（`asTracking`，按差异更新）                                               | —                                                                                         | —    | 不做实体追踪（设计 0002） |

## 其他

| Java                                     | TS                                                           | 状态 | 说明                         |
| ---------------------------------------- | ------------------------------------------------------------ | ---- | ---------------------------- |
| 值转换器、JSON 列                        | `col.custom` / `codec`、`col.json` 接 Standard Schema（zod） | ✓    |                              |
| 函数库 `SQLFunc`、窗口函数、方言专属函数 | 函数库、`win.*`、`MySQL` / `Pg` / `Hana` 入口                | ✓    |                              |
| 原生 SQL 片段                            | `db.sql` 标签模板                                            | ✓    |                              |
| 拦截器（租户、更新时间、自定义）         | `tenant`、`touch`、自定义                                    | ✓    |                              |
| 事务提交后的回调                         | —                                                            | ✗    | 流程引擎要用（ROADMAP 14.3） |
| 分库分表、二级缓存                       | —                                                            | —    | 不做                         |
| DTO 代码生成插件                         | —                                                            | —    | 不需要：结果类型由形状推出   |

## 缺口的先后（排进 ROADMAP 11b）

1. ~~按主键查与查不到就抛错~~（2026-10-28 已补）
2. ~~列表页的筛选与排序~~（2026-10-28、29 已补 `table`、条件树与区间）
3. ~~自关联的树~~（2026-10-28 已补 `toTree`、`descendantsOf`、`ancestorsOf`）
4. ~~导航上的固定条件~~（2026-10-29 已补）
5. 事务提交后的回调（与 14.3 合并做）
6. `subQueryToGroupJoin`、`fillOne` / `fillMany`——性能与外部关联，等真实页面用到
7. `rightJoin`、`crossJoin`、`asSchema`——等用到
