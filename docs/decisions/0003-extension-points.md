# 0003 改变行为的扩展点与"不做"几项的可行性

2026-10-29 调研。对照的是官方：`dromara/easy-query`（801aba8）与官方文档 `xuejmnet/easy-query-doc`（021c59e，下文"adv/interceptor"这类写法指它 src 下的文档），本地克隆在
`IdeaProjects/orm-references/easy-query`、`easy-query-doc`。fork 的 Java 版已不维护，不再作对照。
TS 版的现状按 `packages/easy-query/core/src` 核过。第 1–3 节是调研时的对照与可行性；第 4 节是随后补上的（按 TS 的写法，不照搬接口），第 5 节是回头看已有实现时值得改的。
不做的几项里，实体追踪与聚合保存可以换成不需要追踪上下文的写法来做，分库分表只建议做单库分表，二级缓存与反向生成实体等真实需要时再做。

## 1. 拦截器（官方 adv/interceptor）

| 官方                                                                                                          | TS 现状                                                                    | 差距与建议                                                                                 |
| ------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `EntityInterceptor`：插入前、实体更新前给对象赋值                                                             | `beforeInsert(row)`、`beforeUpdate(set)`                                   | 已有。TS 的 `beforeUpdate` 对实体更新与表达式更新都生效，官方要另加 `UpdateSetInterceptor` |
| `UpdateSetInterceptor`：表达式更新时追加 set 列                                                               | 同上                                                                       | 已有                                                                                       |
| `UpdateEntityColumnInterceptor`：实体更新只更新部分列时补列                                                   | `entity(row)` 总是全列；`beforeUpdate` 补的列都会写                        | 不需要（没有"只更新部分列"的实体更新）                                                     |
| `PredicateFilterInterceptor`：查询、更新、删除加条件                                                          | `filter(ref, entity)`，作用在主表、JOIN 的 ON、子查询、toList 的第二条查询 | 部分：拿不到"这是查询还是更新、删除"。建议 `filter(ref, entity, { kind })`                 |
| `apply(entityClass)`：只作用于某些实体                                                                        | 在 `filter` 里看 `entity`（如 `'tenantId' in entity.columns`）             | 已有，写法不同                                                                             |
| `order`：执行顺序                                                                                             | 数组顺序（内置的在前）                                                     | 已有                                                                                       |
| `enable=false` + `useInterceptor(name)`：默认不开、按需打开                                                   | 没有                                                                       | **缺**。按需过滤（排除测试数据、数据权限只在某些接口生效）要它                             |
| `noInterceptor()` 全关 / `noInterceptor(name)`                                                                | 只有查询上的 `noInterceptor(name)`                                         | **缺**：更新、删除、插入上没有；没有"全关"                                                 |
| `ProtectedInterceptor`：全关时也不关（租户）                                                                  | 没有（`tx.lock` 内部是全关）                                               | 随"全关"一起加：拦截器带 `protected: true`，只能按名字关                                   |
| 单张表、单个导航上开关（`tableLogicDelete`、`relationLogicDelete`、`configure(x -> x.disableLogicDelete())`） | 只能整条语句关                                                             | **缺**。建议 `u.roles.noInterceptor('softDelete').any(…)`、join 的选项里关                 |
| `ThreadLocal` 动态开关                                                                                        | 闭包 + 请求上下文（kit 的 AsyncLocalStorage）                              | 已有，写法不同                                                                             |

TS 写法上建议再加一个 Db 级的派生：`db.withInterceptors({ use: ['dataScope'], skip: ['tenant'] })`，与 `withSignal`、`inSchema` 一样返回新的 Db，
后台任务、管理员接口整段关租户时比逐条语句写 `noInterceptor` 干净。

## 2. 其他改变行为的扩展点

| 官方                                                                                      | TS 现状                                                 | 差距与建议                                                                                                                                         |
| ----------------------------------------------------------------------------------------- | ------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| 逻辑删除策略：BOOLEAN、DELETE_LONG_TIMESTAMP、LOCAL_DATE_TIME、自定义（adv/logic-delete） | `softDelete({ active, deleted })`，`deleted` 可以是函数 | 单列都能表达。**缺**删除时顺带写别的列（删除人）：建议 `softDelete({ …, also: { deletedBy: () => userId() } })`；现在只能自己写拦截器的 `deleteAs` |
| 版本号策略：int、long、UUID、时间戳（adv/version）                                        | `version()` 只认整数                                    | **缺** UUID / 自定义：建议 `version({ next: (current) => … })`                                                                                     |
| 表达式更新 `withVersion(v)`，没给且 `noVersionError` 时报错                               | 表达式更新只把版本加 1，不校验                          | **缺** `update(X).set(…).withVersion(v)`；默认是否报错保持现在的宽松（报错会让现有的表达式更新都要改）                                             |
| 加密列 `supportQueryLike`（分段加密，like 也能查）（adv/column-encryption）               | `encrypted(strategy)` 只支持等值                        | **缺陷**：现在对加密列写 `like()`，模式按明文绑定去匹配密文，静默查不到。先改成报错，再按需支持"可分段"的加密                                      |
| 主键生成器（adv/auto-key）                                                                | `$default(() => uuid())`                                | 已有                                                                                                                                               |
| 数据库函数生成列（`generatedSQLColumnGenerator`，如 `nextval`）                           | 插入值不能是表达式                                      | **缺**：建议 `col.….dbGenerated(sql\`nextval('s')\`)`，或插入的值允许 `sql` 片段                                                                   |
| 值转换 `ValueConverter`、枚举自动转换、`JdbcTypeHandler`                                  | `col.custom` / codec、`col.enum`；驱动层由各方言包处理  | 已有                                                                                                                                               |
| `ColumnValueSQLConverter`                                                                 | `sqlConvert({ read, write })`                           | 已有                                                                                                                                               |
| `JdbcExecutorListener`：前后两段、traceId、state（adv/jdbc-listener）                     | `log`（前）、`onExecute`（后，带耗时、行数、错误）      | 已有；前后之间要关联时用请求上下文                                                                                                                 |
| 审计日志：替换 `EntityExpressionExecutor`，拿到实体与表达式（adv/audit-log）              | `afterWrite({ kind, entity, affected })`                | **缺**写了什么：建议事件里带上插入的行、更新的 set 与条件、删除的条件（见 4.1）                                                                    |
| 派生表条件穿透 `SMART_PREDICATE`（adv/smart-predicate）                                   | 外层条件不进 `asTable()` 的子查询                       | 缺，性能项；等真有大派生表再做                                                                                                                     |
| 全局选项（framework/config-option）                                                       | 见下                                                    |                                                                                                                                                    |
| 替换内部服务（framework/replace-configure 的依赖注入）                                    | 方言子类、Adapter、拦截器、`onExecute`                  | 不需要容器：TS 里要换的东西都是传进 `createDb` 的对象                                                                                              |

全局选项里值得对的几项：

- `deleteThrow`（默认禁止物理删除）：TS 只拒绝"没有条件的删除"。建议 `createDb({ hardDelete: 'forbid' })`，有逻辑删除列以外的实体也不让 `DELETE`。
- `insertStrategy` / `updateStrategy`（只写非 null 列）：TS 插入跳过 `undefined`、写 `null`，`entity(row)` 全列——JS 里 `undefined` 与 `null` 本来就分得开，不需要这个选项。
- `resultSizeLimit`（一次最多拉多少行）：没有，可以做成 `createDb({ maxRows })` 防误拉整表，小。
- `relationGroupSize`（include 一批多少个键）：TS 固定 500，按方言参数上限再切；够用。
- `maxInClauseSize`（IN 拆成几段 OR）：Oracle 的 1000 上限才需要，目前方言里没有 Oracle。
- `defaultCondition`（like 是否把 `%` 当通配符）：TS 的 `like` 一律按字面匹配，同官方的 contains。
- `reverseOffsetThreshold`（深分页时反向排序）：性能项，等用到。
- `nameConversion`、`defaultSchema`：TS 是属性名转下划线、`named()`；schema 用 `inSchema`。

## 3. "不做"的几项

### 3.1 实体追踪（asTracking）与聚合保存（savable）

官方：`TrackManager.begin()` 开一个追踪上下文，`asTracking()` 查出的对象留一份快照，`updatable(entity)` 只更新变了的列，
没变就不发 SQL（adv/data-tracking）；3.1.24 起的聚合保存在追踪之上算整棵对象树的差异：插入、更新、删除子项，维护多对多的中间表，
脱钩时按 `cascade` 设 null 或删除，`savePath` 限定只保存哪些路径（savable/README）。原子更新（adv/atomic-update）已标为废弃。

可行性：追踪上下文要求"同一个对象从查出到保存都在一个上下文里"，在 TS 的请求-响应模型里，前端提交的是一份新的 JSON，原对象早已不在内存，
追踪帮不上忙。换成不需要上下文的两步，能得到追踪的主要好处：

- **差异更新**：`db.update(User).changes(before, after)` 只 set 变了的列，带版本号条件；`before` 由调用方给（刚查出的，或前端带回的原值）。小。
- **按现状比较的聚合保存**：在事务里先按父键把现有子项查出来，与提交的树比较，得出插入、更新、删除（或设 null）。现在的 `db.save` 已经这样做了一层一对多的
  `prune`；要补的是多对多的中间表、多对一 / 一对一、多层、脱钩方式（删除 / 设 null / 不动）、只保存哪些路径。中等偏大，按流程引擎、示例应用真用到的先做多对多中间表与多层。

追踪独有、换写法给不了的：同一段代码里多次修改后自动合并成一次更新——在 TS 里由调用方攒好 `after` 再保存即可。

### 3.2 分库分表

官方（super/*）：客户端分片，表路由（取模、按时间）与库路由，跨分片的排序、分页、聚合在内存里归并，带并发上限、初始化器与按时间建表的定时任务；
源码里分片、归并、路由、改写合计约 1 万行（sharding 5553、merge 3670、rewrite 652、route 452）。

可行性：

- **单库分表**（按月、按取模的同构表）可以做：写入按分片键算出表名（`mapTables` 已能换表）；查询时从条件里取出分片键的范围裁剪出要查的表，
  多张表用 `UNION ALL` 拼成派生表再 `where / orderBy / toPage`（`unionAll`、`asTable` 已有），排序、分页、聚合交给数据库。中等。
- **分库**（跨库归并、跨库事务）不建议做：归并排序与分页、各库的连接与事务，是官方代码量的大头，收益却可以由库本身的分区（PG 声明式分区、MySQL 分区表）
  或中间件获得。

建议：先推荐库的原生分区；真有按月分表的历史库再做单库分表。

### 3.3 二级缓存

官方（cache/*）：独立的 easy-cache 包，`kv` 模式按主键缓存单个对象、`all` 模式加索引；一致性靠 CDC，或"延迟删除 + 逻辑删除"：
写入后在事务提交后异步清缓存，表达式更新拿不到主键时由 `CacheKeysProvider` 按更新时间再查一遍受影响的键（cache/redis-logicdelete）。

可行性：TS 已有 `afterWrite` 与 `afterCommit`，`kv` 模式的骨架小：`findCached(Entity, key)` + 写入后提交时按键失效。难点与官方相同：
表达式更新、删除不知道改了哪些主键——可以在执行前用同样的条件查一次主键（多一条查询），或退化成整个实体失效。多实例部署要共享存储（Redis），
不能用进程内缓存。建议：等真有热点读再做，先做成可选包，不进核心。

### 3.4 asTableLink

跨库链接（HANA 的 remote source、PG 的 FDW、MySQL 的 FEDERATED）各库写法与权限都不同，继续不做；需要时 `db.sql` 写原生 SQL，或在库里建视图再映射成实体。

### 3.5 代码生成

官方的 APT / KSP 生成代理类、IDEA 插件生成 DTO（plugin/*）——TS 的结果类型由形状推出，不需要。插件里有一项值得做：**由表生成实体**（plugin/table2entity）。
已有库（流程引擎从 Java 迁过来的表）要写一遍 `entity(...)` 时有用：按方言读 `information_schema`（HANA 读 `SYS.TABLE_COLUMNS`），
输出 `entity()` 与 `defineSchema` 的代码，外键生成 `r.one` / `r.many`。中等，做成命令行工具。

## 4. 已做（2026-10-29），以及比官方多走的一步

第 1、2 节表里标"缺"的小项都已补上。做法上没有照搬 Java 的接口，而是用 TS 的长处：

| 能力               | 官方                                                                | TS 版                                                                                          | 多走的一步                                                                                        |
| ------------------ | ------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| 拦截器开关         | `noInterceptor(name)` 传字符串                                      | 名字登记在 `InterceptorNames`（声明合并），`noInterceptor` / `useInterceptor` 只认登记过的     | 写错名字编译期就报，编辑器能补全                                                                  |
| 开关的粒度         | 语句级；逻辑删除另有 `tableLogicDelete`、`relationLogicDelete` 一套 | 同一个 `{ use, skip }` 用在语句、Db（`withInterceptors`）、一对多导航、join 的表上，按先后叠加 | 所有拦截器（不只逻辑删除）都能在导航、join 上单独关；Db 级派生与 `withSignal` 一样不可变          |
| 默认关着 / 受保护  | `enable()`、`ProtectedInterceptor` 接口                             | `enabled: false`、`protected: true` 两个字段                                                   | 不用为标记再实现一个接口                                                                          |
| 条件区分语句       | 拿表达式构建器自己判断                                              | `filter(ref, entity, { kind })`                                                                | kind 是 `'select' \| 'update' \| 'delete'` 的联合类型                                             |
| 审计日志           | 替换 `EntityExpressionExecutor`，约 400 行示例                      | `afterWrite` 的事件是判别联合：insert 带行、update 带 set、delete 带是否逻辑删除，都带语句     | `switch (event.kind)` 后各自的字段有类型；语句与事件只构建一次，`$onUpdate` 的时间两边一致        |
| 差异更新           | 追踪上下文 + `asTracking`                                           | `update(X).changes(before, after)`                                                             | 不需要上下文；按列的编码比较（日期比时刻、JSON 比内容）；after 可以只是表单的几项；没变化不发语句 |
| 版本策略           | 四个策略类                                                          | `version()`（整数）或 `version({ initial, next })`；`withVersion(v)`                           | 规则就是一个函数                                                                                  |
| 删除人             | 自定义逻辑删除策略类                                                | 列修饰 `$onDelete(() => user)`                                                                 | 与 `$onUpdate` 对称，写在列上                                                                     |
| 加密列模糊搜索     | `supportQueryLike`                                                  | `encrypted({ …, searchable: true })`                                                           | 不可分段的策略上 like 直接报错（之前是静默查不到）                                                |
| 库里生成的列       | `GeneratedKeySQLColumnGenerator` 接口                               | 插入值、`$default` 可以是 `sql` 片段                                                           | 类型照样是这一列的值类型                                                                          |
| 防误删、防误拉整表 | `deleteThrow`、`resultSizeLimit`（截断）                            | `createDb({ hardDelete: 'forbid', maxRows })`                                                  | maxRows 超了报错而不是悄悄少给                                                                    |

## 5. 现有实现里值得改的

调研时对照官方回头看已有的实现，这几处按 TS 的写法还能更好，按价值排：

1. **聚合保存**（`db.save`）：只做了一层一对多与 `prune`。——已做（ROADMAP 16.4.1）：换成带类型的 `include` 树，多层、多对多中间表按现状增删、
   多对一 / 一对一、`removed`（删除 / 置空 / 不动）、按业务列匹配（`key`），另加 `db.remove` 删整棵树。见 features/ts-writes。
2. **多对一导航上单独关拦截器**：一对多导航与 join 已经能关，`u.company` 这种属性访问没地方放开关。可以在关系定义处给默认开关
   （`r.one('Company', …, { interceptors: { skip: ['softDelete'] } })`），覆盖"关联已删除的公司也要显示名字"这类需求。小。
3. **`table()` 的白名单**：现在按 select 的结果列放行，能筛的列就是能看的列。官方的 `whereObject` 可以按注解只放行一部分；
   TS 可以加 `table(request, { filterable: ['status', 'createdAt'] })`，键的类型由 select 推出。小。
4. **`afterWrite` 拿不到"改之前的值"**：审计常要前后对比。可以让拦截器声明 `before: true`，由核心在同一事务里按同样的条件先查一次再更新，
   查到的行放进事件。代价是多一条查询，所以做成按拦截器声明的。中等。——已做（ROADMAP 16.4.3）：`Interceptor.before`、`WriteEvent.before`。
5. **`maxRows` 只管 `toList`**：`toTree`、`fillMany` 的被填充查询、导航的 `toList` 第二条查询都没管；后两者受父行数限制，问题不大，
   `toTree` 内部走 `toList` 已经受限。暂不改，记在这里。

## 6. 剩下的

- 等真实需要：单库分表（3.2）、二级缓存的 `kv` 模式（3.3）、由表生成实体的命令行（3.5）、派生表条件穿透、深分页反向排序。
- 继续不做：分库与跨库归并、追踪上下文本身、asTableLink、代理类与 DTO 的代码生成。
