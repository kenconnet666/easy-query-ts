# 官方 easy-query 文档站的逐页对照

对照的是官方文档 `xuejmnet/easy-query-doc`（021c59e）`src` 下的中文页（ROADMAP 16.1.2）。状态：✓ 已对应｜≈ 写法不同（效果一致）｜✗ 待做（标出阶段 16 的子项）｜— 不适用（写明理由）。
用例层面的逐条对照见 `parity-tests.md`。做完一项改一项。

## 入门与概念

| 页面                                                          | TS 对应                                                                                                                     | 状态     |
| ------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- | -------- |
| quick-start、startup/step1–5、demo/*                          | 文档站 ORM 分区的快速开始；案例在 16.8.1 按官方的帖子、评论、类目模型重写一遍                                               | ✗ 16.8.1 |
| what-is-easy-query、feature、feature-map、catalog、v2-v3      | 概述性页面，对应文档站 ORM 首页                                                                                             | ✗ 16.8.1 |
| best-practices（实体设计）                                    | 实体、视图、关系的写法建议                                                                                                  | ✗ 16.8.1 |
| context-mode（实体无接口模式、DbSet）                         | TS 本来就不要接口：`db.queryable(User)`                                                                                     | ≈        |
| framework/concept、terminology、key-word（关键字加引号）      | 方言的 `quote`，所有标识符都加引号                                                                                          | ✓        |
| framework/annotation、annotation/readme                       | `entity()` 与列修饰器代替注解                                                                                               | ≈        |
| framework/mapping-db、mapping-rule                            | 属性名转下划线、`named()`；结果形状由 select 推出                                                                           | ≈        |
| framework/config-option、behavior、replace-configure          | `createDb` 的选项、拦截器、方言子类；逐项见 decisions/0003                                                                  | ≈        |
| framework/logging、adv/jdbc-listener                          | `log`、`onExecute`                                                                                                          | ✓        |
| framework/graalvm、guide/*（Spring、Solon、Kotlin、多数据源） | JVM 与 Java 框架的接入，不适用；多数据源即多个 `createDb`                                                                   | —        |
| framework/easy-trans                                          | Java 的字典翻译扩展；TS 用 `fillOne` / 视图                                                                                 | ≈        |
| plugin/*                                                      | IDEA 插件；DTO、代理类生成不需要（类型由形状推出）；由表生成实体：`eqts pull`（easy-query-ts-cli）；SQL 预览格式化见 16.8.1 | ✓ 16.5.3 |
| practice/*（APT、对象设计、自定义异常）                       | APT 不需要；`NotFoundError` 等错误类型                                                                                      | ≈        |

## 查询（ability、sub-query、native-sql、other）

| 页面                                                                | TS 对应                                                      | 状态     |
| ------------------------------------------------------------------- | ------------------------------------------------------------ | -------- |
| ability/select/single、common-api、expression、where、ability/where | `where` 条件数组、短路忽略空条件                             | ✓        |
| ability/select/order、page、group、union、case-when、partition      | `orderBy`、`toPage`、`groupBy`、`union`、`caseWhen`、`win.*` | ✓        |
| ability/select/join                                                 | 显式 join（含 right、cross）                                 | ✓        |
| ability/select/fill                                                 | `fillMany` / `fillOne`                                       | ✓        |
| ability/select/tree                                                 | `toTree`、`descendantsOf` / `ancestorsOf`                    | ✓        |
| ability/select/stream-query                                         | `stream()`                                                   | ✓        |
| ability/select/to-map、return-result/*                              | 结果是普通对象、匿名形状；无实体的按表名查询                 | ✗ 16.2.5 |
| ability/select/query-bean                                           | 条件对象：`filterBy(input, rules)`                           | ✗ 16.3.4 |
| ability/reuse                                                       | 查询对象不可变                                               | ≈        |
| ability/dynamic-table-name                                          | `mapTables`、`inSchema`                                      | ≈        |
| ability/native-sql、native-sql/*                                    | `sql` 标签、`db.sql`                                         | ✓        |
| ability/transaction                                                 | `transaction`、`begin`、保存点、`afterCommit`                | ✓        |
| sub-query/where-sub-query                                           | `in(query)`、`any`、`none`                                   | ✓        |
| sub-query/select-sub-query、select-sub                              | 导航上的聚合、标量子查询                                     | ✓        |
| sub-query/from-sub-query                                            | `asTable()` 派生表                                           | ✓        |
| sub-query/join-sub-query                                            | join 一条子查询                                              | ✗ 16.2.3 |
| other/flat-element                                                  | 一对多展开                                                   | ✗ 16.2.4 |
| other/table-with（`WITH(NOLOCK)`、ClickHouse 的 `FINAL`）           | 表后面追加片段                                               | ✗ 16.2.5 |

## 函数（func）

| 页面              | TS 对应                                                                                                                                               | 状态     |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| func/string       | 已有 upper、lower、trim、length、concat、substring、replace、indexOf、left、right；缺 ltrim、rtrim、补位、stringFormat、nullEmpty、compareTo、joining | ✗ 16.2.1 |
| func/datetime     | 已有 year、month、day、addDays、addMonths、diffDays、dateTrunc；缺 format、加时分秒年、时分秒、dayOfWeek / dayOfYear、duration、now                   | ✗ 16.2.1 |
| func/math、number | 已有 abs、floor、ceil、round、mod、加减乘除；缺 power、sqrt、log、exp、sign 等                                                                        | ✗ 16.2.1 |
| func/general      | 已有 orElse（nullOrDefault）、nullIf；缺 maxColumns / minColumns                                                                                      | ✗ 16.2.1 |
| func/boolean      | 条件即布尔表达式                                                                                                                                      | ✓        |
| func/offset       | 已有 lag、lead；缺 firstValue、lastValue、nthValue                                                                                                    | ✗ 16.2.1 |
| func/json         | 缺                                                                                                                                                    | ✗ 16.2.2 |

## 导航与 DTO（navigate、include、dto-query、prop）

| 页面                                                                               | TS 对应                                            | 状态     |
| ---------------------------------------------------------------------------------- | -------------------------------------------------- | -------- |
| navigate/definition、many2many1                                                    | `r.one` / `r.many` / `r.manyToMany`，复合键        | ✓        |
| navigate/direct2one                                                                | `r.path` / `r.pathOne`                             | ✓        |
| navigate/many-first                                                                | `orderBy(…).first()`、`limit(n)`                   | ✓        |
| navigate/many2many2（无中间表）、dotcolumn（逗号分隔列）、pathcolumn（路径左匹配） | 任意条件的关系                                     | ✗ 16.3.1 |
| include/README、fetcher                                                            | `include`、select 里的 `toList`                    | ✓        |
| include/relation-filter、relation-extra-filter                                     | 导航上的 `where`、关系定义的 `where`               | ✓        |
| performance/include（忽略空串等特殊键值）                                          | 关联键为空串时不查                                 | ✗ 16.3.2 |
| performance/implicit-join（`required` 导航用 inner join）                          | 关系上声明 `required`：类型不可空、渲染 inner join | ✗ 16.3.2 |
| dto-query/readme、map1–3、question                                                 | `defineView`、嵌套视图、形状里平铺导航列           | ≈        |
| dto-query/filter、sort                                                             | `table(request)`；`filterBy`、白名单               | ✗ 16.3.4 |
| prop/README、combine、cross-table、status、simple-sql                              | 实体上的计算属性                                   | ✗ 16.3.3 |
| prop/enum、json、global-value-converter                                            | `col.enum`、`col.json`、`col.custom`               | ✓        |
| prop/sql-column、sql-column-generate                                               | `sqlConvert`、`$default(() => sql…)`               | ✓        |

## 写入与保存（ability、savable、adv）

| 页面                                                                            | TS 对应                                                          | 状态     |
| ------------------------------------------------------------------------------- | ---------------------------------------------------------------- | -------- |
| ability/insert、update、delete、insertOrUpdate                                  | `insert` / `update` / `delete`、`onConflict`                     | ✓        |
| ability/batch、performance/batch                                                | 多行插入、按方言参数上限分块；驱动层批量执行                     | ✗ 16.4.2 |
| savable/*（聚合根、一对多、多对一、一对一、多对多、脱钩、所属权、移除根、主键） | `db.save` 只有一层一对多                                         | ✗ 16.4.1 |
| adv/data-tracking、performance/tracking                                         | `changes(before, after)`                                         | ≈        |
| adv/version                                                                     | `version()`、`version({ initial, next })`、`withVersion`         | ✓        |
| adv/logic-delete                                                                | `softDelete`、`$onDelete`、导航与 join 上单独关                  | ✓        |
| adv/interceptor                                                                 | 拦截器、开关、受保护、默认关着                                   | ✓        |
| adv/audit-log                                                                   | `afterWrite` 的事件；改之前的值                                  | ✗ 16.4.3 |
| adv/auto-key                                                                    | `$default(() => uuid())`                                         | ✓        |
| adv/generated-key-sql-column                                                    | 插入值、`$default` 返回 `sql` 片段                               | ✓        |
| adv/column-encryption                                                           | `encrypted`（可分段搜索）、`sqlConvert`                          | ✓        |
| adv/value-converter、type-handler                                               | codec、各方言包的驱动处理                                        | ✓        |
| adv/value-object                                                                | `embed()`                                                        | ✓        |
| adv/cte                                                                         | `db.with`、`withRecursive`                                       | ✓        |
| adv/atomic-update                                                               | 官方已废弃；表达式更新 `set({ stars: (t) => t.stars.minus(1) })` | ≈        |
| adv/smart-predicate、performance/derived-tables                                 | 派生表条件穿透                                                   | ✗ 16.2.6 |

## 性能（performance）

| 页面                                     | TS 对应                                       | 状态     |
| ---------------------------------------- | --------------------------------------------- | -------- |
| performance/implicit-subquery-group-join | `groupJoin()`                                 | ✓        |
| performance/include-many-limit           | 导航上 `limit(n).toList()`（ROW_NUMBER 分区） | ✓        |
| performance/page（已知总数不再 count）   | `table()` 带 total                            | ✓        |
| performance/deep-page                    | 深分页反向排序                                | ✗ 16.2.6 |

## 建表、缓存、分库分表（code-first、cache、super）

| 页面                                                                   | TS 对应                                                                   | 状态             |
| ---------------------------------------------------------------------- | ------------------------------------------------------------------------- | ---------------- |
| code-first/quick-start、api                                            | `createTables`、`planSync` / `syncTables`、注释、索引、外键、`introspect` | ✓ 16.5.1、16.5.2 |
| code-first/custom、dynamic-table                                       | 自定义类型映射（`dbType`）；换表用 `mapTables` 后同步                     | ✓ 16.5.1         |
| cache/*                                                                | `easy-query-ts-cache`：kv / all、拦截器失效、延迟双删                     | ✓ 16.6.1         |
| super/sharding-table、time、mod、multi、sequence、dna、default-route-* | 分表与路由                                                                | ✗ 16.6.2         |
| super/sharding-datasource、sharding-all、sharding-all-time             | 分库                                                                      | ✗ 16.6.3         |
| super/README（读写分离）                                               | 从库                                                                      | ✗ 16.6.4         |
