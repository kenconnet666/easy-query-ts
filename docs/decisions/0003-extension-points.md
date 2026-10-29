# 0003 改变行为的扩展点与"不做"几项的可行性

2026-10-29 调研。对照的是官方：`dromara/easy-query`（801aba8）与官方文档 `xuejmnet/easy-query-doc`（021c59e），本地克隆在
`IdeaProjects/orm-references/easy-query`、`easy-query-doc`。fork 的 Java 版已不维护，不再作对照。
TS 版的现状按 `packages/easy-query/core/src` 核过。结论先行：拦截器的骨架够用，缺的是"开关的粒度"和"给拦截器的上下文"；
不做的几项里，实体追踪与聚合保存可以换成不需要追踪上下文的写法来做，分库分表只建议做单库分表，二级缓存与反向生成实体等真实需要时再做。

## 1. 拦截器（官方 adv/interceptor.md）

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

| 官方                                                                                         | TS 现状                                                 | 差距与建议                                                                                                                                         |
| -------------------------------------------------------------------------------------------- | ------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| 逻辑删除策略：BOOLEAN、DELETE_LONG_TIMESTAMP、LOCAL_DATE_TIME、自定义（adv/logic-delete.md） | `softDelete({ active, deleted })`，`deleted` 可以是函数 | 单列都能表达。**缺**删除时顺带写别的列（删除人）：建议 `softDelete({ …, also: { deletedBy: () => userId() } })`；现在只能自己写拦截器的 `deleteAs` |
| 版本号策略：int、long、UUID、时间戳（adv/version.md）                                        | `version()` 只认整数                                    | **缺** UUID / 自定义：建议 `version({ next: (current) => … })`                                                                                     |
| 表达式更新 `withVersion(v)`，没给且 `noVersionError` 时报错                                  | 表达式更新只把版本加 1，不校验                          | **缺** `update(X).set(…).withVersion(v)`；默认是否报错保持现在的宽松（报错会让现有的表达式更新都要改）                                             |
| 加密列 `supportQueryLike`（分段加密，like 也能查）（adv/column-encryption.md）               | `encrypted(strategy)` 只支持等值                        | **缺陷**：现在对加密列写 `like()`，模式按明文绑定去匹配密文，静默查不到。先改成报错，再按需支持"可分段"的加密                                      |
| 主键生成器（adv/auto-key.md）                                                                | `$default(() => uuid())`                                | 已有                                                                                                                                               |
| 数据库函数生成列（`generatedSQLColumnGenerator`，如 `nextval`）                              | 插入值不能是表达式                                      | **缺**：建议 `col.….dbGenerated(sql\`nextval('s')\`)`，或插入的值允许 `sql` 片段                                                                   |
| 值转换 `ValueConverter`、枚举自动转换、`JdbcTypeHandler`                                     | `col.custom` / codec、`col.enum`；驱动层由各方言包处理  | 已有                                                                                                                                               |
| `ColumnValueSQLConverter`                                                                    | `sqlConvert({ read, write })`                           | 已有                                                                                                                                               |
| `JdbcExecutorListener`：前后两段、traceId、state（adv/jdbc-listener.md）                     | `log`（前）、`onExecute`（后，带耗时、行数、错误）      | 已有；前后之间要关联时用请求上下文                                                                                                                 |
| 审计日志：替换 `EntityExpressionExecutor`，拿到实体与表达式（adv/audit-log.md）              | `afterWrite({ kind, entity, affected })`                | **缺**写了什么：建议事件里带上插入的行、更新的 set 与条件、删除的条件（见 4.1）                                                                    |
| 派生表条件穿透 `SMART_PREDICATE`（adv/smart-predicate.md）                                   | 外层条件不进 `asTable()` 的子查询                       | 缺，性能项；等真有大派生表再做                                                                                                                     |
| 全局选项（framework/config-option.md）                                                       | 见下                                                    |                                                                                                                                                    |
| 替换内部服务（framework/replace-configure.md 的依赖注入）                                    | 方言子类、Adapter、拦截器、`onExecute`                  | 不需要容器：TS 里要换的东西都是传进 `createDb` 的对象                                                                                              |

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
没变就不发 SQL（adv/data-tracking.md）；3.1.24 起的聚合保存在追踪之上算整棵对象树的差异：插入、更新、删除子项，维护多对多的中间表，
脱钩时按 `cascade` 设 null 或删除，`savePath` 限定只保存哪些路径（savable/README.md）。原子更新（adv/atomic-update.md）已标为废弃。

可行性：追踪上下文要求"同一个对象从查出到保存都在一个上下文里"，在 TS 的请求-响应模型里，前端提交的是一份新的 JSON，原对象早已不在内存，
追踪帮不上忙。换成不需要上下文的两步，能得到追踪的主要好处：

- **差异更新**：`db.update(User).changes(before, after)` 只 set 变了的列，带版本号条件；`before` 由调用方给（刚查出的，或前端带回的原值）。小。
- **按现状比较的聚合保存**：在事务里先按父键把现有子项查出来，与提交的树比较，得出插入、更新、删除（或设 null）。现在的 `db.save` 已经这样做了一层一对多的
  `prune`；要补的是多对多的中间表、多对一 / 一对一、多层、脱钩方式（删除 / 设 null / 不动）、只保存哪些路径。中等偏大，按流程引擎、示例应用真用到的先做多对多中间表与多层。

追踪独有、换写法给不了的：同一段代码里多次修改后自动合并成一次更新——在 TS 里由调用方攒好 `after` 再保存即可。

### 3.2 分库分表

官方（super/*.md）：客户端分片，表路由（取模、按时间）与库路由，跨分片的排序、分页、聚合在内存里归并，带并发上限、初始化器与按时间建表的定时任务；
源码里分片、归并、路由、改写合计约 1 万行（sharding 5553、merge 3670、rewrite 652、route 452）。

可行性：

- **单库分表**（按月、按取模的同构表）可以做：写入按分片键算出表名（`mapTables` 已能换表）；查询时从条件里取出分片键的范围裁剪出要查的表，
  多张表用 `UNION ALL` 拼成派生表再 `where / orderBy / toPage`（`unionAll`、`asTable` 已有），排序、分页、聚合交给数据库。中等。
- **分库**（跨库归并、跨库事务）不建议做：归并排序与分页、各库的连接与事务，是官方代码量的大头，收益却可以由库本身的分区（PG 声明式分区、MySQL 分区表）
  或中间件获得。

建议：先推荐库的原生分区；真有按月分表的历史库再做单库分表。

### 3.3 二级缓存

官方（cache/*.md）：独立的 easy-cache 包，`kv` 模式按主键缓存单个对象、`all` 模式加索引；一致性靠 CDC，或"延迟删除 + 逻辑删除"：
写入后在事务提交后异步清缓存，表达式更新拿不到主键时由 `CacheKeysProvider` 按更新时间再查一遍受影响的键（cache/redis-logicdelete.md）。

可行性：TS 已有 `afterWrite` 与 `afterCommit`，`kv` 模式的骨架小：`findCached(Entity, key)` + 写入后提交时按键失效。难点与官方相同：
表达式更新、删除不知道改了哪些主键——可以在执行前用同样的条件查一次主键（多一条查询），或退化成整个实体失效。多实例部署要共享存储（Redis），
不能用进程内缓存。建议：等真有热点读再做，先做成可选包，不进核心。

### 3.4 asTableLink

跨库链接（HANA 的 remote source、PG 的 FDW、MySQL 的 FEDERATED）各库写法与权限都不同，继续不做；需要时 `db.sql` 写原生 SQL，或在库里建视图再映射成实体。

### 3.5 代码生成

官方的 APT / KSP 生成代理类、IDEA 插件生成 DTO（plugin/*.md）——TS 的结果类型由形状推出，不需要。插件里有一项值得做：**由表生成实体**（plugin/table2entity.md）。
已有库（流程引擎从 Java 迁过来的表）要写一遍 `entity(...)` 时有用：按方言读 `information_schema`（HANA 读 `SYS.TABLE_COLUMNS`），
输出 `entity()` 与 `defineSchema` 的代码，外键生成 `r.one` / `r.many`。中等，做成命令行工具。

## 4. 建议的先后

1. 小、马上值得做：拦截器的开关粒度（更新、删除、插入上的 `noInterceptor`，全关与 `protected`，默认不开 + `useInterceptor`，Db 级 `withInterceptors`，
   导航与 join 上单独关），`filter` 拿到语句种类；加密列 `like` 先报错；`withVersion`；`softDelete` 的 `also`；`version({ next })`；`dbGenerated`；`hardDelete: 'forbid'`；`maxRows`。
2. 中：`afterWrite` 带上写了什么（审计日志）；差异更新 `changes(before, after)`；聚合保存补多对多中间表与多层。
3. 等真实需要：单库分表、二级缓存的 `kv` 模式、由表生成实体的命令行、派生表条件穿透、深分页反向排序。
4. 继续不做：分库与跨库归并、追踪上下文本身、asTableLink、代理类与 DTO 的代码生成。

### 4.1 afterWrite 带上写了什么

事件加上 `rows`（插入的行，已补默认值）、`set` 与 `where`（更新、逻辑删除时 set 的值和条件的语句片段），审计拦截器据此记录；
要"改之前的值"时由拦截器自己在 `beforeUpdate` 阶段按同样的条件查一次（官方的审计示例也是这样做的），核心不默认多查。
