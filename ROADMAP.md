# 路线图

easy-query 的 TS 版。阶段编号沿用迁移前 vue-tsx-pro 的 ROADMAP，代码注释里的 `ROADMAP 18.3.2` 这类编号指这里；与 ORM 无关的阶段留在那边。

## 工作方式

- 在 master 上小步提交并推送；整理与功能分开提交。
- 本地跑相关测试，全量与实库交给 CI。

## 阶段 11：迁入 easy-query TS

把 `easy-query` 仓库的 `ts/`（8 个包、418 个用例）搬进 `packages/easy-query/`，工具链向本仓库看齐。完成标准：用例在本仓库全过，CI 跑实库，`easy-query` 仓库不再有 `ts/`。

- [x] 11.0 本仓库自己的测试库（用户 2026-10-28：ORM 用 WSL 里的容器真实使用与测试，已有的容器不方便用，停掉、改成自己的）：
      `infra/dev/compose.yml`（compose 项目名 `vue-tsx-pro-dev`）起 MySQL 8.0.18（PolarDB 基线）、MySQL 8.4、PG 17，HANA 放在 `hana` profile 里按需起；
      端口与 `easy-query-dev` 错开；`infra/dev/db.sh` 一条命令起停；连接与密码写进不提交的 `.local/`，实库测试按环境变量读。
      起来后停掉 WSL 里的 `easy-query-dev-*` 五个容器（`docker compose stop`，不删数据卷）
- [x] 11.1 带历史搬家：`easy-query` 里 `git subtree split --prefix=ts`，本仓库 `git subtree add` 到 `packages/easy-query/`，再 `git mv` 成 `core/ sqlite/ mysql/ pg/ hana/ decimal/ date/ test/`。
      只搬不改；验收：`git log --follow` 看得到原来的提交
- [x] 11.2 接进工作区：`pnpm-workspace.yaml` 逐个写包族；驱动版本进 catalog；TS 7.0.2 → catalog 的 7.1 beta；`exports` 改用 `@vue-tsx-pro/source` 条件；
      保留它更严的编译选项（`exactOptionalPropertyTypes`、`noUncheckedIndexedAccess`）。验收：`pnpm typecheck` 过
- [x] 11.3 测试换成 Vitest（`node:test` 的导入换掉，`node:assert` 照用）；SQLite 用例本地全过
- [x] 11.4 风格对齐：prettier 整体格式化单独一个提交；oxlint、`docs:check`、`text:check` 打开并修完
- [x] 11.5 CI 加 db 任务：MySQL 8.0.18、PG 17 的服务容器跑实库套件（照搬 `easy-query` 的 ts 任务）；HANA 仍在本机
- [x] 11.6 分层检查扩到包这一级：easy-query 不导入 vue 与组件库，组件库不导入 easy-query；规则写进 `layers:check`
- [x] 11.7 发布产物核对：各包 `pnpm pack` 的文件清单与已发布的 0.1.0 一致（元数据除外）；`repository`、`homepage` 改指本仓库
- [x] 11.8 文档：`0002-ts-design.md` 搬到 `packages/easy-query/docs/decisions/`；14 页 TS 特性说明暂存在 `packages/easy-query/docs/features/`，文档站 ORM 分区并进 11b.6 一起写（按能力一页、写清与 Java 版的对应）
- [x] 11.9 `easy-query` 仓库收尾（开分支、PR、CI 绿后合并）：删掉 `ts/` 与 CI 的 ts 任务；CLAUDE.md、STATUS、ROADMAP 写明 TS 版已迁到本仓库（kenconnet666/easy-query#33，已合并）

## 阶段 11b：easy-query TS 对照 Java 版完善

用户 2026-10-28：对照 Java 版 easy-query 的功能、各种便捷操作，以及 DTO 导航、VO 映射、对象树、对象树的 VO，把 TS 版补完整。
做法同"ORM 在真实项目里长"：先出对照表，再按流程引擎、示例应用用得到的先做；和阶段 12、13、14 交替推进，不必一口气做完。
完成标准：对照表里标"要做"的都打钩，每项带 SQLite 用例与 MySQL 8.0.18 / PG 实库用例，文档站 ORM 分区有对应的页。

- [x] 11b.1 对照表 [docs/parity.md](docs/parity.md)：Java 版的方法清单（EntityQueryable、ClientQueryable）逐项对 TS 版。
      结论：DTO 导航（selectAutoInclude）、VO 映射、对象树、对象树的 VO 在 TS 里都已有，写法是 `defineView` 与嵌套的 `toList`（不用 DTO 类与注解）；缺的是下面几项
- [x] 11b.2 按主键查与查不到就抛错：`find(id)`（含复合主键）、`firstOrThrow(message)` / `singleOrThrow`
- [x] 11b.3 列表页的动态筛选与排序（对应 `whereObject` / `orderByObject`）：对接组件库 `useTableQuery` 的筛选与 `-amount,name` 排序参数，只放行声明过的列（`parseTableRequest` + `Queryable.table(request)`）
- [x] 11b.3a 查询栏的区间值与条件树（FilterBar 的高级筛选，组件库 `condition` 参数）：日期区间落在时间戳列上的整天语义、条件树按结果列的白名单转成条件（原 query 库 0016 §2、0017）
- [x] 11b.4 自关联的树：`toTreeList`（按父子列把行拼成树，节点是视图的形状）、从某个节点取全部下级 / 全部上级（递归 CTE 的便捷写法）（`toTree`、`db.descendantsOf` / `ancestorsOf`）
- [x] 11b.5 导航上的固定条件（对应 `extraFilter`）：定义关系时声明，查询处不用再写
- [x] 11b.6 文档站 ORM 分区：每个能力一页，写清与 Java 版的对应（DTO 导航、VO、对象树、对象树的 VO 各有一页示例）；`packages/easy-query/docs/features/` 的暂存页改写进来后删掉
      （文档站的“全栈”分区：ORM easy-query TS；DTO 导航、树等细节仍在 packages/easy-query/docs/features）
- [x] 11b.7 补齐对照表里剩下的缺口：`groupJoin()`（subQueryToGroupJoin）、`fillOne` / `fillMany`、`rightJoin` / `crossJoin`、`inSchema`（asSchema），另补值对象 `embed()`（@ValueObject）、直达关系 `r.path` / `r.pathOne`（directMapping）、`sqlConvert`（ColumnValueSQLConverter）；事务提交后的回调已与 14.3 一起做。对照表里已没有 ✗

## 阶段 16：easy-query TS 全面对齐官方 easy-query

目标（2026-10-29 定）：官方 easy-query 有的我们都要有——效果一致，写法更符合 TS、更方便；TS 能做得更灵活的地方可以多做。
对照的是官方 `dromara/easy-query`（单元测试 `sql-test`：143 个文件、2344 个用例）与官方文档站 `xuejmnet/easy-query-doc`（22 个章节），
本地克隆在 `IdeaProjects/orm-references/`。官方支持的数据库我们也都支持，实库测试用 WSL 里的容器。

做法：

- **逐个对照**：脚本把官方每个测试文件里的用例列成清单（文件、方法名、断言的 SQL），放进 `packages/easy-query/docs/parity-tests.md`；
  每个用例标"已对应（TS 测试的位置）/ 写法不同 / 新做 / 不适用（理由）"，做完一项改一项。文档站同样按章节列一张表。
- **测试分两层**：生成的 SQL 在 SQLite 上断言（快、不要库）；语义在 `test/src/suite.ts` 的共用实库套件里跑，每种方言都跑一遍。
- **方言**：每加一种库，先在 `infra/dev/compose.yaml` 加容器、`db.sh` 生成连接，再写方言包，最后让共用套件全绿；
  驱动只用纯 JS 或官方维护的 Node 包。H2 是 JVM 里的库，Node 里没有驱动，标"不适用"。
- **小步提交**：每个子项一个提交，本地跑相关测试，全量与实库交给 CI；新方言进 CI 的 db 任务（容器太大的放 nightly）。

### 16.1 对照清单（先做，后面每项都对着它）

- [x] 16.1.1 脚本抽出官方 2344 个用例的清单（按文件、API 归类），生成 `docs/parity-tests.md`
- [x] 16.1.2 文档站 22 个章节逐页对照，补进 `docs/parity.md`（按章节分组，取代现在按 API 分组的表）
- [x] 16.1.3 已有的 TS 测试回填到清单里，算出"已对应"的比例，列出缺口
      （`tools/parity-tests.mjs` + `tools/capabilities.mjs` 生成 `docs/parity-tests.md`：有效用例 2249 个，按能力归类后已对应 1190、写法不同 272、待做 713、不适用 74；
      文档逐页见 `docs/parity-docs.md`。之后每做完一种能力，就对照该能力下的用例补 TS 测试、改能力表的状态、重新生成）

### 16.2 查询与表达式（ability/select、func、sub-query）

- [x] 16.2.1 函数库补齐（func/*）：日期格式化 `format`、`plusYears/Hours/Minutes/Seconds`、`hour/minute/second`、`dayOfYear/dayOfWeek`、
      时间间隔 `duration`（按单位取天、时、分、秒）、`now/utcNow`；`maxColumns/minColumns`（GREATEST / LEAST）；
      字符串 `ltrim/rtrim`、`leftPad/rightPad`、`stringFormat`（模板拼接，参数可复用）、`nullEmpty`、`compareTo`、`notStartsWith/notEndsWith`；
      聚合 `joining`（GROUP_CONCAT / STRING_AGG，带分隔符与排序）、`sumOrDefault` 这类写法用 `orElse`；
      窗口 `firstValue/lastValue/nthValue`；数学 `power/sqrt/exp/log/sign/…`（对 func/math 全表）（全部补齐；函数参数改为延后绑定，修掉换序、重复参数时位置占位符错位的问题）
- [x] 16.2.2 JSON 函数（func/json）：取值、对象 / 数组构造，按方言渲染（MySQL `->>`、PG `->>`、SQLite `json_extract`、HANA `JSON_VALUE`）（json / jsonText / jsonNumber / jsonBoolean / jsonHas / jsonLength，路径按列的 TS 类型补全检查）
- [x] 16.2.3 子查询（sub-query/*）：join 一条子查询（`innerJoin(query.asTable(), …)`，现在派生表不能 join）、select 里的相关子查询手动模式、from 子查询的自定义视图（join 接受一条查询，表引用按子查询的 select 带类型）
- [x] 16.2.4 一对多导航上的 `flatElement` / `elements`：`u.roles.flat((r) => r.name)` 在 select 里得到数组、在 where 里是"任一"；`joining` 拼成一串（flatElement 对应 any / toList / r.path；补 all、at(i)、countDistinct；导航上 limit 用在聚合时报错）
- [x] 16.2.5 动态表名、`whereColumns`、`selectColumn`、`toMap`、`cloneQueryable` 等对照 ability/* 逐条确认（多数是写法不同，补测试）（不在 schema 里的实体直接查写；tableHint；withTableLink；无实体的 Map 结果用 db.sql）
- [x] 16.2.6 深分页反向排序（performance/deep-page：offset 超过一半时倒序取再翻回来）、派生表条件穿透（adv/smart-predicate）（reversePageAfter；派生表条件穿透，有窗口、分组等时不推）

### 16.3 导航、DTO、计算属性（navigate、include、dto-query、prop）

- [x] 16.3.1 自定义关联条件：多对多无中间表、逗号分隔列（navigate/dotcolumn，FIND_IN_SET 一类）、路径左匹配（navigate/pathcolumn）——
      `r.many('Book', { on: (u, b) => … })` 任意条件的关系，隐式子查询与 toList 都支持（r.manyOn / oneOn，inCsv、like 接受列；无中间表即按共同列的 r.many）
- [x] 16.3.2 多对一导航上的拦截器开关（关系定义处给默认开关）、include 的 extra filter 与 include filter 对照（include/*）（required、关系上的 interceptors；include 的两种 filter 即导航上的 where 与关系的 where；空串键不查子项）
- [x] 16.3.3 计算属性（prop/*）：实体上声明数据库计算的属性（`computed: (u) => u.first.concat(u.last)`、跨表、状态 CASE），select / where / orderBy / table() 都能用；
      内存计算属性用视图（defineComputed，跨表、CASE、组合；内存计算属性用视图）
- [x] 16.3.4 DTO 筛选与排序（dto-query/filter、sort）：`filterBy(input, { name: 'like', age: 'range', … })`，规则的键与值类型由实体推出；
      `table()` 加 `filterable` / `sortable` 白名单（filterBy、sortBy、table 的 filterable / sortable）
- [x] 16.3.5 `selectAutoInclude` 的对照：视图 + 导航自动带出（现有）补测试；`NavigateFlat` 的各种平铺对照（视图 + 导航自动带出、形状里平铺导航列，suite.ts views 已覆盖）

### 16.4 写入与保存（ability/insert、update、delete、batch、savable、adv）

- [x] 16.4.1 聚合保存（savable/*）：多对多中间表按现状比较增删、多对一 / 一对一、多层、脱钩方式（删除 / 设 null / 不动）、只保存哪些路径；
      cascade 路径做成类型（`['posts', 'posts.comments', 'roles']` 由关系推出）
- [x] 16.4.2 插入 / 更新策略（只写非 null 列等）对照，`batch`（驱动层的批量执行，MySQL / PG 一次往返多条）
- [x] 16.4.3 `afterWrite` 可选带"改之前的值"（拦截器声明 `before: true` 时核心先按同样条件查一次）
- [x] 16.4.4 更新 / 删除带 join（官方 UpdateDeleteJoinTest、各方言 UpdateJoinTest）：`update(X).join(…)`，按方言渲染（MySQL UPDATE … JOIN、PG UPDATE … FROM、MSSQL UPDATE … FROM）
- [x] 16.4.5 对照 VersionTest、LogicDeleteTest、EncryptionTest、Sm4EncryptionTest、InterceptorTest、TrackTest 逐条补测试

### 16.5 建表与迁移（code-first）

- [x] 16.5.1 `db.syncTables()`：对比库里的结构，建缺的表、加缺的列，列出不一致（类型、可空、默认值）而不自动改；生成迁移 SQL 供审阅
- [x] 16.5.2 列与表的注释、索引声明（`index: [['tenantId', 'createdAt']]`）、外键（可选）
- [x] 16.5.3 由表生成实体的命令行（plugin/table2entity 的 TS 版）：读 information_schema（各方言的系统表），输出 `entity()` 与 `defineSchema`

### 16.6 二级缓存与分库分表（cache、super）

- [x] 16.6.1 缓存（cache/*）：kv 模式按主键缓存、all 模式加索引；写入后在事务提交后失效，表达式更新先查出受影响的键；存储可换（进程内、Redis）；做成 `@zerodep-dev/easy-query-ts-cache`
- [x] 16.6.2 分表（super/sharding-table、sharding-time、sharding-mod）：按取模、按时间路由，写入按分片键算表名，查询从条件裁剪出要查的表，
      多张表 `UNION ALL` 后在库里排序、分页、聚合；按时间自动建表
- [x] 16.6.3 分库（super/sharding-datasource、sharding-all）：多个 Db 按键路由，跨库查询在内存里归并排序、分页、聚合（流式 k 路归并），并发上限；
      跨库写入不做分布式事务（写明）
- [x] 16.6.4 读写分离（官方超级功能之一）：`createDb({ replicas })`，事务里一律走主库
- [x] 16.6.5 search 扩展（官方 sql-search，EasySearch* 测试）与我们的 `table()` / 条件树对照，缺的补上

### 16.7 方言：官方支持的都支持（容器进 `infra/dev/compose.yaml`）

已有 SQLite、MySQL（8.0.18、8.4）、PostgreSQL 17、HANA。按用户量与驱动成熟度排：

- [x] 16.7.1 SQL Server（`mcr.microsoft.com/mssql/server`，驱动 `mssql`/tedious）：TOP / OFFSET FETCH、`[]` 引号、OUTPUT 代替 RETURNING、MERGE upsert；含 2012 以前的 ROW_NUMBER 分页
- [x] 16.7.2 Oracle（`gvenzl/oracle-free`，驱动 `oracledb` 薄模式不用客户端）：FETCH FIRST、序列、IN 列表 1000 上限（`maxInClauseSize`）、MERGE
- [x] 16.7.3 DuckDB（嵌入式，驱动 `@duckdb/node-api`，不用容器）
- [x] 16.7.4 达梦 DM8（社区镜像 `xuxuclassmate/dameng`，驱动 `dmdb`）：方言继承 Oracle 方言（拆出不依赖驱动的 `easy-query-ts-oracle/dialect`）后覆盖差异
- [x] 16.7.5 人大金仓 KingbaseES、openGauss / GaussDB（PG 协议，复用 pg 驱动，方言继承 PG 后覆盖差异）：openGauss 共用套件全绿进 CI；
      金仓社区镜像的试用许可证都已过期，只有 SQL 文本测试，有实例时设 EQTS_KINGBASE_URL 跑共用套件
- [x] 16.7.6 ClickHouse（`clickhouse/clickhouse-server` 25.8，驱动 `@clickhouse/client`）：只读分析为主，写入、事务按它的能力裁剪；带类型的 `{p1:Int64}` 参数（核心的 placeholder 收到绑定的值）
- [x] 16.7.6b Apache Doris（官方没有，额外支持；MySQL 协议，`doris(pool)` 在 MySQL 包里）：主键模型建表、整行覆盖的 upsert、倒排索引；
      与 ClickHouse 共用主键由应用给值的分析型套件（`test/src/analytic.ts`），CI 单独一个 runner
- [x] 16.7.7 DB2（`icr.io/db2_community/db2` 12.1，驱动 `ibm_db`）：共用套件全绿（Linux；Windows 上 ibm_db 的 CLI 环境建不出来），CI 单独一个 runner
- [x] 16.7.8 TDengine（官方 sql-tsdb，驱动 `@tdengine/websocket`）：时间戳主键、写入覆盖、按条件删除、没有 UPDATE / 子查询 / 窗口；专用实库测试进 CI
- [x] 16.7.9 H2：JVM 内的库，Node 没有驱动——不适用，写进清单（对照表 dialect.h2 为不适用）
- [x] 16.7.10 每种方言：共用实库套件全绿（取不回自增的分析库跑分析型套件）、方言专属函数入口（`MySQL.` / `Pg.` / `Hana.` / `MsSql.`）、建表类型映射、CI（大的单独一个 runner）
- [x] 16.7.11 按版本渲染收敛（2026-10-29 定）：默认一套各版本都能跑的写法，只在旧写法被弃用、旧版本没有该能力（渲染时报最低版本）、新旧语义或性能差别大时分支；
      `mysql.detect` / `mssql.detect` / `oracle.detect` 连库读出版本，部署不用手配；只为写法好看的分支（SQL Server 的 TRIM、DATETRUNC、IS NOT DISTINCT FROM）已删

### 16.8 文档站与收尾

- [x] 16.8.1 文档站 ORM 分区按官方章节组织（快速开始、查询、导航、DTO、写入、保存、函数、计算属性、建表、缓存、分库分表、方言），每页写清与官方的对应
- [x] 16.8.2 `parity-tests.md` 里"已对应"到 100%（"不适用"都有理由），对照表没有 ✗（待做 0；写法不同 352、不适用 74 都写了理由）

## 阶段 18：easy-query TS 用足 TS 的语言特性

目标（用户 2026-10-30 定）：在对齐官方之后，用 TS 的类型系统把错误尽量提到编译期、把重复的定义收成一处；不引入代码生成。三批按顺序做，
每项都要有类型测试（`expectTypeOf` / `@ts-expect-error`）、实库或 SQL 文本测试、文档站一节。

### 18.1 第一批：动到 API 形状的（越早做越好）

- [x] 18.1.1 schema 组合：`mergeSchemas(a, b, 跨组关系)` 按模块各写各的再合成一份（实体、导航重名在类型上报错）；
      `db.mount(schema)` 给已有的 Db 挂上另一组 schema，共用连接、拦截器、事务（事务里的 tx 也能 mount）
- [x] 18.1.2 方言能力进类型：adapter 带能力标记（写入、行锁、事务、returning、窗口、json 长度……），Db 与表达式的方法按能力有无；
      TDengine 上 `update()`、ClickHouse 上 `lock()`、MySQL 上 `returning()` 在编辑器里就标红，运行时的报错留作兜底
- [x] 18.1.3 branded 主键与外键：`col.bigint().brand<'UserId'>()`，关系的 from / to 品牌对不上编译报错，`find(id)` 的参数跟着带品牌

### 18.2 第二批：TS 特有、官方没有的能力

- [x] 18.2.1 多态实体：`entity.union('kind', { card: {…}, wechat: {…} })` 一张表存几种子类型，行是判别联合；按判别列过滤后结果类型收窄
- [x] 18.2.2 Standard Schema 互通：实体带插入 / 更新 / 整行的校验器（`~standard`，zod、valibot、arktype 直接用）；`col.json(schema)` 读写校验；
      组件库的表单、框架的 action 共用这一份规则
- [x] 18.2.3 迁移历史：`eqts migrate generate` 由 planSync 生成带快照的迁移文件（改名、拆列可手改），`migrate up` 记历史表；生产环境用它代替 syncTables

### 18.3 第三批：工程体验

- [x] 18.3.1 可复用的通用条件：泛型函数对所有带某些列的实体都能用（结构类型），例如按租户过滤
- [x] 18.3.2 预编译查询：参数带类型，SQL 只渲染一次就缓存
- [x] 18.3.3 只读 Db 与请求上下文：`db.readonly()`、从库在类型上没有写方法；AsyncLocalStorage 的类型化请求上下文交给拦截器
- [x] 18.3.4 可观测性：每条语句一个 OpenTelemetry span；开发环境报 N+1（同一请求里重复的同形语句）与慢查询
- [x] 18.3.5 Serverless 与嵌入式驱动：Cloudflare D1、libSQL / Turso、Bun 的 sqlite、Neon serverless、PGlite（WASM 版 PG，单测不用容器）
- [x] 18.3.6 构建期导出查询：`defineSnapshots` + `eqts snapshot [--check]` 把查询按各方言渲染成 SQL 快照，用于评审与回归对比（定义文件由 Node 直接加载：查询链要运行时求值，不经 Babel 静态分析）

## 阶段 19：PG、MySQL 方言的针对性补全

目标（用户 2026-10-30 定）：两个最常用的库把各自的特色能力用起来，而不只是"各库都能跑的公共子集"。每项都要有 SQL 文本测试与实库测试
（本地 pg、mysql84 容器常开，PGlite 进程内；MySQL 8.0.18 基线交给 CI），文档站一节；别的方言没有的写法在渲染时报出、或在能力类型里标红。
按顺序做：

- [x] 19.1 列类型：`col.uuid()`（PG / DuckDB / ClickHouse 存 UUID、SQL Server 存 UNIQUEIDENTIFIER、MySQL 存 BINARY(16)，客户端 `uuidv7` 按时间有序）、
      PG 数组列 `col.array(元素列)`（`has` / `hasAll` / `hasAny` / `arrayLength`）、原生枚举 `col.enum(…).native(类型名)`（PG 建表前 CREATE TYPE、
      同步时 ADD VALUE；MySQL 是 ENUM(…)）、PG 的 `col.interval()`、数值列的 `unsigned()`；建表、同步、pull 都认得
- 19.2 一条 SQL 出对象树（JSON 聚合）：**不做**（用户 2026-10-30 定，做过一版已撤回）。主流 ORM 的 include 都是二次查询：每层 1+1，
  没有 N+1，性能随数据量是恒定的；JSON 聚合让结果变大、库里的聚合变重，换来的往返收益不值得维护两套写法
- [x] 19.3 服务端真正超时与取消：`db.withTimeout(ms)` / createDb 的 `statementTimeout` 与 `withSignal` 合成每条语句的信号交给驱动；
      PG 驱动 `pg_cancel_backend`、MySQL 驱动 `KILL QUERY` 在服务端终止语句（连接保留），别的驱动仍是客户端不再等
- [x] 19.4 JSON 的更新写法与展开：`jsonSet` / `jsonRemove` / `jsonMerge`（浅合并）/ `jsonAppend` 写进 set；`jsonSome(路径, 列, 条件)`
      按数组元素过滤（PG `jsonb_to_recordset`、MySQL `JSON_TABLE`、SQLite `json_each`）；PG 的 JSONPath `pathExists` / `pathMatch`
- [x] 19.5 批量写入：PG 100 行起 `unnest` 一条语句插完（openGauss 除外）、`merge(列, { onlyIf })` 渲染 `ON CONFLICT … DO UPDATE … WHERE`
      （PG、SQLite）、update / delete 的 `orderBy(…).limit(n)`（MySQL 原生，别的库改写成主键 IN 子查询）、MySQL 批量插入按 `max_allowed_packet` 切分；
      PG 15 的 `MERGE` 暂不做（插入或更新已由 upsert 覆盖，多分支要一套新 API）
- [x] 19.6 查询写法：PG 的 `distinctOn`、like 家族的 `{ ignoreCase }`（PG 写 ILIKE）、正则 `matches`（PG、MySQL、Oracle、DuckDB）、
      `forShare` / `forNoKeyUpdate`、`collate`、`optimizerHint`；MySQL 的索引提示用已有的 `tableHint`。`LATERAL` 与 `FOR UPDATE OF` 暂缓
      （每父行前 n 条已由 toList 的 limit 用窗口函数做了，分组聚合有 groupJoin；多表锁定场景少）
- [x] 19.7 建表时的索引与列：`generatedAs(sql, { stored })` 生成列（PG、MySQL、SQLite，写入时拒绝）；索引的 `using`（PG 的 GIN 等）、
      `where`（部分索引）、`expressions`（表达式索引，MySQL 多值索引也靠它），不支持的方言建表时报错；planSync 按名字比较索引，
      SQLite 改读 table_xinfo（看得到生成列）、PG 读得出表达式索引，eqts pull 生成 expressions
- [x] 19.8 `q.explain()` / `db.explain(statement)`：PG `EXPLAIN (FORMAT JSON)`、MySQL `EXPLAIN FORMAT=JSON`（analyze 时 8.0.18+ 的 EXPLAIN ANALYZE）、
      SQLite `EXPLAIN QUERY PLAN`；`queryWatch({ explain })` 的慢读语句带上计划
- [x] 19.9 MySQL 系的兼容库：`mariadb(pool)` / `mysql.detect` 自动认出 MariaDB——原生 UUID、单表 DELETE 不带别名、REGEXP、LOCK IN SHARE MODE、
      JSON 值用 JSON_EXTRACT、ANALYZE FORMAT=JSON、没有 GROUPING()；11.4 容器进 compose（mariadb profile）与 CI，共用套件全跑
- [x] 19.10 PG 的 advisory lock（`db.advisoryLock(key)`，事务级，跨进程的锁）与 `LISTEN / NOTIFY`（二级缓存的失效通知可以接它）

## 阶段 23：分布式缓存与最终一致（浏览器 → 本机内存 → Redis → 数据库）

目标（用户 2026-10-30 定）：多个后端实例各有本机内存缓存、共用 Redis，浏览器还有一层；失效经消息通道传到每个实例与它连着的浏览器，
通道留成接口，用户接自己的 MQ。一致性的保证写清楚：经 ORM 的写入提交后，各层在"消息送达"与"过期时间"两者较早的那个时间内变新，
消息丢了靠过期时间兜底；要强一致的数据不放本机层与浏览器。实测用 WSL 里的 PG 17 与 Redis 8.2（compose 的 redis 服务，CI 的 db job 同样起一个）。

- [x] 23.1 消息通道：`createBus(transport)`（每个实例一个来源标记，收消息时知道是不是自己发的；消息按传输的大小上限切开）；
      传输只要 `send(text)` 与 `listen(onText, onReset)` 两个方法：内置 `memoryTransport()`（进程内、测试）、`redisTransport`（发布订阅，
      ioredis 形状）、PG 包的 `pgTransport(pool)`（NOTIFY / LISTEN，断线自己重连并报 reset）；Kafka、RabbitMQ 等按文档的示例自己接
- [x] 23.2 多级存储：`redisStore(redis)`（HSET + PEXPIRE）、`tieredStore({ local, shared, localTtlMs })`（先本机、再共享，共享命中时回填本机，
      本机的过期时间更短）；`createCache({ bus })`：提交后删本机与共享层并发消息，别的实例收到后只删本机层（`evictLocal`）
- [x] 23.3 一致性的细节：写回守卫（读库前记下代数，期间这个键被失效过就不写回，挡住"读到旧值后写回"）、`lateEvictMs`（提交后隔一会儿再删一次并再发消息，
      挡住从库延迟与慢请求）、通道断过（reset）时清空本机层；`tableChanges(bus)` 把表的变更也发进通道
- [x] 23.4 kit：推送由消息通道驱动（每个实例收到后推给连着自己的浏览器），`hub.reset()` 让浏览器全部失效
- [x] 23.5 发件箱：`outboxTable()` 建表，`createCache({ outbox })` 与 `tableChanges(bus, { outbox })` 把消息和写入在同一个事务里落一行
      （核心的 afterWrite 事件加 `execute(statement)`，在写入所在的连接上执行），`relayOutbox` 按顺序发出再删；提交后照样马上发一次，发件箱保底
- [x] 23.6 实测：两个实例共用 PG 与 Redis，一个写入后另一个的本机层、Redis 与浏览器都变新；PG 的监听连接被断开后重连并 reset；
      全栈示例接上失效推送，端到端测试里一个页面添加待办、另一个页面的缓存数据自动刷新

## 阶段 24：迁到独立仓库（2026-11-01）

- [x] 24.1 带历史迁入：vue-tsx-pro 的 `packages/easy-query` 拆出 119 个提交，各包放到 `packages/`
- [x] 24.2 工具链独立：解析条件改名 `@easy-query-ts/source`，CI 的实库任务、本机容器（端口 3xxxx）搬过来，新增 `consumer` 检查发布产物
- [x] 24.3 缓存收窄（用户定）：去掉前端相关（`tableChanges`、`onEvict`、前端存储的 `cacheStore`）与真实驱动（`redisStore`、`redisTransport`、`pgTransport`、发件箱）。
      只留本机与 Redis 两级、三种部署；Redis 由使用方实现 `CacheStore`、`CacheTransport`，示例与实测放在 `packages/test`。上面阶段 23 里提到的这些都已不在本仓库
- [x] 24.4 发布 0.2.0（17 个包），vue-tsx-pro 改用 npm 上的版本

## 阶段 25：文档站（apps/docs）

用组件库（`@zerodep-dev/vue-tsx-pro-ui`、`tsx`，从 npm 装）写，不用 Markdown。

- [x] 25.1 代码卡片一行三栏：TypeScript、SQL、结果；方言全站共用，默认 PostgreSQL。SQL 不手写：`*.examples.ts` 先在 SQLite 上执行，别的方言用回放驱动走完同一段代码
- [x] 25.2 PostgreSQL、SQLite 点“运行”在浏览器里真实执行（PGlite、SQLite WASM），其余方言显示 SQL；演练场可以自己改代码，卡片上的“改一改”带过去
- [x] 25.3 全站共用一套业务模型（site/model.ts）；用社区首页串起功能；术语、最佳实践与常见问题
- [x] 25.4 CI 的 docs 任务：逐页水合，每张卡片在两个引擎上各跑一遍
- [x] 25.3.1 示例模型扩到 16 张表（树、自关联、多对多、订单明细、值对象、多态），隐式 join 默认 LEFT JOIN，只有 `Profile.user` 标 `required`；示例数据在“示例模型”页画成表格；新增 JSON 列、计算属性、复用查询、校验几章
- [x] 25.5 把 `docs/features/` 改写进来：实体与列、列类型、多态实体、显式 join、原生 SQL、事务与锁、性能、动态表名与模块、方言差异、配置、测试、与 Java 版的对应。共 37 页
- [ ] 25.5.1 站点部署（25.7）之后删掉 `docs/features/`，各包 README 改链到文档站；部署之前它们还是仓库里唯一能直接看的说明
- [ ] 25.5.2 还没写到站上的细节：加密列的分段搜索、各方言专属函数（`Pg.*`、`MySQL.*`、`MsSql.*`）的完整列表
- [ ] 25.6 全文搜索：现在只搜标题与简介；脚本检查每个公开导出都有文档、与 `docs/parity-docs.md` 对账
- [ ] 25.7 部署（需要域名）；vue-tsx-pro 文档站的 `/stack/orm/*` 换成外链
