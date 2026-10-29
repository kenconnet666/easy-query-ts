# 官方 easy-query 单元测试的逐条对照

由 `packages/easy-query/tools/parity-tests.mjs` 生成，不要手改：改能力的状态在 `tools/capabilities.mjs` 里改，再重新生成。
对照的是官方 `dromara/easy-query` 的 sql-test（2249 个用例）。每个用例按方法体里用到的 API 归到一种能力，状态取能力的状态。

合计：已对应 1643、写法不同 298、待做 234、不适用 74。

## 按能力

| 能力                                                             | 用例数 | 状态     | TS 侧（实现与测试）                                                                                                                                                                                 |
| ---------------------------------------------------------------- | ------ | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 建表与迁移（code-first）（`codeFirst`）                          | 17     | 待做     | 部分：createTables；syncTables 待做（16.5）                                                                                                                                                         |
| 列加密（`column.encryption`）                                    | 8      | 已对应   | encrypted（可分段搜索）、sqlConvert；easy-query-ts-crypto 的 aesEncryption / sm4Encryption（与 Java 版分段兼容）；crypto.test.ts、guards.test.ts、sql-convert.test.ts                               |
| ClickHouse 方言（`dialect.clickhouse`）                          | 4      | 待做     | 待做（16.7.6）                                                                                                                                                                                      |
| 达梦方言（`dialect.dameng`）                                     | 51     | 待做     | 待做（16.7.4）                                                                                                                                                                                      |
| DuckDB 方言（`dialect.duckdb`）                                  | 16     | 待做     | 待做（16.7.3）                                                                                                                                                                                      |
| H2 方言（`dialect.h2`）                                          | 74     | 不适用   | 不适用：H2 运行在 JVM 里，Node 没有驱动                                                                                                                                                             |
| 人大金仓方言（`dialect.kingbase`）                               | 2      | 待做     | 待做（16.7.5）                                                                                                                                                                                      |
| SQL Server 方言（`dialect.mssql`）                               | 38     | 待做     | 待做（16.7.1）                                                                                                                                                                                      |
| SQL Server 2008 及以前（ROW_NUMBER 分页）（`dialect.mssql2008`） | 13     | 待做     | 待做（16.7.1）                                                                                                                                                                                      |
| 按 DTO 自动带出（selectAutoInclude）（`dto.autoInclude`）        | 35     | 写法不同 | defineView + select(View)；suite.ts views                                                                                                                                                           |
| 按对象筛选排序（whereObject / orderByObject）（`dto.object`）    | 101    | 已对应   | filterBy(input, rules)（同名列直接写比较方式，{ op, column } 多列任一满足、经过导航，没填的跳过）、sortBy(sort, 白名单)、table(request, { filterable, sortable })；filter-by.test.ts、table.test.ts |
| CASE WHEN（`expr.case`）                                         | 27     | 已对应   | caseWhen；suite.ts functions and CASE                                                                                                                                                               |
| 按键填充（fillMany / fillOne）（`fill`）                         | 4      | 已对应   | fill.test.ts                                                                                                                                                                                        |
| 日期函数（`func.date`）                                          | 96     | 已对应   | format、add / addYears / addHours …（数量可以是列）、hour / minute / second、dayOfYear、dayOfWeek、isoDayOfWeek、diff、now；suite.ts function library                                               |
| 通用函数（nullOrDefault、maxColumns …）（`func.general`）        | 53     | 已对应   | orElse（nullOrDefault）、greatest / least（忽略 NULL）；suite.ts function library                                                                                                                   |
| 字符串聚合（joining）（`func.joining`）                          | 29     | 已对应   | g.joining / u.posts.joining / groupJoin().joining；suite.ts function library                                                                                                                        |
| JSON 函数（`func.json`）                                         | 12     | 已对应   | json / jsonText / jsonNumber / jsonBoolean / jsonHas / jsonLength，路径按列的 TS 类型补全检查；json-functions.test.ts、suite.ts function library                                                    |
| 数学函数（`func.math`）                                          | 4      | 已对应   | sign、power、sqrt、exp、ln、log10、log、三角函数、truncate；suite.ts function library                                                                                                               |
| 字符串函数（`func.string`）                                      | 128    | 已对应   | ltrim / rtrim、padStart / padEnd、text 模板、compare、notStartsWith / notEndsWith（nullEmpty 用 orElse）；suite.ts function library                                                                 |
| 拦截器（`interceptor`）                                          | 3      | 已对应   | interceptor-toggles.test.ts、write-events.test.ts                                                                                                                                                   |
| 行锁（`lock`）                                                   | 27     | 已对应   | forUpdate / NoWait / SkipLocked、tx.lock；suite.ts、transaction-hooks.test.ts                                                                                                                       |
| 逻辑删除（`logicDelete`）                                        | 10     | 已对应   | softDelete、$onDelete、导航上单独关；suite.ts column rules、guards.test.ts                                                                                                                          |
| 一对多展开（flatElement / elements）（`nav.flat`）               | 56     | 写法不同 | flatElement 在条件里是 any(…)、select 里是 toList(p => p.x)、多层是 r.path；element / firstElement 是 at(i)，另有 all、countDistinct；suite.ts implicit subqueries                                  |
| 隐式子查询改分组 join（`nav.groupJoin`）                         | 67     | 已对应   | groupJoin()；group-join.test.ts                                                                                                                                                                     |
| include 带出导航（`nav.include`）                                | 37     | 已对应   | include()、select 里的 toList；suite.ts                                                                                                                                                             |
| 隐式子查询（any / none / count / sum …）（`nav.subquery`）       | 142    | 已对应   | ManyRef；suite.ts、relation-filter.test.ts                                                                                                                                                          |
| 基本查询（条件、排序、选列、分页）（`query.basic`）              | 402    | 已对应   | query.ts；test/src/suite.ts queries、sqlite.sql.test.ts                                                                                                                                             |
| CTE（`query.cte`）                                               | 11     | 已对应   | db.with / withRecursive；suite.ts                                                                                                                                                                   |
| 分组与 having（`query.group`）                                   | 78     | 已对应   | groupBy / having / rollup / cube；suite.ts                                                                                                                                                          |
| 显式 join（含 merge 写法）（`query.join`）                       | 88     | 已对应   | innerJoin / leftJoin / rightJoin / crossJoin，lambda 按顺序收到各表；suite.ts explicit joins                                                                                                        |
| 无实体的 Map 查询、toMap（`query.map`）                          | 11     | 写法不同 | 不在 schema 里的实体直接查：db.queryable(entity('t_x', {...}))（带类型）；无实体、按列名取的 Map 结果用 db.sql；行本来就是普通对象（toMap）；adhoc.test.ts                                          |
| 分页结果（`query.page`）                                         | 22     | 已对应   | toPage、table()；suite.ts、table.test.ts                                                                                                                                                            |
| 复用查询（cloneQueryable）（`query.reuse`）                      | 2      | 写法不同 | 查询对象不可变，直接复用                                                                                                                                                                            |
| 流式读取（`query.stream`）                                       | 9      | 已对应   | stream()；suite.ts streaming                                                                                                                                                                        |
| union / union all（`query.union`）                               | 18     | 已对应   | union / unionAll；suite.ts                                                                                                                                                                          |
| 聚合根保存（savable）（`save.aggregate`）                        | 39     | 写法不同 | db.save(entity, tree, { include })：类型化 include 树，按现状比较（无追踪上下文）；多层、多对多中间表、多对一/一对一、removed、key；db.remove 删整棵树                                              |
| search 扩展（`search`）                                          | 45     | 待做     | 待对照（16.6.5）                                                                                                                                                                                    |
| 分库分表（`sharding`）                                           | 48     | 待做     | 待做（16.6.2、16.6.3）                                                                                                                                                                              |
| 原生 SQL（`sql.native`）                                         | 50     | 已对应   | sql 标签、db.sql；suite.ts native SQL                                                                                                                                                               |
| 跨库链接（asTableLink）（`table.link`）                          | 13     | 已对应   | db.withTableLink(link, only?)，表名渲染成 "t"@link；adhoc.test.ts                                                                                                                                   |
| 换表名（asTable）（`table.rename`）                              | 45     | 写法不同 | db.mapTables；suite.ts table mapping                                                                                                                                                                |
| 换 schema（asSchema）（`table.schema`）                          | 19     | 写法不同 | db.inSchema；sqlite.tenant.test.ts                                                                                                                                                                  |
| 追踪与差异更新（`tracking`）                                     | 62     | 写法不同 | update().changes(before, after)；changes.test.ts                                                                                                                                                    |
| 树（toTreeList / asTreeCTE）（`tree`）                           | 25     | 已对应   | toTree、descendantsOf / ancestorsOf；tree.test.ts                                                                                                                                                   |
| 乐观锁版本（`version`）                                          | 13     | 已对应   | version() / version({ initial, next })、withVersion；changes.test.ts                                                                                                                                |
| 窗口函数与分区（`window`）                                       | 38     | 已对应   | win.* 含 firstValue / lastValue / nthValue；suite.ts function library、windows                                                                                                                      |
| 删除（`write.delete`）                                           | 21     | 已对应   | delete()、hard()、hardDelete 护栏；suite.ts、guards.test.ts                                                                                                                                         |
| 插入（`write.insert`）                                           | 44     | 已对应   | insert().values / fromQuery / returnId / returnEntity；suite.ts writes                                                                                                                              |
| 更新 / 删除里用导航（UPDATE / DELETE 带 JOIN）（`write.join`）   | 10     | 写法不同 | 条件、set 里的多对一导航生成 LEFT JOIN；MySQL 原生多表 UPDATE / DELETE，PG / SQLite 按主键自连接（保留 LEFT 语义，官方在 PG 上等于 INNER）；suite.ts、sqlite.sql.test.ts                            |
| 写哪些列、批量执行（`write.strategy`）                           | 19     | 写法不同 | values / entity / entities 的 { columns: notNull \| null }；entities(..).batch() 合成 CASE WHEN 一条语句（不依赖驱动批量接口）；suite.ts                                                            |
| 更新（`write.update`）                                           | 50     | 已对应   | update().set / entity / changes / withVersion；suite.ts、changes.test.ts                                                                                                                            |
| upsert（`write.upsert`）                                         | 13     | 已对应   | onConflict().merge / ignore；suite.ts upsert                                                                                                                                                        |

## 逐条

### 建表与迁移（code-first）（`codeFirst`，待做）

| 用例                                    | 断言的 SQL（摘要）                                                                            |
| --------------------------------------- | --------------------------------------------------------------------------------------------- |
| InsertTest1.java#testInsert             | `INSERT INTO `t_test_insert` (`id`,`column1`,`column2`) VALUES (?,?,?)`                       |
| migration/MigrationDamengTest.java#test |                                                                                               |
| migration/MigrationPgTest.java#test     |                                                                                               |
| MigrationTest.java#createTableSQLTest1  | `CREATE TABLE IF NOT EXISTS `my_migration_blog` ( \n`                                         |
| MigrationTest.java#createTableSQLTest2  | `ALTER TABLE `t_topic`RENAME TO`t_topic2`;`                                                   |
| MigrationTest.java#createTableSQLTest3  | `ALTER TABLE `t_topic`CHANGE`title` `abc` varchar(200) NULL;`                                 |
| MigrationTest.java#createTableSQLTest4  |                                                                                               |
| mysql8/M8Test1.java#testNoKeyCodeFirst  |                                                                                               |
| mysql8/MySQL8Test2.java#test            |                                                                                               |
| pgsql/MigrationTest.java#test1          |                                                                                               |
| QueryTest22.java#testManyOrder          |                                                                                               |
| QueryTest24.java#testx18                | `SELECT `id`,`create_time`,`update_time`,`create_by`,`update_by`,`deleted`,`title`,`content…` |
| QueryTest26.java#testGenerateKeys       |                                                                                               |
| QueryTest3.java#userBookTest            |                                                                                               |
| sqlite/SQLiteTest.java#testDDL          | `CREATE TABLE IF NOT EXISTS \`                                                                |
| sqlite/SQLiteTest.java#testDDL2         | `CREATE TABLE IF NOT EXISTS \`                                                                |
| testmysql8/MyTest.java#testaa           |                                                                                               |

### 列加密（`column.encryption`，已对应）

| 用例                           | 断言的 SQL（摘要） |
| ------------------------------ | ------------------ |
| EncryptionTest.java#phoneTest  |                    |
| EncryptionTest.java#phoneTest1 |                    |
| EncryptionTest.java#phoneTest2 |                    |
| EncryptionTest.java#phoneTest3 |                    |
| EncryptionTest.java#phoneTest4 |                    |
| EncryptionTest.java#test5      |                    |
| EncryptionTest.java#test6      |                    |
| Sm4EncryptionTest.java#sm4Test |                    |

### ClickHouse 方言（`dialect.clickhouse`，待做）

| 用例                                  | 断言的 SQL（摘要）                                                                  |
| ------------------------------------- | ----------------------------------------------------------------------------------- |
| click/ClickHouseTest.java#testDelete1 | `ALTER TABLE `t_topic`DELETE WHERE`ID` = ?`                                         |
| click/ClickHouseTest.java#testDelete2 | `ALTER TABLE `t_topic`DELETE WHERE`ID` = ?`                                         |
| click/ClickHouseTest.java#testUpdate1 | `ALTER TABLE `t_topic`UPDATE`TITLE`= ? WHERE`ID` = ?`                               |
| click/ClickHouseTest.java#testUpdate2 | `ALTER TABLE `t_topic`UPDATE`STARS` = ?,`TITLE` = ?,`CREATE_TIME`= ? WHERE`ID` = ?` |

### 达梦方言（`dialect.dameng`，待做）

| 用例                                                                                       | 断言的 SQL（摘要）                            |
| ------------------------------------------------------------------------------------------ | --------------------------------------------- |
| dameng/DamengForUpdateTest.java#testForUpdateAppliesOnlyOnOuterQueryForExistsAndInSubQuery |                                               |
| dameng/DamengForUpdateTest.java#testForUpdateBlocksConcurrentTransaction                   |                                               |
| dameng/DamengForUpdateTest.java#testForUpdateDerivedCountAndExistsSqlBehaviorConsistent    |                                               |
| dameng/DamengForUpdateTest.java#testForUpdateDuplicateCallThrows                           |                                               |
| dameng/DamengForUpdateTest.java#testForUpdateJoinNotSupported                              |                                               |
| dameng/DamengForUpdateTest.java#testForUpdateSqlAppendInTransaction                        |                                               |
| dameng/DamengForUpdateTest.java#testForUpdateWithoutTransactionThrows                      |                                               |
| dameng/DamengQueryTest.java#concat1                                                        |                                               |
| dameng/DamengQueryTest.java#cteViewTree1                                                   |                                               |
| dameng/DamengQueryTest.java#query0                                                         | `SELECT \`                                    |
| dameng/DamengQueryTest.java#query0_1                                                       | `SELECT \`                                    |
| dameng/DamengQueryTest.java#query1                                                         | `SELECT rt.* FROM(SELECT \`                   |
| dameng/DamengQueryTest.java#query16                                                        | `SELECT COUNT(*) FROM (SELECT COUNT(*) AS \`  |
| dameng/DamengQueryTest.java#query17                                                        |                                               |
| dameng/DamengQueryTest.java#query2                                                         | `SELECT rt1.* FROM (SELECT rt.*, ROWNUM AS \` |
| dameng/DamengQueryTest.java#query3                                                         | `SELECT rt.* FROM (SELECT \`                  |
| dameng/DamengQueryTest.java#query4                                                         |                                               |
| dameng/DamengQueryTest.java#query5                                                         |                                               |
| dameng/DamengQueryTest.java#query6                                                         |                                               |
| dameng/DamengQueryTest.java#query7                                                         |                                               |
| dameng/DamengQueryTest.java#queryFormat1                                                   | `SELECT t.\`                                  |
| dameng/DamengQueryTest.java#queryFormat2                                                   | `SELECT t.\`                                  |
| dameng/DamengQueryTest.java#queryFormat3                                                   | `SELECT t.\`                                  |
| dameng/DamengQueryTest.java#queryFormat4                                                   | `SELECT t.\`                                  |
| dameng/DamengQueryTest.java#subQueryTest1                                                  | `SELECT t.\`                                  |
| dameng/DamengQueryTest.java#test1                                                          |                                               |
| dameng/DamengQueryTest.java#test111                                                        |                                               |
| dameng/DamengQueryTest.java#testaa                                                         |                                               |
| dameng/DamengQueryTest.java#testAll                                                        | `SELECT t.\`                                  |
| dameng/DamengQueryTest.java#testAll1                                                       | `SELECT t.\`                                  |
| dameng/DamengQueryTest.java#testAll2                                                       | `SELECT t.\`                                  |
| dameng/DamengQueryTest.java#testAllGroupJoin                                               | `SELECT t.\`                                  |
| dameng/DamengQueryTest.java#testAllGroupJoin2                                              | `SELECT t.\`                                  |
| dameng/DamengQueryTest.java#testBooleanValue                                               | `SELECT (CASE WHEN (EXISTS(SELECT 1 FROM \`   |
| dameng/DamengQueryTest.java#testBooleanValue2                                              | `SELECT (CASE WHEN (EXISTS(SELECT 1 FROM \`   |
| dameng/DamengQueryTest.java#testDraft9                                                     |                                               |
| dameng/DamengQueryTest.java#testEasyQuery                                                  |                                               |
| dameng/DamengQueryTest.java#testJoin1                                                      |                                               |
| dameng/DamengQueryTest.java#testJoining                                                    | `SELECT t.\`                                  |
| dameng/DamengQueryTest.java#testJoining1                                                   | `SELECT t.\`                                  |
| dameng/DamengQueryTest.java#testMaxColumns1                                                | `SELECT \`                                    |
| dameng/DamengQueryTest.java#testMaxColumns2                                                | `SELECT \`                                    |
| dameng/DamengQueryTest.java#testMaxColumns3                                                | `SELECT \`                                    |
| dameng/DamengQueryTest.java#testQuery                                                      | `SELECT t.\`                                  |
| dameng/DamengQueryTest.java#testQueryAlias                                                 | `SELECT t.\`                                  |
| dameng/DamengQueryTest.java#testQueryAlias2                                                | `SELECT t.\`                                  |
| dameng/DamengQueryTest.java#testQueryAlias3                                                | `SELECT t.\`                                  |
| dameng/MathQueryTest.java#testPropertyMath1                                                | `SELECT t.\`                                  |
| dameng/UpdateJoinTest.java#testTopicInsertOrUpdate                                         |                                               |
| dameng/UpdateJoinTest.java#testUpdateJoin1                                                 | `UPDATE \`                                    |
| dameng/UpdateJoinTest.java#testUpdateJoin2                                                 | `UPDATE \`                                    |

### DuckDB 方言（`dialect.duckdb`，待做）

| 用例                                             | 断言的 SQL（摘要） |
| ------------------------------------------------ | ------------------ |
| duckdb/AllTypeTest.java#testAllType              |                    |
| duckdb/AllTypeTest.java#testAllType1             |                    |
| duckdb/DuckDBMathQueryTest.java#testPropertyMath | `SELECT t.\`       |
| duckdb/DuckDBQueryTest.java#datetimeformat       | `SELECT t.\`       |
| duckdb/DuckDBQueryTest.java#datetimeformat1      | `SELECT t.\`       |
| duckdb/DuckDBQueryTest.java#formatMySQL          | `SELECT t.\`       |
| duckdb/DuckDBQueryTest.java#readExcel1           | `SELECT \`         |
| duckdb/DuckDBQueryTest.java#readExcel2           | `SELECT t.\`       |
| duckdb/DuckDBQueryTest.java#readExcel3           | `SELECT t.\`       |
| duckdb/DuckDBQueryTest.java#readExcel4           | `SELECT t.\`       |
| duckdb/DuckDBQueryTest.java#testConcat           | `SELECT \`         |
| duckdb/DuckDBQueryTest.java#testConcat2          |                    |
| duckdb/DuckDBQueryTest.java#testConcat3          | `SELECT \`         |
| duckdb/DuckDBQueryTest.java#testDraft9           |                    |
| duckdb/DuckDBQueryTest.java#testDraft9_1         |                    |
| duckdb/M8Save4Test.java#testToManyToMany1        |                    |

### H2 方言（`dialect.h2`，不适用）

| 用例                                                                               | 断言的 SQL（摘要）                                                                            |
| ---------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| h2/BasicTypeTest.java#booleanTest1                                                 | `SELECT ? FROM t_all_type t LIMIT 1`                                                          |
| h2/BasicTypeTest.java#booleanTest2                                                 | `SELECT t.enable FROM t_all_type t WHERE t.enable = ? LIMIT 1`                                |
| h2/BasicTypeTest.java#booleanTest3                                                 | `SELECT t.enable_basic FROM t_all_type t WHERE t.enable_basic = ? LIMIT 1`                    |
| h2/BasicTypeTest.java#byteTest1                                                    | `SELECT ? FROM t_all_type t WHERE t.id = ? LIMIT 1`                                           |
| h2/BasicTypeTest.java#byteTest2                                                    | `SELECT t.number_byte FROM t_all_type t WHERE t.id = ? LIMIT 1`                               |
| h2/BasicTypeTest.java#byteTest3                                                    | `SELECT t.number_byte_basic FROM t_all_type t WHERE t.id = ? LIMIT 1`                         |
| h2/BasicTypeTest.java#doubleTest1                                                  | `SELECT ? FROM t_all_type t WHERE t.id = ? LIMIT 1`                                           |
| h2/BasicTypeTest.java#doubleTest2                                                  | `SELECT t.number_double FROM t_all_type t WHERE t.id = ? LIMIT 1`                             |
| h2/BasicTypeTest.java#doubleTest3                                                  | `SELECT t.number_double_basic FROM t_all_type t WHERE t.id = ? LIMIT 1`                       |
| h2/BasicTypeTest.java#floatTest1                                                   | `SELECT ? FROM t_all_type t WHERE t.id = ? LIMIT 1`                                           |
| h2/BasicTypeTest.java#floatTest2                                                   | `SELECT t.number_float FROM t_all_type t WHERE t.id = ? LIMIT 1`                              |
| h2/BasicTypeTest.java#floatTest3                                                   | `SELECT t.number_float_basic FROM t_all_type t WHERE t.id = ? LIMIT 1`                        |
| h2/BasicTypeTest.java#intTest1                                                     | `SELECT ? FROM t_all_type t WHERE t.id = ? LIMIT 1`                                           |
| h2/BasicTypeTest.java#intTest2                                                     | `SELECT t.number_integer FROM t_all_type t WHERE t.id = ? LIMIT 1`                            |
| h2/BasicTypeTest.java#intTest3                                                     | `SELECT t.number_integer_basic FROM t_all_type t WHERE t.id = ? LIMIT 1`                      |
| h2/BasicTypeTest.java#localDateTest1                                               | `SELECT ? FROM t_all_type t WHERE t.id = ? LIMIT 1`                                           |
| h2/BasicTypeTest.java#localDateTest2                                               | `SELECT t.time_local_date FROM t_all_type t WHERE t.id = ? LIMIT 1`                           |
| h2/BasicTypeTest.java#localDateTimeTest1                                           | `SELECT ? FROM t_all_type t WHERE t.id = ? LIMIT 1`                                           |
| h2/BasicTypeTest.java#localDateTimeTest2                                           | `SELECT t.time_local_date_time FROM t_all_type t WHERE t.id = ? LIMIT 1`                      |
| h2/BasicTypeTest.java#localTimeTest1                                               | `SELECT ? FROM t_all_type t WHERE t.id = ? LIMIT 1`                                           |
| h2/BasicTypeTest.java#localTimeTest2                                               | `SELECT t.time_local_time FROM t_all_type t WHERE t.id = ? LIMIT 1`                           |
| h2/BasicTypeTest.java#longTest1                                                    | `SELECT ? FROM t_all_type t WHERE t.id = ? LIMIT 1`                                           |
| h2/BasicTypeTest.java#longTest2                                                    | `SELECT t.number_long FROM t_all_type t WHERE t.id = ? LIMIT 1`                               |
| h2/BasicTypeTest.java#longTest3                                                    | `SELECT t.number_long_basic FROM t_all_type t WHERE t.id = ? LIMIT 1`                         |
| h2/BasicTypeTest.java#shortTest1                                                   | `SELECT ? FROM t_all_type t WHERE t.id = ? LIMIT 1`                                           |
| h2/BasicTypeTest.java#shortTest2                                                   | `SELECT t.number_short FROM t_all_type t WHERE t.id = ? LIMIT 1`                              |
| h2/BasicTypeTest.java#shortTest3                                                   | `SELECT t.number_short_basic FROM t_all_type t WHERE t.id = ? LIMIT 1`                        |
| h2/BasicTypeTest.java#timeTest1                                                    | `SELECT ? FROM t_all_type t WHERE t.id = ? LIMIT 1`                                           |
| h2/BasicTypeTest.java#timeTest2                                                    | `SELECT t.only_time FROM t_all_type t WHERE t.id = ? LIMIT 1`                                 |
| h2/H2DocTest.java#selectClassTest1                                                 | `SELECT t.id,t.uid,t.code,t.type,t1.name AS user_name,t2.name AS bank_name FROM doc_bank_ca…` |
| h2/H2DocTest.java#selectClassTest2                                                 | `SELECT t.id,t.uid,t.code,t.type,t1.name AS user_name,t2.name AS bank_name FROM doc_bank_ca…` |
| h2/H2DocTest.java#selectClassTest3                                                 | `SELECT t.id,t.name,t.phone,t.age,(SELECT COUNT(*) FROM doc_bank_card t1 WHERE t1.uid = t.i…` |
| h2/H2DocTest.java#selectClassTest4                                                 | `SELECT t.id,t.name,t.phone,t.age,(SELECT COUNT(*) FROM doc_bank_card t1 WHERE t1.uid = t.i…` |
| h2/H2DocTest.java#selectClassTest5                                                 | `SELECT t.id,t.name,t.phone,t.age,IFNULL(t.age,1) AS card_count FROM doc_user t WHERE t.nam…` |
| h2/H2DocTest.java#selectProxyTest1                                                 | `SELECT t.id,t.uid,t.code,t.type,t1.name AS user_name,t2.name AS bank_name FROM doc_bank_ca…` |
| h2/H2DocTest.java#selectProxyTest1_1                                               | `SELECT t.id,t.code FROM doc_bank_card t WHERE t.type = ?`                                    |
| h2/H2DocTest.java#selectProxyTest2                                                 | `SELECT t.id,t.uid,t.code,t.type,t1.name AS user_name,t2.name AS bank_name FROM doc_bank_ca…` |
| h2/H2DocTest.java#selectProxyTest3                                                 | `SELECT t.id,t.name,t.phone,t.age,(SELECT COUNT(*) FROM doc_bank_card t1 WHERE t1.uid = t.i…` |
| h2/H2DocTest.java#selectProxyTest4                                                 | `SELECT t.id,t.name,t.phone,t.age,(SELECT COUNT(*) FROM doc_bank_card t1 WHERE t1.uid = t.i…` |
| h2/H2DocTest.java#selectProxyTest5                                                 | `SELECT t.id,t.name,t.phone,t.age,IFNULL(t.age,1) AS card_count FROM doc_user t WHERE t.nam…` |
| h2/H2DocTest.java#testToOne                                                        | `SELECT id,name,phone,age FROM doc_user WHERE name LIKE ? AND id IS NULL AND id IS NOT NULL`  |
| h2/H2DocTest.java#testToOne1                                                       | `SELECT t.id,t.uid,t.code,t.type,t.bank_id FROM doc_bank_card t LEFT JOIN doc_user t1 ON t1…` |
| h2/H2ForUpdateTest.java#testForUpdateAppliesOnlyOnOuterQueryForExistsAndInSubQuery |                                                                                               |
| h2/H2ForUpdateTest.java#testForUpdateBlocksConcurrentTransaction                   |                                                                                               |
| h2/H2ForUpdateTest.java#testForUpdateDerivedCountAndExistsSqlBehaviorConsistent    |                                                                                               |
| h2/H2ForUpdateTest.java#testForUpdateDuplicateCallThrows                           |                                                                                               |
| h2/H2ForUpdateTest.java#testForUpdateJoinNotSupported                              |                                                                                               |
| h2/H2ForUpdateTest.java#testForUpdateSqlAppendInTransaction                        |                                                                                               |
| h2/H2ForUpdateTest.java#testForUpdateWithoutTransactionThrows                      |                                                                                               |
| h2/H2OrderTest.java#test1                                                          |                                                                                               |
| h2/H2OrderTest.java#test2                                                          |                                                                                               |
| h2/H2QueryRelationTest.java#tbTest1                                                | `SELECT id,uid,uname,price FROM t_tb_order`                                                   |
| h2/H2QueryTest.java#allTypeTest1                                                   |                                                                                               |
| h2/H2QueryTest.java#allTypeTest1_1                                                 |                                                                                               |
| h2/H2QueryTest.java#allTypeTest1_1_proxy                                           |                                                                                               |
| h2/H2QueryTest.java#allTypeTest1_2                                                 |                                                                                               |
| h2/H2QueryTest.java#allTypeTest1_2_proxy                                           |                                                                                               |
| h2/H2QueryTest.java#allTypeTest1_proxy                                             |                                                                                               |
| h2/H2QueryTest.java#allTypeTestSharding1                                           |                                                                                               |
| h2/H2QueryTest.java#conditionTest1                                                 | `SELECT t.id,t.user_name,t.nickname,t.enable,t.score,t.mobile,t.avatar,t.number,t.status,t.…` |
| h2/H2QueryTest.java#leftJoin1                                                      | `SELECT t.id,t.user_name,t.nickname,t.enable,t.score,t.mobile,t.avatar,t.number,t.status,t.…` |
| h2/H2QueryTest.java#leftJoin1_1                                                    | `SELECT t.id,t.user_name,t.nickname,t.enable,t.score,t.mobile,t.avatar,t.number,t.status,t.…` |
| h2/H2QueryTest.java#leftJoin2                                                      | `SELECT t.id,t.user_name,t.nickname,t.enable,t.score,t.mobile,t.avatar,t.number,t.status,t.…` |
| h2/H2QueryTest.java#leftJoin2_1                                                    | `SELECT t.id,t.user_name,t.nickname,t.enable,t.score,t.mobile,t.avatar,t.number,t.status,t.…` |
| h2/H2QueryTest.java#leftJoin3                                                      | `SELECT t.id,t.user_name,t.nickname,t.enable,t.score,t.mobile,t.avatar,t.number,t.status,t.…` |
| h2/H2QueryTest.java#leftJoin3_1                                                    | `SELECT t.id,t.user_name,t.nickname,t.enable,t.score,t.mobile,t.avatar,t.number,t.status,t.…` |
| h2/H2QueryTest.java#leftJoin4                                                      | `SELECT t.id,t.user_name,t.nickname,t.enable,t.score,t.mobile,t.avatar,t.number,t.status,t.…` |
| h2/H2QueryTest.java#leftJoin4_1                                                    | `SELECT t.id,t.user_name,t.nickname,t.enable,t.score,t.mobile,t.avatar,t.number,t.status,t.…` |
| h2/H2QueryTest.java#testDDL                                                        | `CREATE TABLE IF NOT EXISTS t_topic ( \n`                                                     |
| h2/H2QueryTest.java#testDDL2                                                       | `CREATE TABLE IF NOT EXISTS t_multi_primary ( \n`                                             |
| h2/H2QueryTest.java#testTableCommentDDL                                            | `CREATE TABLE IF NOT EXISTS t_h2_table_comment ( \n`                                          |
| h2/TreeCTETest.java#tree8                                                          | `WITH RECURSIVE as_tree_cte(cte_deep,id,parent_id,name) AS ( (SELECT 0 AS cte_deep,t1.id,t1…` |
| h2/v2/H2V2Test.java#testAllType                                                    |                                                                                               |
| h2/v2/H2V2Test.java#testAllType1                                                   |                                                                                               |

### 人大金仓方言（`dialect.kingbase`，待做）

| 用例                                   | 断言的 SQL（摘要）                                                                            |
| -------------------------------------- | --------------------------------------------------------------------------------------------- |
| kingbase/MyKingbaseESTest.java#testaa  | `SELECT `id`,`create_time`,`update_time`,`create_by`,`update_by`,`deleted`,`delete_by`,`del…` |
| kingbase/MyKingbaseESTest.java#testaa1 | `SELECT `id`,`create_time`,`update_time`,`create_by`,`update_by`,`deleted`,`delete_by`,`del…` |

### SQL Server 方言（`dialect.mssql`，待做）

| 用例                                           | 断言的 SQL（摘要）                                                                            |
| ---------------------------------------------- | --------------------------------------------------------------------------------------------- |
| mssql/MSSQLMathQueryTest.java#testPropertyMath | `SELECT t.[TestValue] AS [TestValue],ABS(t.[TestValue]) AS [TestAbs],SIGN(t.[TestValue]) AS…` |
| mssql/MsSQLQueryTest.java#concat1              |                                                                                               |
| mssql/MsSQLQueryTest.java#query0               | `SELECT [Id],[Stars],[Title],[CreateTime] FROM [MyTopic] WHERE [Id] = ?`                      |
| mssql/MsSQLQueryTest.java#query1               | `SELECT [Id],[Stars],[Title],[CreateTime] FROM [MyTopic] WHERE [Id] = ?`                      |
| mssql/MsSQLQueryTest.java#query10              | `SELECT [Id],[Stars],[Title],[CreateTime] FROM [MyTopic] WHERE (SUBSTRING(CONVERT(CHAR(8), …` |
| mssql/MsSQLQueryTest.java#query11              | `SELECT [Id],[Stars],[Title],[CreateTime] FROM [MyTopic] WHERE (SUBSTRING(CONVERT(CHAR(8), …` |
| mssql/MsSQLQueryTest.java#query2               | `SELECT [Id],[Stars],[Title],[CreateTime] FROM [MyTopic] WHERE [Id] = ?`                      |
| mssql/MsSQLQueryTest.java#query3               | `SELECT [Id],[Stars],[Title],[CreateTime] FROM [MyTopic] WHERE [Id] = ?`                      |
| mssql/MsSQLQueryTest.java#query4               |                                                                                               |
| mssql/MsSQLQueryTest.java#query5               |                                                                                               |
| mssql/MsSQLQueryTest.java#query6               |                                                                                               |
| mssql/MsSQLQueryTest.java#query7               | `SELECT [Id],[Stars],[Title],[CreateTime] FROM [MyTopic] WHERE (CASE WHEN [Title] = ? THEN …` |
| mssql/MsSQLQueryTest.java#query8               | `SELECT [Id],[Stars],[Title],[CreateTime] FROM [MyTopic] WHERE (CASE WHEN [Title] = [Id] TH…` |
| mssql/MsSQLQueryTest.java#query9               | `SELECT t.[Title] AS [Value1],STRING_AGG(t.[Id], ?) AS [Value2] FROM [MyTopic] t GROUP BY t…` |
| mssql/MsSQLQueryTest.java#testAll              | `SELECT t.[Id],t.[Name],t.[Phone],t.[Age],t.[CreateTime] FROM [t_sys_user] t WHERE NOT (EXI…` |
| mssql/MsSQLQueryTest.java#testAll1             | `SELECT t.[Id],t.[Name],t.[Phone],t.[Age],t.[CreateTime] FROM [t_sys_user] t WHERE NOT (EXI…` |
| mssql/MsSQLQueryTest.java#testAll2             | `SELECT t.[Id],t.[Name],t.[Phone],t.[Age],t.[CreateTime] FROM [t_sys_user] t WHERE NOT (EXI…` |
| mssql/MsSQLQueryTest.java#testAllGroupJoin     | `SELECT t.[Id],t.[Name],t.[Phone],t.[Age],t.[CreateTime] FROM [t_sys_user] t LEFT JOIN (SEL…` |
| mssql/MsSQLQueryTest.java#testAllGroupJoin2    | `SELECT t.[Id],t.[Name],t.[Phone],t.[Age],t.[CreateTime] FROM [t_sys_user] t LEFT JOIN (SEL…` |
| mssql/MsSQLQueryTest.java#testBatchInsert      |                                                                                               |
| mssql/MsSQLQueryTest.java#testBigDecima2       |                                                                                               |
| mssql/MsSQLQueryTest.java#testBigDecima4       |                                                                                               |
| mssql/MsSQLQueryTest.java#testBigDecimal       |                                                                                               |
| mssql/MsSQLQueryTest.java#testFormat           | `SELECT t.[CreateTime] AS [Value1],(SUBSTRING(CONVERT(CHAR(8), t.[CreateTime], 112), 1, 4) …` |
| mssql/MsSQLQueryTest.java#testLikeConcat1      | `SELECT [Id],[Stars],[Title],[CreateTime] FROM [MyTopic] WHERE [Title] LIKE ('%'+CAST(CONCA…` |
| mssql/MsSQLQueryTest.java#testLikeConcat2      | `SELECT [Id],[Stars],[Title],[CreateTime] FROM [MyTopic] WHERE [Title] LIKE (CAST(CONCAT(?,…` |
| mssql/MsSQLQueryTest.java#testLikeConcat3      | `SELECT [Id],[Stars],[Title],[CreateTime] FROM [MyTopic] WHERE [Title] LIKE ('%'+CAST(CONCA…` |
| mssql/MsSQLQueryTest.java#testMaxColumns       | `SELECT [Id],[Column1],[Column2],[Column3] FROM [t_calc] WHERE (SELECT MAX(__col__) FROM (V…` |
| mssql/MsSQLQueryTest.java#testMaxColumns2      | `SELECT t.[Column1] AS [Value1],t.[Column2] AS [Value2],t.[Column3] AS [Value3],(SELECT MAX…` |
| mssql/MsSQLQueryTest.java#testWithIndex        | `SELECT t.[Id],t.[Name],t.[Phone],t.[Age],t.[CreateTime] FROM [t_sys_user] t WITH(INDEX(myI…` |
| mssql/MsSQLQueryTest.java#testWithNolock1      | `SELECT t.[Id],t.[Uid],t.[Code],t.[Type],t.[BankId],t.[OpenTime] FROM [t_bank_card] t WITH(…` |
| mssql/MsSQLQueryTest.java#testWithNolock2      | `SELECT t.[Id],t.[Name],t.[Phone],t.[Age],t.[CreateTime] FROM [t_sys_user] t WITH(NOLOCK) L…` |
| mssql/MsSQLQueryTest.java#update1              | `UPDATE t SET t.[Title] = ? FROM [MyTopic] t WHERE t.[Id] IS NULL AND EXISTS(SELECT 1 FROM …` |
| mssql/MSSQLTest1.java#test1                    | `SELECT t2.[code] AS [code],t2.[name] AS [name] FROM (SELECT t.[Code] AS [code],t1.[Code] A…` |
| mssql/MsSQLUpdateJoinTest.java#testDeleteJoin1 | `DELETE t FROM [doc_bank_card] t INNER JOIN [doc_user] t1 ON t1.[Id] = t.[Uid] WHERE t1.[Na…` |
| mssql/MsSQLUpdateJoinTest.java#testDeleteJoin2 | `DELETE t FROM [doc_bank_card] t INNER JOIN [doc_user] t1 ON t1.[Id] = t.[Uid] WHERE t1.[Na…` |
| mssql/MsSQLUpdateJoinTest.java#testUpdateJoin1 | `UPDATE t SET t.[Type] = t1.[Name] FROM [doc_bank_card] t INNER JOIN [doc_user] t1 ON t1.[I…` |
| mssql/MsSQLUpdateJoinTest.java#testUpdateJoin2 | `UPDATE t SET t.[Type] = t1.[Name] FROM [doc_bank_card] t INNER JOIN [doc_bank] t1 ON t1.[I…` |

### SQL Server 2008 及以前（ROW_NUMBER 分页）（`dialect.mssql2008`，待做）

| 用例                                                   | 断言的 SQL（摘要）                                                                            |
| ------------------------------------------------------ | --------------------------------------------------------------------------------------------- |
| mssqlrownumber/MsSQLRowNumberQueryTest.java#query0     | `SELECT [Id],[Stars],[Title],[CreateTime] FROM [MyTopic] WHERE [Id] = ?`                      |
| mssqlrownumber/MsSQLRowNumberQueryTest.java#query1     | `SELECT [Id],[Stars],[Title],[CreateTime] FROM [MyTopic] WHERE [Id] = ?`                      |
| mssqlrownumber/MsSQLRowNumberQueryTest.java#query2     | `SELECT [Id],[Stars],[Title],[CreateTime] FROM [MyTopic] WHERE [Id] = ?`                      |
| mssqlrownumber/MsSQLRowNumberQueryTest.java#query3     | `SELECT [Id],[Stars],[Title],[CreateTime] FROM [MyTopic] WHERE [Id] = ?`                      |
| mssqlrownumber/MsSQLRowNumberQueryTest.java#query4     |                                                                                               |
| mssqlrownumber/MsSQLRowNumberQueryTest.java#query4_1   |                                                                                               |
| mssqlrownumber/MsSQLRowNumberQueryTest.java#query4_2   |                                                                                               |
| mssqlrownumber/MsSQLRowNumberQueryTest.java#query5     |                                                                                               |
| mssqlrownumber/MsSQLRowNumberQueryTest.java#query5_1   |                                                                                               |
| mssqlrownumber/MsSQLRowNumberQueryTest.java#query5_2   | `WITH rt AS ( SELECT [Id],[Stars],[Title],[CreateTime], ROW_NUMBER() OVER( ORDER BY [Id] AS…` |
| mssqlrownumber/MsSQLRowNumberQueryTest.java#query5_3   | `WITH rt AS ( SELECT [Id],[Stars],[Title],[CreateTime], ROW_NUMBER() OVER( ORDER BY [Id] ) …` |
| mssqlrownumber/MsSQLRowNumberQueryTest.java#query6     |                                                                                               |
| mssqlrownumber/MsSQLRowNumberQueryTest.java#testDraft9 |                                                                                               |

### 按 DTO 自动带出（selectAutoInclude）（`dto.autoInclude`，写法不同）

| 用例                                                         | 断言的 SQL（摘要）                                                                            |
| ------------------------------------------------------------ | --------------------------------------------------------------------------------------------- |
| DirectRelationTest.java#test4                                | `SELECT t.`c1`,t.`c2`,t.`c3`,t.`c4`FROM`direct1` t`                                           |
| DirectRelationTest.java#test5                                | `SELECT t.`c1`,t.`c2`,t.`c3`,t.`c4`FROM`direct1` t`                                           |
| doc/DocTest1.java#testBlog5                                  | `SELECT t1.`name`AS`uname1`,t3.`name`AS`uname2`,t.`id`,t.`name`FROM`test_self` t LEFT…`       |
| GeneralFunctionsTest.java#testKingbaseCte                    | `WITH RECURSIVE \`                                                                            |
| mysql8/IncludeConditionTest.java#testInclude3                | `SELECT t.`id`,t.`name`,t.`version`AS`__relation__version`FROM`my_task` t WHERE t.`id` …`     |
| mysql8/IncludeConditionTest.java#testInclude4                | `SELECT t.`id`,t.`name`,t.`version`FROM`my_task` t WHERE t.`id` = ?`                          |
| mysql8/M8BankTest.java#partitionBy                           | `SELECT t.`id`,t.`uid`,t.`code`,t.`type`,t.`bank_id`,t.`open_time`FROM`t_bank_card` t`        |
| mysql8/M8BankTest.java#testExtraDTO                          | `SELECT t.`id`,t.`name`,t.`create_time`FROM`t_bank` t`                                        |
| mysql8/M8BankTest.java#testExtraDTO123                       | `SELECT t.`id`,t.`name`,t.`create_time`FROM`t_bank` t`                                        |
| mysql8/M8BankTest.java#testExtraFilter                       | `SELECT t.`id`,t.`name`,t.`phone`,t.`age`,t.`create_time`FROM`t_sys_user` t`                  |
| mysql8/M8BankTest.java#testExtraFilter2                      | `SELECT IFNULL(t2.`**count2**`,0) AS `card_count`,t.`id`,t.`name`,t.`phone`,t.`age`,t.`crea…` |
| mysql8/M8PCABTest.java#testFlat                              | `SELECT t.`id`,t.`name`FROM`m8_province` t`                                                   |
| mysql8/M8PCABTest.java#testFlat1                             | `SELECT t.`id`,t.`name`FROM`m8_province` t`                                                   |
| mysql8/M8PCABTest.java#testFlat2                             | `SELECT t.`id`,t.`name`FROM`m8_province` t`                                                   |
| mysql8/M8Test1.java#test24                                   | `SELECT t1.`uid`AS`uid`,t1.`count`AS`count` FROM (SELECT t.`uid`AS`uid`,COUNT(*) AS `…`       |
| mysql8/M8Test1.java#test25                                   | `SELECT t1.`uid`AS`uid`,t1.`count`AS`count` FROM (SELECT t.`uid`AS`uid`,COUNT(*) AS `…`       |
| mysql8/ManyJoinTest.java#testFlatExtra                       | `SELECT t.`id`,t.`name`,t.`create_time`FROM`m8_role` t`                                       |
| mysql8/ManyJoinTest.java#testFlatMenuOwner                   |                                                                                               |
| mysql8/ManyJoinTest.java#testFlatMenuOwner1                  |                                                                                               |
| mysql8/ManyJoinTest.java#testFlatMenuOwnerFlatValueConverter |                                                                                               |
| mysql8/MySQL8Test2.java#includePartitionBy                   | `SELECT t.`id`,t.`name`,t.`create_time`FROM`t_bank` t`                                        |
| mysql8/MySQL8Test2.java#includePartitionBy1                  | `SELECT t.`id`,t.`name`,t.`create_time`FROM`t_bank` t`                                        |
| mysql8/MySQL8Test3.java#testQueryFirstLimit2                 | `SELECT t2.`code`,t2.`type`,t2.`open_time`,t2.`uid`AS`__relation__uid` FROM (SELECT t1.`i…`   |
| mysql8/MySQL8Test3.java#testTree2                            | `WITH RECURSIVE `as_tree_cte`AS ( (SELECT 0 AS`deep`,t1.`id`,t1.`parent_id`,t1.`content`,…`   |
| mysql8/MySQL8Test3.java#testTree3                            | `WITH RECURSIVE `as_tree_cte`AS ( (SELECT 0 AS`deep`,t1.`id`,t1.`parent_id`,t1.`content`,…`   |
| mysql8/MySQL8Test3.java#testTree4                            | `WITH RECURSIVE `as_tree_cte`AS ( (SELECT 0 AS`deep`,t1.`id`,t1.`parent_id`,t1.`content`,…`   |
| mysql8/MySQL8Test3.java#testTree5                            |                                                                                               |
| mysql8/MySQL8Test5.java#testSysDeptCTE                       |                                                                                               |
| pgsql/QueryCteTest.java#tree7                                | `WITH RECURSIVE \`                                                                            |
| pgsql/QueryTest19.java#tree7                                 | `WITH RECURSIVE \`                                                                            |
| pgsql/QueryTest19.java#tree8                                 | `WITH RECURSIVE \`                                                                            |
| QueryTest14.java#test1                                       | `SELECT t.`id`,t.`name`,t.`password`FROM`t_test_user` t`                                      |
| QueryTest16.java#test111                                     | `SELECT t.`id`AS`__relation__id`FROM`sys_user` t WHERE t.`deleted` = ?`                       |
| QueryTest19.java#testDoc100                                  | `SELECT t.`id`,t.`name`FROM`t_user` t`                                                        |
| QueryTestRelationTest.java#testRelation                      | `SELECT `id`,`com_id`,`user_id`,`gw`FROM`my_com_user``                                        |

### 按对象筛选排序（whereObject / orderByObject）（`dto.object`，已对应）

| 用例                                                  | 断言的 SQL（摘要）                                                                            |
| ----------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| doc/DocTest.java#test1                                | `SELECT COUNT(*) FROM `t_sys_user`WHERE`name`LIKE ? AND`phone`LIKE ? AND`create_time`…`       |
| mysql8/ExampleTest.java#sampleTest1                   |                                                                                               |
| mysql8/M8BankTest.java#test10                         | `SELECT t.`code`AS`value1`,t2.`name`AS`value2`,t1.`name`AS`value3`FROM`t_bank_card`…`         |
| mysql8/M8BankTest.java#test4                          | `SELECT t.`id`,t.`name`,t.`phone`,t.`age`,t.`create_time`FROM`t_sys_user` t WHERE (SELECT…`   |
| mysql8/M8BankTest.java#test9                          | `SELECT t.`id`,t.`uid`,t.`code`,t.`type`,t.`bank_id`,t.`open_time`FROM`t_bank_card` t`        |
| mysql8/M8QueryTest.java#whereObject1                  | `SELECT t.`id`,t.`uid`,t.`code`,t.`type`,t.`bank_id`,t.`open_time`FROM`t_bank_card` t INN…`   |
| mysql8/M8QueryTest.java#whereObject2                  | `SELECT t.`id`,t.`name`,t.`phone`,t.`age`,t.`create_time`FROM`t_sys_user` t LEFT JOIN (SE…`   |
| mysql8/M8QueryTest.java#whereObject3                  | `SELECT t.`id`,t.`name`,t.`phone`,t.`age`,t.`create_time`FROM`t_sys_user` t WHERE EXISTS(…`   |
| mysql8/M8QueryTest.java#whereObject4                  | `SELECT t.`id`,t.`name`,t.`phone`,t.`age`,t.`create_time`FROM`t_sys_user` t LEFT JOIN (SE…`   |
| mysql8/M8QueryTest.java#whereObject6                  | `SELECT t.`id`,t.`name`,t.`phone`,t.`age`,t.`create_time`FROM`t_sys_user` t LEFT JOIN (SE…`   |
| mysql8/MySQL8Test2.java#testFilterConfigure1          | `SELECT t.`id`,t.`name`,t.`create_time`FROM`t_bank`t WHERE EXISTS(SELECT 1 FROM`t_bank_…`     |
| mysql8/MySQL8Test2.java#testFilterConfigure10         | `SELECT t.`id`,t.`name`,t.`create_time`FROM`t_bank`t WHERE EXISTS(SELECT 1 FROM`t_bank_…`     |
| mysql8/MySQL8Test2.java#testFilterConfigure11         | `SELECT t.`id`,t.`name`,t.`create_time`FROM`t_bank`t WHERE EXISTS(SELECT 1 FROM`t_bank_…`     |
| mysql8/MySQL8Test2.java#testFilterConfigure2          | `SELECT t.`id`,t.`name`,t.`create_time`FROM`t_bank`t WHERE EXISTS(SELECT 1 FROM`t_bank_…`     |
| mysql8/MySQL8Test2.java#testFilterConfigure3          | `SELECT t.`id`,t.`name`,t.`create_time`FROM`t_bank` t LEFT JOIN (SELECT t1.`bank_id`AS`…`     |
| mysql8/MySQL8Test2.java#testFilterConfigure3_1        | `SELECT t.`id`,t.`name`,t.`create_time`FROM`t_bank` t LEFT JOIN (SELECT t1.`bank_id`AS`…`     |
| mysql8/MySQL8Test2.java#testFilterConfigure4          | `SELECT t.`id`,t.`name`,t.`create_time`FROM`t_bank` t LEFT JOIN (SELECT t1.`bank_id`AS`…`     |
| mysql8/MySQL8Test2.java#testFilterConfigure5          | `SELECT t.`id`,t.`name`,t.`create_time`FROM`t_bank` t`                                        |
| mysql8/MySQL8Test2.java#testFilterConfigure6          | `SELECT t.`id`,t.`name`,t.`create_time`FROM`t_bank` t`                                        |
| mysql8/MySQL8Test2.java#testFilterConfigure7          | `SELECT t.`id`,t.`name`,t.`create_time`FROM`t_bank` t`                                        |
| mysql8/MySQL8Test2.java#testFilterConfigure8          | `SELECT t.`id`,t.`name`,t.`create_time`FROM`t_bank` t LEFT JOIN (SELECT t1.`id`,t1.`uid`,…`   |
| mysql8/MySQL8Test2.java#testFilterConfigure9          | `SELECT t.`id`,t.`name`,t.`create_time`FROM`t_bank` t LEFT JOIN (SELECT t1.`id`,t1.`uid`,…`   |
| mysql8/MySQL8Test2.java#testMerge                     | `SELECT IFNULL(t2.`**count2**`,0) AS `value1`,IFNULL(t2.`**count3**`,0) AS `value2`FROM`m…`   |
| mysql8/MySQL8Test2.java#testMerge2                    | `SELECT COUNT(*) FROM `m8_province` t LEFT JOIN (SELECT t1.`pid`AS`**group_key1**`,COUNT(…`   |
| mysql8/MySQL8Test2.java#testMerge3                    | `SELECT COUNT(*) FROM `m8_province` t LEFT JOIN (SELECT t1.`pid`AS`**group_key1**`,COUNT(…`   |
| mysql8/MySQL8Test2.java#testMerge4                    | `SELECT COUNT(*) FROM `m8_province` t WHERE t.`name` LIKE CONCAT('%',?,'%')`                  |
| mysql8/MySQL8Test2.java#testMerge5                    | `SELECT COUNT(*) FROM `m8_province` t LEFT JOIN (SELECT t1.`pid`AS`**group_key1**`,COUNT(…`   |
| mysql8/MySQL8Test2.java#testSumCount                  | `SELECT IFNULL(t2.`**sum2**`,0) AS `value1`,IFNULL(t2.`**sum3**`,0) AS `value2`FROM`m8_pr…`   |
| mysql8/MySQL8Test3.java#testDynamicJoin               |                                                                                               |
| mysql8/MySQL8Test4.java#testFilter                    | `SELECT t.`id`,t.`name`,t.`phone`,t.`age`,t.`create_time`FROM`t_sys_user`t LEFT JOIN`t_…`     |
| mysql8/MySQL8Test4.java#testFilterAndDependency       | `SELECT t.`id`,t.`name`,t.`phone`,t.`age`,t.`create_time`FROM`t_sys_user` t LEFT JOIN (SE…`   |
| mysql8/MySQL8Test4.java#testSubQueryCountCompareNull2 | `SELECT `id`,`name`,`phone`,`age`,`create_time`FROM`t_sys_user``                              |
| mysql8/MySQL8Test4.java#testTimeAfterNull2            | `SELECT `id`,`name`,`phone`,`age`,`create_time`FROM`t_sys_user``                              |
| mysql8/MySQL8Test4.java#testTimeBeforeNull2           | `SELECT `id`,`name`,`phone`,`age`,`create_time`FROM`t_sys_user``                              |
| mysql8/MySQL8Test5.java#testToSelectPageResult        | `SELECT t1.`id`,t1.`name`,t1.`create_time`,t3.`**joining2**`AS`__part__column1` FROM (SEL…`   |
| QueryTest.java#query15                                | `SELECT `id`,`stars`,`title`,`create_time`FROM`t_topic`WHERE`create_time` > ?`                |
| QueryTest.java#query18                                | `SELECT `id`,`stars`,`title`,`create_time`FROM`t_topic`WHERE`create_time` > ? ORDER BY …`     |
| QueryTest14.java#testClose                            | `SELECT t.`order`AS`top`FROM`t_blog`t LEFT JOIN`t_topic` t1 ON t.`id` = t1.`id` WHERE…`       |
| QueryTest18.java#rangeTest1_1                         | `SELECT `id`,`create_time`,`update_time`,`create_by`,`update_by`,`deleted`,`title`,`content…` |
| QueryTest18.java#rangeTest1_2                         | `SELECT `id`,`create_time`,`update_time`,`create_by`,`update_by`,`deleted`,`title`,`content…` |
| QueryTest18.java#rangeTest1_3                         | `SELECT `id`,`create_time`,`update_time`,`create_by`,`update_by`,`deleted`,`title`,`content…` |
| QueryTest18.java#rangeTest1_4                         | `SELECT `id`,`create_time`,`update_time`,`create_by`,`update_by`,`deleted`,`title`,`content…` |
| QueryTest18.java#rangeTest1_5                         | `SELECT `id`,`create_time`,`update_time`,`create_by`,`update_by`,`deleted`,`title`,`content…` |
| QueryTest18.java#rangeTest1_6                         | `SELECT `id`,`create_time`,`update_time`,`create_by`,`update_by`,`deleted`,`title`,`content…` |
| QueryTest18.java#rangeTest3                           | `SELECT `id`,`create_time`,`update_time`,`create_by`,`update_by`,`deleted`,`title`,`content…` |
| QueryTest18.java#test11                               |                                                                                               |
| QueryTest18.java#test13                               | `SELECT t.`id`,t.`create_time`,t.`username`,t.`phone`,t.`id_card`,t.`address`FROM`easy-qu…`   |
| QueryTest19.java#test1                                | `SELECT t.`id`,t.`company_id`,t.`name`,t.`age`,t.`create_time`FROM`t_user` t WHERE t.`nam…`   |
| QueryTest19.java#testMyFilter                         | `SELECT `id`,`stars`,`title`,`create_time`FROM`t_topic`WHERE`title` LIKE ?`                   |
| QueryTest2.java#dynamicSort                           | `SELECT t.`id`,t.`title`,t.`content`FROM`t_blog` t WHERE t.`deleted` = ? ORDER BY t.`titl…`   |
| QueryTest2.java#dynamicSort2                          | `SELECT t.`id`,t.`title`,t.`content`FROM`t_blog` t WHERE t.`deleted` = ? ORDER BY t.`titl…`   |
| QueryTest2.java#dynamicSort3                          | `SELECT t.`id`,t.`title`,t.`content`FROM`t_blog`t INNER JOIN`t_topic` t1 ON t.`id` = t1…`     |
| QueryTest2.java#dynamicSort4                          | `SELECT t.`id`,t.`title`,t.`content`FROM`t_blog`t INNER JOIN`t_topic` t1 ON t.`id` = t1…`     |
| QueryTest2.java#queryTest17                           | `SELECT `id`,`create_time`,`update_time`,`create_by`,`update_by`,`deleted`,`title`,`content…` |
| QueryTest2.java#queryTest18                           | `SELECT `id`,`create_time`,`update_time`,`create_by`,`update_by`,`deleted`,`title`,`content…` |
| QueryTest2.java#queryTest18_1                         | `SELECT `id`,`create_time`,`update_time`,`create_by`,`update_by`,`deleted`,`title`,`content…` |
| QueryTest2.java#queryTest18_2                         | `SELECT `id`,`create_time`,`update_time`,`create_by`,`update_by`,`deleted`,`title`,`content…` |
| QueryTest2.java#queryTest19                           | `SELECT `id`,`create_time`,`update_time`,`create_by`,`update_by`,`deleted`,`title`,`content…` |
| QueryTest2.java#queryTest20                           | `SELECT `id`,`create_time`,`update_time`,`create_by`,`update_by`,`deleted`,`title`,`content…` |
| QueryTest21.java#testOrderBy2                         | `SELECT t.`id`,t.`uid`,t.`code`,t.`type`,t.`bank_id`FROM`doc_bank_card`t LEFT JOIN`doc_…`     |
| QueryTest24.java#test14                               | `SELECT `id`,`create_time`,`update_time`,`create_by`,`update_by`,`deleted`,`title`,`content…` |
| QueryTest24.java#test15                               | `SELECT `id`,`create_time`,`update_time`,`create_by`,`update_by`,`deleted`,`title`,`content…` |
| QueryTest24.java#test16                               | `SELECT `id`,`create_time`,`update_time`,`create_by`,`update_by`,`deleted`,`title`,`content…` |
| QueryTest24.java#test17                               | `SELECT `id`,`create_time`,`update_time`,`create_by`,`update_by`,`deleted`,`title`,`content…` |
| QueryTest24.java#test18                               | `SELECT `id`,`create_time`,`update_time`,`create_by`,`update_by`,`deleted`,`title`,`content…` |
| QueryTest24.java#test19                               | `SELECT `id`,`create_time`,`update_time`,`create_by`,`update_by`,`deleted`,`title`,`content…` |
| QueryTest24.java#test20                               | `SELECT `id`,`create_time`,`update_time`,`create_by`,`update_by`,`deleted`,`title`,`content…` |
| QueryTest24.java#test21                               | `SELECT `id`,`create_time`,`update_time`,`create_by`,`update_by`,`deleted`,`title`,`content…` |
| QueryTest24.java#test22                               | `SELECT `id`,`create_time`,`update_time`,`create_by`,`update_by`,`deleted`,`title`,`content…` |
| QueryTest24.java#test23                               | `SELECT `id`,`create_time`,`update_time`,`create_by`,`update_by`,`deleted`,`title`,`content…` |
| QueryTest24.java#test24                               | `SELECT `id`,`create_time`,`update_time`,`create_by`,`update_by`,`deleted`,`title`,`content…` |
| QueryTest24.java#test25                               | `SELECT `id`,`create_time`,`update_time`,`create_by`,`update_by`,`deleted`,`title`,`content…` |
| QueryTest24.java#test26                               | `SELECT (t.`create_time` < ? AND t.`title`= ?) FROM`t_blog` t WHERE t.`deleted` = ? AND (…`   |
| QueryTest24.java#test27                               | `SELECT DATE_FORMAT(t.`create_time`,'%Y-%m') AS `value1`,(DATE_FORMAT(t.`create_time`,'%Y-%…` |
| QueryTest24.java#test28                               | `SELECT DATE_FORMAT(t.`create_time`,'%Y-%m') AS `value1`,((DATE_FORMAT(t.`create_time`,'%Y-…` |
| QueryTest24.java#test29                               | `SELECT (t.`create_time` < ? AND t.`title`= ?) FROM`t_blog` t WHERE t.`deleted` = ? AND d…`   |
| QueryTest24.java#testContains2                        | `SELECT `id`,`create_time`,`update_time`,`create_by`,`update_by`,`deleted`,`title`,`content…` |
| QueryTest24.java#testContains3                        | `SELECT `id`,`create_time`,`update_time`,`create_by`,`update_by`,`deleted`,`title`,`content…` |
| QueryTest3.java#dynamicWhere1                         | `SELECT `id`,`create_time`,`update_time`,`create_by`,`update_by`,`deleted`,`title`,`content…` |
| QueryTest3.java#orderTest1                            | `SELECT `id`,`create_time`,`update_time`,`create_by`,`update_by`,`deleted`,`title`,`content…` |
| QueryTest3.java#orderTest2                            |                                                                                               |
| QueryTest3.java#query124                              | `SELECT t.`id`,t.`stars`,t.`title`,t.`create_time`FROM`t_topic`t LEFT JOIN`t_blog` t1 O…`     |
| QueryTest3.java#query124_5                            | `SELECT t.`id`,t.`stars`,t.`title`,t.`create_time`FROM`t_topic`t LEFT JOIN`t_blog` t1 O…`     |
| QueryTest4.java#joinTest1                             | `SELECT t.`id`,COUNT(t.`id`) AS `stars`FROM`t_topic`t LEFT JOIN`t_topic` t1 ON t.`id` =…`     |
| QueryTest4.java#joinTest2                             | `SELECT t.`id`,COUNT(t.`id`) AS `stars`FROM`t_topic`t LEFT JOIN`t_topic` t1 ON t.`id` =…`     |
| QueryTest4.java#joinTest3                             | `SELECT t.`id`,COUNT(t.`id`) AS `stars`FROM`t_topic`t LEFT JOIN`t_topic` t1 ON t.`id` =…`     |
| QueryTest4.java#joinTest4                             | `SELECT t.`id`,COUNT(t.`id`) AS `stars`FROM`t_topic`t LEFT JOIN`t_topic` t1 ON t.`id` =…`     |
| QueryTest4.java#joinTest5                             | `SELECT t.`id`,COUNT(t.`id`) AS `stars`FROM`t_topic`t LEFT JOIN`t_topic` t1 ON t.`id` =…`     |
| QueryTest4.java#joinTest6                             | `SELECT t.`id`,COUNT(t.`id`) AS `stars`FROM`t_topic`t LEFT JOIN`t_topic` t1 ON t.`id` =…`     |
| QueryTest4.java#joinTest7                             | `SELECT t.`id`,COUNT(t.`id`) AS `stars`FROM`t_topic`t LEFT JOIN`t_topic` t1 ON t.`id` =…`     |
| QueryTestRelationTest.java#relationTest0              | `SELECT t.`id`,t.`com_id`,t.`user_id`,t.`gw`FROM`my_com_user` t WHERE EXISTS(SELECT 1 FRO…`   |
| QueryTestRelationTest.java#relationTest0_2            | `SELECT t.`id`,t.`com_id`,t.`user_id`,t.`time`,t.`content`FROM`my_sign_up` t WHERE t.`com…`   |
| QueryTestRelationTest.java#relationTest0_3            | `SELECT t.`id`,t.`com_id`,t.`user_id`,t.`time`,t.`content`FROM`my_sign_up`t LEFT JOIN`m…`     |
| QueryTestRelationTest.java#relationTest0_4            | `SELECT t.`id`,t.`com_id`,t.`user_id`,t.`time`,t.`content`FROM`my_sign_up`t LEFT JOIN`m…`     |
| QueryTestRelationTest.java#relationTest0_5            | `SELECT (SELECT COUNT(*) FROM `my_sign_up` t2 WHERE t2.`com_id` = t1.`com_id`) AS `id` FROM…` |
| QueryTestRelationTest.java#relationTest0_6            | `SELECT t.`id`,t.`com_id`,t.`user_id`,t.`time`,t.`content`FROM`my_sign_up`t LEFT JOIN`m…`     |
| QueryTestRelationTest.java#relationTest0_7            | `SELECT t.`id`,t.`com_id`,t.`user_id`,t.`time`,t.`content`FROM`my_sign_up`t LEFT JOIN`m…`     |
| QueryTestRelationTest.java#relationTest0_8            | `SELECT t1.`com_id`AS`value1`FROM`my_sign_up`t LEFT JOIN`my_com_user` t1 ON (t1.`com_…`       |
| QueryTestRelationTest.java#test1_1                    | `SELECT (CASE WHEN t1.`name`LIKE ? THEN ? ELSE ? END) AS`value1`FROM`my_com_user` t LEF…`     |
| QueryTestRelationTest.java#test2                      | `SELECT t.`id`,t.`com_id`,t.`user_id`,t.`gw`FROM`my_com_user` t`                              |
| QueryTestRelationTest.java#testDirectWhere            | `SELECT t.`id`,t.`com_id`,t.`user_id`,t.`time`,t.`content`FROM`my_sign_up` t`                 |

### CASE WHEN（`expr.case`，已对应）

| 用例                                        | 断言的 SQL（摘要）                                                                            |
| ------------------------------------------- | --------------------------------------------------------------------------------------------- |
| mysql8/MySQL8Test2.java#abc                 |                                                                                               |
| pgsql/MathQueryTest.java#testPropertyMath   | `SELECT t.\`                                                                                  |
| pgsql/QueryTest19.java#testItem             |                                                                                               |
| QueryTest12.java#testSelectPropTypeColumn10 | `SELECT SUM((CASE WHEN t.`id`= ? THEN ? ELSE ? END)) AS`star`,MIN(case t.`score` when ? t…`   |
| QueryTest12.java#testSelectPropTypeColumn11 | `SELECT SUM((CASE WHEN t.`id` = ? THEN t.`score`ELSE ? END)) AS`star`FROM`t_blog` t WHE…`     |
| QueryTest12.java#testSelectPropTypeColumn12 | `SELECT SUM((CASE WHEN t.`id` = ? THEN t.`score` ELSE (t.`status`* ?) END)) AS`star` FROM…`   |
| QueryTest12.java#testSelectPropTypeColumn3  | `SELECT (CASE WHEN t.`id`= ? THEN ? ELSE ? END) AS`score`FROM`t_blog` t WHERE t.`delete…`     |
| QueryTest12.java#testSelectPropTypeColumn4  | `SELECT (CASE WHEN t.`id`= ? THEN ? ELSE ? END) AS`score`FROM`t_blog` t WHERE t.`delete…`     |
| QueryTest12.java#testSelectPropTypeColumn5  | `SELECT (CASE WHEN t.`id`= ? THEN ? ELSE ? END) AS`score`FROM`t_blog` t WHERE t.`delete…`     |
| QueryTest12.java#testSelectPropTypeColumn6  | `SELECT (CASE WHEN t.`id`= ? THEN ? ELSE ? END) AS`score`FROM`t_blog` t WHERE t.`delete…`     |
| QueryTest12.java#testSelectPropTypeColumn7  | `SELECT (CASE WHEN t.`id`= ? THEN ? ELSE ? END) AS`score`FROM`t_blog` t WHERE t.`delete…`     |
| QueryTest12.java#testSelectPropTypeColumn8  | `SELECT (CASE WHEN t.`id`= ? THEN ? ELSE ? END) AS`score`FROM`t_blog` t WHERE t.`delete…`     |
| QueryTest12.java#testSelectPropTypeColumn9  | `SELECT (CASE WHEN t.`id`= ? THEN ? ELSE ? END) AS`score`FROM`t_blog` t WHERE t.`delete…`     |
| QueryTest15.java#testCaseWhenLazy           | `SELECT (CASE WHEN t.`title`= ? THEN ? ELSE ? END) AS`value1`FROM`t_topic` t`                 |
| QueryTest15.java#testCaseWhenLazy2          | `SELECT (CASE WHEN t.`title`= ? THEN ? ELSE ? END) AS`title`FROM`t_topic` t`                  |
| QueryTest15.java#testOrderCase              | `SELECT `id`,`stars`,`title`,`create_time`FROM`t_topic`WHERE`id` = ? ORDER BY (CASE WHE…`     |
| QueryTest18.java#testUpdate                 | `UPDATE `t_topic`SET`stars` = (CASE WHEN (`stars` - ?) < ? THEN ? ELSE (`stars` - ?) END)…`   |
| QueryTest21.java#caseWhenTest1              | `SELECT (CASE WHEN t.`title`= ? THEN ? ELSE ? END) AS`title`,t.`id`AS`id`FROM`t_topic…`       |
| QueryTest21.java#caseWhenTest2              | `SELECT (CASE WHEN t.`title`= ? THEN ? ELSE ? END) AS`title`,t.`id`AS`id`FROM`t_topic…`       |
| QueryTest22.java#testaa                     |                                                                                               |
| QueryTest23.java#fetcherOrder               |                                                                                               |
| QueryTest23.java#testOrderSQL1              | `SELECT `id`,`create_time`,`update_time`,`create_by`,`update_by`,`deleted`,`title`,`content…` |
| QueryTest25.java#testOrderCaseWhen          |                                                                                               |
| QueryTest3.java#propertyCaseWhen            | `SELECT (CASE WHEN t.`title` = ? THEN ? WHEN t.`title`= ? THEN ? ELSE ? END) AS`title`,t.…`   |
| QueryTest3.java#testCaseWhen                | `SELECT (CASE WHEN t.`title` = ? AND t.`stars` >= ? THEN ? WHEN t.`title` = ? THEN ? WHEN t…` |
| SubJoinTest.java#testSubJoinCaseWhen1_1     | `SELECT IFNULL((SELECT SUM(t3.`age`) FROM `sub_join_book`t2 LEFT JOIN`sub_join_author` t3…`   |
| SubJoinTest.java#testSubJoinCaseWhen2       | `SELECT IFNULL((SELECT SUM(t3.`age`) FROM `sub_join_book`t2 LEFT JOIN`sub_join_author` t3…`   |

### 按键填充（fillMany / fillOne）（`fill`，已对应）

| 用例                             | 断言的 SQL（摘要）                     |
| -------------------------------- | -------------------------------------- |
| RelationTest.java#provinceTest2  |                                        |
| RelationTest.java#provinceTest3  |                                        |
| RelationTest.java#provinceTest4  | `SELECT `code`,`name`FROM`t_province`` |
| RelationTest.java#provinceVoTest |                                        |

### 日期函数（`func.date`，已对应）

| 用例                                                    | 断言的 SQL（摘要）                                                                             |
| ------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| DateTimeFunctionsTest.java#dayOfWeekSunDayIsEndDayMySQL | `SELECT t.`create_time`AS`value1`,(WEEKDAY(t.`create_time`)+1) AS `value2`FROM`t_blog` …`      |
| DateTimeFunctionsTest.java#dayOfYearMySQL               | `SELECT t.`create_time`AS`value1`,DAYOFYEAR(t.`create_time`) AS `value2`FROM`t_blog` t …`      |
| DateTimeFunctionsTest.java#durationMySQL                | `SELECT t.`create_time`AS`value1`,timestampdiff(DAY, t.`create_time`, ?) AS `value2`,time…`    |
| DateTimeFunctionsTest.java#formatMySQL                  | `SELECT t.`create_time`AS`value1`,DATE_FORMAT(t.`create_time`,'%Y年%m-01 %H:%i分%s秒') AS `v…` |
| DateTimeFunctionsTest.java#testConstant                 | `SELECT NOW() AS `value1`,UTC_TIMESTAMP() AS `value2`FROM`t_blog` t WHERE t.`deleted` = ?`     |
| doc/DocTest.java#test2                                  | `SELECT t.`id`,t.`name`,t.`phone`,t.`depart_name`FROM`a222` t WHERE t.`id` = ? AND t.`id`…`    |
| doc/DocTest.java#testLikeOr                             | `SELECT t.`id`,t.`create_time`,t.`update_time`,t.`create_by`,t.`update_by`,t.`deleted`,t.`c…`  |
| doc/DocTest.java#testSubQuerySelect                     | `SELECT t.`id`,t.`create_time`,t.`update_time`,t.`create_by`,t.`update_by`,t.`deleted`,t.`c…`  |
| doc/DocTest.java#testSubQuerySelect2                    | `SELECT t.`id`,t.`create_time`,t.`update_time`,t.`create_by`,t.`update_by`,t.`deleted`,t.`c…`  |
| mysql8/M8BankTest.java#includeSubQuery4                 | `SELECT t.`name`AS`vo1`,t.`id`AS`vo2`,t.`phone`AS`vo3`,t.`id`AS`__relation__id` FRO…`          |
| MyTest1.java#testDraft4                                 | `SELECT date_add(t.`create_time`, interval (?) month) AS `value1`FROM`t_blog` t WHERE t.`…`    |
| MyTest1.java#testDraft5                                 | `SELECT date_add(date_add(t.`create_time`, interval (?) month), interval (?) day) AS `value…`  |
| MyTest1.java#testExists                                 | `SELECT t.`id`AS`value1`,t.`title`AS`value2`,t.`create_time`AS`value3`,(SELECT t2.`ti…`        |
| MyTest1.java#testSelect3                                | `SELECT t.`title`AS`id`,DATE_FORMAT(t.`create_time`,'%Y-%m-%d') AS `id`,SUBSTR(t.`title`,…`    |
| MyTest1.java#testSelect4                                | `SELECT t.`id`,t.`title`,DATE_FORMAT(t.`create_time`,'%Y-%m-%d') AS `title`FROM`t_topic` …`    |
| MyTest2.java#testExists                                 | `SELECT t.`id`AS`value1`,t.`title`AS`value2`,t.`create_time`AS`value3`,(SELECT t2.`ti…`        |
| MyTest2.java#testSelect3                                | `SELECT t.`title`AS`id`,DATE_FORMAT(t.`create_time`,'%Y-%m-%d') AS `id`,SUBSTR(t.`title`,…`    |
| MyTest2.java#testSelect4                                | `SELECT t.`id`,t.`title`,DATE_FORMAT(t.`create_time`,'%Y-%m-%d') AS `title`FROM`t_topic` …`    |
| MyTest2.java#testTuple4                                 | `SELECT date_add(t.`create_time`, interval (?) month) AS `value1`FROM`t_blog` t WHERE t.`…`    |
| MyTest2.java#testTuple5                                 | `SELECT date_add(date_add(t.`create_time`, interval (?) month), interval (?) day) AS `value…`  |
| pgsql/QueryTest.java#query7                             |                                                                                                |
| pgsql/QueryTest.java#test123                            | `SELECT \`                                                                                     |
| pgsql/QueryTest.java#testDuration                       |                                                                                                |
| pgsql/QueryTest19.java#datetimeformat                   | `SELECT t.\`                                                                                   |
| QueryTest.java#query68                                  | `SELECT t.`id`,t.`username`,t.`phone`,t.`id_card`,t.`address`,IFNULL(t.`create_time`,?) AS …`  |
| QueryTest.java#query7                                   |                                                                                                |
| QueryTest10.java#test222                                |                                                                                                |
| QueryTest10.java#testDraft12                            | `SELECT t.`id`AS`value1`,REPLACE(LOWER(t.`title`),?,?) AS `value2`,UPPER(t.`title`) AS `v…`    |
| QueryTest10.java#testDraft13                            | `SELECT t.`id`AS`value1`,TRIM(LOWER(t.`title`)) AS `value2`,UPPER(TRIM(t.`title`)) AS `va…`    |
| QueryTest10.java#testDraft14                            | `SELECT t.`id`AS`value1`,LTRIM(LOWER(t.`title`)) AS `value2`,UPPER(LTRIM(t.`title`)) AS `…`    |
| QueryTest10.java#testDraft15                            | `SELECT t.`id`AS`value1`,RTRIM(LOWER(t.`title`)) AS `value2`,UPPER(RTRIM(t.`title`)) AS `…`    |
| QueryTest10.java#testDraft16                            | `SELECT t.`id`AS`value1`,LOWER(t.`title`) AS `value2`FROM`t_topic` t WHERE LTRIM(RTRIM(…`      |
| QueryTest10.java#testLike1                              | `SELECT t2.`id`,t2.`content`,t2.`create_time`,t3.`stars` FROM (SELECT t.`id`,t.`create_time…`  |
| QueryTest10.java#testQuery8                             | `SELECT t.`id`,t.`create_time`,t.`update_time`,t.`create_by`,t.`update_by`,t.`deleted`,t.`c…`  |
| QueryTest10.java#testVO1                                | `SELECT t.`id`,t1.`title`AS`field1`,t2.`id`AS`field2`FROM`t_topic`t LEFT JOIN`t_blo…`          |
| QueryTest11.java#testOrder                              | `SELECT t.`title`,t.`id`,DATE_FORMAT(t.`create_time`,'%Y-%m-%d %H:%i:%s') FROM `t_topic` t …`  |
| QueryTest11.java#testOrder1                             | `SELECT t.`title`,t.`id`,DATE_FORMAT(t.`create_time`,'%Y-%m-%d %H:%i:%s') FROM `t_topic_typ…`  |
| QueryTest11.java#testx15                                | `SELECT `id`,`stars`,`title`,`topic_type`,`create_time`FROM`t_topic_type`WHERE`create_t…`      |
| QueryTest11.java#testx16                                | `SELECT `id`,`stars`,`title`,`topic_type`,`create_time`FROM`t_topic_type`WHERE ? <=`cre…`      |
| QueryTest11.java#testx17                                |                                                                                                |
| QueryTest11.java#testx18                                | `SELECT `id`,`stars`,`title`,`topic_type`,`create_time`FROM`t_topic_type` WHERE CONCAT(`i…`    |
| QueryTest11.java#testx21                                | `SELECT YEAR(t.`create_time`) AS `value1`,MONTH(t.`create_time`) AS `value2`,SUM(t.`star`) …`  |
| QueryTest12.java#orderTest1                             | `SELECT `id`,`stars`,`title`,`create_time`FROM`t_topic`ORDER BY`id` ASC`                       |
| QueryTest13.java#testMultiSelect                        | `SELECT t.`id`,t.`content`,t.`create_time`AS`create_time`,t1.`address`,t1.`id_card` FROM …`    |
| QueryTest14.java#testOracle                             | `SELECT \`                                                                                     |
| QueryTest14.java#testPlus                               | `SELECT `id`,`stars`,`title`,`create_time`FROM`t_topic`WHERE`create_time` < date_add(CA…`      |
| QueryTest14.java#testPlus_1                             | `SELECT `id`,`stars`,`title`,`create_time`FROM`t_topic`WHERE`create_time` < date_add(CA…`      |
| QueryTest14.java#testPropertyFunc                       | `SELECT `id`,`stars`,`title`,`create_time`FROM`t_topic`WHERE`create_time` < CAST(? AS D…`      |
| QueryTest15.java#tes123txxx                             |                                                                                                |
| QueryTest15.java#test122345                             | `SELECT \`                                                                                     |
| QueryTest15.java#test1223456                            | `SELECT \`                                                                                     |
| QueryTest15.java#test123                                | `SELECT `id`,`stars`,`title`,`create_time`FROM`t_topic` WHERE DATE_FORMAT(`create_time`,'…`    |
| QueryTest15.java#testa                                  | `SELECT DATE_FORMAT(t.`create_time`,'%Y-%m') AS `value1`,COUNT(*) AS `value2`FROM`t_topic…`    |
| QueryTest15.java#testColumn                             | `SELECT t.`create_time`FROM`t_topic` t WHERE t.`id` = ? AND DATE_FORMAT(t.`create_time`,'…`    |
| QueryTest15.java#testFETCHER                            | `SELECT t.`id`,t.`create_time`,t.`title`FROM`t_topic` t WHERE t.`id` = ? AND DATE_FORMAT(…`    |
| QueryTest17.java#test12234567                           | `SELECT \`                                                                                     |
| QueryTest18.java#easyQuery                              |                                                                                                |
| QueryTest18.java#easyQueryPrint1                        |                                                                                                |
| QueryTest18.java#Sum                                    |                                                                                                |
| QueryTest18.java#Sum1                                   |                                                                                                |
| QueryTest18.java#test10                                 |                                                                                                |
| QueryTest18.java#testxx                                 |                                                                                                |
| QueryTest19.java#test2                                  | `SELECT t.`id`,t.`company_id`,t.`name`,t.`age`,t.`create_time`FROM`t_user`t LEFT JOIN`t…`      |
| QueryTest19.java#testNow                                |                                                                                                |
| QueryTest2.java#queryTest16                             | `SELECT `id`,`create_time`,`update_time`,`create_by`,`update_by`,`deleted`,`title`,`content…`  |
| QueryTest20.java#test1                                  |                                                                                                |
| QueryTest23.java#datetimeformat                         | `SELECT t.`create_time`AS`value1`,DATE_FORMAT(t.`create_time`,'%Y年%m-01 %H:%i分%s秒') AS `v…` |
| QueryTest23.java#formatMySQL                            | `SELECT t.`create_time`AS`value1`,DATE_FORMAT(t.`create_time`,'%Y年%m-01 %H:%i分%s秒') AS `v…` |
| QueryTest26.java#test1                                  |                                                                                                |
| QueryTest26.java#test2                                  |                                                                                                |
| QueryTest26.java#test3                                  |                                                                                                |
| QueryTest26.java#test4                                  |                                                                                                |
| QueryTest26.java#test5                                  |                                                                                                |
| QueryTest26.java#test6                                  |                                                                                                |
| QueryTest26.java#test7                                  |                                                                                                |
| QueryTest3.java#dynamicWhere                            | `SELECT `id`,`create_time`,`update_time`,`create_by`,`update_by`,`deleted`,`title`,`content…`  |
| QueryTest3.java#orTest1                                 | `SELECT `id`,`stars`,`title`,`create_time`FROM`t_topic`WHERE`create_time` = ?`                 |
| QueryTest3.java#orTest2                                 | `SELECT `id`,`stars`,`title`,`create_time`FROM`t_topic`WHERE`create_time` = ?`                 |
| QueryTest3.java#orTest3                                 | `SELECT `id`,`stars`,`title`,`create_time`FROM`t_topic``                                       |
| QueryTest3.java#orTest4                                 | `SELECT `id`,`create_time`,`update_time`,`create_by`,`update_by`,`deleted`,`title`,`content…`  |
| QueryTest3.java#orTest5                                 |                                                                                                |
| QueryTest3.java#query9                                  |                                                                                                |
| QueryTest3.java#query9_1                                |                                                                                                |
| QueryTest3.java#query9_x                                |                                                                                                |
| QueryTest3.java#testAndOr1                              | `SELECT `id`,`stars`,`title`,`create_time`FROM`t_topic`WHERE`id` = ? AND (`title` LIKE …`      |
| QueryTest3.java#testOrder1                              | `SELECT `id`,`create_time`,`update_time`,`create_by`,`update_by`,`deleted`,`title`,`content…`  |
| QueryTest4.java#testSQLFunc12_1                         | `SELECT `id`,`stars`,`title`,`create_time`FROM`t_topic` WHERE IFNULL(`id`,?) = DATE_FORMA…`    |
| QueryTest4.java#testSQLFunc7                            | `SELECT DATE_FORMAT(t.`create_time`,'%Y-%m-%d') AS `title`FROM`t_topic` t WHERE t.`id` = …`    |
| QueryTest9.java#dslTest6                                | `SELECT t.`title`FROM`t_topic` t WHERE t.`create_time` <= IFNULL(t.`create_time`,?) AND I…`    |
| QueryTest9.java#dslTest7                                | `SELECT t.`stars`,t.`create_time`,t.`id`AS`abc`,t.`id`FROM`t_topic` t WHERE DATE_FORMAT…`      |
| QueryTest9.java#entityQuery1                            |                                                                                                |
| QueryTest9.java#testDsl1                                | `SELECT `id`,`stars`,`title`,`create_time`FROM`t_topic`WHERE`stars` = ?`                       |
| QueryTest9.java#testDsl2                                | `SELECT COUNT(t.`id`) AS `stars`,DATE_FORMAT(t.`create_time`,'%Y/%m/%d') AS `title`FROM`t…`    |
| QueryTest9.java#testDsl3                                | `SELECT CAST(IFNULL(t.`stars`,?) AS CHAR) AS `title`,IFNULL(t.`id`,'') AS `alias`FROM`t_t…`    |
| QueryTest9.java#testDsl5                                | `SELECT `id`,`stars`,`title`,`create_time`FROM`t_topic`WHERE`create_time`<=`create_ti…`        |
| QueryTest9.java#testQuery5                              | `SELECT t.`id`AS`id`,COUNT(*) AS `star`,MAX(t.`id`) AS `title`FROM`t_blog` t WHERE t.`d…`      |

### 通用函数（nullOrDefault、maxColumns …）（`func.general`，已对应）

| 用例                                          | 断言的 SQL（摘要）                                                                            |
| --------------------------------------------- | --------------------------------------------------------------------------------------------- |
| GeneralFunctionsTest.java#equalsWithMSSQL     | `SELECT (CASE t.[id] WHEN ? THEN 1 ELSE 0 END) AS [value1] FROM [doc_bank_card] t WHERE (CA…` |
| GeneralFunctionsTest.java#equalsWithMySQL     | `SELECT (CASE t.`id`WHEN ? THEN 1 ELSE 0 END) AS`value1`FROM`doc_bank_card` t WHERE (CA…`     |
| GeneralFunctionsTest.java#equalsWithORACLE    | `SELECT (CASE t.\`                                                                            |
| GeneralFunctionsTest.java#equalsWithPGSQL     | `SELECT (CASE t.\`                                                                            |
| GeneralFunctionsTest.java#nullOrDefaultMSSQL  | `SELECT [id],[uid],[code],[type],[bank_id] FROM [doc_bank_card] WHERE ISNULL([code],?) = ?`   |
| GeneralFunctionsTest.java#nullOrDefaultMySQL  | `SELECT `id`,`uid`,`code`,`type`,`bank_id`FROM`doc_bank_card` WHERE IFNULL(`code`,?) = ?`     |
| GeneralFunctionsTest.java#nullOrDefaultORACLE | `SELECT \`                                                                                    |
| GeneralFunctionsTest.java#nullOrDefaultPGSQL  | `SELECT \`                                                                                    |
| mysql8/ManyJoinTest.java#testElement5         | `SELECT t.`id`,t.`name`,t.`phone`,t.`age`FROM`doc_user` t LEFT JOIN (SELECT t1.`id`,t1.`u…`   |
| mysql8/ManyJoinTest.java#testElement6         | `SELECT t.`id`,t.`name`,t.`phone`,t.`age`FROM`doc_user` t LEFT JOIN (SELECT t1.`id`,t1.`u…`   |
| mysql8/ManyJoinTest.java#testElement7         | `SELECT t3.`type`AS`value1`,t3.`code`AS`value2`FROM`doc_user` t LEFT JOIN (SELECT t1.…`       |
| pgsql/QueryTest.java#query10                  | `SELECT COALESCE(t.\`                                                                         |
| pgsql/QueryTest.java#testNullDefault          | `SELECT \`                                                                                    |
| QueryTest.java#query16_1_1                    | `SELECT COUNT(1) FROM (SELECT IFNULL(t1.`id`,?) AS `id`,SUM(t1.`score`) AS `score`FROM`t_…`   |
| QueryTest.java#query16_1_3                    | `SELECT COUNT(1) FROM (SELECT IFNULL(t1.`id`,?) AS `id`,SUM(t1.`score`) AS `score`FROM`t_…`   |
| QueryTest10.java#testDraft9                   | `SELECT IFNULL(t.`title`,?) AS `title`,t.`id`AS`id`,t.`stars`AS`stars`FROM`t_topic` t…`       |
| QueryTest11.java#testx27                      | `SELECT `id`,`stars`,`title`,`topic_type`,`create_time`FROM`t_topic_type` WHERE IFNULL(`t…`   |
| QueryTest11.java#testx28                      | `SELECT `id`,`stars`,`title`,`topic_type`,`create_time`FROM`t_topic_type` WHERE IFNULL(`t…`   |
| QueryTest17.java#testOptional1                |                                                                                               |
| QueryTest18.java#rangeTest1                   | `SELECT `id`,`create_time`,`update_time`,`create_by`,`update_by`,`deleted`,`title`,`content…` |
| QueryTest18.java#rangeTest2                   | `SELECT `id`,`create_time`,`update_time`,`create_by`,`update_by`,`deleted`,`title`,`content…` |
| QueryTest18.java#test1_0                      | `SELECT IFNULL(t.`id`,?) AS `id`FROM`t_topic` t WHERE t.`id` IS NULL`                         |
| QueryTest18.java#test15                       |                                                                                               |
| QueryTest18.java#test1xa                      |                                                                                               |
| QueryTest2.java#groupTest5                    | `SELECT t.`id`AS`id`,IFNULL(SUM(DISTINCT t.`score`),?) AS `score`,IFNULL(COUNT(DISTINCT t…`   |
| QueryTest2.java#groupTest5_1                  |                                                                                               |
| QueryTest20.java#testFullSingleColumns3       | `SELECT IFNULL(t.`id`,?) FROM `t_blog` t WHERE t.`deleted` = ? AND t.`content` LIKE ? AND t…` |
| QueryTest20.java#testFullSingleColumns4       | `SELECT IFNULL(t.`id`,?) FROM `t_blog` t WHERE t.`deleted` = ? AND t.`content` LIKE ? AND t…` |
| QueryTest20.java#testMap1                     | `SELECT t.`id`AS`v1`,(t1.`star`+ ?) AS`v2`,IFNULL(t.`create_time`,?) AS `v3`FROM`t_to…`       |
| QueryTest20.java#testMap2                     | `SELECT t.`id`AS`str`,(t1.`star`+ ?) AS`integer`,IFNULL(t.`create_time`,?) AS `time` FR…`     |
| QueryTest21.java#anyColumnOrderByTest1        | `SELECT t.`id`,t.`uid`,t.`code`,t.`type`,t.`bank_id`FROM`doc_bank_card`t LEFT JOIN`doc_…`     |
| QueryTest21.java#anyColumnTest1               | `SELECT t.`id`,t.`uid`,t.`code`,t.`type`,t.`bank_id`FROM`doc_bank_card`t LEFT JOIN`doc_…`     |
| QueryTest21.java#anyColumnTest2               | `SELECT t.`id`,t.`uid`,t.`code`,t.`type`,t.`bank_id`FROM`doc_bank_card`t LEFT JOIN`doc_…`     |
| QueryTest21.java#joinOrderTest2               | `SELECT t.`id`,t.`uid`,t.`code`,t.`type`,t.`bank_id`FROM`doc_bank_card`t LEFT JOIN`doc_…`     |
| QueryTest21.java#joinOrderTest3               | `SELECT t.`id`,t.`uid`,t.`code`,t.`type`,t.`bank_id`FROM`doc_bank_card`t LEFT JOIN`doc_…`     |
| QueryTest21.java#typeTest                     | `SELECT `id`,`create_time`,`update_time`,`create_by`,`update_by`,`deleted`,`title`,`content…` |
| QueryTest23.java#testAdd                      | `SELECT t.`id`,t.`create_time`,t.`update_time`,t.`create_by`,t.`update_by`,t.`deleted`,t.`t…` |
| QueryTest24.java#test13                       | `SELECT `id`,`create_time`,`update_time`,`create_by`,`update_by`,`deleted`,`title`,`content…` |
| QueryTest24.java#testContains4                | `SELECT t.`title`AS`title`,IFNULL(t.`content`,?) AS `content`FROM`t_blog` t WHERE t.`de…`     |
| QueryTest27.java#staticTestCustomFunction3    | `SELECT `id`,`create_time`,`update_time`,`create_by`,`update_by`,`deleted`,`title`,`content…` |
| QueryTest27.java#testMap                      | `SELECT t.`create_time`AS`a1`,IFNULL(t.`create_time`,?) AS `a2`FROM`t_topic` t`               |
| QueryTest28.java#testQueryNullOrDefault       | `SELECT `id`,`stars`,`title`,`create_time`FROM`t_topic` WHERE IFNULL(`stars`,0) = ?`          |
| QueryTest28.java#testQueryNullOrDefault2      | `SELECT `id`,`stars`,`title`,`create_time`FROM`t_topic` WHERE IFNULL(`stars`,1) = ?`          |
| QueryTest3.java#testProperty3_1               | `SELECT `id`,`stars`,`title`,`create_time`FROM`t_topic` WHERE (IFNULL(`id`,?) = IFNULL(`s…`   |
| QueryTest4.java#testSQLFunc1                  | `SELECT IFNULL(t.`id`,?) FROM `t_topic` t WHERE t.`id` = ?`                                   |
| QueryTest4.java#testSQLFunc12                 | `SELECT `id`,`stars`,`title`,`create_time`FROM`t_topic` WHERE IFNULL(`id`,?) = IFNULL(`cr…`   |
| QueryTest4.java#testSQLFunc2                  | `SELECT IFNULL(t.`id`,?) FROM `t_topic` t WHERE t.`id` = ?`                                   |
| QueryTest4.java#testSQLFunc2_1                | `SELECT IFNULL(t.`id`,t.`title`,?) FROM `t_topic` t WHERE t.`id` = ?`                         |
| QueryTest4.java#testSQLFunc2_2                | `SELECT IFNULL(t.`id`,?) FROM `t_topic` t WHERE t.`id` = ?`                                   |
| QueryTest4.java#testSQLFuncExtension1         | `SELECT IFNULL(t.`id`,?) FROM `t_topic` t WHERE t.`id` = ? AND FIND_IN_SET(?,t.`id`)`         |
| QueryTest5.java#groupTest5_2                  |                                                                                               |
| QueryTest5.java#joinTestx                     | `SELECT COUNT(t2.`id`) FROM (SELECT DISTINCT IFNULL(t1.`id`,?) AS `id`,SUM(t1.`score`) AS `…` |
| QueryTest9.java#testQuery6                    | `SELECT t.`id`,COUNT(t.`id`) AS `star`,MAX(t.`id`) AS `title`FROM`t_blog` t WHERE t.`dele…`   |

### 字符串聚合（joining）（`func.joining`，已对应）

| 用例                                            | 断言的 SQL（摘要）                                                                            |
| ----------------------------------------------- | --------------------------------------------------------------------------------------------- |
| mysql8/MySQL8Test2.java#testGroupConcat1        | `SELECT t.`id`AS`value1`,GROUP_CONCAT(DISTINCT t.`title`SEPARATOR ?) AS`value2`,GROUP_C…`     |
| mysql8/MySQL8Test5.java#testJoining1            | `SELECT t.`id`,t.`name`,t.`create_time`,t2.`**joining2**`AS`__part__column1`FROM`t_bank…`     |
| mysql8/MySQL8Test5.java#testJoining2            | `SELECT t.`id`,t.`name`,t.`create_time`,t2.`**joining2**`AS`__part__column1`FROM`t_bank…`     |
| mysql8/MySQL8Test5.java#testManyLimit1_1        | `SELECT t.`id`AS`value1`,t4.`**joining2**`AS`value2`FROM`m8_user` t LEFT JOIN (SELECT…`       |
| mysql8/MySQL8Test5.java#testManyLimit2          | `SELECT t.`id`AS`value1`,t4.`**joining2**`AS`value2`FROM`m8_user` t LEFT JOIN (SELECT…`       |
| mysql8/MySQL8Test5.java#testManyLimit4          | `SELECT t.`id`AS`value1`,t2.`**joining2**`AS`value2`FROM`t_sys_user` t LEFT JOIN (SEL…`       |
| mysql8/MySQL8Test5.java#testManyLimit7          | `SELECT t.`id`AS`value1`,t2.`**joining2**`AS`value2`FROM`t_sys_user` t LEFT JOIN (SEL…`       |
| mysql8/MySQL8Test5.java#testToSelectPageResult2 | `SELECT t1.`id`,t1.`name`,t1.`create_time`,t3.`**joining2**`AS`__part__column1` FROM (SEL…`   |
| mysql8/MySQL8Test5.java#testToSelectPageResult3 | `SELECT t1.`id`,t1.`name`,t1.`create_time`,t3.`**joining2**`AS`__part__column1` FROM (SEL…`   |
| MyTest1.java#testGroup15                        | `SELECT SUBSTR(t.`title`,2,2) AS `id`,MAX(t.`title`) AS `title`,MIN(CAST(t.`stars` AS DECIM…` |
| MyTest2.java#testGroup15                        | `SELECT SUBSTR(t.`title`,2,2) AS `id`,MAX(t.`title`) AS `title`,MIN(CAST(t.`stars` AS DECIM…` |
| pgsql/QueryTest19.java#testJoining              | `SELECT t.\`                                                                                  |
| pgsql/QueryTest19.java#testJoining2             | `SELECT t.\`                                                                                  |
| pgsql/QueryTest19.java#testJoining3             | `SELECT t.\`                                                                                  |
| pgsql/QueryTest19.java#testJoining4             | `SELECT t.\`                                                                                  |
| QueryTest10.java#testDraft20                    | `SELECT SUBSTR(t.`content`,1,8) AS `value1`,GROUP_CONCAT(t.`id`SEPARATOR ?) AS`value2` FR…`   |
| QueryTest12.java#testDraft21                    | `SELECT t.`id`,t.`create_time`,t.`update_time`,t.`create_by`,t.`update_by`,t.`deleted`,t.`t…` |
| QueryTest12.java#testNum8                       | `SELECT t.`id`,t.`create_time`,t.`update_time`,t.`create_by`,t.`update_by`,t.`deleted`,t.`t…` |
| QueryTest12.java#testOrSub1                     | `SELECT t.`id`,t.`create_time`,t.`update_time`,t.`create_by`,t.`update_by`,t.`deleted`,t.`t…` |
| QueryTest14.java#testMapQuery                   | `SELECT * FROM `t_topic`WHERE`id` = ?`                                                        |
| QueryTest17.java#xxx123                         | `SELECT t.`id`AS`my_code`,GROUP_CONCAT(t1.`title`SEPARATOR ?) AS`my_name`FROM`t_topic…`       |
| QueryTest19.java#testaaa                        |                                                                                               |
| QueryTest22.java#testSelectAnyElement2          | `SELECT (SELECT GROUP_CONCAT(t1.`code`SEPARATOR ?) FROM`doc_bank_card` t1 WHERE t1.`uid` …`   |
| QueryTest26.java#joiningTest                    |                                                                                               |
| StringFunctionsTest.java#joining2MySQL          | `SELECT t.`code`AS`value1`,GROUP_CONCAT(DISTINCT (CASE WHEN t.`type` = ? THEN t1.`name` E…`   |
| StringFunctionsTest.java#joiningMSSQL           | `SELECT t.[code] AS [value1],STRING_AGG(DISTINCT (CASE WHEN t.[type] = ? THEN t1.[name] ELS…` |
| StringFunctionsTest.java#joiningMySQL           | `SELECT t.`code`AS`value1`,GROUP_CONCAT(DISTINCT (CASE WHEN t.`type` = ? THEN t1.`name` E…`   |
| StringFunctionsTest.java#joiningORACLE          | `SELECT t.\`                                                                                  |
| StringFunctionsTest.java#joiningPGSQL           | `SELECT t.\`                                                                                  |

### JSON 函数（`func.json`，已对应）

| 用例                                | 断言的 SQL（摘要）                                                                          |
| ----------------------------------- | ------------------------------------------------------------------------------------------- |
| mysql8/JsonTest.java#testJsonField  |                                                                                             |
| mysql8/JsonTest.java#testJsonField2 | `SELECT `id`,`name`,`extra_json`,`extra_json_array`FROM`t_test_json` WHERE JSON_UNQUOTE(J…` |
| mysql8/JsonTest.java#testJsonField4 |                                                                                             |
| mysql8/JsonTest.java#testJsonField5 |                                                                                             |
| mysql8/JsonTest.java#testJsonField6 |                                                                                             |
| pgsql/Json2Test.java#testJsonField4 |                                                                                             |
| pgsql/Json2Test.java#testJsonField5 |                                                                                             |
| pgsql/Json2Test.java#testJsonField6 |                                                                                             |
| pgsql/Json2Test.java#testJsonField7 |                                                                                             |
| pgsql/JsonTest.java#testJsonField4  |                                                                                             |
| pgsql/JsonTest.java#testJsonField5  |                                                                                             |
| pgsql/JsonTest.java#testJsonField6  |                                                                                             |

### 数学函数（`func.math`，已对应）

| 用例                         | 断言的 SQL（摘要）                                                                            |
| ---------------------------- | --------------------------------------------------------------------------------------------- |
| QueryTest12.java#testNum6    | `SELECT ((t.`star` * t.`score`) + ?) FROM `t_blog` t WHERE t.`deleted` = ? AND FLOOR(t.`sco…` |
| QueryTest23.java#testMath    | `SELECT t.`score`AS`value1`,ABS(t.`score`) AS `value2`,SIGN(t.`score`) AS `value3`,FLOOR(…`   |
| QueryTest4.java#testSQLFunc8 | `SELECT ABS(t.`create_time`) AS `title`FROM`t_topic` t WHERE t.`id` = ? ORDER BY t.`creat…`   |
| QueryTest4.java#testSQLFunc9 | `SELECT ROUND(t.`stars`,1) AS `title`FROM`t_topic` t WHERE t.`id` = ? ORDER BY t.`create_…`   |

### 字符串函数（`func.string`，已对应）

| 用例                                        | 断言的 SQL（摘要）                                                                            |
| ------------------------------------------- | --------------------------------------------------------------------------------------------- |
| GeneralFunctionsTest.java#testDoubleConcat  | `SELECT \`                                                                                    |
| InsertTest.java#insertTest                  |                                                                                               |
| MathQueryTest.java#testPropertyMath         | `SELECT t.`test_value`AS`test_value`,ABS(t.`test_value`) AS `test_abs`,SIGN(t.`test_value…`   |
| MathQueryTest.java#testPropertyMath2        | `SELECT t.`test_value`AS`test_value`,ABS(t.`test_value`) AS `test_abs`,SIGN(t.`test_value…`   |
| mysql8/ExampleTest.java#test2               |                                                                                               |
| MyTest1.java#testDraft1                     | `SELECT t.`content`AS`value1`,CHAR_LENGTH(t.`content`) AS `value2`FROM`t_blog` t WHERE …`     |
| MyTest1.java#testDraft1_1                   | `SELECT t.`content`AS`value1`,CHAR_LENGTH(t.`content`) AS `value2`FROM`t_blog` t WHERE …`     |
| MyTest1.java#testDraft2                     | `SELECT t.`content`AS`value1`,CHAR_LENGTH(t.`content`) AS `value2`FROM`t_blog` t WHERE …`     |
| MyTest1.java#testGroup11                    | `SELECT SUBSTR(t.`title`,2,2) AS `id`,COUNT(SUBSTR(t.`title`,2,2)) AS `star`FROM`t_topic`…`   |
| MyTest1.java#testGroup12                    | `SELECT t1.`value1`AS`id`,COUNT(t1.`value2`) AS `star` FROM (SELECT t.`title`AS`value1`…`     |
| MyTest1.java#testGroup13                    | `SELECT t1.`value1`AS`id`,COUNT(t1.`value2`) AS `star` FROM (SELECT t.`title`AS`value1`…`     |
| MyTest1.java#testGroup14                    | `SELECT t2.`id`AS`id`,t2.`star`AS`star` FROM (SELECT t1.`value1`AS`id`,COUNT(t1.`valu…`       |
| MyTest1.java#testGroup16                    | `SELECT SUBSTR(`title`,2,2) FROM `t_topic`WHERE`title` IS NOT NULL GROUP BY SUBSTR(`title…`   |
| MyTest1.java#testGroup17                    | `SELECT SUBSTR(`title`,2,2) FROM `t_topic`WHERE`title` IS NOT NULL GROUP BY SUBSTR(`title…`   |
| MyTest1.java#testGroup18                    | `SELECT SUBSTR(t.`title`,2,2) AS `value1`,COUNT(*) AS `value2`FROM`t_topic` t WHERE t.`ti…`   |
| MyTest1.java#testGroup19                    | `SELECT SUBSTR(t.`title`,2,2) AS `value1`,IFNULL(t1.`score`,?) AS `value2`,COUNT(*) AS `val…` |
| MyTest1.java#testSelect5                    | `SELECT t.`title`AS`id`,SUBSTR(t.`title`,2,2) AS `title`FROM`t_topic` t WHERE t.`title`…`     |
| MyTest1.java#testSelect6                    | `SELECT t2.`id`AS`id`,t2.`id_count`AS`id_count` FROM (SELECT t1.`id`AS`id`,COUNT(*) A…`       |
| MyTest1.java#testSelect6_1                  | `SELECT t1.`id`AS`id`,COUNT(*) AS `id_count` FROM (SELECT t.`title`AS`id`,SUBSTR(t.`tit…`     |
| MyTest1.java#testSelect6_2                  | `SELECT t1.`id`AS`id`,MIN(t1.`id`) AS `id_count` FROM (SELECT t.`title`AS`id`,SUBSTR(t.…`     |
| MyTest1.java#testSelect7                    | `SELECT t2.`value1`AS`value1`,t2.`value2`AS`value2` FROM (SELECT t1.`value1`AS`value1…`       |
| MyTest1.java#testSelect9                    | `SELECT t1.`value1`AS`value1`,COUNT(*) AS `value2` FROM (SELECT t.`title`AS`value1`,SUB…`     |
| MyTest2.java#testGroup11                    | `SELECT SUBSTR(t.`title`,2,2) AS `id`,COUNT(SUBSTR(t.`title`,2,2)) AS `star`FROM`t_topic`…`   |
| MyTest2.java#testGroup12                    | `SELECT t1.`value1`AS`id`,COUNT(t1.`value2`) AS `star` FROM (SELECT t.`title`AS`value1`…`     |
| MyTest2.java#testGroup13                    | `SELECT t1.`value1`AS`id`,COUNT(t1.`value2`) AS `star` FROM (SELECT t.`title`AS`value1`…`     |
| MyTest2.java#testGroup14                    | `SELECT t2.`id`AS`id`,t2.`star`AS`star` FROM (SELECT t1.`value1`AS`id`,COUNT(t1.`valu…`       |
| MyTest2.java#testGroup16                    | `SELECT SUBSTR(`title`,2,2) FROM `t_topic`WHERE`title` IS NOT NULL GROUP BY SUBSTR(`title…`   |
| MyTest2.java#testGroup17                    | `SELECT SUBSTR(`title`,2,2) FROM `t_topic`WHERE`title` IS NOT NULL GROUP BY SUBSTR(`title…`   |
| MyTest2.java#testGroup18                    | `SELECT SUBSTR(t.`title`,2,2) AS `value1`,COUNT(*) AS `value2`FROM`t_topic` t WHERE t.`ti…`   |
| MyTest2.java#testGroup19                    | `SELECT SUBSTR(t.`title`,2,2) AS `value1`,IFNULL(t1.`score`,?) AS `value2`,COUNT(*) AS `val…` |
| MyTest2.java#testSelect5                    | `SELECT t.`title`AS`id`,SUBSTR(t.`title`,2,2) AS `title`FROM`t_topic` t WHERE t.`title`…`     |
| MyTest2.java#testSelect6                    | `SELECT t2.`id`AS`id`,t2.`id_count`AS`id_count` FROM (SELECT t1.`id`AS`id`,COUNT(*) A…`       |
| MyTest2.java#testSelect6_1                  | `SELECT t1.`id`AS`id`,COUNT(*) AS `id_count` FROM (SELECT t.`title`AS`id`,SUBSTR(t.`tit…`     |
| MyTest2.java#testSelect6_2                  | `SELECT t1.`id`AS`id`,MIN(t1.`id`) AS `id_count` FROM (SELECT t.`title`AS`id`,SUBSTR(t.…`     |
| MyTest2.java#testSelect7                    | `SELECT t2.`value1`AS`value1`,t2.`value2`AS`value2` FROM (SELECT t1.`value1`AS`value1…`       |
| MyTest2.java#testSelect9                    | `SELECT t1.`value1`AS`value1`,COUNT(*) AS `value2` FROM (SELECT t.`title`AS`value1`,SUB…`     |
| MyTest2.java#testTuple1                     | `SELECT t.`content`AS`value1`,CHAR_LENGTH(t.`content`) AS `value2`FROM`t_blog` t WHERE …`     |
| MyTest2.java#testTuple1_1                   | `SELECT t.`content`AS`value1`,CHAR_LENGTH(t.`content`) AS `value2`FROM`t_blog` t WHERE …`     |
| MyTest2.java#testTuple2                     | `SELECT t.`content`AS`value1`,CHAR_LENGTH(t.`content`) AS `value2`FROM`t_blog` t WHERE …`     |
| QueryTest.java#query102_1                   |                                                                                               |
| QueryTest.java#query103                     |                                                                                               |
| QueryTest.java#query104                     |                                                                                               |
| QueryTest.java#query112                     |                                                                                               |
| QueryTest.java#query114                     |                                                                                               |
| QueryTest.java#query115                     |                                                                                               |
| QueryTest.java#query116                     |                                                                                               |
| QueryTest.java#query117                     |                                                                                               |
| QueryTest.java#query118                     |                                                                                               |
| QueryTest.java#query119                     |                                                                                               |
| QueryTest.java#query120                     |                                                                                               |
| QueryTest.java#query89                      |                                                                                               |
| QueryTest.java#query89_1                    |                                                                                               |
| QueryTest.java#query90                      |                                                                                               |
| QueryTest.java#query91                      |                                                                                               |
| QueryTest.java#query99                      |                                                                                               |
| QueryTest10.java#testDraft11                | `SELECT t.`id`AS`value1`,LOWER(t.`title`) AS `value2`,UPPER(t.`title`) AS `value3`FROM`…`     |
| QueryTest10.java#testDraft17                | `SELECT t.`id`AS`value1`,REPLACE(LOWER(t.`title`),?,?) AS `value2`FROM`t_topic` t WHERE…`     |
| QueryTest10.java#testDraft18                | `SELECT t.`id`AS`value1`,STRCMP(t.`title`,t.`id`) AS `value2`FROM`t_topic` t WHERE STRC…`     |
| QueryTest10.java#testDraft19                | `SELECT t.`id`AS`value1`,LPAD(t.`title`, 9, ?) AS `value2`FROM`t_topic` t WHERE LPAD(t.…`     |
| QueryTest11.java#testx14                    | `SELECT `id`,`stars`,`title`,`topic_type`,`create_time`FROM`t_topic_type` WHERE SUBSTR(`i…`   |
| QueryTest11.java#testx26                    | `SELECT t.`id`AS`id`,(CASE t.`id`WHEN ? THEN 1 ELSE 0 END) AS`is_top`,(CASE SUBSTR(t.`i…`     |
| QueryTest12.java#testDoc19                  | `SELECT `id`,`create_time`,`username`,`phone`,`id_card`,`address`FROM`easy-query-test`.`t…`   |
| QueryTest14.java#testLikeColumn             | `SELECT t.`id`,t.`create_time`,t.`update_time`,t.`create_by`,t.`update_by`,t.`deleted`,t.`t…` |
| QueryTest17.java#test1                      | `SELECT `id`,`create_time`,`update_time`,`create_by`,`update_by`,`deleted`,`title`,`content…` |
| QueryTest17.java#test3                      | `SELECT `id`,`create_time`,`update_time`,`create_by`,`update_by`,`deleted`,`title`,`content…` |
| QueryTest17.java#textLikeFunc               | `SELECT `id`,`create_time`,`update_time`,`create_by`,`update_by`,`deleted`,`title`,`content…` |
| QueryTest18.java#testSubString              | `SELECT `id`,`create_time`,`update_time`,`create_by`,`update_by`,`deleted`,`title`,`content…` |
| QueryTest2.java#query112                    |                                                                                               |
| QueryTest2.java#query114                    |                                                                                               |
| QueryTest2.java#query115                    |                                                                                               |
| QueryTest2.java#query116                    |                                                                                               |
| QueryTest2.java#query117                    |                                                                                               |
| QueryTest2.java#query118                    |                                                                                               |
| QueryTest2.java#query119                    |                                                                                               |
| QueryTest2.java#query120                    |                                                                                               |
| QueryTest23.java#testConcat                 | `SELECT `id`,`create_time`,`update_time`,`create_by`,`update_by`,`deleted`,`title`,`content…` |
| QueryTest23.java#testConcat2                |                                                                                               |
| QueryTest23.java#testConcat3                | `SELECT `id`,`create_time`,`update_time`,`create_by`,`update_by`,`deleted`,`title`,`content…` |
| QueryTest23.java#testIndexOf                | `SELECT `id`,`create_time`,`update_time`,`create_by`,`update_by`,`deleted`,`title`,`content…` |
| QueryTest23.java#testMathx1                 | `SELECT t.`score`AS`value1`,ABS(t.`score`) AS `value2`,SIN(t.`score`) AS `value3`,FLOOR(t…`   |
| QueryTest23.java#testMathx2                 | `SELECT t.`score`AS`value1`,ROUND(t.`score`) AS `value2`,SIGN(t.`score`) AS `value3`,ROUN…`   |
| QueryTest23.java#testQueryConcat            |                                                                                               |
| QueryTest24.java#testContains               | `SELECT `id`,`create_time`,`update_time`,`create_by`,`update_by`,`deleted`,`title`,`content…` |
| QueryTest24.java#testdraft1                 | `SELECT SUBSTR(t2.`title`,2,2) AS `value1` FROM (SELECT t.`id`,t.`stars`,t.`title`,t.`creat…` |
| QueryTest24.java#testJoinParameterCount     | `SELECT SUBSTR(t2.`title`,2,2) AS `value1` FROM (SELECT t.`id`,t.`stars`,t.`title`,t.`creat…` |
| QueryTest3.java#query112                    |                                                                                               |
| QueryTest3.java#query114                    |                                                                                               |
| QueryTest3.java#query115                    |                                                                                               |
| QueryTest3.java#query116                    |                                                                                               |
| QueryTest3.java#query117                    |                                                                                               |
| QueryTest3.java#query118                    |                                                                                               |
| QueryTest3.java#query119                    |                                                                                               |
| QueryTest3.java#query120                    |                                                                                               |
| RelationTest.java#testSub3                  | `SELECT LOWER(t1.`name`) FROM `school_student`t LEFT JOIN`school_class` t1 ON t1.`id` = t…`   |
| RelationTest.java#testSub4                  | `SELECT LOWER(t1.`name`) FROM `school_student`t LEFT JOIN`school_class` t1 ON t1.`id` = t…`   |
| SkipTest.java#test11                        |                                                                                               |
| StringFunctionsTest.java#compareToMSSQL     | `SELECT (CASE WHEN t.[code] = t.[type] THEN 0 WHEN t.[code] > t.[type] THEN 1 ELSE -1 END) …` |
| StringFunctionsTest.java#compareToMySQL     | `SELECT STRCMP(t.`code`,t.`type`) FROM `doc_bank_card` t WHERE STRCMP(t.`code`,?) = ?`        |
| StringFunctionsTest.java#compareToORACLE    | `SELECT (CASE WHEN t.\`                                                                       |
| StringFunctionsTest.java#compareToPGSQL     | `SELECT (CASE WHEN t.\`                                                                       |
| StringFunctionsTest.java#concatMSSQL        | `SELECT CONCAT(?,t.[code],?,t.[type]) FROM [doc_bank_card] t WHERE CONCAT(t.[code],?) = ? A…` |
| StringFunctionsTest.java#concatMySQL        | `SELECT CONCAT(?,t.`code`,?,t.`type`) FROM `doc_bank_card` t WHERE CONCAT(t.`code`,?) = ? A…` |
| StringFunctionsTest.java#concatORACLE       | `SELECT ? \|\| t.\`                                                                           |
| StringFunctionsTest.java#concatPGSQL        | `SELECT CONCAT(?,t.\`                                                                         |
| StringFunctionsTest.java#leftRightPadMSSQL  | `SELECT [id],[uid],[code],[type],[bank_id] FROM [doc_bank_card] WHERE LPAD([code], 4) = ? A…` |
| StringFunctionsTest.java#leftRightPadMySQL  | `SELECT `id`,`uid`,`code`,`type`,`bank_id`FROM`doc_bank_card` WHERE LPAD(`code`, 4) = ? A…`   |
| StringFunctionsTest.java#leftRightPadORACLE | `SELECT \`                                                                                    |
| StringFunctionsTest.java#leftRightPadPGSQL  | `SELECT \`                                                                                    |
| StringFunctionsTest.java#lengthMSSQL        | `SELECT LEN(t.[code]) FROM [doc_bank_card] t WHERE LEN(t.[code]) = ?`                         |
| StringFunctionsTest.java#lengthMySQL        | `SELECT CHAR_LENGTH(t.`code`) FROM `doc_bank_card` t WHERE CHAR_LENGTH(t.`code`) = ?`         |
| StringFunctionsTest.java#lengthORACLE       | `SELECT LENGTH(t.\`                                                                           |
| StringFunctionsTest.java#lengthPGSQL        | `SELECT CHAR_LENGTH(t.\`                                                                      |
| StringFunctionsTest.java#lowerUpperMSSQL    | `SELECT LOWER(t.[id]) AS [value1],UPPER(t.[id]) AS [value2] FROM [doc_bank_card] t`           |
| StringFunctionsTest.java#lowerUpperMySQL    | `SELECT LOWER(t.`id`) AS `value1`,UPPER(t.`id`) AS `value2`FROM`doc_bank_card` t`             |
| StringFunctionsTest.java#lowerUpperORACLE   | `SELECT LOWER(t.\`                                                                            |
| StringFunctionsTest.java#lowerUpperPGSQL    | `SELECT LOWER(t.\`                                                                            |
| StringFunctionsTest.java#replaceMSSQL       | `SELECT REPLACE(t.[id],?,?) AS [value1] FROM [doc_bank_card] t WHERE REPLACE(t.[code],?,?) …` |
| StringFunctionsTest.java#replaceMySQL       | `SELECT REPLACE(t.`id`,?,?) AS `value1`FROM`doc_bank_card` t WHERE REPLACE(t.`code`,?,?) …`   |
| StringFunctionsTest.java#replaceORACLE      | `SELECT REPLACE(t.\`                                                                          |
| StringFunctionsTest.java#replacePGSQL       | `SELECT REPLACE(t.\`                                                                          |
| StringFunctionsTest.java#subStringMSSQL     | `SELECT SUBSTRING(t.[id],1,2) AS [value1],SUBSTRING(t.[id],1,t.[stars]) AS [value2] FROM [t…` |
| StringFunctionsTest.java#subStringMySQL     | `SELECT SUBSTR(t.`id`,1,2) AS `value1`,SUBSTR(t.`id`,1,t.`stars`) AS `value2`FROM`t_topic…`   |
| StringFunctionsTest.java#subStringORACLE    | `SELECT SUBSTR(t.\`                                                                           |
| StringFunctionsTest.java#subStringPGSQL     | `SELECT SUBSTR(t.\`                                                                           |
| StringFunctionsTest.java#trimMSSQL          | `SELECT LTRIM(RTRIM(t.[id])) AS [value1] FROM [doc_bank_card] t WHERE LTRIM(RTRIM(t.[code])…` |
| StringFunctionsTest.java#trimMySQL          | `SELECT TRIM(t.`id`) AS `value1`FROM`doc_bank_card` t WHERE TRIM(t.`code`) = ? AND LTRIM(…`   |
| StringFunctionsTest.java#trimORACLE         | `SELECT TRIM(t.\`                                                                             |
| StringFunctionsTest.java#trimPGSQL          | `SELECT TRIM(t.\`                                                                             |

### 拦截器（`interceptor`，已对应）

| 用例                       | 断言的 SQL（摘要）                                                                            |
| -------------------------- | --------------------------------------------------------------------------------------------- |
| InterceptorTest.java#test1 | `SELECT `id`,`stars`,`title`,`create_time`,`create_by`,`update_time`,`update_by`,`tenant_id…` |
| InterceptorTest.java#test2 | `SELECT `id`,`stars`,`title`,`create_time`,`create_by`,`update_time`,`update_by`,`tenant_id…` |
| InterceptorTest.java#test3 | `SELECT `id`,`stars`,`title`,`create_time`,`create_by`,`update_time`,`update_by`,`tenant_id…` |

### 行锁（`lock`，已对应）

| 用例                                                                                     | 断言的 SQL（摘要） |
| ---------------------------------------------------------------------------------------- | ------------------ |
| ForUpdateDialectToSQLSmokeTest.java#clickHouseForUpdateThrowsUnsupported                 |                    |
| ForUpdateDialectToSQLSmokeTest.java#damengForUpdateToSQLSmoke                            |                    |
| ForUpdateDialectToSQLSmokeTest.java#db2ForUpdateToSQLSmoke                               |                    |
| ForUpdateDialectToSQLSmokeTest.java#duckDBForUpdateThrowsUnsupported                     |                    |
| ForUpdateDialectToSQLSmokeTest.java#gaussDBForUpdateToSQLSmoke                           |                    |
| ForUpdateDialectToSQLSmokeTest.java#h2ForUpdateToSQLSmoke                                |                    |
| ForUpdateDialectToSQLSmokeTest.java#kingbaseESForUpdateToSQLSmoke                        |                    |
| ForUpdateDialectToSQLSmokeTest.java#msSQLForUpdateThrowsUnsupported                      |                    |
| ForUpdateDialectToSQLSmokeTest.java#msSQLRowNumberForUpdateThrowsUnsupported             |                    |
| ForUpdateDialectToSQLSmokeTest.java#mysqlForUpdateToSQLSmoke                             |                    |
| ForUpdateDialectToSQLSmokeTest.java#oracleForUpdateToSQLSmoke                            |                    |
| ForUpdateDialectToSQLSmokeTest.java#pgsqlForUpdateToSQLSmoke                             |                    |
| ForUpdateDialectToSQLSmokeTest.java#sqliteForUpdateToSQLSmoke                            |                    |
| mysql8/ForUpdateTest.java#testForUpdateAppliesOnlyOnOuterQueryForExistsAndInSubQuery     |                    |
| mysql8/ForUpdateTest.java#testForUpdateBlocksConcurrentTransaction                       |                    |
| mysql8/ForUpdateTest.java#testForUpdateDerivedCountAndExistsSqlBehaviorConsistent        |                    |
| mysql8/ForUpdateTest.java#testForUpdateDuplicateCallThrows                               |                    |
| mysql8/ForUpdateTest.java#testForUpdateJoinNotSupported                                  |                    |
| mysql8/ForUpdateTest.java#testForUpdateSqlAppendInTransaction                            |                    |
| mysql8/ForUpdateTest.java#testForUpdateWithoutTransactionThrows                          |                    |
| pgsql/PgSQLForUpdateTest.java#testForUpdateAppliesOnlyOnOuterQueryForExistsAndInSubQuery |                    |
| pgsql/PgSQLForUpdateTest.java#testForUpdateBlocksConcurrentTransaction                   |                    |
| pgsql/PgSQLForUpdateTest.java#testForUpdateDerivedCountAndExistsSqlBehaviorConsistent    |                    |
| pgsql/PgSQLForUpdateTest.java#testForUpdateDuplicateCallThrows                           |                    |
| pgsql/PgSQLForUpdateTest.java#testForUpdateJoinNotSupported                              |                    |
| pgsql/PgSQLForUpdateTest.java#testForUpdateSqlAppendInTransaction                        |                    |
| pgsql/PgSQLForUpdateTest.java#testForUpdateWithoutTransactionThrows                      |                    |

### 逻辑删除（`logicDelete`，已对应）

| 用例                        | 断言的 SQL（摘要）                                                                          |
| --------------------------- | ------------------------------------------------------------------------------------------- |
| LogicDeleteTest.java#Test1  | `SELECT `id`,`stars`,`title`,`deleted`,`create_time`FROM`t_logic_del_topic`WHERE`delete…`   |
| LogicDeleteTest.java#Test10 | `SELECT `id`,`stars`,`title`,`deleted_at`,`deleted_user`,`create_time`FROM`t_logic_del_to…` |
| LogicDeleteTest.java#Test2  | `UPDATE `t_logic_del_topic`SET`deleted`= ? WHERE`deleted`= ? AND`id` = ?`                   |
| LogicDeleteTest.java#Test3  | `UPDATE `t_logic_del_topic`SET`deleted`= ? WHERE`deleted`= ? AND`id` = ?`                   |
| LogicDeleteTest.java#Test4  | `SELECT `id`,`stars`,`title`,`deleted`,`create_time`FROM`t_logic_del_topic``                |
| LogicDeleteTest.java#Test5  | `DELETE FROM `t_logic_del_topic`WHERE`id` = ?`                                              |
| LogicDeleteTest.java#Test6  | `UPDATE `t_logic_del_topic`SET`title`= ? WHERE`id` = ?`                                     |
| LogicDeleteTest.java#Test7  | `SELECT `id`,`stars`,`title`,`deleted_at`,`deleted_user`,`create_time`FROM`t_logic_del_to…` |
| LogicDeleteTest.java#Test8  | `SELECT `id`,`stars`,`title`,`deleted_at`,`deleted_user`,`create_time`FROM`t_logic_del_to…` |
| LogicDeleteTest.java#Test9  | `SELECT `id`,`stars`,`title`,`deleted_at`,`deleted_user`,`create_time`FROM`t_logic_del_to…` |

### 一对多展开（flatElement / elements）（`nav.flat`，写法不同）

| 用例                                                          | 断言的 SQL（摘要）                                                                            |
| ------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| mysql8/CTETest.java#cteTest4                                  | `WITH `m8_user_temp` AS (SELECT t.`id`,t.`name`FROM`m8_user` t WHERE t.`age` IS NULL) SEL…`   |
| mysql8/CTETest.java#cteTest6                                  | `WITH `m8_user_temp2` AS (SELECT t.`id`,t.`name`,t.`age`,(ROW_NUMBER() OVER (PARTITION BY t…` |
| mysql8/M8BankTest.java#test11                                 | `SELECT t.`name`AS`value1`,t4.`**joining3**`AS`value2`FROM`t_sys_user` t LEFT JOIN (S…`       |
| mysql8/M8BankTest.java#test12                                 | `SELECT t.`id`,t.`name`,t.`phone`,t.`age`,t.`create_time`FROM`t_sys_user` t LEFT JOIN (SE…`   |
| mysql8/M8BankTest.java#test13                                 | `SELECT t.`name`AS`value1`,t4.`**joining3**`AS`value2`FROM`t_sys_user` t LEFT JOIN (S…`       |
| mysql8/M8BankTest.java#test14                                 | `SELECT t.`name`AS`value1`,t4.`**joining3**`AS`value2`FROM`t_sys_user` t LEFT JOIN (S…`       |
| mysql8/M8BankTest.java#test15                                 | `SELECT t.`name`AS`value1`,t4.`**joining3**`AS`value2`FROM`t_sys_user` t LEFT JOIN (S…`       |
| mysql8/M8BankTest.java#test16                                 | `SELECT t.`name`AS`value1`,t4.`**joining3**`AS`value2`FROM`t_sys_user` t LEFT JOIN (S…`       |
| mysql8/M8BankTest.java#test17                                 | `SELECT t.`id`,t.`name`,t.`phone`,t.`age`,t.`create_time`FROM`t_sys_user` t LEFT JOIN (SE…`   |
| mysql8/M8BankTest.java#test7                                  | `SELECT t.`name`AS`value1`,(SELECT GROUP_CONCAT(t1.`type`SEPARATOR ?) FROM`t_bank_card`…`     |
| mysql8/M8BankTest.java#test7_1                                | `SELECT t.`name`AS`value1`,(SELECT GROUP_CONCAT(t2.`type` SEPARATOR ?) FROM (SELECT t1.`i…`   |
| mysql8/M8BankTest.java#test7_2                                | `SELECT t.`name`AS`value1`,(SELECT GROUP_CONCAT(t1.`type`SEPARATOR ?) FROM`t_bank_card`…`     |
| mysql8/M8BankTest.java#test8                                  | `SELECT t.`name`AS`value1`,(SELECT GROUP_CONCAT(t4.`type`SEPARATOR ?) FROM`t_bank_card`…`     |
| mysql8/M8BankTest.java#testFlatTest                           | `SELECT t.`id`,t.`name`,t.`create_time`FROM`t_bank` t LEFT JOIN (SELECT t1.`bank_id`AS`…`     |
| mysql8/M8BankTest.java#testQueryBankAndCardImplicitCountTest2 | `SELECT t.`id`,t.`name`,t.`create_time`,(NOT (EXISTS(SELECT 1 FROM (SELECT t1.`id`,t1.`uid`…` |
| mysql8/M8BankTest.java#testQueryBankAndCardImplicitCountTest3 | `SELECT t.`id`,t.`name`,t.`create_time`,IFNULL(t4.`**none2**`,?) AS `__part__column1` FROM …` |
| mysql8/M8OrderTest.java#testSubQuery                          | `SELECT t.`id`,t.`no`,t.`price`,t.`create_time`FROM`t_order` t INNER JOIN (SELECT t1.`ord…`   |
| mysql8/M8OrderTest.java#testSubQuery3                         | `SELECT t.`id`,t.`no`,t.`price`,t.`create_time`FROM`t_order` t INNER JOIN (SELECT t1.`ord…`   |
| mysql8/ManyJoinTest.java#testElement8                         | `SELECT t4.`**max2**`AS`value1`,t7.`type`AS`value2`FROM`doc_user` t LEFT JOIN (SELECT…`       |
| mysql8/ManyJoinTest.java#testMany2Many2GroupJoin2             | `SELECT t.`id`,t.`name`,t.`age`,t.`create_time`FROM`m8_user` t LEFT JOIN (SELECT t2.`user…`   |
| mysql8/ManyJoinTest.java#testMany2Many2GroupJoin24            | `SELECT t.`id`,t.`name`,t.`age`,t.`create_time`FROM`m8_user` t LEFT JOIN (SELECT t2.`user…`   |
| mysql8/ManyJoinTest.java#testMany2Many2GroupJoin4             | `SELECT t.`id`,t.`name`,t.`age`,t.`create_time`FROM`m8_user` t LEFT JOIN (SELECT t2.`user…`   |
| mysql8/ManyJoinTest.java#testMany2Many2GroupJoin5             | `SELECT t.`id`,t.`name`,t.`age`,t.`create_time`FROM`m8_user` t LEFT JOIN (SELECT t2.`user…`   |
| mysql8/MySQL8Test3.java#testFlatElement                       | `SELECT t.`id`,t.`name`FROM`m8_province` t LEFT JOIN (SELECT t1.`pid`AS`**group_key1**`…`     |
| mysql8/MySQL8Test3.java#testFlatElement1                      | `SELECT t.`id`,t.`name`FROM`m8_province` t LEFT JOIN (SELECT t1.`pid`AS`**group_key1**`…`     |
| mysql8/MySQL8Test3.java#testFlatElement2                      | `SELECT t.`id`,t.`name`FROM`m8_province`t WHERE EXISTS(SELECT 1 FROM`m8_city` t1 WHERE …`     |
| mysql8/MySQL8Test3.java#testFlatElement3                      | `SELECT t.`id`,t.`name`FROM`m8_province` t LEFT JOIN (SELECT t1.`pid`AS`**group_key1**`…`     |
| mysql8/MySQL8Test3.java#testGroupJoin                         | `SELECT t.`id`,t.`name`FROM`m8_province` t LEFT JOIN (SELECT t1.`pid`AS`**group_key1**`…`     |
| mysql8/MySQL8Test3.java#testGroupJoin2                        | `SELECT t.`id`,t.`name`FROM`m8_province` t LEFT JOIN (SELECT t1.`pid`AS`**group_key1**`…`     |
| mysql8/MySQL8Test3.java#testGroupJoin3                        | `SELECT t.`id`,t.`name`FROM`m8_province` t LEFT JOIN (SELECT t1.`pid`AS`**group_key1**`…`     |
| mysql8/MySQL8Test3.java#testGroupJoin4                        | `SELECT t.`id`,t.`name`FROM`m8_province` t LEFT JOIN (SELECT t1.`pid`AS`**group_key1**`…`     |
| mysql8/MySQL8Test3.java#testMany2Many                         | `SELECT t.`id`,t.`name`,t.`order`FROM`m8_parent` t LEFT JOIN (SELECT t2.`parent_id`AS`_…`     |
| mysql8/MySQL8Test5.java#testManyLimit1                        | `SELECT t.`id`AS`value1`,t6.`**joining2**`AS`value2`FROM`m8_user` t LEFT JOIN (SELECT…`       |
| mysql8/MySQL8Test5.java#testManyLimit1_2                      | `SELECT t.`id`AS`value1`,t6.`**joining2**`AS`value2`FROM`m8_user` t LEFT JOIN (SELECT…`       |
| mysql8/MySQL8Test5.java#testManyLimit1_3                      | `SELECT t.`id`AS`value1`,t6.`**joining2**`AS`value2`,t6.`**joining3**`AS`value3` FROM…`       |
| mysql8/MySQL8Test5.java#testManyLimit5                        | `SELECT t.`id`AS`value1`,t5.`**joining2**`AS`value2`FROM`t_sys_user` t LEFT JOIN (SEL…`       |
| mysql8/MySQL8Test5.java#testManyLimit6                        | `SELECT t.`id`AS`value1`,t5.`**joining2**`AS`value2`FROM`t_sys_user` t LEFT JOIN (SEL…`       |
| QueryTest12.java#testDoc24                                    | `DELETE FROM `relation_user`t WHERE EXISTS(SELECT 1 FROM`relation_teacher` t1 WHERE (EXIS…`   |
| QueryTest16.java#test1                                        | `SELECT t.`id`,t.`company_id`,t.`name`,t.`age`,t.`create_time`FROM`t_user` t WHERE EXISTS…`   |
| QueryTest16.java#test15                                       | `SELECT t.`id`,t.`company_id`,t.`name`,t.`age`,t.`create_time`FROM`t_user` t WHERE (t.`na…`   |
| QueryTest16.java#test2                                        | `SELECT t.`id`,t.`company_id`,t.`name`,t.`age`,t.`create_time`FROM`t_user` t LEFT JOIN (S…`   |
| QueryTest16.java#test3                                        | `SELECT t.`id`,t.`company_id`,t.`name`,t.`age`,t.`create_time`FROM`t_user` t LEFT JOIN (S…`   |
| QueryTest16.java#testDocSub                                   | `SELECT t.`id`,t.`name`,t.`create_time`FROM`t_company`t WHERE EXISTS(SELECT 1 FROM`t_us…`     |
| QueryTest17.java#testaaa                                      |                                                                                               |
| QueryTest17.java#testFlatElement1                             | `SELECT t.`id`,t.`f1`,t.`f2`,t.`parent_id`FROM`MyObject`t LEFT JOIN`MyObjectParent` t1 …`     |
| QueryTest17.java#testFlatElement2                             | `SELECT t.`id`,t.`f1`,t.`f2`,t.`parent_id`FROM`MyObject`t LEFT JOIN`MyObjectParent` t1 …`     |
| QueryTest17.java#testNop2                                     | `SELECT t4.`value1`AS`value1`,SUM(t4.`value2`) AS `value2`,COUNT(t5.`type`) AS `value3` F…`   |
| QueryTest18.java#test8_1                                      |                                                                                               |
| QueryTest22.java#testManyGroup17                              | `SELECT t.`id`,t.`name`,t.`phone`,t.`age`FROM`doc_user` t LEFT JOIN (SELECT t1.`uid`AS`…`     |
| QueryTest22.java#testManyGroup18                              | `SELECT t.`id`,t.`name`,t.`phone`,t.`age`FROM`doc_user` t LEFT JOIN (SELECT t1.`uid`AS`…`     |
| QueryTest25.java#test11a                                      | `SELECT `id`,`create_time`,`update_time`,`create_by`,`update_by`,`deleted`,`title`,`content…` |
| QueryTest25.java#testToListFlat1                              |                                                                                               |
| QueryTest25.java#xxx22                                        |                                                                                               |
| QueryTest26.java#includeFlat                                  |                                                                                               |
| QueryTestRelationTest.java#test1                              | `SELECT t.`id`,t.`com_id`,t.`user_id`,t.`gw`FROM`my_com_user`t LEFT JOIN`my_company_inf…`     |
| SubJoinTest.java#testSubJoinCaseWhen1                         | `SELECT IFNULL((SELECT SUM(t3.`age`) FROM `sub_join_book`t2 LEFT JOIN`sub_join_author` t3…`   |

### 隐式子查询改分组 join（`nav.groupJoin`，已对应）

| 用例                                                                 | 断言的 SQL（摘要）                                                                            |
| -------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| mysql8/M8BankTest.java#test5                                         | `SELECT t.`id`,t.`name`,t.`phone`,t.`age`,t.`create_time`FROM`t_sys_user` t LEFT JOIN (SE…`   |
| mysql8/M8BankTest.java#testExtraFilter5                              | `SELECT t.`name`AS`value1`,IFNULL(t2.`**count2**`,0) AS `value2`FROM`t_bank` t LEFT JOI…`     |
| mysql8/M8BankTest.java#testQueryBankAndCardImplicitCountToGroupTest  | `SELECT t.`id`,t.`name`,t.`create_time`,IFNULL(t2.`**count2**`,0) AS `__part__column1` FROM…` |
| mysql8/M8BankTest.java#testQueryBankAndCardImplicitCountToGroupTest1 | `SELECT t.`id`,t.`name`,t.`create_time`,IFNULL(t2.`**count2**`,0) AS `__part__column1`,IFNU…` |
| mysql8/M8BankTest.java#whereSubQuery2                                | `SELECT t.`id`,t.`name`,t.`phone`,t.`age`,t.`create_time`FROM`t_sys_user` t LEFT JOIN (SE…`   |
| mysql8/M8BankTest.java#whereSubQuery2_1                              | `SELECT t.`id`,t.`name`,t.`phone`,t.`age`,t.`create_time`FROM`t_sys_user` t LEFT JOIN (SE…`   |
| mysql8/M8BankTest.java#whereSubQuery2_2                              | `SELECT t.`id`,t.`name`,t.`phone`,t.`age`,t.`create_time`FROM`t_sys_user` t LEFT JOIN (SE…`   |
| mysql8/M8BankTest.java#whereSubQuery3                                | `SELECT t.`id`,t.`name`,t.`phone`,t.`age`,t.`create_time`FROM`t_sys_user` t WHERE EXISTS(…`   |
| mysql8/M8BankTest.java#whereSubQuery4                                | `SELECT t.`id`,t.`name`,t.`phone`,t.`age`,t.`create_time`FROM`t_sys_user` t LEFT JOIN (SE…`   |
| mysql8/M8OrderTest.java#testSubQuery2                                | `SELECT t.`id`,t.`no`,t.`price`,t.`create_time`FROM`t_order` t INNER JOIN (SELECT t1.`id`…`   |
| mysql8/M8OrderTest.java#testSubQuery4                                |                                                                                               |
| mysql8/ManyJoinTest.java#manyJoinMany2Many10                         | `SELECT t.`user_id`,t.`user_name`,t.`user_age`,t.`create_time`FROM`m8_user2` t LEFT JOIN …`   |
| mysql8/ManyJoinTest.java#manyJoinMany2Many2                          | `SELECT t.`id`,t.`name`FROM`school_class` t LEFT JOIN (SELECT t2.`class_id`AS`__class_i…`     |
| mysql8/ManyJoinTest.java#manyJoinMany2Many3                          | `SELECT t.`id`,t.`name`,t.`age`,t.`create_time`FROM`m8_user` t LEFT JOIN (SELECT t2.`user…`   |
| mysql8/ManyJoinTest.java#manyJoinMany2Many3_1                        | `SELECT t.`user_id`,t.`user_name`,t.`user_age`,t.`create_time`FROM`m8_user2` t LEFT JOIN …`   |
| mysql8/ManyJoinTest.java#manyJoinMany2Many3_2                        | `SELECT t.`user_id`,t.`user_name`,t.`user_age`,t.`create_time`FROM`m8_user2` t LEFT JOIN …`   |
| mysql8/ManyJoinTest.java#manyJoinMany2Many4                          | `SELECT t.`id`,t.`name`,t.`age`,t.`create_time`FROM`m8_user` t LEFT JOIN (SELECT t2.`user…`   |
| mysql8/ManyJoinTest.java#manyJoinMany2Many4_1                        | `SELECT t.`user_id`,t.`user_name`,t.`user_age`,t.`create_time`FROM`m8_user2` t LEFT JOIN …`   |
| mysql8/ManyJoinTest.java#testElement3                                | `SELECT t2.`**max2**`AS`value1`,t5.`type`AS`value2`FROM`doc_user` t LEFT JOIN (SELECT…`       |
| mysql8/ManyJoinTest.java#testMany2Many2GroupJoin                     | `SELECT t.`id`,t.`name`,t.`age`,t.`create_time`FROM`m8_user` t LEFT JOIN (SELECT t2.`user…`   |
| mysql8/ManyJoinTest.java#testManyJoinGroup                           |                                                                                               |
| mysql8/MySQL8Test2.java#testPageSelectSubQueryCount                  | `SELECT COUNT(*) FROM `t_bank` t`                                                             |
| NumberFunctionsTest.java#subQueryMySQL                               | `SELECT IFNULL(t2.`**any7**`,?) AS `value1`FROM`t_sys_user` t LEFT JOIN (SELECT t1.`uid` …`   |
| NumberFunctionsTest.java#subQueryORACLE                              | `SELECT NVL(t2.\`                                                                             |
| QueryTest19.java#test1_3                                             | `SELECT t.`id`,t.`company_id`,t.`name`,t.`age`,t.`create_time`FROM`t_user` t LEFT JOIN (S…`   |
| QueryTest22.java#testDoubleField                                     | `SELECT IFNULL(t2.`**count3**`,0) AS `value1`,IFNULL(t2.`**count4**`,0) AS `value2`FROM`m…`   |
| QueryTest22.java#testManyGroup                                       | `SELECT t.`id`,t.`name`,t.`phone`,t.`age`FROM`doc_user` t LEFT JOIN (SELECT t1.`uid`AS`…`     |
| QueryTest22.java#testManyGroup10                                     | `SELECT t.`id`,t.`name`,t.`phone`,t.`age`FROM`doc_user` t LEFT JOIN (SELECT t1.`uid`AS`…`     |
| QueryTest22.java#testManyGroup11                                     | `SELECT t.`id`,t.`name`,t.`phone`,t.`age`FROM`doc_user` t LEFT JOIN (SELECT t1.`uid`AS`…`     |
| QueryTest22.java#testManyGroup12                                     | `SELECT t.`id`,t.`name`,t.`phone`,t.`age`FROM`doc_user` t LEFT JOIN (SELECT t1.`uid`AS`…`     |
| QueryTest22.java#testManyGroup13                                     | `SELECT t.`id`,t.`name`,t.`phone`,t.`age`FROM`doc_user` t LEFT JOIN (SELECT t2.`uid`AS`…`     |
| QueryTest22.java#testManyGroup14                                     | `SELECT t.`id`,t.`name`,t.`phone`,t.`age`FROM`doc_user` t LEFT JOIN (SELECT t1.`uid`AS`…`     |
| QueryTest22.java#testManyGroup15                                     | `SELECT t.`id`,t.`uid`,t.`code`,t.`type`,t.`bank_id`FROM`doc_bank_card`t LEFT JOIN`doc_…`     |
| QueryTest22.java#testManyGroup16                                     | `SELECT t.`id`,t.`create_time`,t.`update_time`,t.`create_by`,t.`update_by`,t.`deleted`,t.`t…` |
| QueryTest22.java#testManyGroup2                                      | `SELECT t.`id`,t.`name`,t.`phone`,t.`age`FROM`doc_user` t LEFT JOIN (SELECT t1.`uid`AS`…`     |
| QueryTest22.java#testManyGroup3                                      | `SELECT IFNULL(t2.`**count3**`,0) AS `value1`,IFNULL(t2.`**count4**`,0) AS `value2`,IFNULL(…` |
| QueryTest22.java#testManyGroup4                                      | `SELECT IFNULL(t2.`**any2**`,?) AS `value1`,IFNULL(t2.`**none3**`,?) AS `value2`FROM`doc_…`   |
| QueryTest22.java#testManyGroup5                                      | `SELECT t.`id`,t.`name`,t.`phone`,t.`age`FROM`doc_user` t LEFT JOIN (SELECT t1.`uid`AS`…`     |
| QueryTest22.java#testManyGroup6                                      | `SELECT t.`id`,t.`name`,t.`phone`,t.`age`FROM`doc_user` t`                                    |
| QueryTest22.java#testManyGroup7                                      | `SELECT t.`id`,t.`name`,t.`phone`,t.`age`FROM`doc_user` t`                                    |
| QueryTest22.java#testManyGroup8                                      | `SELECT t.`id`,t.`name`,t.`phone`,t.`age`FROM`doc_user` t LEFT JOIN (SELECT t1.`uid`AS`…`     |
| QueryTest22.java#testManyGroup9                                      | `SELECT t.`id`,t.`name`,t.`phone`,t.`age`FROM`doc_user`t WHERE (SELECT COUNT(*) FROM`do…`     |
| QueryTest22.java#testManyGroupJoin                                   | `SELECT t.`id`,t.`name`,t.`phone`,t.`age`FROM`doc_user` t LEFT JOIN (SELECT t1.`uid`AS`…`     |
| QueryTest22.java#testManyGroupJoin2                                  | `SELECT t.`id`AS`value1`,IFNULL(t3.`**sum2**`,0) AS `value2`,t3.`**min5**`AS`value3` FR…`     |
| QueryTest22.java#testManyGroupJoin2_1                                | `SELECT t.`id`AS`value1`,IFNULL(t3.`**sum2**`,0) AS `value2`,t3.`**min5**`AS`value3` FR…`     |
| QueryTest22.java#testManyGroupJoin2_2                                | `SELECT t.`id`AS`value1`,IFNULL(t5.`**sum2**`,0) AS `value2`,t5.`**min4**`AS`value3` FR…`     |
| QueryTest22.java#testManyGroupJoin3                                  | `SELECT t.`id`AS`value1`,IFNULL(t2.`**count3**`,0) AS `value2`,IFNULL(t2.`**count4**`,0) …`   |
| QueryTest22.java#testManyGroupx                                      | `SELECT t.`id`,t.`name`,t.`phone`,t.`age`FROM`doc_user` t LEFT JOIN (SELECT t1.`uid`AS`…`     |
| QueryTest22.java#testManyJoinCount                                   | `SELECT t.`id`,t.`name`,t.`phone`,t.`age`FROM`doc_user` t LEFT JOIN (SELECT t1.`uid`AS`…`     |
| QueryTest22.java#testManyJoinNone                                    | `SELECT t.`id`,t.`name`,t.`phone`,t.`age`FROM`doc_user` t LEFT JOIN (SELECT t1.`uid`AS`…`     |
| QueryTest22.java#testOrderCountDistinct10                            | `SELECT t.`id`,t.`name`,t.`phone`,t.`age`FROM`doc_user` t LEFT JOIN (SELECT t1.`uid`AS`…`     |
| QueryTest22.java#testOrderCountDistinct12                            | `SELECT t.`id`,t.`name`,t.`phone`,t.`age`FROM`doc_user` t LEFT JOIN (SELECT t1.`uid`AS`…`     |
| QueryTest22.java#testOrderCountDistinct13                            | `SELECT t.`id`,t.`name`,t.`phone`,t.`age`FROM`doc_user` t LEFT JOIN (SELECT t1.`uid`AS`…`     |
| QueryTest22.java#testOrderCountDistinct15                            | `SELECT t.`id`,t.`name`,t.`phone`,t.`age`FROM`doc_user` t LEFT JOIN (SELECT t1.`uid`AS`…`     |
| QueryTest22.java#testOrderCountDistinct2                             | `SELECT t.`id`,t.`name`,t.`phone`,t.`age`FROM`doc_user` t LEFT JOIN (SELECT t1.`uid`AS`…`     |
| QueryTest22.java#testOrderCountDistinct4                             | `SELECT t.`id`,t.`name`,t.`phone`,t.`age`FROM`doc_user` t LEFT JOIN (SELECT t1.`uid`AS`…`     |
| QueryTest22.java#testOrderCountDistinct6                             | `SELECT t.`id`,t.`name`,t.`phone`,t.`age`FROM`doc_user` t LEFT JOIN (SELECT t1.`uid`AS`…`     |
| QueryTest22.java#testOrderCountDistinct7                             | `SELECT t.`id`,t.`name`,t.`phone`,t.`age`FROM`doc_user` t LEFT JOIN (SELECT t1.`uid`AS`…`     |
| QueryTest22.java#testOrderCountDistinct8                             | `SELECT t.`id`,t.`name`,t.`phone`,t.`age`FROM`doc_user` t LEFT JOIN (SELECT t1.`uid`AS`…`     |
| QueryTest22.java#testOrderCountDistinct9                             | `SELECT t.`id`,t.`name`,t.`phone`,t.`age`FROM`doc_user` t LEFT JOIN (SELECT t1.`uid`AS`…`     |
| QueryTest22.java#testSelectAnyElement                                | `SELECT t2.`**joining2**`AS`value1`,t2.`**joining3**`AS`value2`FROM`doc_user` t LEFT …`       |
| QueryTest22.java#testSelectAnyElement3                               | `SELECT t2.`**max2**`AS`value1`,t2.`**min3**`AS`value2`FROM`doc_user` t LEFT JOIN (SE…`       |
| QueryTest23.java#manyJoinMany2Many                                   | `SELECT t.`id`,t.`name`FROM`school_class` t LEFT JOIN (SELECT t2.`class_id`AS`__group_k…`     |
| QueryTest23.java#testElement3                                        | `SELECT t2.`**max2**`AS`value1`,t5.`type`AS`value2`FROM`doc_user` t LEFT JOIN (SELECT…`       |
| QueryTest23.java#testJoin3                                           |                                                                                               |
| QueryTest23.java#testMany2Many2                                      | `SELECT t.`name`AS`value1`,IFNULL(t2.`**count3**`,0) AS `value2`FROM`t_user_account` t …`     |
| QueryTest23.java#testMany2Many2_1                                    | `SELECT t.`name`AS`value1`,IFNULL(t2.`**count3**`,0) AS `value2`FROM`t_user_account` t …`     |

### include 带出导航（`nav.include`，已对应）

| 用例                                                           | 断言的 SQL（摘要）                                                                          |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| DirectRelationTest.java#test                                   | `SELECT `c1`,`c2`,`c3`,`c4`,`c5`FROM`direct1``                                              |
| DirectRelationTest.java#test2                                  | `SELECT `c1`,`c2`,`c3`,`c4`,`c5`FROM`direct1``                                              |
| mysql8/M8CommentTest.java#testPartitionBy                      | `SELECT `id`,`parent_id`,`content`,`username`,`time`FROM`comment``                          |
| mysql8/M8IncludeLimitTest.java#testIncludeLimit                |                                                                                             |
| mysql8/M8IncludeLimitTest.java#testIncludeLimitPagingPartition |                                                                                             |
| mysql8/M8IncludeLimitTest.java#testIncludeLimitPagingUnionAll  |                                                                                             |
| mysql8/M8IncludeOrderTest.java#testOrde2r                      |                                                                                             |
| mysql8/M8IncludeOrderTest.java#testOrder                       |                                                                                             |
| mysql8/M8Test1.java#testRelationColumns1                       | `SELECT `user_id`,`user_name`,`user_age`,`create_time`,`book_ids`FROM`m8_user_book_ids``    |
| mysql8/M8Test1.java#testSelfTargetTypeDiff                     |                                                                                             |
| mysql8/MySQL8Test3.java#testQueryFirstLimit1                   | `SELECT t2.`id`AS`id`,t2.`uid`AS`uid`,t2.`code`AS`code`,t2.`type`AS`type`,t2.`bank_…`       |
| mysql8/MySQL8Test4.java#includeOneTest1                        | `SELECT `id`,`name`,`phone`,`age`,`create_time`FROM`t_sys_user``                            |
| mysql8/MySQL8Test4.java#testAll                                | `SELECT t.`id`,t.`name`,t.`phone`,t.`age`,t.`create_time`FROM`t_sys_user` t WHERE NOT (EX…` |
| mysql8/MySQL8Test4.java#testAll1                               | `SELECT t.`id`,t.`name`,t.`phone`,t.`age`,t.`create_time`FROM`t_sys_user` t WHERE NOT (EX…` |
| mysql8/MySQL8Test4.java#testAll2                               | `SELECT t.`id`,t.`name`,t.`phone`,t.`age`,t.`create_time`FROM`t_sys_user` t WHERE NOT (EX…` |
| mysql8/MySQL8Test4.java#testAllGroupJoin                       | `SELECT t.`id`,t.`name`,t.`phone`,t.`age`,t.`create_time`FROM`t_sys_user` t LEFT JOIN (SE…` |
| mysql8/MySQL8Test4.java#testAllGroupJoin2                      | `SELECT t.`id`,t.`name`,t.`phone`,t.`age`,t.`create_time`FROM`t_sys_user` t LEFT JOIN (SE…` |
| mysql8/MySQL8Test4.java#testIncludeIdOnly1                     | `SELECT `id`,`name`,`phone`,`age`,`create_time`FROM`t_sys_user``                            |
| mysql8/MySQL8Test4.java#testIncludeIdOnly2                     | `SELECT `id`,`name`,`phone`,`age`,`create_time`FROM`t_sys_user``                            |
| mysql8/MySQL8Test5.java#selectJoinInclude                      |                                                                                             |
| pgsql/QueryTest19.java#test                                    |                                                                                             |
| pgsql/QueryTest19.java#testAll                                 | `SELECT t.\`                                                                                |
| pgsql/QueryTest19.java#testAll1                                | `SELECT t.\`                                                                                |
| pgsql/QueryTest19.java#testAll2                                | `SELECT t.\`                                                                                |
| pgsql/QueryTest19.java#testAllGroupJoin                        | `SELECT t.\`                                                                                |
| pgsql/QueryTest19.java#testAllGroupJoin2                       | `SELECT t.\`                                                                                |
| QueryTest18.java#esss                                          |                                                                                             |
| QueryTest18.java#test14                                        | `SELECT COUNT(*) FROM (SELECT DISTINCT t.`id`,t.`stars`,t1.`create_time`FROM`t_topic` t L…` |
| QueryTest2.java#query26                                        |                                                                                             |
| QueryTest28.java#testInterceptor3                              | `SELECT `id`,`name`FROM`m8_interceptor``                                                    |
| RelationNullValueTest.java#one2oneTest                         |                                                                                             |
| RelationTest.java#provinceTest                                 |                                                                                             |
| RelationTest.java#provinceTest1                                |                                                                                             |
| RelationTest.java#provinceTest5                                |                                                                                             |
| RelationTest.java#provinceTest6                                |                                                                                             |
| RelationTest.java#provinceTest61                               |                                                                                             |
| RelationTest.java#provinceTest7                                |                                                                                             |

### 隐式子查询（any / none / count / sum …）（`nav.subquery`，已对应）

| 用例                                                          | 断言的 SQL（摘要）                                                                            |
| ------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| GeneralFunctionsTest.java#countFilterMySQL                    | `SELECT COUNT(t.`id`) AS `value1`,COUNT(DISTINCT t.`title`) AS `value2`,COUNT((CASE WHEN t.…` |
| GeneralFunctionsTest.java#countMSSQL                          | `SELECT COUNT(t.[id]) AS [value1],COUNT(DISTINCT t.[id]) AS [value2] FROM [doc_bank_card] t`  |
| GeneralFunctionsTest.java#countMySQL                          | `SELECT COUNT(t.`id`) AS `value1`,COUNT(DISTINCT t.`id`) AS `value2`FROM`doc_bank_card` t`    |
| GeneralFunctionsTest.java#countORACLE                         | `SELECT COUNT(t.\`                                                                            |
| GeneralFunctionsTest.java#countPGSQL                          | `SELECT COUNT(t.\`                                                                            |
| GeneralFunctionsTest.java#maxMinMSSQL                         | `SELECT MAX(t.[id]) AS [value1],MIN(t.[id]) AS [value2] FROM [doc_bank_card] t`               |
| GeneralFunctionsTest.java#maxMinMySQL                         | `SELECT MAX(t.`id`) AS `value1`,MIN(t.`id`) AS `value2`FROM`doc_bank_card` t`                 |
| GeneralFunctionsTest.java#maxMinORACLE                        | `SELECT MAX(t.\`                                                                              |
| GeneralFunctionsTest.java#maxMinPGSQL                         | `SELECT MAX(t.\`                                                                              |
| GeneralFunctionsTest.java#minMaxFilterMySQL                   | `SELECT MAX(t.`score`) AS `value1`,MAX((CASE WHEN t.`title` <> ? THEN t.`score` ELSE NULL E…` |
| mysql8/M8BankTest.java#fromSubQuery2                          | `SELECT t2.`vo1`AS`vo1`,t2.`vo2`AS`vo2`,t2.`vo3`AS`vo3`,t2.`bank_card_count`AS`bank…`         |
| mysql8/M8BankTest.java#testQueryBankAndCardExplicitCountTest  | `SELECT t.`id`,t.`name`,t.`create_time`,(SELECT COUNT(t1.`id`) FROM `t_bank_card` t1 WHERE …` |
| mysql8/M8BankTest.java#testQueryBankAndCardExplicitCountTest1 | `SELECT t.`id`,t.`name`,t.`create_time`,(SELECT COUNT(t1.`id`) FROM `t_bank_card` t1 WHERE …` |
| mysql8/M8BankTest.java#testQueryBankAndCardImplicitCountTest  | `SELECT t.`id`,t.`name`,t.`create_time`,(SELECT COUNT(*) FROM `t_bank_card` t1 WHERE t1.`ba…` |
| mysql8/M8BankTest.java#testQueryBankAndCardImplicitCountTest1 | `SELECT t.`id`,t.`name`,t.`create_time`,(SELECT COUNT(*) FROM `t_bank_card` t1 WHERE t1.`ba…` |
| mysql8/M8BankTest.java#testUserAutoSubQueryToGroupJoin        | `SELECT t.`id`,t.`name`,t.`phone`,t.`age`,t.`create_time`,IFNULL(t2.`**count2**`,0) AS `__p…` |
| mysql8/M8BankTest.java#testUserAutoSubQueryToGroupJoin1       | `SELECT t.`id`,t.`name`,t.`phone`,t.`age`,t.`create_time`,t2.`**count2**`AS`__part__colum…`   |
| mysql8/M8BankTest.java#whereSubQuery1                         | `SELECT t.`id`,t.`name`,t.`phone`,t.`age`,t.`create_time`FROM`t_sys_user` t WHERE EXISTS(…`   |
| mysql8/M8BankTest.java#whereSubQuery5                         | `SELECT t.`id`,t.`name`,t.`phone`,t.`age`,t.`create_time`FROM`t_sys_user` t WHERE (SELECT…`   |
| mysql8/M8QueryTest.java#whereObject5                          | `SELECT t.`id`,t.`name`,t.`phone`,t.`age`,t.`create_time`FROM`t_sys_user` t LEFT JOIN (SE…`   |
| mysql8/M8Test1.java#testMany                                  |                                                                                               |
| mysql8/M8Test1.java#testRelationColumns                       | `SELECT t.`user_id`,t.`user_name`,t.`user_age`,t.`create_time`,t.`book_ids`FROM`m8_user_b…`   |
| mysql8/ManyJoinTest.java#manyGroupTest1                       |                                                                                               |
| mysql8/ManyJoinTest.java#test10GroupJoinCombine               | `SELECT t.`name`AS`value1`,IFNULL(t2.`**count4**`,0) AS `value2`FROM`t_sys_user` t LEFT…`     |
| mysql8/ManyJoinTest.java#test11GroupJoinCombine               | `SELECT t.`name`AS`value1`,IFNULL(t2.`**count4**`,0) AS `value2`FROM`t_sys_user` t LEFT…`     |
| mysql8/ManyJoinTest.java#test12GroupJoinCombine               | `SELECT t.`name`AS`value1`,IFNULL(t2.`**count4**`,0) AS `value2`FROM`t_sys_user` t LEFT…`     |
| mysql8/ManyJoinTest.java#test13GroupJoinCombine               | `SELECT t.`name`AS`value1`,IFNULL(t2.`**count4**`,0) AS `value2`FROM`t_sys_user` t LEFT…`     |
| mysql8/ManyJoinTest.java#test14GroupJoinCombine               | `SELECT t.`name`AS`value1`FROM`t_sys_user` t LEFT JOIN (SELECT t1.`uid`AS`__group_key…`       |
| mysql8/ManyJoinTest.java#test15GroupJoinCombine               | `SELECT t.`name`AS`value1`FROM`t_sys_user` t LEFT JOIN (SELECT t1.`uid`AS`__group_key…`       |
| mysql8/ManyJoinTest.java#test16GroupJoinCombine               | `SELECT t.`name`AS`value1`FROM`t_sys_user` t LEFT JOIN (SELECT t1.`uid`AS`__group_key…`       |
| mysql8/ManyJoinTest.java#test3GroupJoinCombine                | `SELECT t.`name`AS`value1`,IFNULL(t2.`**count3**`,0) AS `value2`FROM`t_sys_user` t LEFT…`     |
| mysql8/ManyJoinTest.java#test4GroupJoinCombine                | `SELECT t.`name`AS`value1`,IFNULL(t2.`**count3**`,0) AS `value2`FROM`t_sys_user` t LEFT…`     |
| mysql8/ManyJoinTest.java#test5GroupJoinCombine                | `SELECT t.`name`AS`value1`,IFNULL(t2.`**count3**`,0) AS `value2`FROM`t_sys_user` t LEFT…`     |
| mysql8/ManyJoinTest.java#test6GroupJoinCombine                | `SELECT t.`name`AS`value1`,IFNULL(t3.`**count3**`,0) AS `value2`FROM`t_sys_user` t LEFT…`     |
| mysql8/ManyJoinTest.java#test7GroupJoinCombine                | `SELECT t.`name`AS`value1`,IFNULL(t2.`**count3**`,0) AS `value2`FROM`t_sys_user` t LEFT…`     |
| mysql8/ManyJoinTest.java#test8GroupJoinCombine                | `SELECT t.`name`AS`value1`,IFNULL(t2.`**count3**`,0) AS `value2`FROM`t_sys_user` t LEFT…`     |
| mysql8/ManyJoinTest.java#test9GroupJoinCombine                | `SELECT t.`name`AS`value1`,IFNULL(t2.`**count3**`,0) AS `value2`FROM`t_sys_user` t LEFT…`     |
| mysql8/ManyJoinTest.java#testGroupJoinCombine                 | `SELECT t.`name`AS`value1`,IFNULL(t2.`**count3**`,0) AS `value2`FROM`t_sys_user` t LEFT…`     |
| mysql8/ManyJoinTest.java#testMany2Many2GroupJoin3             | `SELECT t.`id`,t.`name`,t.`age`,t.`create_time`FROM`m8_user` t LEFT JOIN (SELECT t2.`user…`   |
| mysql8/MySQL8Test2.java#testAA                                |                                                                                               |
| mysql8/MySQL8Test3.java#testDTO1                              |                                                                                               |
| mysql8/MySQL8Test4.java#testPartition2                        | `SELECT t.`id`AS`id`,t.`name`AS`name`,t5.`type`AS`third_card_type`,t5.`code`AS`thir…`         |
| mysql8/MySQL8Test4.java#testPartition3                        | `SELECT t.`id`AS`id`,t.`name`AS`name`,t5.`type`AS`third_card_type`,t5.`code`AS`thir…`         |
| mysql8/MySQL8Test4.java#testSubQueryCountCompareNull1         | `SELECT t.`id`,t.`name`,t.`phone`,t.`age`,t.`create_time`FROM`t_sys_user` t WHERE (SELECT…`   |
| NumberFunctionsTest.java#avgMSSQL                             | `SELECT AVG(t.[score]) AS [value1],AVG(DISTINCT t.[score]) AS [value2],AVG(DISTINCT (CASE W…` |
| NumberFunctionsTest.java#avgMySQL                             | `SELECT AVG(t.`score`) AS `value1`,AVG(DISTINCT t.`score`) AS `value2`,AVG(DISTINCT (CASE W…` |
| NumberFunctionsTest.java#avgORACLE                            | `SELECT AVG(t.\`                                                                              |
| NumberFunctionsTest.java#avgPGSQL                             | `SELECT AVG(t.\`                                                                              |
| NumberFunctionsTest.java#sumMSSQL                             | `SELECT SUM(t.[score]) AS [value1],SUM(DISTINCT t.[score]) AS [value2],SUM(DISTINCT t.[scor…` |
| NumberFunctionsTest.java#sumMySQL                             | `SELECT SUM(t.`score`) AS `value1`,SUM(DISTINCT t.`score`) AS `value2`,SUM(DISTINCT t.`scor…` |
| NumberFunctionsTest.java#sumORACLE                            | `SELECT SUM(t.\`                                                                              |
| NumberFunctionsTest.java#sumPGSQL                             | `SELECT SUM(t.\`                                                                              |
| QueryTest.java#query61                                        |                                                                                               |
| QueryTest.java#query63                                        | `SELECT t.`id`,t.`stars`,t.`title`,t.`create_time`,(SELECT COUNT(t1.`id`) FROM `t_blog` t1 …` |
| QueryTest.java#query63_1                                      | `SELECT t.`id`,t.`stars`,t.`title`,t.`create_time`,(SELECT SUM(t1.`star`) FROM `t_blog` t1 …` |
| QueryTest.java#query64                                        | `SELECT t.`id`,t.`stars`,t.`title`,(SELECT COUNT(t1.`id`) FROM `t_blog` t1 WHERE t1.`delete…` |
| QueryTest11.java#testx5                                       | `SELECT t.`id`,t.`stars`,t.`title`,t.`create_time`,(SELECT SUM(t1.`star`) FROM `t_blog` t1 …` |
| QueryTest12.java#testAny1                                     | `SELECT 1 FROM `t_topic`WHERE`title`= ? ORDER BY CASE WHEN`id` IS NULL THEN 1 ELSE 0 EN…`     |
| QueryTest12.java#testDoc1                                     | `SELECT t.`id`,t.`name`FROM`school_class`t WHERE EXISTS(SELECT 1 FROM`school_student` t…`     |
| QueryTest12.java#testDoc10                                    | `SELECT t.`id`,t.`create_time`,t.`username`,t.`phone`,t.`id_card`,t.`address`FROM`easy-qu…`   |
| QueryTest12.java#testDoc16                                    | `SELECT t.`id`,t.`name`FROM`relation_user`t WHERE EXISTS(SELECT 1 FROM`relation_book` t…`     |
| QueryTest12.java#testDoc17                                    | `SELECT t.`id`,t.`name`FROM`relation_user`t WHERE EXISTS(SELECT 1 FROM`relation_teacher…`     |
| QueryTest12.java#testDoc2                                     | `SELECT t.`id`,t.`name`FROM`school_class`t WHERE NOT (EXISTS(SELECT 1 FROM`school_stude…`     |
| QueryTest12.java#testDoc22                                    | `SELECT t.`id`,t.`name`FROM`relation_user`t WHERE EXISTS(SELECT 1 FROM`relation_teacher…`     |
| QueryTest12.java#testDoc3                                     | `SELECT t.`id`,t.`name`FROM`school_class`t WHERE EXISTS(SELECT 1 FROM`school_student` t…`     |
| QueryTest12.java#testDoc4                                     | `SELECT t.`id`,t.`name`FROM`school_class`t WHERE (SELECT COUNT(*) FROM`school_student` …`     |
| QueryTest12.java#testDoc5                                     | `SELECT t.`id`,t.`name`FROM`school_class`t WHERE EXISTS(SELECT 1 FROM`school_teacher` t…`     |
| QueryTest12.java#testDoc6                                     | `SELECT t.`id`,t.`name`FROM`school_class`t WHERE EXISTS(SELECT 1 FROM`school_teacher` t…`     |
| QueryTest12.java#testDoc7                                     | `SELECT t.`id`,t.`create_time`,t.`update_time`,t.`create_by`,t.`update_by`,t.`deleted`,t.`t…` |
| QueryTest12.java#testDoc8                                     | `SELECT t.`id`,t.`create_time`,t.`update_time`,t.`create_by`,t.`update_by`,t.`deleted`,t.`t…` |
| QueryTest12.java#testDoc9                                     | `SELECT t.`id`,t.`create_time`,t.`username`,t.`phone`,t.`id_card`,t.`address`FROM`easy-qu…`   |
| QueryTest12.java#testNum2                                     | `SELECT (SUM(t.`score`) - SUM(t.`score`)) AS `score`FROM`t_blog` t WHERE t.`deleted` = ?`     |
| QueryTest12.java#testNum3                                     | `SELECT (SUM(t.`score`) - SUM(t.`score`)) FROM `t_blog` t WHERE t.`deleted` = ?`              |
| QueryTest16.java#docSub                                       | `SELECT t.`id`AS`value1`,(NOT (EXISTS(SELECT 1 FROM `t_user` t1 WHERE t1.`company_id` = t…`   |
| QueryTest16.java#test19                                       | `SELECT t.`id`,t.`company_id`,t.`name`,t.`age`,t.`create_time`FROM`t_user` t WHERE EXISTS…`   |
| QueryTest16.java#test20                                       | `SELECT t.`id`,t.`company_id`,t.`name`,t.`age`,t.`create_time`FROM`t_user`t LEFT JOIN`t…`     |
| QueryTest16.java#testSubSum                                   | `SELECT t1.`id`AS`value1`,IFNULL((SELECT SUM(t2.`age`) FROM `t_user` t2 WHERE t2.`company…`   |
| QueryTest16.java#testSubSumOracle                             | `SELECT t1.\`                                                                                 |
| QueryTest17.java#testFlatElement5                             | `SELECT t.`id`,t.`f1`,t.`f2`,t.`parent_id`FROM`MyObject`t LEFT JOIN`MyObjectParent` t1 …`     |
| QueryTest18.java#testCount                                    |                                                                                               |
| QueryTest18.java#testSubCountLimitSelect1                     | `SELECT t1.`id`AS`value1`,t1.`phone`AS`value2`,(SELECT COUNT(*) FROM `t_blog` t2 WHERE …`     |
| QueryTest18.java#testSubCountPage1                            | `SELECT COUNT(*) FROM `easy-query-test`.`t_sys_user`WHERE`phone` <> ?`                        |
| QueryTest18.java#textDistinct1                                | `SELECT DISTINCT COUNT(*) FROM `t_topic``                                                     |
| QueryTest19.java#test1_1                                      | `SELECT t.`id`,t.`company_id`,t.`name`,t.`age`,t.`create_time`FROM`t_user` t WHERE t.`nam…`   |
| QueryTest19.java#test1_2                                      | `SELECT t.`id`,t.`company_id`,t.`name`,t.`age`,t.`create_time`FROM`t_user` t WHERE t.`nam…`   |
| QueryTest19.java#test122                                      |                                                                                               |
| QueryTest21.java#subNumberRangeClosed                         | `SELECT t.`id`,t.`name`,t.`phone`,t.`age`FROM`doc_user`t WHERE ((SELECT COUNT(*) FROM`d…`     |
| QueryTest21.java#subNumberRangeClosed1                        | `SELECT t.`id`,t.`name`,t.`phone`,t.`age`FROM`doc_user`t WHERE (SELECT COUNT(*) FROM`do…`     |
| QueryTest21.java#testDistinctCount                            | `SELECT COUNT(DISTINCT t.`id`) FROM `t_blog` t WHERE t.`deleted` = ? AND t.`title` LIKE ?`    |
| QueryTest21.java#testDistinctCount1                           | `SELECT COUNT(DISTINCT t.`id`) FROM `t_blog` t WHERE t.`deleted` = ? AND t.`title` LIKE ?`    |
| QueryTest22.java#testManyGroup29                              |                                                                                               |
| QueryTest22.java#testOrderCountDistinct1                      | `SELECT t.`id`,t.`name`,t.`phone`,t.`age`FROM`doc_user` t ORDER BY IFNULL((SELECT SUM((SE…`   |
| QueryTest22.java#testOrderCountDistinct11                     | `SELECT t.`id`,t.`name`,t.`phone`,t.`age`FROM`doc_user` t WHERE (SELECT MAX(t1.`type`) FR…`   |
| QueryTest22.java#testOrderCountDistinct14                     | `SELECT t.`id`,t.`name`,t.`phone`,t.`age`FROM`doc_user` t WHERE (SELECT MIN(t1.`type`) FR…`   |
| QueryTest22.java#testOrderCountDistinct3                      | `SELECT t.`id`,t.`name`,t.`phone`,t.`age`FROM`doc_user` t ORDER BY (SELECT COUNT(DISTINCT…`   |
| QueryTest22.java#testOrderCountDistinct5                      | `SELECT t.`id`,t.`name`,t.`phone`,t.`age`FROM`doc_user` t ORDER BY IFNULL((SELECT SUM(DIS…`   |
| QueryTest22.java#testOrderCountDistinct6_1                    | `SELECT t.`id`,t.`name`,t.`phone`,t.`age`FROM`doc_user` t LEFT JOIN (SELECT t1.`uid`AS`…`     |
| QueryTest23.java#anyTest                                      | `SELECT (SELECT MAX(t2.`type`) FROM `doc_bank_card` t2 WHERE t2.`uid` = t.`id` AND t.`name`…` |
| QueryTest23.java#filterOn3                                    | `SELECT COUNT(*) FROM `doc_bank_card`t INNER JOIN`doc_bank` t1 ON t1.`id` = t.`bank_id` A…`   |
| QueryTest23.java#testJoin2                                    |                                                                                               |
| QueryTest23.java#testMany2Many                                | `SELECT t.`name`AS`value1`,(SELECT COUNT(*) FROM `t_user_book` t2 WHERE t2.`uid` = t.`uid…`   |
| QueryTest24.java#testSubCount                                 | `SELECT t.`id`,t.`create_time`,t.`title`,IFNULL(t2.`**count2**`,0) AS `stars`FROM`t_blog`…`   |
| QueryTest24.java#testx14                                      | `SELECT MAX(t.`topic_type`) FROM `t_topic_type` t LIMIT 1`                                    |
| QueryTest24.java#testx15                                      | `SELECT MIN(t.`topic_type`) FROM `t_topic_type` t LIMIT 1`                                    |
| QueryTest27.java#autoMergeMany2Many1                          | `SELECT t.`station_id`,t.`station_name`FROM`t_station` t LEFT JOIN (SELECT t2.`station_id…`   |
| QueryTest27.java#autoMergeMany2Many2                          | `SELECT t.`station_id`,t.`station_name`FROM`t_station` t LEFT JOIN (SELECT t2.`station_id…`   |
| QueryTest27.java#testCountSubQueryCount                       | `SELECT t.`id`,t.`create_time`,t.`update_time`,t.`create_by`,t.`update_by`,t.`deleted`,t.`t…` |
| QueryTest28.java#testInterceptor2                             | `SELECT t.`id`,t.`name`FROM`m8_interceptor`t WHERE EXISTS(SELECT 1 FROM`m8_interceptor2…`     |
| QueryTest3.java#nativePage2                                   | `SELECT COUNT(*) FROM (select * from t_topicxx) t`                                            |
| QueryTest4.java#query1233                                     | `SELECT t.`id`,t.`stars`,t.`title`,t.`create_time`FROM`t_topic` t WHERE t.`create_time` =…`   |
| QueryTest5.java#joinTest1                                     | `SELECT t.`id`,COUNT(t.`id`) AS `stars`FROM`t_topic`t LEFT JOIN`t_topic` t1 ON t.`id` =…`     |
| QueryTest5.java#joinTest2                                     | `SELECT t.`id`,COUNT(t.`id`) AS `stars`FROM`t_topic`t LEFT JOIN`t_topic` t1 ON t.`id` =…`     |
| QueryTest5.java#joinTest3                                     | `SELECT t.`id`,COUNT(t.`id`) AS `stars`FROM`t_topic`t LEFT JOIN`t_topic` t1 ON t.`id` =…`     |
| QueryTest5.java#joinTest4                                     | `SELECT t.`id`,COUNT(t.`id`) AS `stars`FROM`t_topic`t LEFT JOIN`t_topic` t1 ON t.`id` =…`     |
| QueryTest5.java#joinTest5                                     | `SELECT t.`id`,COUNT(t.`id`) AS `stars`FROM`t_topic`t LEFT JOIN`t_topic` t1 ON t.`id` =…`     |
| QueryTest5.java#joinTest6                                     | `SELECT t.`id`,COUNT(t.`id`) AS `stars`FROM`t_topic`t LEFT JOIN`t_topic` t1 ON t.`id` =…`     |
| QueryTest5.java#joinTest7                                     | `SELECT t.`id`,COUNT(t.`id`) AS `stars`FROM`t_topic`t LEFT JOIN`t_topic` t1 ON t.`id` =…`     |
| Relation2Test.java#test10                                     | `SELECT t.`id`,t.`name`FROM`my_school_class` t WHERE (SELECT MAX(t1.`name`) FROM `my_scho…`   |
| Relation2Test.java#test10_1                                   | `SELECT t.`id`,t.`name`FROM`my_school_class` t WHERE (SELECT MAX(t1.`name`) FROM `my_scho…`   |
| Relation2Test.java#test5                                      | `SELECT t.`id`,t.`name`FROM`my_school_class`t WHERE (SELECT COUNT(*) FROM`my_school_stu…`     |
| Relation2Test.java#test6                                      | `SELECT t.`id`,t.`name`FROM`my_school_class`t WHERE EXISTS(SELECT 1 FROM`my_school_stud…`     |
| Relation2Test.java#test8                                      | `SELECT t.`id`,t.`name`FROM`my_school_class` t WHERE IFNULL((SELECT AVG(CAST(t1.`name` AS…`   |
| RelationTest.java#schoolTest1                                 | `SELECT t.`id`,t.`name`FROM`school_class`t WHERE EXISTS(SELECT 1 FROM`school_student` t…`     |
| RelationTest.java#schoolTest3                                 | `SELECT t.`id`,t.`name`FROM`school_class`t WHERE EXISTS(SELECT 1 FROM`school_student` t…`     |
| RelationTest.java#schoolTest4                                 | `SELECT t.`id`,t.`name`FROM`school_class`t WHERE EXISTS(SELECT 1 FROM`school_student` t…`     |
| RelationTest.java#schoolTest5                                 | `SELECT t.`id`,t.`name`FROM`school_class`t WHERE EXISTS(SELECT 1 FROM`school_student` t…`     |
| RelationTest.java#schoolTest6                                 | `SELECT t.`id`,t.`name`FROM`school_class`t WHERE EXISTS(SELECT 1 FROM`school_teacher` t…`     |
| RelationTest.java#schoolTest7                                 | `SELECT t.`id`,t.`name`FROM`school_class`t WHERE (SELECT COUNT(*) FROM`school_student` …`     |
| RelationTest.java#schoolTest8                                 | `SELECT t.`id`,t.`name`FROM`school_class`t WHERE NOT (EXISTS(SELECT 1 FROM`school_stude…`     |
| RelationTest.java#schoolTest8_1                               | `SELECT t.`id`,t.`name`FROM`school_class`t WHERE EXISTS(SELECT 1 FROM`school_student` t…`     |
| SubJoinTest.java#testSubJoinAvg                               | `SELECT IFNULL((SELECT AVG(t2.`age`) FROM `sub_join_book`t1 LEFT JOIN`sub_join_author` t2…`   |
| SubJoinTest.java#testSubJoinAvg2                              | `SELECT IFNULL((SELECT AVG(t2.`age`) FROM `sub_join_book`t1 LEFT JOIN`sub_join_author` t2…`   |
| SubJoinTest.java#testSubJoinAvgDistinct                       | `SELECT IFNULL((SELECT AVG(DISTINCT t2.`age`) FROM `sub_join_book`t1 LEFT JOIN`sub_join_a…`   |
| SubJoinTest.java#testSubJoinAvgDistinct2                      | `SELECT IFNULL((SELECT AVG(DISTINCT t2.`age`) FROM `sub_join_book`t1 LEFT JOIN`sub_join_a…`   |
| SubJoinTest.java#testSubJoinMax                               | `SELECT (SELECT MAX(t2.`age`) FROM `sub_join_book`t1 LEFT JOIN`sub_join_author` t2 ON t2.…`   |
| SubJoinTest.java#testSubJoinMax2                              | `SELECT (SELECT MAX(t2.`age`) FROM `sub_join_book`t1 LEFT JOIN`sub_join_author` t2 ON t2.…`   |
| SubJoinTest.java#testSubJoinMin                               | `SELECT (SELECT MIN(t2.`age`) FROM `sub_join_book`t1 LEFT JOIN`sub_join_author` t2 ON t2.…`   |
| SubJoinTest.java#testSubJoinMin2                              | `SELECT (SELECT MIN(t2.`age`) FROM `sub_join_book`t1 LEFT JOIN`sub_join_author` t2 ON t2.…`   |
| SubJoinTest.java#testSubJoinSum                               | `SELECT IFNULL((SELECT SUM(t2.`age`) FROM `sub_join_book`t1 LEFT JOIN`sub_join_author` t2…`   |
| SubJoinTest.java#testSubJoinSum2                              | `SELECT IFNULL((SELECT SUM(t2.`age`) FROM `sub_join_book`t1 LEFT JOIN`sub_join_author` t2…`   |
| SubJoinTest.java#testSubJoinSumDistinct                       | `SELECT IFNULL((SELECT SUM(DISTINCT t2.`age`) FROM `sub_join_book`t1 LEFT JOIN`sub_join_a…`   |
| SubJoinTest.java#testSubJoinSumDistinct2                      | `SELECT IFNULL((SELECT SUM(DISTINCT t2.`age`) FROM `sub_join_book`t1 LEFT JOIN`sub_join_a…`   |

### 基本查询（条件、排序、选列、分页）（`query.basic`，已对应）

| 用例                                                          | 断言的 SQL（摘要）                                                                            |
| ------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| DateTimeFunctionsTest.java#booleanMySQL                       | `SELECT t.`deleted`AS`value1`,(NOT (t.`deleted`)) AS `value2`FROM`t_blog` t WHERE t.`de…`     |
| DateTimeFunctionsTest.java#dateTimeProp2MySQL                 | `SELECT t.`create_time`AS`value1`,YEAR(t.`create_time`) AS `value2`,MONTH(t.`create_time`…`   |
| DateTimeFunctionsTest.java#dateTimePropMySQL                  | `SELECT t.`create_time`AS`value1`,YEAR(t.`create_time`) AS `value2`,MONTH(t.`create_time`…`   |
| DirectRelationTest.java#test3                                 | `SELECT t.`c1`,t.`c2`,t.`c3`,t.`c4`,t.`c5`FROM`direct1`t LEFT JOIN`direct2` t1 ON t1.`c…`     |
| DirectRelationTest.java#testJoin1                             | `SELECT t3.`c18`AS`value1`FROM`direct1`t LEFT JOIN`direct2` t1 ON t1.`c7` = t.`c1` LE…`       |
| doc/DocTest.java#testDoc3x                                    |                                                                                               |
| doc/DocTest1.java#test1                                       | `SELECT `id`,`create_time`,`update_time`,`create_by`,`update_by`,`deleted`,`title`,`content…` |
| doc/DocTest1.java#test2                                       | `SELECT `id`,`create_time`,`update_time`,`create_by`,`update_by`,`deleted`,`title`,`content…` |
| doc/DocTest1.java#testBlog4                                   | `SELECT t1.`name`AS`value1`,t3.`name`AS`value2`FROM`test_self`t LEFT JOIN`my_user` …`         |
| EntityQueryAggregateTest1.java#test1                          | `SELECT SUM(t.`stars`) FROM `t_topic`t LEFT JOIN`t_topic` t1 ON t.`id` = t1.`id` LEFT JOI…`   |
| EntityQueryAggregateTest1.java#test2                          | `SELECT SUM(t.`stars`) FROM `t_topic`t LEFT JOIN`t_topic` t1 ON t.`id` = t1.`id` LEFT JOI…`   |
| EntityQueryAggregateTest1.java#test3                          | `SELECT SUM(t.`stars`) FROM `t_topic`t LEFT JOIN`t_topic` t1 ON t.`id` = t1.`id` LEFT JOI…`   |
| EntityQueryAggregateTest1.java#test4                          | `SELECT SUM(t.`stars`) FROM `t_topic`t LEFT JOIN`t_topic` t1 ON t.`id` = t1.`id` LEFT JOI…`   |
| EntityQueryAggregateTest1.java#test5                          | `SELECT SUM(t.`stars`) FROM `t_topic`t LEFT JOIN`t_topic` t1 ON t.`id` = t1.`id` LEFT JOI…`   |
| EntityQueryAggregateTest1.java#test6                          | `SELECT SUM(t.`stars`) FROM `t_topic`t LEFT JOIN`t_topic` t1 ON t.`id` = t1.`id` LEFT JOI…`   |
| EntityQueryAggregateTest1.java#test7                          | `SELECT SUM(t.`stars`) FROM `t_topic`t LEFT JOIN`t_topic` t1 ON t.`id` = t1.`id` LEFT JOI…`   |
| EntityQueryAggregateTest1.java#test8                          | `SELECT SUM(t.`stars`) FROM `t_topic`t LEFT JOIN`t_topic` t1 ON t.`id` = t1.`id` LEFT JOI…`   |
| EntityQueryAggregateTest1.java#test9                          | `SELECT SUM(t.`stars`) FROM `t_topic`t LEFT JOIN`t_topic` t1 ON t.`id` = t1.`id``             |
| EntityQueryAggregateTest3.java#test1                          | `SELECT SUM(t.`stars`) FROM `t_topic`t LEFT JOIN`t_topic` t1 ON t.`id` = t1.`id` LEFT JOI…`   |
| EntityQueryAggregateTest3.java#test10                         | `SELECT SUM(t.`stars`) FROM `t_topic` t`                                                      |
| EntityQueryAggregateTest3.java#test2                          | `SELECT SUM(t.`stars`) FROM `t_topic`t LEFT JOIN`t_topic` t1 ON t.`id` = t1.`id` LEFT JOI…`   |
| EntityQueryAggregateTest3.java#test3                          | `SELECT SUM(t.`stars`) FROM `t_topic`t LEFT JOIN`t_topic` t1 ON t.`id` = t1.`id` LEFT JOI…`   |
| EntityQueryAggregateTest3.java#test4                          | `SELECT SUM(t.`stars`) FROM `t_topic`t LEFT JOIN`t_topic` t1 ON t.`id` = t1.`id` LEFT JOI…`   |
| EntityQueryAggregateTest3.java#test5                          | `SELECT SUM(t.`stars`) FROM `t_topic`t LEFT JOIN`t_topic` t1 ON t.`id` = t1.`id` LEFT JOI…`   |
| EntityQueryAggregateTest3.java#test6                          | `SELECT SUM(t.`stars`) FROM `t_topic`t LEFT JOIN`t_topic` t1 ON t.`id` = t1.`id` LEFT JOI…`   |
| EntityQueryAggregateTest3.java#test7                          | `SELECT SUM(t.`stars`) FROM `t_topic`t LEFT JOIN`t_topic` t1 ON t.`id` = t1.`id` LEFT JOI…`   |
| EntityQueryAggregateTest3.java#test8                          | `SELECT SUM(t.`stars`) FROM `t_topic`t LEFT JOIN`t_topic` t1 ON t.`id` = t1.`id` LEFT JOI…`   |
| EntityQueryAggregateTest3.java#test9                          | `SELECT SUM(t.`stars`) FROM `t_topic`t LEFT JOIN`t_topic` t1 ON t.`id` = t1.`id``             |
| EntityQueryAggregateTest4.java#test1                          | `SELECT t.`id`,t.`stars`,t.`title`,t.`create_time`FROM`t_topic`t LEFT JOIN`t_topic` t1 …`     |
| EntityQueryAggregateTest4.java#test2                          | `SELECT t.`id`,t.`stars`,t.`title`,t.`create_time`FROM`t_topic`t LEFT JOIN`t_topic` t1 …`     |
| EntityQueryAggregateTest4.java#test3                          | `SELECT t.`id`,t.`stars`,t.`title`,t.`create_time`FROM`t_topic`t LEFT JOIN`t_topic` t1 …`     |
| EntityQueryAggregateTest4.java#test4                          | `SELECT t.`id`,t.`stars`,t.`title`,t.`create_time`FROM`t_topic`t LEFT JOIN`t_topic` t1 …`     |
| EntityQueryAggregateTest4.java#test5                          | `SELECT t.`id`,t.`stars`,t.`title`,t.`create_time`FROM`t_topic`t LEFT JOIN`t_topic` t1 …`     |
| EntityQueryAggregateTest4.java#test6                          | `SELECT t.`id`,t.`stars`,t.`title`,t.`create_time`FROM`t_topic`t LEFT JOIN`t_topic` t1 …`     |
| EntityQueryAggregateTest4.java#test7                          | `SELECT t.`id`,t.`stars`,t.`title`,t.`create_time`FROM`t_topic`t LEFT JOIN`t_topic` t1 …`     |
| EntityQueryAggregateTest4.java#test8                          | `SELECT t.`id`,t.`stars`,t.`title`,t.`create_time`FROM`t_topic`t LEFT JOIN`t_topic` t1 …`     |
| EntityQueryAggregateTest4.java#test9                          | `SELECT t.`id`,t.`stars`,t.`title`,t.`create_time`FROM`t_topic`t LEFT JOIN`t_topic` t1 …`     |
| EntityQueryAggregateTest7.java#test1                          | `SELECT t.`id`AS`value1`,t.`stars`AS`value2`,t.`create_time`AS`value3`FROM`t_topic`…`         |
| EntityQueryAggregateTest7.java#test10                         | `SELECT DISTINCT t.`id`AS`value1`,t.`stars`AS`value2`,t.`create_time`AS`value3` FROM …`       |
| EntityQueryAggregateTest7.java#test2                          | `SELECT t.`id`AS`value1`,t.`stars`AS`value2`,t.`create_time`AS`value3`FROM`t_topic`…`         |
| EntityQueryAggregateTest7.java#test3                          | `SELECT DISTINCT t.`id`AS`value1`,t.`stars`AS`value2`,t.`create_time`AS`value3` FROM …`       |
| EntityQueryAggregateTest7.java#test4                          | `SELECT DISTINCT t.`id`AS`value1`,t.`stars`AS`value2`,t.`create_time`AS`value3` FROM …`       |
| EntityQueryAggregateTest7.java#test5                          | `SELECT DISTINCT t.`id`AS`value1`,t.`stars`AS`value2`,t.`create_time`AS`value3` FROM …`       |
| EntityQueryAggregateTest7.java#test6                          | `SELECT DISTINCT t.`id`AS`value1`,t.`stars`AS`value2`,t.`create_time`AS`value3` FROM …`       |
| EntityQueryAggregateTest7.java#test7                          | `SELECT DISTINCT t.`id`AS`value1`,t.`stars`AS`value2`,t.`create_time`AS`value3` FROM …`       |
| EntityQueryAggregateTest7.java#test8                          | `SELECT DISTINCT t.`id`AS`value1`,t.`stars`AS`value2`,t.`create_time`AS`value3` FROM …`       |
| EntityQueryAggregateTest7.java#test9                          | `SELECT DISTINCT t.`id`AS`value1`,t.`stars`AS`value2`,t.`create_time`AS`value3` FROM …`       |
| GeneralFunctionsTest.java#likeOracle                          | `SELECT \`                                                                                    |
| GeneralFunctionsTest.java#likeOracle2                         | `SELECT \`                                                                                    |
| GeneralFunctionsTest.java#likeOracle3                         | `SELECT \`                                                                                    |
| GeneralFunctionsTest.java#likePgSQL                           | `SELECT \`                                                                                    |
| GeneralFunctionsTest.java#likePgSQL2                          | `SELECT \`                                                                                    |
| GeneralFunctionsTest.java#likePgSQL3                          | `SELECT \`                                                                                    |
| GeneralFunctionsTest.java#likeSQLite                          | `SELECT \`                                                                                    |
| GeneralFunctionsTest.java#likeSQLite2                         | `SELECT \`                                                                                    |
| GeneralFunctionsTest.java#likeSQLite3                         | `SELECT \`                                                                                    |
| GenericTest2.java#testAgroalGetUrl                            |                                                                                               |
| InjectTest.java#injectTest1                                   |                                                                                               |
| InjectTest.java#injectTest2                                   |                                                                                               |
| InjectTest.java#injectTest3                                   |                                                                                               |
| InsertTest1.java#testColumnConfigure                          |                                                                                               |
| mysql8/CTETest.java#cteTest3                                  | `WITH `m8_user_temp` AS (SELECT t.`id`,t.`name`FROM`m8_user` t WHERE t.`age` IS NULL) SEL…`   |
| mysql8/IncludeConditionTest.java#testInclude1                 | `SELECT `id`,`name`,`version`FROM`my_task``                                                   |
| mysql8/IncludeConditionTest.java#testInclude2                 | `SELECT `id`,`name`,`version`FROM`my_task`WHERE`id` = ?`                                      |
| mysql8/M8BankTest.java#dynamicPartition                       |                                                                                               |
| mysql8/M8BankTest.java#fromSubQuery1                          | `SELECT t1.`value1`AS`value1`,t1.`value2`AS`value2`,t1.`value3`AS`value3` FROM (SELEC…`       |
| mysql8/M8BankTest.java#includeSubQuery2                       | `SELECT t.`name`AS`vo1`,t.`id`AS`vo2`,t.`phone`AS`vo3`,t.`id`AS`__relation__id` FRO…`         |
| mysql8/M8BankTest.java#includeSubQuery3                       | `SELECT t.`name`AS`vo1`,t.`id`AS`vo2`,t.`phone`AS`vo3`,t.`id`AS`__relation__id` FRO…`         |
| mysql8/M8BankTest.java#includeSubQuery5                       | `SELECT t.`id`,t.`name`,t.`phone`,t.`age`,t.`create_time`FROM`t_sys_user` t`                  |
| mysql8/M8BankTest.java#test1                                  | `SELECT t.`id`,t.`uid`,t.`code`,t.`type`,t.`bank_id`,t.`open_time`FROM`t_bank_card` t LEF…`   |
| mysql8/M8BankTest.java#test2                                  | `SELECT t.`id`,t.`uid`,t.`code`,t.`type`,t.`bank_id`,t.`open_time`FROM`t_bank_card` t LEF…`   |
| mysql8/M8BankTest.java#test3                                  | `SELECT t1.`name`AS`value1`,t2.`name`AS`value2`,t.`code`AS`value3`FROM`t_bank_card`…`         |
| mysql8/M8BankTest.java#test6                                  | `SELECT t.`id`,t.`name`,t.`phone`,t.`age`,t.`create_time`FROM`t_sys_user` t LEFT JOIN (SE…`   |
| mysql8/M8BankTest.java#testFirst                              | `SELECT t.`id`,t.`name`,t.`phone`,t.`age`,t.`create_time`,t3.`code`AS`__part__column1` FR…`   |
| mysql8/M8BankTest.java#testFirst2                             | `SELECT t.`name`AS`value1`,t3.`code`AS`value2`FROM`t_sys_user` t LEFT JOIN (SELECT t1…`       |
| mysql8/M8BankTest.java#testFirstElementInnerJoin              | `SELECT t.`id`,t.`name`,t.`phone`,t.`age`,t.`create_time`FROM`t_sys_user` t INNER JOIN (S…`   |
| mysql8/M8BankTest.java#testQueryBankAndCardImplicitCountTest4 | `SELECT t.`name`AS`value1`,t3.`code`AS`value2`,t4.`name`AS`value3`FROM`t_sys_user` …`         |
| mysql8/M8BankTest.java#testUserAutoSubQueryToGroupJoin2       | `SELECT t.`id`,t.`name`,t.`phone`,t.`age`,t.`create_time`FROM`t_sys_user` t LEFT JOIN (SE…`   |
| mysql8/M8BankTest.java#whereSubQuery6                         | `SELECT t.`id`,t.`name`,t.`phone`,t.`age`,t.`create_time`FROM`t_sys_user` t WHERE (SELECT…`   |
| mysql8/M8BankTest.java#whereSubQuery6_1                       | `SELECT t.`id`,t.`name`,t.`phone`,t.`age`,t.`create_time`FROM`t_sys_user` t WHERE (SELECT…`   |
| mysql8/M8BankTest.java#whereSubQuery7                         | `SELECT t.`id`,t.`name`,t.`phone`,t.`age`,t.`create_time`FROM`t_sys_user` t WHERE ? = (SE…`   |
| mysql8/M8Save2Test.java#testInsert                            |                                                                                               |
| mysql8/M8Save3Test.java#testForeach                           | `SELECT `id`,`name`FROM`m8_save_a`WHERE`id` = ?`                                              |
| mysql8/M8SaveTest.java#testInsert                             |                                                                                               |
| mysql8/M8Test1.java#testQuery                                 | `SELECT t.`uid`,t.`code`,t.`type`,t.`bank_id`,t.`open_time`,t1.`name`AS`__part__column1` …`   |
| mysql8/M8Test1.java#testQuery2                                | `SELECT t.`id`,t.`uid`,t.`code`,t.`type`,t.`bank_id`,t.`open_time`,t1.`name`AS`__part__co…`   |
| mysql8/M8Test1.java#userTest                                  | `SELECT `id`,`sex`,`age`,`user_name`FROM`m8_user_test`WHERE`id` >= ? AND (`sex` = ? OR …`     |
| mysql8/ManyJoinTest.java#manyJoinMany2Many9                   | `SELECT t.`user_id`,t.`user_name`,t.`user_age`,t.`create_time`FROM`m8_user2` t LEFT JOIN …`   |
| mysql8/ManyJoinTest.java#partitionByFirst                     | `SELECT t.`id`,t.`name`,t.`age`,t.`create_time`FROM`m8_user` t LEFT JOIN (SELECT t2.`user…`   |
| mysql8/ManyJoinTest.java#partitionByFirst2                    | `SELECT t.`id`,t.`name`,t.`age`,t.`create_time`FROM`m8_user` t LEFT JOIN (SELECT t2.`user…`   |
| mysql8/ManyJoinTest.java#testElement4                         | `SELECT t.`id`,t.`name`,t.`phone`,t.`age`FROM`doc_user` t LEFT JOIN (SELECT t1.`id`,t1.`u…`   |
| mysql8/ManyJoinTest.java#testLastCard                         |                                                                                               |
| mysql8/MySQL8Test2.java#testJoin                              | `SELECT t.`id`,t.`uid`,t.`code`,t.`type`,t.`bank_id`,t.`open_time`FROM`t_bank_card` t INN…`   |
| mysql8/MySQL8Test2.java#testOrderCaseWhen1                    | `SELECT t.`id`,t.`name`,t.`phone`,t.`age`,t.`create_time`FROM`t_sys_user` t LEFT JOIN (SE…`   |
| mysql8/MySQL8Test2.java#testOrderCaseWhen2                    | `SELECT t.`id`,t.`name`,t.`phone`,t.`age`,t.`create_time`FROM`t_sys_user` t LEFT JOIN (SE…`   |
| mysql8/MySQL8Test2.java#testParentNull                        | `SELECT t.`id`,t.`uid`,t.`code`,t.`type`,t.`bank_id`,t.`open_time`FROM`t_bank_card` t INN…`   |
| mysql8/MySQL8Test3.java#testQueryFirstLimit3                  | `SELECT t.`id`,t.`name`,t.`phone`,t.`age`,t.`create_time`FROM`t_sys_user` t LEFT JOIN (SE…`   |
| mysql8/MySQL8Test3.java#testQueryFirstLimit4                  | `SELECT t.`id`,t.`name`,t.`phone`,t.`age`,t.`create_time`FROM`t_sys_user` t LEFT JOIN (SE…`   |
| mysql8/MySQL8Test4.java#includeOneTest2                       | `SELECT `id`,`name`,`phone`,`age`,`create_time`FROM`t_sys_user``                              |
| mysql8/MySQL8Test4.java#testAll4                              | `SELECT t.`id`,t.`name`,t.`phone`,t.`age`,t.`create_time`FROM`t_sys_user` t WHERE (EXISTS…`   |
| mysql8/MySQL8Test4.java#testAll5                              | `SELECT t.`id`,t.`name`,t.`phone`,t.`age`,t.`create_time`FROM`t_sys_user` t LEFT JOIN (SE…`   |
| mysql8/MySQL8Test4.java#testPartition                         | `SELECT t.`id`AS`value1`,t.`name`AS`value2`,t3.`code`AS`value3`,t3.`type`AS`value4`…`         |
| mysql8/MySQL8Test4.java#testSelect                            | `SELECT t1.`id`,t1.`phone`AS`phone`,t1.`age` FROM (SELECT t.`id`,t.`name`AS`phone`,t.`a…`     |
| mysql8/MySQL8Test4.java#testSelect1                           | `SELECT t1.`id`,t1.`phone`AS`phone`,t1.`age` FROM (SELECT t.`id`,t.`name`AS`phone`,t.`a…`     |
| mysql8/MySQL8Test4.java#testTimeAfterNull1                    | `SELECT `id`,`name`,`phone`,`age`,`create_time`FROM`t_sys_user`WHERE`create_time` > ?`        |
| mysql8/MySQL8Test4.java#testTimeBeforeNull1                   | `SELECT `id`,`name`,`phone`,`age`,`create_time`FROM`t_sys_user`WHERE`create_time` < ?`        |
| mysql8/MySQL8Test5.java#configurationLogicDelete              | `SELECT `id`,`name`,`deleted`FROM`my_config_logic`WHERE`deleted` = ?`                         |
| mysql8/MySQL8Test5.java#interceptorTest1                      | `SELECT `id`,`name`,`age`,`create_time`FROM`m8_user` WHERE 1=1`                               |
| mysql8/MySQL8Test5.java#interceptorTest2                      | `SELECT `id`,`name`,`age`,`create_time`FROM`m8_user` WHERE 1=1`                               |
| mysql8/MySQL8Test5.java#interceptorTest3                      | `SELECT `id`,`name`,`age`,`create_time`FROM`m8_user` WHERE 1=1`                               |
| mysql8/MySQL8Test5.java#interceptorTest4                      | `SELECT `id`,`name`,`age`,`create_time`FROM`m8_user``                                         |
| mysql8/MySQL8Test5.java#interceptorTest5                      | `SELECT `id`,`name`,`age`,`create_time`FROM`m8_user``                                         |
| mysql8/MySQL8Test5.java#interceptorTest6                      | `SELECT `id`,`name`,`age`,`create_time`FROM`m8_user``                                         |
| MyTest1.java#testDraft3                                       | `SELECT date_add(t.`create_time`, interval (?) day) AS `value1`FROM`t_blog` t WHERE t.`de…`   |
| MyTest1.java#testSelect1                                      | `SELECT ? AS `title`,t.`title`AS`id`FROM`t_topic` t WHERE t.`title` IS NOT NULL`              |
| MyTest1.java#testSelect10                                     | `SELECT t.`id`,t.`stars`,t.`title`,t.`create_time`,(SELECT COUNT(*) FROM `t_blog` t1 WHERE …` |
| MyTest1.java#testSelect2                                      | `SELECT t.`title`AS`id`,1+1+t.`stars`AS`title`FROM`t_topic` t WHERE t.`title` IS NOT …`       |
| MyTest1.java#testSelect8                                      | `SELECT t.`title`FROM`t_topic` t WHERE t.`title` IS NOT NULL AND t.`create_time` <= ?`        |
| MyTest2.java#testSelect1                                      | `SELECT ? AS `title`,t.`title`AS`id`FROM`t_topic` t WHERE t.`title` IS NOT NULL`              |
| MyTest2.java#testSelect10                                     | `SELECT t.`id`,t.`stars`,t.`title`,t.`create_time`,(SELECT COUNT(*) FROM `t_blog` t1 WHERE …` |
| MyTest2.java#testSelect2                                      | `SELECT t.`title`AS`id`,1+1+t.`stars`AS`title`FROM`t_topic` t WHERE t.`title` IS NOT …`       |
| MyTest2.java#testSelect8                                      | `SELECT t.`title`FROM`t_topic` t WHERE t.`title` IS NOT NULL AND t.`create_time` <= ?`        |
| MyTest2.java#testTuple3                                       | `SELECT date_add(t.`create_time`, interval (?) day) AS `value1`FROM`t_blog` t WHERE t.`de…`   |
| NumberFunctionsTest.java#addMSSQL                             | `SELECT (t.[score] + ?) AS [value1],(t.[score] + ?) AS [value2],(t.[score] + ?) AS [value3]…` |
| NumberFunctionsTest.java#addMySQL                             | `SELECT (t.`score`+ ?) AS`value1`,(t.`score`+ ?) AS`value2`,(t.`score`+ ?) AS`value3`…`       |
| NumberFunctionsTest.java#addORACLE                            | `SELECT (t.\`                                                                                 |
| NumberFunctionsTest.java#addPGSQL                             | `SELECT (t.\`                                                                                 |
| NumberFunctionsTest.java#divideMSSQL                          | `SELECT (t.[score] / ?) AS [value1],(t.[score] / t.[score]) AS [value2] FROM [t_blog] t WHE…` |
| NumberFunctionsTest.java#divideMySQL                          | `SELECT (t.`score`/ ?) AS`value1`,(t.`score` / t.`score`) AS `value2`FROM`t_blog` t WHE…`     |
| NumberFunctionsTest.java#divideORACLE                         | `SELECT (t.\`                                                                                 |
| NumberFunctionsTest.java#dividePGSQL                          | `SELECT (t.\`                                                                                 |
| NumberFunctionsTest.java#multiplyMSSQL                        | `SELECT (t.[score] * ?) AS [value1],(t.[score] * t.[score]) AS [value2] FROM [t_blog] t WHE…` |
| NumberFunctionsTest.java#multiplyMySQL                        | `SELECT (t.`score`* ?) AS`value1`,(t.`score` * t.`score`) AS `value2`FROM`t_blog` t WHE…`     |
| NumberFunctionsTest.java#multiplyORACLE                       | `SELECT (t.\`                                                                                 |
| NumberFunctionsTest.java#multiplyPGSQL                        | `SELECT (t.\`                                                                                 |
| NumberFunctionsTest.java#subtractMSSQL                        | `SELECT (t.[score] - ?) AS [value1],(t.[score] - ?) AS [value2],(t.[score] - ?) AS [value3]…` |
| NumberFunctionsTest.java#subtractMySQL                        | `SELECT (t.`score`- ?) AS`value1`,(t.`score`- ?) AS`value2`,(t.`score`- ?) AS`value3`…`       |
| NumberFunctionsTest.java#subtractORACLE                       | `SELECT (t.\`                                                                                 |
| NumberFunctionsTest.java#subtractPGSQL                        | `SELECT (t.\`                                                                                 |
| pgsql/NamedEnumTest.java#test1                                | `SELECT \`                                                                                    |
| pgsql/QueryTest.java#query1                                   | `SELECT \`                                                                                    |
| pgsql/QueryTest.java#query2                                   | `SELECT \`                                                                                    |
| pgsql/QueryTest.java#query3                                   | `SELECT 1 FROM \`                                                                             |
| pgsql/QueryTest.java#query4                                   | `SELECT 1 as id FROM \`                                                                       |
| pgsql/QueryTest.java#query5                                   | `SELECT \`                                                                                    |
| pgsql/QueryTest.java#query6                                   | `SELECT \`                                                                                    |
| pgsql/QueryTest.java#query8                                   | `SELECT CONCAT(t.\`                                                                           |
| pgsql/QueryTest.java#query9                                   | `SELECT CONCAT(t.\`                                                                           |
| pgsql/QueryTest19.java#testMapChain                           | `SELECT t1.\`                                                                                 |
| pgsql/QueryTest19.java#testMapChain2                          | `SELECT t1.\`                                                                                 |
| QueryTest.java#query0                                         | `SELECT `id`,`create_time`,`username`,`phone`,`id_card`,`address`FROM`easy-query-test`.`t…`   |
| QueryTest.java#query0_1                                       | `SELECT x.`id`,x.`create_time`,x.`username`,x.`phone`,x.`id_card`,x.`address`FROM`easy-qu…`   |
| QueryTest.java#query0_2                                       | `SELECT `id`,`create_time`,`username`,`phone`,`id_card`,`address`FROM`easy-query-test`.`t…`   |
| QueryTest.java#query1                                         | `SELECT x.`id`,x.`create_time`,x.`update_time`,x.`create_by`,x.`update_by`,x.`deleted`,x.`t…` |
| QueryTest.java#query100                                       |                                                                                               |
| QueryTest.java#query101                                       |                                                                                               |
| QueryTest.java#query101_1                                     |                                                                                               |
| QueryTest.java#query102                                       |                                                                                               |
| QueryTest.java#query102_2                                     |                                                                                               |
| QueryTest.java#query108                                       |                                                                                               |
| QueryTest.java#query2                                         | `SELECT `id`,`create_time`,`update_time`,`create_by`,`update_by`,`deleted`,`title`,`content…` |
| QueryTest.java#query27                                        | `SELECT t.`title`,t.`content`,t.`url`,t.`star`,t.`publish_time`,t.`score`,t.`status`,t.`ord…` |
| QueryTest.java#query3                                         | `SELECT 1 FROM `t_blog`WHERE`deleted`= ? AND`id` = ? LIMIT 1`                                 |
| QueryTest.java#query30                                        | `SELECT * FROM `t_blog` t`                                                                    |
| QueryTest.java#query31                                        | `SELECT * FROM `t_blog` t`                                                                    |
| QueryTest.java#query37                                        |                                                                                               |
| QueryTest.java#query38                                        |                                                                                               |
| QueryTest.java#query39                                        | `SELECT t.`url`AS`my_url`FROM`t_blog` t WHERE t.`deleted` = ?`                                |
| QueryTest.java#query4                                         | `SELECT 1 as id FROM `t_blog`WHERE`deleted`= ? AND`id` = ? LIMIT 1`                           |
| QueryTest.java#query42                                        | `SELECT `id`,`create_time`,`update_time`,`create_by`,`update_by`,`deleted`,`title`,`content…` |
| QueryTest.java#query45                                        | `SELECT t.`id`,t.`stars`,t.`title`,t.`create_time`FROM`t_topic` t WHERE EXISTS(SELECT 1 F…`   |
| QueryTest.java#query46                                        | `SELECT t.`id`,t.`stars`,t.`title`,t.`create_time`FROM`t_topic` t WHERE NOT EXISTS(SELECT…`   |
| QueryTest.java#query47                                        | `SELECT `id`,`create_time`,`update_time`,`create_by`,`update_by`,`deleted`,`title`,`content…` |
| QueryTest.java#query48                                        |                                                                                               |
| QueryTest.java#query49                                        |                                                                                               |
| QueryTest.java#query5                                         | `SELECT `id`,`create_time`,`update_time`,`create_by`,`update_by`,`deleted`,`title`,`content…` |
| QueryTest.java#query5_1                                       | `SELECT `id`,`create_time`,`update_time`,`create_by`,`update_by`,`deleted`,`title`,`content…` |
| QueryTest.java#query5_2                                       | `SELECT `id`,`create_time`,`update_time`,`create_by`,`update_by`,`deleted`,`title`,`content…` |
| QueryTest.java#query51                                        | `SELECT DISTINCT t.`id`FROM`t_topic` t WHERE t.`id` IS NOT NULL`                              |
| QueryTest.java#query58                                        | `SELECT t.`id`,t.`stars`,t.`title`,t.`create_time`FROM`t_topic` t WHERE t.`id` IN (SELECT…`   |
| QueryTest.java#query59                                        |                                                                                               |
| QueryTest.java#query6                                         | `SELECT `id`,`create_time`,`update_time`,`create_by`,`update_by`,`deleted`,`title`,`content…` |
| QueryTest.java#query60                                        |                                                                                               |
| QueryTest.java#query72                                        | `SELECT t.`score`,t.`status`AS`status1`,t.`order`,t.`is_top`,t.`top`FROM`t_blog` t WHER…`     |
| QueryTest.java#query73                                        | `SELECT t.`score`,t.`status`AS`status1`,t.`order`,t.`is_top`,t.`top`FROM`t_blog` t WHER…`     |
| QueryTest.java#query74                                        | `SELECT t.`score`,t.`status`AS`status1`,t.`order`,t.`is_top`,t.`top`FROM`t_blog` t WHER…`     |
| QueryTest.java#query75                                        | `SELECT t.`order`AS`score`FROM`t_blog` t WHERE t.`deleted` = ? AND t.`id` = ? LIMIT 1`        |
| QueryTest.java#query76                                        | `SELECT t.`status`AS`status1`,t.`order`,t.`is_top`,t.`top`FROM`t_blog` t WHERE t.`delet…`     |
| QueryTest.java#query8                                         | `SELECT `id`,`stars`,`title`,`create_time`FROM`t_topic` LIMIT 1`                              |
| QueryTest.java#query82                                        | `SELECT `id`,`create_time`,`username`,`phone`,`id_card`,`address`FROM`easy-query-test`.`t…`   |
| QueryTest.java#query83                                        | `SELECT `id`,`create_time`,`username`,`phone`,`id_card`,`address`FROM`easy-query-test`.`t…`   |
| QueryTest.java#query83_1                                      | `SELECT `id`,`create_time`,`username`,`phone`,`id_card`,`address`FROM`easy-query-test`.`t…`   |
| QueryTest.java#query84                                        | `SELECT `id`,`create_time`,`username`,`phone`,`id_card`,`address`FROM`easy-query-test`.`t…`   |
| QueryTest.java#query85                                        | `SELECT `id`,`create_time`,`username`,`phone`,`id_card`,`address`FROM`easy-query-test`.`t…`   |
| QueryTest.java#query86                                        | `SELECT `id`,`create_time`,`username`,`phone`,`id_card`,`address`FROM`easy-query-test`.`t…`   |
| QueryTest.java#query87                                        | `SELECT `id`,`create_time`,`username`,`phone`,`id_card`,`address`FROM`easy-query-test`.`t…`   |
| QueryTest.java#query88                                        | `SELECT `id`,`create_time`,`username`,`phone`,`id_card`,`address`FROM`easy-query-test`.`t…`   |
| QueryTest.java#query88_1                                      | `SELECT `id`,`create_time`,`username`,`phone`,`id_card`,`address`FROM`easy-query-test`.`t…`   |
| QueryTest.java#query9                                         |                                                                                               |
| QueryTest.java#query90_1                                      |                                                                                               |
| QueryTest.java#query92                                        |                                                                                               |
| QueryTest.java#query93                                        |                                                                                               |
| QueryTest.java#query94                                        |                                                                                               |
| QueryTest.java#query95                                        |                                                                                               |
| QueryTest.java#query96                                        |                                                                                               |
| QueryTest.java#query97                                        |                                                                                               |
| QueryTest.java#query98                                        |                                                                                               |
| QueryTest10.java#test223                                      | `SELECT `id`,`stars`,`title`,`create_time`FROM`t_topic`WHERE`title` <> ? AND (`title` =…`     |
| QueryTest11.java#testOrder2                                   | `SELECT `id`,`stars`,`title`,`topic_type`,`create_time`FROM`t_topic_type`WHERE`topic_ty…`     |
| QueryTest11.java#testOrder3                                   | `SELECT t.`id`AS`id`,t.`title`AS`name`FROM`t_topic_type` t WHERE t.`topic_type` LIKE …`       |
| QueryTest11.java#testx10                                      | `SELECT t.`id`,t.`stars`,t.`title`,t.`create_time`FROM`t_topic` t WHERE t.`id` NOT IN (SE…`   |
| QueryTest11.java#testx11                                      | `SELECT t.`id`,t.`stars`,t.`title`,t.`topic_type`,t.`create_time`FROM`t_topic_type` t WHE…`   |
| QueryTest11.java#testx12                                      | `SELECT CAST(t.`topic_type`AS SIGNED) FROM`t_topic_type` t`                                   |
| QueryTest11.java#testx12_1                                    | `SELECT CAST(t.`topic_type`AS SIGNED) FROM`t_topic_type` t LIMIT 1`                           |
| QueryTest11.java#testx13                                      | `SELECT `id`,`stars`,`title`,`topic_type`,`create_time`FROM`t_topic_type`WHERE`topic_ty…`     |
| QueryTest11.java#testx2                                       | `SELECT t.`order`AS`score`FROM`t_blog` t WHERE t.`deleted` = ? AND t.`id` = ? LIMIT 1`        |
| QueryTest11.java#testx22                                      | `SELECT `id`,`create_time`,`update_time`,`create_by`,`update_by`,`deleted`,`title`,`content…` |
| QueryTest11.java#testx23                                      | `SELECT t.`id`AS`value1`,t.`url`AS`value2`FROM`t_blog` t WHERE t.`deleted` = ? AND ? …`       |
| QueryTest11.java#testx24                                      | `SELECT t.`id`AS`value1`,t.`url`AS`value2`,(SELECT COUNT(*) FROM `t_topic` t1 WHERE t1.…`     |
| QueryTest11.java#testx3                                       | `SELECT `id`,`create_time`,`update_time`,`create_by`,`update_by`,`deleted`,`title`,`content…` |
| QueryTest11.java#testx4                                       | `SELECT t.`id`,t.`stars`,t.`title`,t.`create_time`,(SELECT COUNT(*) FROM `t_blog` t1 WHERE …` |
| QueryTest11.java#testx6                                       | `SELECT t.`id`,t.`stars`,t.`title`,t.`create_time`FROM`t_topic` t WHERE EXISTS(SELECT 1 F…`   |
| QueryTest11.java#testx7                                       | `SELECT t.`id`,t.`stars`,t.`title`,t.`create_time`FROM`t_topic` t WHERE NOT EXISTS(SELECT…`   |
| QueryTest11.java#testx8                                       | `SELECT t.`id`,t.`stars`,t.`title`,t.`create_time`FROM`t_topic` t WHERE t.`id` IN (SELECT…`   |
| QueryTest12.java#testDoc11                                    | `SELECT t.`id`,t.`create_time`,t.`username`,t.`phone`,t.`id_card`,t.`address`FROM`easy-qu…`   |
| QueryTest12.java#testDoc12                                    | `SELECT t.`id`,t.`create_time`,t.`update_time`,t.`create_by`,t.`update_by`,t.`deleted`,t.`t…` |
| QueryTest12.java#testDoc13                                    | `SELECT t.`id`,t.`create_time`,t.`update_time`,t.`create_by`,t.`update_by`,t.`deleted`,t.`t…` |
| QueryTest12.java#testDoc14                                    | `SELECT `id`,`create_time`,`update_time`,`create_by`,`update_by`,`deleted`,`title`,`content…` |
| QueryTest12.java#testDoc18                                    | `SELECT `id`,`create_time`,`username`,`phone`,`id_card`,`address`FROM`easy-query-test`.`t…`   |
| QueryTest12.java#testDoc20                                    | `SELECT `id`,`create_time`,`username`,`phone`,`id_card`,`address`FROM`easy-query-test`.`t…`   |
| QueryTest12.java#testDraft23                                  |                                                                                               |
| QueryTest12.java#testFetchSub2                                | `SELECT t.`id`,t.`class_id`,t.`name`,t1.`id`,t1.`name`,t2.`address`FROM`my_school_student…`   |
| QueryTest12.java#testFetchSub3                                | `SELECT t.`id`,t.`class_id`,t.`name`,t1.`id`,t1.`name`,t2.`address`FROM`my_school_student…`   |
| QueryTest12.java#testNum4                                     | `SELECT ((t.`star` * t.`score`) + t.`score`) FROM `t_blog` t WHERE t.`deleted` = ?`           |
| QueryTest12.java#testNum5                                     | `SELECT ((t.`star` * t.`score`) + ?) FROM `t_blog` t WHERE t.`deleted` = ?`                   |
| QueryTest12.java#testOr26                                     | `SELECT `id`,`create_time`,`update_time`,`create_by`,`update_by`,`deleted`,`title`,`content…` |
| QueryTest13.java#orderTest2                                   | `SELECT t.`id`AS`blogId`,t.`create_time`AS`dateTime`FROM`t_blog` t WHERE t.`deleted` …`       |
| QueryTest14.java#test111                                      |                                                                                               |
| QueryTest15.java#test1                                        | `SELECT `id`,`first_name`,`last_name`,`birthday`,CONCAT(`first_name`,`last_name`) AS `full_…` |
| QueryTest15.java#test1_1                                      | `SELECT t.`id`,t.`name`,(SELECT COUNT(t1.`id`) AS `id`FROM`school_student` t1 WHERE t1.`c…`   |
| QueryTest15.java#test12234                                    |                                                                                               |
| QueryTest15.java#test7                                        | `SELECT `id`,`stars`,`title`,`create_time`FROM`t_topic`WHERE`create_time` = ?`                |
| QueryTest15.java#testCaseSubAggregate                         | `SELECT `id`,`name`FROM`school_class``                                                        |
| QueryTest15.java#testColumn1                                  | `SELECT t.`create_time`FROM`t_topic` t`                                                       |
| QueryTest15.java#testColumn2                                  | `SELECT t.`stars`FROM`t_topic` t LIMIT 1`                                                     |
| QueryTest15.java#testSimple                                   | `SELECT `id`,`first_name`,`last_name`,`birthday`,CONCAT(`first_name`,`last_name`) AS `full_…` |
| QueryTest15.java#testSubqueryAnonymous                        | `SELECT t3.`a`AS`a`,t3.`b`AS`b`,t3.`sc`AS`sc` FROM (SELECT t.`id`AS`a`,t.`name` AS …`         |
| QueryTest16.java#test14                                       | `SELECT t.`id`,t.`company_id`,t.`name`,t.`age`,t.`create_time`FROM`t_user`t LEFT JOIN`t…`     |
| QueryTest16.java#test8                                        | `SELECT `id`,`create_time`,`update_time`,`create_by`,`update_by`,`deleted`,`title`,`content…` |
| QueryTest17.java#test11                                       | `SELECT t.`id`,t.`title`FROM`t_topic` t WHERE t.`title` = ?`                                  |
| QueryTest17.java#testNopQuery                                 |                                                                                               |
| QueryTest17.java#testSubFrom                                  |                                                                                               |
| QueryTest17.java#testSubFrom1                                 |                                                                                               |
| QueryTest17.java#testxxx9                                     |                                                                                               |
| QueryTest17.java#xxx                                          |                                                                                               |
| QueryTest18.java#andTest                                      |                                                                                               |
| QueryTest18.java#autoFalse                                    |                                                                                               |
| QueryTest18.java#test1                                        | `SELECT `id`,`stars`,`title`,`create_time`FROM`t_topic`WHERE`id` IS NULL`                     |
| QueryTest18.java#test125                                      | `SELECT `id`,`create_time`,`update_time`,`create_by`,`update_by`,`deleted`,`title`,`content…` |
| QueryTest18.java#test2                                        | `SELECT `id`,`stars`,`title`,`create_time`FROM`t_topic`WHERE`id` IS NULL`                     |
| QueryTest18.java#test8                                        |                                                                                               |
| QueryTest18.java#testDraft                                    |                                                                                               |
| QueryTest18.java#testEnum                                     |                                                                                               |
| QueryTest18.java#testFETCHER                                  | `SELECT t.`id`,t.`stars`FROM`t_topic` t WHERE t.`id` = ?`                                     |
| QueryTest18.java#testFinal                                    | `SELECT a.`id`,a.`create_time`,a.`update_time`,a.`create_by`,a.`update_by`,a.`deleted`,a.`t…` |
| QueryTest18.java#testMaxEnum                                  | `SELECT MAX(t.`topic_type`) FROM `t_topic_type` t`                                            |
| QueryTest18.java#testPartition1                               |                                                                                               |
| QueryTest18.java#testResultSizeLimit1                         |                                                                                               |
| QueryTest18.java#testStarStr                                  | `SELECT `id`,`create_time`,`update_time`,`create_by`,`update_by`,`deleted`,`title`,`star`,C…` |
| QueryTest19.java#aaa                                          |                                                                                               |
| QueryTest19.java#aaa1                                         | `SELECT `id`,`name`,`age`FROM`a`.`dbo`.`my_user``                                             |
| QueryTest19.java#testConcat                                   |                                                                                               |
| QueryTest19.java#testTime                                     | `SELECT t.`create_time`FROM`t_topic` t WHERE t.`id` = ?`                                      |
| QueryTest19.java#testTime1                                    | `SELECT ? FROM `t_topic` t WHERE t.`id` = ?`                                                  |
| QueryTest2.java#groupTest10                                   | `SELECT `id`,`create_time`,`update_time`,`create_by`,`update_by`,`deleted`,`title`,`content…` |
| QueryTest2.java#groupTest10_1                                 | `SELECT `id`,`create_time`,`update_time`,`create_by`,`update_by`,`deleted`,`title`,`content…` |
| QueryTest2.java#groupTest11                                   | `SELECT `id`,`create_time`,`update_time`,`create_by`,`update_by`,`deleted`,`title`,`content…` |
| QueryTest2.java#groupTest12                                   | `SELECT `id`,`create_time`,`update_time`,`create_by`,`update_by`,`deleted`,`title`,`content…` |
| QueryTest2.java#groupTest13                                   | `SELECT `id`,`create_time`,`update_time`,`create_by`,`update_by`,`deleted`,`title`,`content…` |
| QueryTest2.java#groupTest9                                    | `SELECT `id`,`create_time`,`update_time`,`create_by`,`update_by`,`deleted`,`title`,`content…` |
| QueryTest2.java#query1232                                     | `SELECT t.`id`,t.`stars`,t.`title`,t.`create_time`FROM`t_topic` t WHERE t.`create_time` =…`   |
| QueryTest2.java#query13x                                      | `SELECT `id`,`create_time`,`username`,`phone`,`id_card`,`address`FROM`easy-query-test`.`t…`   |
| QueryTest2.java#query143x                                     | `SELECT `id`,`create_time`,`username`,`phone`,`id_card`,`address`FROM`easy-query-test`.`t…`   |
| QueryTest2.java#query14x                                      | `SELECT `id`,`create_time`,`username`,`phone`,`id_card`,`address`FROM`easy-query-test`.`t…`   |
| QueryTest2.java#queryMultiFrom1                               | `SELECT t.`id`,t.`stars`,t.`title`,t.`create_time`FROM`t_topic`t ,`t_topic` t1 WHERE t.…`     |
| QueryTest20.java#testFullSingleAllColumns                     | `SELECT `id`,`create_time`,`update_time`,`create_by`,`update_by`,`deleted`,`title`,`content…` |
| QueryTest20.java#testFullSingleAllColumns1                    | `SELECT t.`id`,t.`create_time`,t.`update_time`,t.`create_by`,t.`update_by`,t.`deleted`,t.`t…` |
| QueryTest20.java#testFullSingleAllColumns2                    | `SELECT t.`id`,t.`create_time`,t.`update_time`,t.`create_by`,t.`update_by`,t.`deleted`,t.`t…` |
| QueryTest20.java#testFullSingleAllColumns3                    | `SELECT t.`id`,t.`create_time`,t.`update_time`,t.`create_by`,t.`update_by`,t.`deleted`,t.`t…` |
| QueryTest20.java#testFullSingleColumns1                       | `SELECT t.`id`FROM`t_blog` t WHERE t.`deleted` = ? AND t.`content` LIKE ? AND t.`title` =…`   |
| QueryTest20.java#testFullSingleColumns2                       | `SELECT t.`id`FROM`t_blog` t WHERE t.`deleted` = ? AND t.`content` LIKE ? AND t.`title` =…`   |
| QueryTest20.java#testFullSingleSomeColumns1                   | `SELECT t.`id`,t.`star`,t.`status`FROM`t_blog` t WHERE t.`deleted` = ? AND t.`content` LI…`   |
| QueryTest20.java#testFullSingleSomeColumns2                   | `SELECT t.`id`,t.`create_time`,t.`update_time`,t.`create_by`,t.`update_by`,t.`deleted`,t.`c…` |
| QueryTest20.java#testFullSingleSomeColumns3                   | `SELECT t.`id`AS`id`,t.`title`AS`title`,t.`star`AS`star`FROM`t_blog` t WHERE t.`del…`         |
| QueryTest20.java#testWhere1                                   | `SELECT `id`,`create_time`,`update_time`,`create_by`,`update_by`,`deleted`,`title`,`content…` |
| QueryTest20.java#testWhere2                                   | `SELECT `id`,`stars`,`title`,`create_time`FROM`t_topic`WHERE`title`LIKE ? AND`stars` …`       |
| QueryTest21.java#joinOrderTest                                | `SELECT t.`id`,t.`uid`,t.`code`,t.`type`,t.`bank_id`FROM`doc_bank_card`t LEFT JOIN`doc_…`     |
| QueryTest21.java#testOrderBy                                  | `SELECT t.`id`,t.`uid`,t.`code`,t.`type`,t.`bank_id`FROM`doc_bank_card`t LEFT JOIN`doc_…`     |
| QueryTest21.java#testOrderBy3                                 | `SELECT t.`id`,t.`uid`,t.`code`,t.`type`,t.`bank_id`FROM`doc_bank_card`t LEFT JOIN`doc_…`     |
| QueryTest22.java#testAdd                                      | `SELECT MAX((t.`star`+ ?)) FROM`t_blog` t WHERE t.`deleted` = ?`                              |
| QueryTest22.java#testBigDecimal                               | `SELECT t.`score`FROM`t_blog` t WHERE t.`deleted` = ?`                                        |
| QueryTest23.java#filterOn1                                    | `SELECT t.`id`,t.`uid`,t.`code`,t.`type`,t.`bank_id`FROM`doc_bank_card`t INNER JOIN`doc…`     |
| QueryTest23.java#filterOn2                                    | `SELECT t.`id`,t.`uid`,t.`code`,t.`type`,t.`bank_id`FROM`doc_bank_card` t`                    |
| QueryTest23.java#filterOn5                                    | `SELECT t.`id`,t.`uid`,t.`code`,t.`type`,t.`bank_id`FROM`doc_bank_card`t INNER JOIN`doc…`     |
| QueryTest23.java#testaaa                                      |                                                                                               |
| QueryTest23.java#testAddMulty                                 | `SELECT ((t.`order` + t.`star`) / t.`score`) AS `value1`FROM`t_blog` t WHERE t.`deleted` …`   |
| QueryTest23.java#testJoin                                     |                                                                                               |
| QueryTest23.java#testJoin1                                    |                                                                                               |
| QueryTest23.java#testJoin4                                    |                                                                                               |
| QueryTest23.java#testLt                                       | `SELECT `id`,`create_time`,`update_time`,`create_by`,`update_by`,`deleted`,`title`,`content…` |
| QueryTest23.java#testOrderSQL                                 | `SELECT `id`,`create_time`,`update_time`,`create_by`,`update_by`,`deleted`,`title`,`content…` |
| QueryTest23.java#testPageDistinct2                            | `SELECT DISTINCT t.`code`AS`value1`,t1.`name`AS`value2`FROM`doc_bank_card` t LEFT JOI…`       |
| QueryTest24.java#test11                                       | `SELECT `id`,`create_time`,`update_time`,`create_by`,`update_by`,`deleted`,`title`,`content…` |
| QueryTest24.java#test12                                       | `SELECT `id`,`create_time`,`update_time`,`create_by`,`update_by`,`deleted`,`title`,`content…` |
| QueryTest24.java#testEnum                                     | `SELECT t.`topic_type`AS`topic_type`FROM`t_topic_type` t`                                     |
| QueryTest24.java#testx13                                      | `SELECT t.`topic_type`FROM`t_topic_type` t LIMIT 1`                                           |
| QueryTest24.java#testx16                                      | `SELECT `id`,`stars`,`title`,`topic_type`,`create_time`FROM`t_topic_type`WHERE`id` = ?`       |
| QueryTest24.java#testx17                                      | `SELECT `id`,`create_time`,`update_time`,`create_by`,`update_by`,`deleted`,`title`,`content…` |
| QueryTest25.java#test11                                       |                                                                                               |
| QueryTest25.java#test11a1                                     | `SELECT `id`,`stars`,`title`,`create_time`FROM`t_topic`WHERE`id` IN (?)`                      |
| QueryTest25.java#testList                                     |                                                                                               |
| QueryTest25.java#testMap                                      | `SELECT t1.`aa`AS`aa`,t1.`bb`AS`bb` FROM (SELECT t.`id`AS`aa`,t.`star`AS`bb`FROM`…`           |
| QueryTest25.java#testMap1                                     | `SELECT t1.`aa`AS`aa`,t1.`bb`AS`bb` FROM (SELECT t.`id`AS`aa`,t.`star`AS`bb`FROM`…`           |
| QueryTest25.java#testOnlyIgnore                               | `SELECT t.`stars`,t.`title`,t.`create_time`FROM`t_topic` t`                                   |
| QueryTest25.java#testOnlyIgnore2                              | `SELECT t.`stars`,t.`title`,t.`create_time`FROM`t_topic` t`                                   |
| QueryTest25.java#testOnlyIgnore3                              | `SELECT t.`id`,t.`stars`,t.`title`,t.`create_time`FROM`t_topic` t`                            |
| QueryTest25.java#topicIntegerTest                             |                                                                                               |
| QueryTest25.java#tupleTest7                                   | `SELECT t.`id`AS`value1`,t.`create_time`AS`value2`FROM`t_blog` t WHERE t.`deleted` = …`       |
| QueryTest26.java#switchCase                                   | `SELECT `id`,`create_time`,`update_time`,`create_by`,`update_by`,`deleted`,`title`,`content…` |
| QueryTest26.java#test11                                       | `SELECT t.`id`,t.`uid`,t.`code`,t.`type`,t.`bank_id`,t.`open_time`FROM`t_bank_card` t INN…`   |
| QueryTest26.java#test22                                       | `SELECT t.`id`,t.`uid`,t.`code`,t.`type`,t.`bank_id`,t.`open_time`FROM`t_bank_card` t INN…`   |
| QueryTest26.java#testaa1                                      | `SELECT t.`id`AS`title`,t.`title`AS`id`FROM`t_topic` t WHERE t.`id` IS NOT NULL`              |
| QueryTest26.java#testFindInSet                                | `SELECT t.`id`,t.`create_time`,t.`update_time`,t.`create_by`,t.`update_by`,t.`deleted`,t.`t…` |
| QueryTest26.java#testMaxInCaluse                              | `SELECT \`                                                                                    |
| QueryTest26.java#testQuery                                    | `SELECT `id`,`name`,AES_DECRYPT(from_base64(`phone`),?) AS `phone`FROM`sys_user2` WHERE A…`   |
| QueryTest26.java#testSetConstant                              |                                                                                               |
| QueryTest27.java#selectAllMap                                 | `SELECT t.`id`AS`id`,t.`create_time`AS`createTime`,t.`update_time`AS`updateTime`,t.`c…`       |
| QueryTest27.java#staticTestCustomFunction                     | `SELECT `id`,`create_time`,`update_time`,`create_by`,`update_by`,`deleted`,`title`,`content…` |
| QueryTest27.java#staticTestCustomFunction2                    | `SELECT `id`,`create_time`,`update_time`,`create_by`,`update_by`,`deleted`,`title`,`content…` |
| QueryTest27.java#staticTestCustomFunction4                    | `SELECT `id`,`create_time`,`username`,`phone`,`id_card`,`address`FROM`easy-query-test`.`t…`   |
| QueryTest27.java#testAAA                                      | `SELECT t.`id`,t.`create_time`,t.`username`,t.`phone`,t.`id_card`,t.`address`FROM`easy-qu…`   |
| QueryTest27.java#testAAA1                                     | `SELECT t.`id`,t.`create_time`,t.`username`,t.`phone`,t.`id_card`,t.`address`FROM`easy-qu…`   |
| QueryTest27.java#testDerivedTable1                            | `SELECT t1.`score`AS`score`,t1.`status1`AS`status1`,t1.`order`AS`order`,t1.`is_top` A…`       |
| QueryTest27.java#testMap2                                     | `SELECT t.`id`,t.`stars`,t.`title`,t.`create_time`FROM`t_topic` t`                            |
| QueryTest27.java#testRandom                                   | `SELECT `id`,`stars`,`title`,`create_time`FROM`t_topic` ORDER BY RAND() ASC`                  |
| QueryTest28.java#test                                         |                                                                                               |
| QueryTest28.java#testInterceptor1                             | `SELECT `id`,`name`FROM`m8_interceptor` WHERE 1=1`                                            |
| QueryTest28.java#testNoValueConverter1                        | `SELECT `id`,`stars`,`title`,`title2`,`topic_type`,`create_time`FROM`t_topic_type_array` …`   |
| QueryTest3.java#extendsUserTest                               |                                                                                               |
| QueryTest3.java#orTest                                        | `SELECT `id`,`stars`,`title`,`create_time`FROM`t_topic` WHERE (`title`LIKE ? OR`id` LIK…`     |
| QueryTest3.java#queryBasic1                                   | `SELECT t.`id`FROM`t_topic` t WHERE t.`id` = ?`                                               |
| QueryTest3.java#queryBasic2                                   | `SELECT t.`stars`FROM`t_topic` t WHERE t.`id` = ?`                                            |
| QueryTest3.java#queryToList1                                  |                                                                                               |
| QueryTest3.java#testGenericKey                                | `SELECT `id`,`stars`,`title`,`create_time`FROM`t_topic` LIMIT 1`                              |
| QueryTest3.java#testGenericKey1                               |                                                                                               |
| QueryTest3.java#testLambda3                                   |                                                                                               |
| QueryTest3.java#testProperty3                                 |                                                                                               |
| QueryTest3.java#testSample                                    |                                                                                               |
| QueryTest3.java#testSelfPredicate1                            | `SELECT `id`,`create_time`,`update_time`,`create_by`,`update_by`,`deleted`,`title`,`content…` |
| QueryTest4.java#testSQLFunc10                                 | `SELECT CONCAT(t.`stars`,t.`id`) AS `title`FROM`t_topic` t WHERE t.`id` = ? ORDER BY t.`c…`   |
| QueryTest4.java#testSQLFunc3                                  | `SELECT DATE_FORMAT(t.`create_time`,'%Y/%m/%d') FROM `t_topic` t WHERE t.`id` = ?`            |
| QueryTest4.java#testSQLFunc4                                  | `SELECT DATE_FORMAT(t.`create_time`,'%Y-%m-%d') FROM `t_topic` t WHERE t.`id` = ?`            |
| QueryTest4.java#testSQLFunc5                                  |                                                                                               |
| QueryTest4.java#testSQLFunc6                                  |                                                                                               |
| QueryTest5.java#test1                                         | `SELECT * FROM (select 1) t`                                                                  |
| QueryTest7.java#forEachTest1                                  |                                                                                               |
| QueryTest7.java#testBank1                                     | `SELECT `id`,`stars`,`title`,`create_time`FROM`t_topic` WHERE (`id`IS NOT NULL AND`id` …`     |
| QueryTest7.java#testBank2                                     | `SELECT `id`,`stars`,`title`,`create_time`FROM`t_topic` WHERE (`id`IS NULL OR`id` = '' …`     |
| QueryTest7.java#testEmpty1                                    | `SELECT `id`,`stars`,`title`,`create_time`FROM`t_topic` WHERE (`id`IS NOT NULL AND`id` …`     |
| QueryTest7.java#testEmpty2                                    | `SELECT `id`,`stars`,`title`,`create_time`FROM`t_topic` WHERE (`id`IS NULL OR`id` = '')`      |
| QueryTest7.java#testQuery9                                    | `SELECT `id`,`stars`,`title`,`create_time`FROM`t_topic` WHERE (`id`IS NULL OR`id` = '' …`     |
| QueryTest9.java#selectCount1                                  | `SELECT COUNT(*) FROM `t_topic`WHERE`id` = ?`                                                 |
| QueryTest9.java#testDsl4                                      | `SELECT `id`,`stars`,`title`,`create_time`FROM`t_topic` WHERE (`id`IS NULL OR`id` = '')`      |
| QueryTest9.java#testQuery7                                    | `SELECT t.`id`,t.`create_time`,t.`update_time`,t.`create_by`,t.`update_by`,t.`deleted`,t.`c…` |
| QueryTestRelationTest.java#relation11                         | `SELECT (SELECT COUNT(t1.`id`) AS `id`FROM`school_student` t1 WHERE t1.`class_id` = t.`id…`   |
| QueryTestRelationTest.java#relationTest0_1                    | `SELECT t.`id`,t.`com_id`,t.`user_id`,t.`time`,t.`content`FROM`my_sign_up`t LEFT JOIN`m…`     |
| QueryTestRelationTest.java#relationTest0_x                    | `SELECT t.`id`,t.`com_id`,t.`user_id`,t.`time`,t.`content`FROM`my_sign_up`t LEFT JOIN`m…`     |
| QueryTestRelationTest.java#relationTest1                      | `SELECT t.`id`,t.`com_id`,t.`user_id`,t.`time`,t.`content`FROM`my_sign_up`t LEFT JOIN`m…`     |
| QueryTestRelationTest.java#relationTest2                      | `SELECT t.`id`AS`value1`,t1.`gw`AS`value2`FROM`my_sign_up`t LEFT JOIN`my_com_user` …`         |
| QueryTestRelationTest.java#test3                              | `SELECT `id`,`com_id`,`user_id`,`gw`FROM`my_com_user``                                        |
| QueryTestRelationTest.java#testDirectWhere1                   | `SELECT t.`id`,t.`com_id`,t.`user_id`,t.`time`,t.`content`FROM`my_sign_up`t LEFT JOIN`m…`     |
| QueryTestRelationTest.java#testDirectWhere2                   | `SELECT t.`id`,t.`com_id`,t.`user_id`,t.`time`,t.`content`FROM`my_sign_up`t LEFT JOIN`m…`     |
| QueryTestRelationTest.java#testDirectWhere3                   | `SELECT t.`id`,t.`com_id`,t.`user_id`,t.`time`,t.`content`FROM`my_sign_up`t LEFT JOIN`m…`     |
| Relation2Test.java#test                                       | `SELECT t.`id`,t.`class_id`,t.`name`FROM`my_school_student`t LEFT JOIN`school_student_a…`     |
| Relation2Test.java#test1                                      | `SELECT t.`id`,t.`class_id`,t.`name`FROM`my_school_student`t LEFT JOIN`school_student_a…`     |
| Relation2Test.java#test2                                      | `SELECT t.`id`,t.`class_id`,t.`name`FROM`my_school_student`t LEFT JOIN`school_student_a…`     |
| Relation2Test.java#test3                                      | `SELECT t.`id`,t.`class_id`,t.`name`FROM`my_school_student`t LEFT JOIN`my_school_class`…`     |
| Relation2Test.java#test7                                      | `SELECT t.`id`,t.`name`FROM`my_school_class` t WHERE IFNULL((SELECT SUM(CAST(t1.`name` AS…`   |
| Relation2Test.java#test9                                      | `SELECT t.`id`,t.`name`FROM`my_school_class` t WHERE IFNULL((SELECT SUM(CAST(t1.`name` AS…`   |
| Relation2Test.java#test9_1                                    | `SELECT t.`id`,t.`name`FROM`my_school_class` t WHERE IFNULL((SELECT SUM(CAST(t1.`name` AS…`   |
| RelationTest.java#schoolTest2                                 | `SELECT t.`id`,t.`class_id`,t.`name`FROM`school_student`t LEFT JOIN`school_class` t1 ON…`     |
| RelationTest.java#testSub                                     | `SELECT t1.`id`,t1.`name`FROM`school_student`t LEFT JOIN`school_class` t1 ON t1.`id` = …`     |
| RelationTest.java#testSub1                                    | `SELECT t1.`name`FROM`school_student`t LEFT JOIN`school_class` t1 ON t1.`id` = t.`class…`     |
| RelationTest.java#testSub2                                    | `SELECT t2.`id`,t2.`class_id`,t2.`name`FROM`school_student`t LEFT JOIN`school_student_a…`     |
| SkipTest.java#testEasyQueryConcurrentException                |                                                                                               |
| sqlite/SQLiteTest.java#testQuery                              |                                                                                               |
| sqlite/SQLiteTest.java#testQuery1                             |                                                                                               |
| SubJoinTest.java#testSubJoinSumBigDecimal                     | `SELECT IFNULL((SELECT SUM(t2.`age`) FROM `sub_join_book`t1 LEFT JOIN`sub_join_author` t2…`   |
| SubJoinTest.java#testSubJoinSumBigDecimal2                    | `SELECT IFNULL((SELECT SUM(t2.`age`) FROM `sub_join_book`t1 LEFT JOIN`sub_join_author` t2…`   |
| SubJoinTest.java#testSubJoinSumBigDecimalDistinct             | `SELECT IFNULL((SELECT SUM(DISTINCT t2.`age`) FROM `sub_join_book`t1 LEFT JOIN`sub_join_a…`   |
| SubJoinTest.java#testSubJoinSumBigDecimalDistinct2            | `SELECT IFNULL((SELECT SUM(DISTINCT t2.`age`) FROM `sub_join_book`t1 LEFT JOIN`sub_join_a…`   |
| UpdateTest2.java#test11                                       | `SELECT t.\`                                                                                  |

### CTE（`query.cte`，已对应）

| 用例                                    | 断言的 SQL（摘要）                                                                          |
| --------------------------------------- | ------------------------------------------------------------------------------------------- |
| mysql8/CTETest.java#cteJoinTest2        | `WITH `ttt` AS (SELECT t.`id`,t.`name`,t.`age`,t.`create_time`FROM`m8_user` t WHERE t.`ag…` |
| mysql8/CTETest.java#cteJoinTest7        | `WITH `ttt` AS (SELECT t.`id`,t.`name`,t.`age`,t.`create_time`FROM`m8_user` t WHERE t.`na…` |
| mysql8/CTETest.java#cteJoinTest8        | `WITH `ttt` AS (SELECT t.`id`,t.`name`,t.`age`,t.`create_time`FROM`m8_user` t WHERE t.`ag…` |
| mysql8/CTETest.java#cteTest1            | `WITH `ttt` AS (SELECT t.`id`,t.`name`,t.`age`,t.`create_time`FROM`m8_user` t WHERE t.`ag…` |
| mysql8/M8BankTest.java#testExtraFilter4 | `WITH `with_Draft2` AS (SELECT t1.`bank_id`AS`value1`,COUNT(*) AS `value2`FROM`t_bank_c…`   |
| pgsql/QueryTest.java#testToWithAs2      | `WITH \`                                                                                    |
| QueryTest19.java#testToWithA43          | `WITH `with_Topic` AS (SELECT t1.`id`,t1.`stars`,t1.`title`,t1.`create_time`FROM`t_topic`…` |
| QueryTest19.java#testToWithAs           | `WITH `withTableTopic` AS (SELECT t1.`id`,t1.`stars`,t1.`title`,t1.`create_time`FROM`t_to…` |
| QueryTest19.java#testToWithAs2          | `WITH `with_Topic` AS (SELECT t1.`id`,t1.`stars`,t1.`title`,t1.`create_time`FROM`t_topic`…` |
| QueryTest19.java#testToWithAs3          | `WITH `with_Topic` AS (SELECT t1.`id`,t1.`stars`,t1.`title`,t1.`create_time`FROM`t_topic`…` |
| QueryTest20.java#testGroupJoin2         | `WITH `with_TopicGroupTestDTO` AS (SELECT t1.`id`AS`id`,COUNT(t1.`id`) AS `id_count` FROM…` |

### 分组与 having（`query.group`，已对应）

| 用例                                                      | 断言的 SQL（摘要）                                                                            |
| --------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| EntityQueryAggregateTest5.java#test1                      | `SELECT t.`id`,t1.`id`FROM`t_topic`t LEFT JOIN`t_topic` t1 ON t.`id` = t1.`id` LEFT JOI…`     |
| EntityQueryAggregateTest5.java#test2                      | `SELECT t.`id`,t1.`id`FROM`t_topic`t LEFT JOIN`t_topic` t1 ON t.`id` = t1.`id` LEFT JOI…`     |
| EntityQueryAggregateTest5.java#test3                      | `SELECT t.`id`,t1.`id`FROM`t_topic`t LEFT JOIN`t_topic` t1 ON t.`id` = t1.`id` LEFT JOI…`     |
| EntityQueryAggregateTest5.java#test4                      | `SELECT t.`id`,t1.`id`FROM`t_topic`t LEFT JOIN`t_topic` t1 ON t.`id` = t1.`id` LEFT JOI…`     |
| EntityQueryAggregateTest5.java#test5                      | `SELECT t.`id`,t1.`id`FROM`t_topic`t LEFT JOIN`t_topic` t1 ON t.`id` = t1.`id` LEFT JOI…`     |
| EntityQueryAggregateTest5.java#test6                      | `SELECT t.`id`,t1.`id`FROM`t_topic`t LEFT JOIN`t_topic` t1 ON t.`id` = t1.`id` LEFT JOI…`     |
| EntityQueryAggregateTest5.java#test7                      | `SELECT t.`id`,t1.`id`FROM`t_topic`t LEFT JOIN`t_topic` t1 ON t.`id` = t1.`id` LEFT JOI…`     |
| EntityQueryAggregateTest5.java#test8                      | `SELECT t.`id`,t1.`id`FROM`t_topic`t LEFT JOIN`t_topic` t1 ON t.`id` = t1.`id` LEFT JOI…`     |
| EntityQueryAggregateTest5.java#test9                      | `SELECT t.`id`,t1.`id`FROM`t_topic`t LEFT JOIN`t_topic` t1 ON t.`id` = t1.`id` GROUP BY…`     |
| GeneralFunctionsTest.java#limitOrderTest1                 | `SELECT t1.\`                                                                                 |
| GeneralFunctionsTest.java#limitOrderTest2                 | `SELECT rt1.* FROM (SELECT rt.*, ROWNUM AS \`                                                 |
| mysql8/M8BankTest.java#testExtraFilter3                   | `SELECT t.`name`AS`value1`,t3.`value2`AS`value2`FROM`t_bank` t LEFT JOIN (SELECT t1.`…`       |
| mysql8/M8BankTest.java#testUserAutoSubQueryToGroupJoin3   | `SELECT t.`name`AS`value1`,COUNT((CASE WHEN IFNULL(t2.`**any2**`,?) = ? THEN ? ELSE NULL …`   |
| mysql8/M8BankTest.java#testUserAutoSubQueryToGroupJoin3_1 | `SELECT t.`name`AS`value1`,COUNT((CASE WHEN t2.`**any2**`= ? THEN ? ELSE NULL END)) AS`…`     |
| mysql8/M8Test1.java#test23                                | `SELECT t1.`uid`AS`uid`,t1.`count`AS`count` FROM (SELECT t.`uid`AS`uid`,COUNT(*) AS `…`       |
| QueryTest.java#query16                                    | `SELECT COUNT(1) FROM (SELECT t1.`id`AS`id`,SUM(t1.`score`) AS `score`FROM`t_topic` t I…`     |
| QueryTest.java#query16_1_2                                | `SELECT COUNT(1) FROM (SELECT IFNULL(t1.`id`,?) AS `id`,SUM(t1.`score`) AS `score`FROM`t_…`   |
| QueryTest.java#query19                                    |                                                                                               |
| QueryTest.java#query19_1                                  | `SELECT t.`id`,t.`create_time`,t.`update_time`,t.`create_by`,t.`update_by`,t.`deleted`,t.`t…` |
| QueryTest.java#query19_2                                  | `SELECT t.`id`,t.`create_time`,t.`update_time`,t.`create_by`,t.`update_by`,t.`deleted`,t.`t…` |
| QueryTest.java#query19_3                                  | `SELECT t.`id`,t.`create_time`,t.`update_time`,t.`create_by`,t.`update_by`,t.`deleted`,t.`t…` |
| QueryTest.java#query20                                    | `SELECT t.`id`AS`id`,COUNT(t.`id`) AS `id_count`FROM`t_topic` t WHERE t.`id` = ? GROUP …`     |
| QueryTest.java#query21                                    | `SELECT t.`id`,COUNT(t.`id`) AS `id_count`FROM`t_topic` t WHERE t.`id` = ? GROUP BY t.`id…`   |
| QueryTest.java#query43                                    |                                                                                               |
| QueryTest.java#query44                                    | `SELECT t1.`id`AS`id`,t1.`id_count`AS`id_count` FROM (SELECT t.`id`AS`id`,COUNT(t.`id…`       |
| QueryTest10.java#test2                                    | `SELECT t.`id`FROM`t_blog` t WHERE t.`deleted` = ? AND t.`id` = ? GROUP BY t.`id` HAVING …`   |
| QueryTest10.java#test3                                    | `SELECT t.`id`FROM`t_blog` t WHERE t.`deleted` = ? AND t.`id` = ? GROUP BY t.`id` HAVING …`   |
| QueryTest10.java#test4                                    | `SELECT t.`id`FROM`t_blog` t WHERE t.`deleted` = ? AND t.`id` = ? GROUP BY t.`id` HAVING …`   |
| QueryTest10.java#test5                                    | `SELECT t1.`id`,SUM(t1.`score`) AS `score`FROM`t_topic`t INNER JOIN`t_blog` t1 ON t1.`d…`     |
| QueryTest10.java#testDraft10                              | `SELECT t.`id`AS`value1`,COUNT(*) AS `value2`FROM`t_topic` t WHERE t.`title` LIKE ? AND…`     |
| QueryTest11.java#testdraft                                | `SELECT t.`id`AS`value1`,COUNT(*) AS `value2`FROM`t_topic` t GROUP BY t.`id``                 |
| QueryTest13.java#orderTest1                               | `SELECT t2.`id`,t2.`stars`,t2.`title`,t2.`create_time` FROM (SELECT t.`id`AS`blogId`,COUN…`   |
| QueryTest13.java#orderTest1_1                             | `SELECT t2.`id`,t2.`stars`,t2.`title`,t2.`create_time` FROM (SELECT t.`id`AS`blogId`,COUN…`   |
| QueryTest15.java#test4                                    | `SELECT CEILING((timestampdiff(DAY, t.`birthday`, NOW()) / ?)) AS `value1`,CONCAT(t.`first_…` |
| QueryTest18.java#test1111                                 |                                                                                               |
| QueryTest19.java#testUnion1                               | `SELECT '未开始'AS task_status\n`                                                             |
| QueryTest2.java#groupTest                                 | `SELECT t.`id`AS`id`,COUNT(t.`id`) AS `id_count`,SUM(t.`score`) AS `score_sum`,MAX(t.`pub…`   |
| QueryTest2.java#groupTest1                                | `SELECT t.`id`AS`id`,SUM(t.`score`) AS `score`,MAX(t.`publish_time`) AS `publish_time`,MI…`   |
| QueryTest2.java#groupTest2                                | `SELECT t.`id`AS`id`,SUM(DISTINCT t.`score`) AS `score_sum`,COUNT(DISTINCT t.`id`) AS `id…`   |
| QueryTest2.java#groupTest3                                | `SELECT t.`id`AS`id`,SUM(DISTINCT t.`score`),COUNT(DISTINCT t.`order`),AVG(DISTINCT t.`st…`   |
| QueryTest2.java#groupTest4                                | `SELECT t.`id`AS`id`,SUM(DISTINCT t.`score`) AS `score`,COUNT(DISTINCT t.`order`) AS `ord…`   |
| QueryTest2.java#query122                                  | `SELECT t.`id`FROM`t_topic`t LEFT JOIN`t_blog` t1 ON t1.`deleted` = ? AND t.`id` = t1.`…`     |
| QueryTest2.java#query122x                                 | `SELECT t.`id`FROM`t_topic`t LEFT JOIN`t_blog` t1 ON t1.`deleted` = ? AND t.`id` = t1.`…`     |
| QueryTest2.java#query123                                  | `SELECT DISTINCT t.`id`FROM`t_topic`t LEFT JOIN`t_blog` t1 ON t1.`deleted` = ? AND t.`i…`     |
| QueryTest2.java#query123x                                 | `SELECT DISTINCT t.`id`FROM`t_topic`t LEFT JOIN`t_blog` t1 ON t1.`deleted` = ? AND t.`i…`     |
| QueryTest20.java#testFullSingleTable                      | `SELECT t1.`value1`AS`value1`,t1.`value2`AS`value2`,t1.`value3`AS`value3` FROM (SELEC…`       |
| QueryTest20.java#testGroup                                | `SELECT t.`title`AS`value1`,COUNT(*) AS `value2`,MAX(t.`create_time`) AS `value3`,SUM(t.`…`   |
| QueryTest20.java#testGroup1                               | `SELECT t.`title`AS`key`,COUNT(*) AS `id_count`,MAX(t.`create_time`) AS `create_time_max`…`   |
| QueryTest20.java#testGroupJoin1                           | `SELECT t.`id`AS`value1`,t3.`id_count`AS`value2`FROM`t_blog` t LEFT JOIN (SELECT t1.`…`       |
| QueryTest21.java#testWhereGroup                           | `SELECT t.`title`AS`value1`,COUNT((CASE WHEN t.`star` >= ? THEN t.`id` ELSE NULL END)) AS…`   |
| QueryTest21.java#testWhereGroup1                          | `SELECT t.`title`AS`value1`,COUNT((CASE WHEN t.`star`>= ? THEN ? ELSE NULL END)) AS`val…`     |
| QueryTest21.java#testWhereGroup2                          | `SELECT t.`title`AS`value1`,COUNT(DISTINCT (CASE WHEN t.`star` >= ? THEN ? ELSE NULL END)…`   |
| QueryTest21.java#testWhereGroup3                          | `SELECT t.`title`AS`value1`,COUNT(DISTINCT ?) AS `value2`FROM`t_blog` t WHERE t.`delete…`     |
| QueryTest21.java#testWhereGroup4                          | `SELECT t.`title`AS`value1`,COUNT(DISTINCT (CASE WHEN t.`star` >= ? THEN ? ELSE NULL END)…`   |
| QueryTest21.java#testWhereGroup5                          | `SELECT t.`title`AS`value1`,SUM((CASE WHEN t.`star` >= ? THEN t.`score`ELSE ? END)) AS`…`     |
| QueryTest21.java#testWhereGroup6                          | `SELECT t.`title`AS`value1`,SUM(DISTINCT (CASE WHEN t.`star` >= ? THEN t.`score` ELSE ? E…`   |
| QueryTest22.java#testManyGroup39                          |                                                                                               |
| QueryTest23.java#testaaa1                                 |                                                                                               |
| QueryTest25.java#tupleTest1                               | `SELECT t.`id`AS`value1`FROM`t_topic` t GROUP BY t.`id``                                      |
| QueryTest25.java#tupleTest2                               | `SELECT t.`id`AS`value1`FROM`t_topic` t GROUP BY t.`id`,t.`title``                            |
| QueryTest25.java#tupleTest3                               | `SELECT t1.`value1`AS`value1` FROM (SELECT t.`id`AS`value1`FROM`t_topic` t GROUP BY t…`       |
| QueryTest25.java#tupleTest4                               | `SELECT t.`id`AS`value1`,COUNT(*) AS `value2`FROM`t_topic` t GROUP BY t.`id``                 |
| QueryTest25.java#tupleTest5                               | `SELECT t.`id`AS`value1`,COUNT(*) AS `value2`,SUM(t.`stars`) AS `value3`FROM`t_topic` t…`     |
| QueryTest26.java#test                                     |                                                                                               |
| QueryTest26.java#test23                                   | `SELECT t1.`uid`AS`uid`,t1.`count`AS`count` FROM (SELECT t.`uid`AS`uid`,COUNT(*) AS `…`       |
| QueryTest28.java#testQueryAggregate2                      | `SELECT COUNT(*) AS `value1`,AVG(t.`stars`) AS `value2`FROM`t_topic` t WHERE t.`title` LI…`   |
| QueryTest3.java#query122                                  | `SELECT t.`id`FROM`t_topic`t LEFT JOIN`t_blog` t1 ON t1.`deleted` = ? AND t.`id` = t1.`…`     |
| QueryTest3.java#query123                                  | `SELECT DISTINCT t.`id`FROM`t_topic`t LEFT JOIN`t_blog` t1 ON t1.`deleted` = ? AND t.`i…`     |
| QueryTest7.java#testQuery10                               | `SELECT t1.`id`,SUM(t1.`score`) AS `score`FROM`t_topic`t INNER JOIN`t_blog` t1 ON t1.`d…`     |
| QueryTest7.java#testQuery11                               | `SELECT t1.`id`,SUM(t1.`score`) AS `score`FROM`t_topic`t INNER JOIN`t_blog` t1 ON t1.`d…`     |
| QueryTest7.java#testQuery12                               | `SELECT t1.`id`,SUM(t1.`score`) AS `score`FROM`t_topic`t INNER JOIN`t_blog` t1 ON t1.`d…`     |
| QueryTest7.java#testQuery13                               | `SELECT t1.`id`,SUM(t1.`score`) AS `score`FROM`t_topic`t INNER JOIN`t_blog` t1 ON t1.`d…`     |
| QueryTest7.java#testQuery14                               | `SELECT t1.`id`,SUM(t1.`score`) AS `score`FROM`t_topic`t INNER JOIN`t_blog` t1 ON t1.`d…`     |
| QueryTest7.java#testQuery15                               | `SELECT t1.`id`,SUM(t1.`score`) AS `score`FROM`t_topic`t INNER JOIN`t_blog` t1 ON t1.`d…`     |
| QueryTest7.java#testQuery16                               | `SELECT t1.`id`,SUM(t1.`score`) AS `score`FROM`t_topic`t INNER JOIN`t_blog` t1 ON t1.`d…`     |
| QueryTest7.java#testQuery17                               | `SELECT t1.`id`,SUM(t1.`score`) AS `score`FROM`t_topic`t INNER JOIN`t_blog` t1 ON t1.`d…`     |
| QueryTest7.java#testQuery18                               | `SELECT t1.`id`,SUM(t1.`score`) AS `score`FROM`t_topic`t INNER JOIN`t_blog` t1 ON t1.`d…`     |
| QueryTest9.java#havingQueryTest1                          | `SELECT t.`id`AS`id`,COUNT(t.`id`) AS `star`,MAX(t.`id`) AS `title`FROM`t_blog` t WHERE…`     |

### 显式 join（含 merge 写法）（`query.join`，已对应）

| 用例                                              | 断言的 SQL（摘要）                                                                            |
| ------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| mysql8/CrossJoinTest.java#crossJoin1              | `SELECT t.`id`,t.`uid`,t.`code`,t.`type`,t.`bank_id`,t.`open_time`FROM`t_bank_card` t CRO…`   |
| mysql8/CTETest.java#cteTest5                      | `WITH `m8_user_temp` AS (SELECT t.`id`,t.`name`FROM`m8_user` t WHERE t.`age` IS NULL) SEL…`   |
| mysql8/MySQL8Test2.java#test1                     | `SELECT t2.`id`,t2.`name`,t2.`create_time`,t2.`__part__column1`AS`__part__column1` FROM (…`   |
| mysql8/MySQL8Test2.java#test2                     | `SELECT t3.`id`,t3.`name`,t3.`create_time`,t3.`__part__column1`AS`__part__column1` FROM (…`   |
| mysql8/MySQL8Test2.java#test3                     | `SELECT t.`id`,t.`uid`,t.`code`,t.`type`,t.`bank_id`,t.`open_time`FROM`t_bank_card` t LEF…`   |
| mysql8/MySQL8Test2.java#test4                     | `SELECT t.`id`,t.`uid`,t.`code`,t.`type`,t.`bank_id`,t.`open_time`FROM`t_bank_card` t LEF…`   |
| mysql8/MySQL8Test2.java#test5                     | `SELECT t.`id`,t.`uid`,t.`code`,t.`type`,t.`bank_id`,t.`open_time`FROM`t_bank_card` t LEF…`   |
| mysql8/MySQL8Test3.java#testDTOWhereToTableWhere  | `SELECT t2.`name`AS`name`,t2.`phone`AS`phone`,t2.`code2`AS`code2` FROM (SELECT t.`nam…`       |
| mysql8/MySQL8Test3.java#testDTOWhereToTableWhere1 | `SELECT t2.`name`AS`name`,t2.`phone`AS`phone`,t2.`code2`AS`code2` FROM (SELECT t.`nam…`       |
| mysql8/MySQL8Test5.java#testWhereJoin             |                                                                                               |
| QueryTest.java#query10                            | `SELECT t.`id`,t.`stars`,t.`title`,t.`create_time`FROM`t_topic`t LEFT JOIN`t_blog` t1 O…`     |
| QueryTest.java#query10_1                          | `SELECT y.`id`,y.`stars`,y.`title`,y.`create_time`FROM`t_topic`y LEFT JOIN`t_blog` z ON…`     |
| QueryTest.java#query11                            | `SELECT t.`id`,t.`create_time`,t.`update_time`,t.`create_by`,t.`update_by`,t.`deleted`,t.`t…` |
| QueryTest.java#query11_1                          | `SELECT t.`id`,t.`create_time`,t.`update_time`,t.`create_by`,t.`update_by`,t.`deleted`,t.`t…` |
| QueryTest.java#query111                           | `SELECT t.`id`,t.`stars`,t.`title`,t.`create_time`FROM`t_topic`t LEFT JOIN`t_blog` t1 O…`     |
| QueryTest.java#query113                           |                                                                                               |
| QueryTest.java#query121                           | `SELECT t.`id`,t.`stars`,t.`title`,t.`create_time`FROM`t_topic`t LEFT JOIN`t_blog` t1 O…`     |
| QueryTest.java#query17                            | `SELECT COUNT(1) FROM (SELECT t1.`create_time`,t1.`update_time`,t1.`create_by`,t1.`update_b…` |
| QueryTest.java#query26                            | `SELECT t1.`id`,t1.`create_time`,t1.`update_time`,t1.`create_by`,t1.`update_by`,t1.`deleted…` |
| QueryTest.java#query40                            | `SELECT COUNT(*) FROM `t_topic`t INNER JOIN`t_blog` t1 ON t1.`deleted` = ? AND t.`id` = t…`   |
| QueryTest.java#query78                            | `SELECT t1.`title`,t1.`content`,t1.`url`,t1.`star`,t1.`publish_time`,t1.`score`,t1.`status`…` |
| QueryTest.java#query79                            | `SELECT t1.`id`,t1.`title`,t1.`content`,t1.`url`,t1.`star`,t1.`publish_time`,t1.`score`,t1.…` |
| QueryTest.java#query80                            |                                                                                               |
| QueryTest11.java#testx9                           |                                                                                               |
| QueryTest12.java#testDoc15                        | `SELECT t.`id`,t.`create_time`,t.`update_time`,t.`create_by`,t.`update_by`,t.`deleted`,t.`t…` |
| QueryTest12.java#testDoc21                        |                                                                                               |
| QueryTest12.java#testDraftInteger                 |                                                                                               |
| QueryTest12.java#testDraftInteger1                |                                                                                               |
| QueryTest12.java#testJoinSelect                   | `SELECT t1.`id`,t1.`create_time`,t1.`update_time`,t1.`create_by`,t1.`update_by`,t1.`deleted…` |
| QueryTest12.java#testLogicDeleteRecentlyTable     | `SELECT t.`id`,t.`create_time`,t.`update_time`,t.`create_by`,t.`update_by`,t.`deleted`,t.`t…` |
| QueryTest12.java#testLogicDeleteRecentlyTable1    | `SELECT t.`id`,t.`create_time`,t.`update_time`,t.`create_by`,t.`update_by`,t.`deleted`,t.`t…` |
| QueryTest12.java#testMap1                         | `SELECT t.`id`,t.`create_time`,t.`update_time`,t.`create_by`,t.`update_by`,t.`deleted`,t.`t…` |
| QueryTest12.java#testMap2                         | `SELECT t.`id`,t.`update_time`,t.`create_by`,t.`update_by`,t.`deleted`,t.`title`,t.`content…` |
| QueryTest14.java#testLikeColumn2                  | `SELECT t.`id`,t.`create_time`,t.`update_time`,t.`create_by`,t.`update_by`,t.`deleted`,t.`t…` |
| QueryTest15.java#test5                            | `SELECT t.`id`,t.`first_name`,t.`last_name`,t.`birthday`,CONCAT(t.`first_name`,t.`last_name…` |
| QueryTest15.java#test6                            | `SELECT t.`id`,t.`create_time`,t.`update_time`,t.`create_by`,t.`update_by`,t.`deleted`,t.`t…` |
| QueryTest18.java#test                             |                                                                                               |
| QueryTest18.java#test124                          | `SELECT t.`id`,t.`title`,t1.`id`AS`content`,t1.`top`AS`score`FROM`t_topic` t LEFT JOI…`       |
| QueryTest18.java#test18                           |                                                                                               |
| QueryTest19.java#mapJoinFixed                     | `SELECT t.`id1`AS`id1`,t.`name1`AS`name1`,t1.`id2`AS`id2`,t1.`name2`AS`name2` FROM …`         |
| QueryTest2.java#query113                          |                                                                                               |
| QueryTest2.java#query121                          | `SELECT t.`id`,t.`stars`,t.`title`,t.`create_time`FROM`t_topic`t LEFT JOIN`t_blog` t1 O…`     |
| QueryTest2.java#query124                          | `SELECT t.`id`,t.`stars`,t.`title`,t.`create_time`FROM`t_topic`t LEFT JOIN`t_blog` t1 O…`     |
| QueryTest2.java#query124_1                        | `SELECT t.`id`,t.`stars`,t.`title`,t.`create_time`FROM`t_topic`t LEFT JOIN`t_blog` t1 O…`     |
| QueryTest2.java#query125                          | `SELECT t.`id`,t1.`title`,t2.`star`FROM`t_topic`t LEFT JOIN`t_blog` t1 ON t1.`deleted` …`     |
| QueryTest2.java#query126                          |                                                                                               |
| QueryTest20.java#testGroupJoin3                   | `SELECT t.`id`,t.`create_time`,t.`update_time`,t.`create_by`,t.`update_by`,t.`deleted`,t.`t…` |
| QueryTest20.java#testJoinMultiOn                  | `SELECT t.`id`,t.`stars`,t.`title`,t.`create_time`FROM`t_topic`t LEFT JOIN`t_blog` t1 O…`     |
| QueryTest20.java#testJoinVo                       | `SELECT t.`title`AS`column1`,t1.`title`AS`column2`FROM`t_blog`t LEFT JOIN`t_topic` …`         |
| QueryTest20.java#testMapIgnore                    | `SELECT t.`id`,t.`update_time`,t.`create_by`,t.`update_by`,t.`deleted`,t.`title`,t.`content…` |
| QueryTest20.java#testWhere3                       | `SELECT t.`id`,t.`stars`,t.`title`,t.`create_time`FROM`t_topic`t LEFT JOIN`t_blog` t1 O…`     |
| QueryTest24.java#aaa                              |                                                                                               |
| QueryTest25.java#testDraft                        | `SELECT t1.`id`,t1.`star`,t.`title`AS`content`FROM`t_topic`t LEFT JOIN`t_blog` t1 ON …`       |
| QueryTest25.java#testDraft2                       | `SELECT t1.`id`,t1.`star`,t.`title`AS`content`FROM`t_topic`t LEFT JOIN`t_blog` t1 ON …`       |
| QueryTest26.java#testaa                           | `SELECT t.`id`,t.`update_time`,t.`create_by`,t.`update_by`,t.`deleted`,t.`title`,t.`content…` |
| QueryTest26.java#testRelationOn                   | `SELECT t.`aid`,t.`aname`FROM`on_relation_a`t LEFT JOIN`on_relation_b` t2 ON t2.`aid` =…`     |
| QueryTest26.java#testViewWhere                    |                                                                                               |
| QueryTest26.java#testViewWhere2                   |                                                                                               |
| QueryTest27.java#testaaaa54                       |                                                                                               |
| QueryTest27.java#testaaaa541                      |                                                                                               |
| QueryTest27.java#testDerivedTable2                | `SELECT t2.`score`AS`score`,t2.`status1`AS`status1`,t2.`order`AS`order`,t2.`is_top` A…`       |
| QueryTest27.java#testDerivedTable3                | `SELECT t2.`score`AS`score`,t2.`status1`AS`status1`,t2.`order`AS`order`,t2.`is_top` A…`       |
| QueryTest27.java#testDerivedTable4                | `SELECT t2.`score`AS`score`,t2.`status1`AS`status1`,t2.`order`AS`order`,t2.`is_top` A…`       |
| QueryTest27.java#testQuery                        | `SELECT `id`,`stars`,`title`,`create_time`FROM`t_topic`WHERE`id` = ?`                         |
| QueryTest27.java#testSave1                        | `SELECT t.`id`,t.`stars`,t.`title`,t.`create_time`FROM`t_topic`t LEFT JOIN`easy-query-t…`     |
| QueryTest3.java#query113                          |                                                                                               |
| QueryTest3.java#query121                          | `SELECT t.`id`,t.`stars`,t.`title`,t.`create_time`FROM`t_topic`t LEFT JOIN`t_blog` t1 O…`     |
| QueryTest3.java#query124_2                        | `SELECT t.`id`,t.`stars`,t.`title`,t.`create_time`FROM`t_topic`t LEFT JOIN`t_blog` t1 O…`     |
| QueryTest3.java#query124_4                        | `SELECT t.`id`,t.`stars`,t.`title`,t.`create_time`FROM`t_topic`t LEFT JOIN`t_blog` t1 O…`     |
| QueryTest3.java#query125                          | `SELECT t.`id`,t1.`title`,t2.`star`FROM`t_topic`t LEFT JOIN`t_blog` t1 ON t1.`deleted` …`     |
| QueryTest3.java#query126                          |                                                                                               |
| QueryTest4.java#queryTest7                        |                                                                                               |
| QueryTest8.java#test1                             |                                                                                               |
| QueryTest8.java#testJoin10                        | `SELECT t.`id`,t.`stars`,t.`title`,t.`create_time`FROM`t_topic`t LEFT JOIN`t_topic` t1 …`     |
| QueryTest8.java#testJoin5                         | `SELECT t.`id`,t.`stars`,t.`title`,t.`create_time`FROM`t_topic`t LEFT JOIN`t_topic` t1 …`     |
| QueryTest8.java#testJoin6                         | `SELECT t.`id`,t.`stars`,t.`title`,t.`create_time`FROM`t_topic`t LEFT JOIN`t_topic` t1 …`     |
| QueryTest8.java#testJoin7                         | `SELECT t.`id`,t.`stars`,t.`title`,t.`create_time`FROM`t_topic`t LEFT JOIN`t_topic` t1 …`     |
| QueryTest8.java#testJoin8                         | `SELECT t.`id`,t.`stars`,t.`title`,t.`create_time`FROM`t_topic`t LEFT JOIN`t_topic` t1 …`     |
| QueryTest8.java#testJoin9                         | `SELECT t.`id`,t.`stars`,t.`title`,t.`create_time`FROM`t_topic`t LEFT JOIN`t_topic` t1 …`     |
| QueryTest9.java#selectCount2                      | `SELECT COUNT(*) FROM `t_topic`t INNER JOIN`t_blog` t1 ON t1.`deleted` = ? AND t.`id` = t…`   |
| QueryTest9.java#selectCount3                      | `SELECT COUNT(*) FROM `t_topic`t INNER JOIN`t_blog` t1 ON t1.`deleted` = ? AND t.`id` = t…`   |
| QueryTest9.java#selectThrow3                      | `SELECT t.`id`,t.`stars`,t.`title`,t.`create_time`FROM`t_topic`t INNER JOIN`t_blog` t1 …`     |
| QueryTest9.java#selectThrow4                      | `SELECT t.`id`,t.`stars`,t.`title`,t.`create_time`FROM`t_topic`t INNER JOIN`t_blog` t1 …`     |
| QueryTest9.java#selectThrow5                      |                                                                                               |
| QueryTest9.java#selectThrow6                      |                                                                                               |
| QueryTest9.java#selectThrow7                      |                                                                                               |
| QueryTest9.java#selectThrow9                      | `SELECT t.`id`,t.`stars`,t.`title`,t.`create_time`FROM`t_topic`t INNER JOIN`t_blog` t1 …`     |
| UpdateTest.java#aaaa                              |                                                                                               |

### 无实体的 Map 查询、toMap（`query.map`，写法不同）

| 用例                               | 断言的 SQL（摘要）                                                                        |
| ---------------------------------- | ----------------------------------------------------------------------------------------- |
| QueryTest.java#query22             |                                                                                           |
| QueryTest.java#query23             |                                                                                           |
| QueryTest14.java#testDynamicTable2 | `SELECT t1.`id`AS`id` FROM (SELECT t.`id`AS`id`FROM`aaa` t) t1 LEFT JOIN (SELECT * FR…`   |
| QueryTest15.java#test1223          | `SELECT * FROM `123`WHERE`name` = ?`                                                      |
| QueryTest15.java#test8             |                                                                                           |
| QueryTest15.java#testxxx           | `SELECT * FROM `table1`t INNER JOIN`table2` t1 ON t.`id1` = t1.`id2``                     |
| QueryTest16.java#test16            | `SELECT t4.`a`AS`a`,t4.`b`AS`b` FROM ( (SELECT t.`a`AS`a`,t.`b`AS`b`FROM`t_user` …`       |
| QueryTest19.java#mapJoin           | `SELECT t.`table1Column`AS`table1Column`,t1.`table2Column`AS`table2Column`,t2.`table3Co…` |
| QueryTest19.java#mapQuery          | `SELECT `id`AS`id`,`age`AS`age`,`id_card`AS`id_card`FROM`aaa`WHERE`id`= ? AND`n…`         |
| QueryTest19.java#testMapJson       | `SELECT * FROM `table1`t LEFT JOIN`table2` t1 ON t1.`id1` = t.`id2`LEFT JOIN`table3` t2…` |
| QueryTest28.java#testQueryMap      | `SELECT * FROM `t_topic`WHERE`id` = ?`                                                    |

### 分页结果（`query.page`，已对应）

| 用例                                                | 断言的 SQL（摘要）                                                                          |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| doc/DocTest.java#testTopic                          | `SELECT COUNT(*) FROM `t_topic`WHERE`title`LIKE ? AND`create_time` <= ?`                    |
| mysql8/ManyJoinTest.java#test16GroupJoinCombinePage | `SELECT COUNT(*) FROM `t_sys_user` t`                                                       |
| mysql8/MySQL8Test3.java#thisConfigureTest           | `SELECT COUNT(*) FROM `t_sys_user` t`                                                       |
| QueryTest.java#query12                              |                                                                                             |
| QueryTest.java#query13                              |                                                                                             |
| QueryTest.java#query50                              |                                                                                             |
| QueryTest11.java#testx                              |                                                                                             |
| QueryTest15.java#aaa                                |                                                                                             |
| QueryTest15.java#aaa1                               |                                                                                             |
| QueryTest18.java#test16                             | `SELECT COUNT(DISTINCT t.`stars`) FROM `t_topic`t LEFT JOIN`t_blog` t1 ON t1.`deleted` = …` |
| QueryTest18.java#test17                             | `SELECT COUNT(*) FROM (SELECT DISTINCT t.`id`,t.`stars`,t.`title`,t.`create_time`FROM`t_t…` |
| QueryTest18.java#textDistinct2                      | `SELECT DISTINCT COUNT(*) FROM `t_topic`t LEFT JOIN`t_blog` t1 ON t1.`deleted` = ? AND t.…` |
| QueryTest2.java#query12x                            |                                                                                             |
| QueryTest21.java#searchCountPageTest                | `SELECT COUNT(*) FROM `t_topic`WHERE`title` LIKE ?`                                         |
| QueryTest23.java#filterOn4                          | `SELECT COUNT(*) FROM `doc_bank_card`t INNER JOIN`doc_bank` t1 ON t1.`id` = t.`bank_id` A…` |
| QueryTest23.java#testPageDistinct                   | `SELECT COUNT(*) FROM (SELECT DISTINCT t.`code`AS`value1`,t1.`name`AS`value2`FROM`doc…`     |
| QueryTest23.java#testPageDistinct3                  | `SELECT COUNT(DISTINCT t1.`name`) FROM `doc_bank_card`t LEFT JOIN`doc_user` t1 ON t1.`id`…` |
| QueryTest25.java#xxx                                |                                                                                             |
| QueryTest3.java#nativePage1                         |                                                                                             |
| QueryTest3.java#nativePage3                         |                                                                                             |
| QueryTest3.java#nativePage4                         |                                                                                             |
| QueryTest3.java#testGenericKey2                     |                                                                                             |

### 复用查询（cloneQueryable）（`query.reuse`，写法不同）

| 用例                               | 断言的 SQL（摘要）                                                       |
| ---------------------------------- | ------------------------------------------------------------------------ |
| QueryTest16.java#testSubSumOracle2 | `SELECT COUNT(*) FROM \`                                                 |
| QueryTest18.java#testSubCountPage  | `SELECT COUNT(*) FROM `easy-query-test`.`t_sys_user`WHERE`phone` LIKE ?` |

### 流式读取（`query.stream`，已对应）

| 用例                              | 断言的 SQL（摘要） |
| --------------------------------- | ------------------ |
| pgsql/QueryTest19.java#testChunk  |                    |
| QueryTest17.java#testOptional     |                    |
| QueryTest18.java#testChunk1       |                    |
| QueryTest18.java#testChunk2       |                    |
| QueryTest18.java#testChunk3       |                    |
| QueryTest18.java#testChunk4       |                    |
| QueryTest18.java#testStreamChunk1 |                    |
| QueryTest23.java#subquery         |                    |
| QueryTest25.java#test12           |                    |

### union / union all（`query.union`，已对应）

| 用例                                  | 断言的 SQL（摘要）                                                                            |
| ------------------------------------- | --------------------------------------------------------------------------------------------- |
| GeneralFunctionsTest.java#unionSQLite | `SELECT t3.\`                                                                                 |
| mysql8/MySQL8Test3.java#testOneIsNull |                                                                                               |
| QueryTest.java#query52                | `SELECT t3.`id`,t3.`stars`,t3.`title`,t3.`create_time` FROM ( (SELECT t.`id`,t.`stars`,t.`t…` |
| QueryTest.java#query52_1              | `SELECT t3.`id`,t3.`stars`,t3.`title`,t3.`create_time` FROM ( (SELECT t.`id`,t.`stars`,t.`t…` |
| QueryTest.java#query52_1_1            | `SELECT t3.`id`,t3.`stars`,t3.`title`,t3.`create_time` FROM ( (SELECT t.`id`,t.`stars`,t.`t…` |
| QueryTest.java#query52_1_2            | `SELECT t3.`id`,t3.`stars`,t3.`title`,t3.`create_time` FROM ( (SELECT t.`id`,t.`stars`,t.`t…` |
| QueryTest.java#query52_2              | `SELECT t2.`id`,t2.`stars`,t2.`title`,t2.`create_time` FROM ( (SELECT t.`id`,t.`stars`,t.`t…` |
| QueryTest.java#query52_3              | `SELECT t2.`id`,t2.`stars`,t2.`title`,t2.`create_time` FROM ( (SELECT t.`id`,t.`stars`,t.`t…` |
| QueryTest.java#query52_3_1            | `SELECT t2.`id`,t2.`stars`,t2.`title`,t2.`create_time` FROM ( (SELECT t.`id`,t.`stars`,t.`t…` |
| QueryTest.java#query53                | `SELECT t3.`id`,t3.`stars`,t3.`title`,t3.`create_time` FROM ( (SELECT t.`id`,t.`stars`,t.`t…` |
| QueryTest.java#query54                | `SELECT t3.`id`,t3.`stars`,t3.`title`,t3.`create_time` FROM ( (SELECT t.`id`,t.`stars`,t.`t…` |
| QueryTest.java#query55                | `SELECT t3.`create_time`,t3.`stars` FROM ( (SELECT t.`id`,t.`stars`,t.`title`,t.`create_tim…` |
| QueryTest.java#query56                | `SELECT t5.`id`,t5.`stars`,t5.`title`,t5.`create_time` FROM ( (SELECT t3.`id`,t3.`stars`,t3…` |
| QueryTest.java#query57                |                                                                                               |
| QueryTest.java#query65                | `SELECT t7.`id`,t7.`stars`,t7.`title`,t7.`create_time` FROM ( (SELECT t.`id`,t.`stars`,t.`t…` |
| QueryTest.java#query66                | `SELECT t8.`id`,t8.`stars`,t8.`abc`AS`abc` FROM ( (SELECT t.`id`,t.`stars`,t.`title`AS`…`     |
| QueryTest.java#query67                | `SELECT t5.`id`,t5.`stars`,t5.`abc`AS`abc` FROM ( (SELECT t.`id`,t.`stars`,t.`title`AS`…`     |
| QueryTest11.java#testx20              | `SELECT t6.`value1`AS`value1`,t6.`value2`AS`value2`FROM ( (SELECT ? AS`value1`,COUNT(…`       |

### 聚合根保存（savable）（`save.aggregate`，写法不同）

| 用例                                           | 断言的 SQL（摘要）                                              |
| ---------------------------------------------- | --------------------------------------------------------------- |
| mysql8/M8Save2Test.java#testOne2Many1          |                                                                 |
| mysql8/M8Save2Test.java#testOne2Many2          | `SELECT `id`,`name`,`code`FROM`m8_save_root`WHERE`id` IN (?,?)` |
| mysql8/M8Save2Test.java#testOne2Many3          |                                                                 |
| mysql8/M8Save2Test.java#testOne2Many4          | `DELETE FROM `m8_save_root_many`WHERE`id` = ?`                  |
| mysql8/M8Save2Test.java#testOne2Many5          |                                                                 |
| mysql8/M8Save2Test.java#testOne2Many6          |                                                                 |
| mysql8/M8Save2Test.java#testOne2OneChange      | `SELECT `id`,`name`,`code`FROM`m8_save_root``                   |
| mysql8/M8Save2Test.java#testOne2OneChange2     | `SELECT `id`,`name`,`code`FROM`m8_save_root``                   |
| mysql8/M8Save2Test.java#testOne2OneChange3     |                                                                 |
| mysql8/M8Save3Test.java#many2manySetNullInsert | `INSERT INTO `m8_role3` (`role_id`,`role_name`) VALUES (?,?)`   |
| mysql8/M8Save3Test.java#testOwnershipChange1   | `UPDATE `m8_save_b`SET`pid`= ? WHERE`id` = ?`                   |
| mysql8/M8Save3Test.java#testOwnershipChange1_1 | `UPDATE `m8_save_b`SET`pid`= ? WHERE`id` = ?`                   |
| mysql8/M8Save3Test.java#testOwnershipChange2   | `DELETE FROM `m8_save_d`WHERE`id` = ?`                          |
| mysql8/M8Save3Test.java#testOwnershipChange3   | `DELETE FROM `m8_save_d`WHERE`id` = ?`                          |
| mysql8/M8Save4Test.java#testToManyToMany1      |                                                                 |
| mysql8/M8Save4Test.java#testToManyToMany2      | `SELECT `a`,`b`,`c`FROM`m8_many1`WHERE`a` = ?`                  |
| mysql8/M8SaveTest.java#test2One1               | `SELECT `id`,`name`,`code`FROM`m8_save_root`WHERE`id` = ?`      |
| mysql8/M8SaveTest.java#test2One2               | `SELECT `id`,`name`,`code`FROM`m8_save_root`WHERE`id` = ?`      |
| mysql8/M8SaveTest.java#test2One3               | `SELECT `id`,`name`,`code`FROM`m8_save_root`WHERE`id` = ?`      |
| mysql8/M8SaveTest.java#test2One4               | `SELECT `id`,`name`,`code`FROM`m8_save_root`WHERE`id` = ?`      |
| mysql8/M8SaveTest.java#testDeleteAll           | `DELETE FROM `m8_save_root_many_one`WHERE`id` = ?`              |
| mysql8/M8SaveTest.java#testMany2Many1          | `SELECT `id`,`name`,`code`FROM`m8_save_root`WHERE`id` = ?`      |
| mysql8/M8SaveTest.java#testMany2Many2          | `SELECT `id`,`name`,`code`FROM`m8_save_root`WHERE`id` = ?`      |
| mysql8/M8SaveTest.java#testMany2Many3          |                                                                 |
| mysql8/M8SaveTest.java#testMany2Many4          | `SELECT `id`,`name`,`code`FROM`m8_save_root`WHERE`id` = ?`      |
| mysql8/M8SaveTest.java#testMany2Many5          |                                                                 |
| mysql8/M8SaveTest.java#testMany2Many6          | `SELECT `id`,`name`,`code`FROM`m8_save_root`WHERE`id` = ?`      |
| mysql8/M8SaveTest.java#testMany2Many7          | `SELECT `id`,`name`,`code`FROM`m8_save_root`WHERE`id` = ?`      |
| mysql8/M8SaveTest.java#testMany2ManyMiddle1    | `DELETE FROM `m8_save_root_middle_many`WHERE`id` = ?`           |
| mysql8/M8SaveTest.java#testMany2ManyMiddle2    |                                                                 |
| mysql8/M8SaveTest.java#testMany2ManyMiddle3    |                                                                 |
| mysql8/M8SaveTest.java#testOne2Many1           |                                                                 |
| mysql8/M8SaveTest.java#testOne2Many2           | `SELECT `id`,`name`,`code`FROM`m8_save_root`WHERE`id` = ?`      |
| mysql8/M8SaveTest.java#testOne2Many2_1         | `SELECT `id`,`name`,`code`FROM`m8_save_root`WHERE`id` = ?`      |
| mysql8/M8SaveTest.java#testOne2Many3           | `SELECT `id`,`name`,`code`FROM`m8_save_root`WHERE`id` = ?`      |
| mysql8/M8SaveTest.java#testOne2Many4           | `SELECT `id`,`name`,`code`FROM`m8_save_root`WHERE`id` = ?`      |
| mysql8/M8SaveTest.java#testOne2Many5           |                                                                 |
| mysql8/M8SaveTest.java#testOne2Many6           |                                                                 |
| mysql8/M8SaveTest.java#testPathAggregateRoot   |                                                                 |

### search 扩展（`search`，待做）

| 用例                                                                 | 断言的 SQL（摘要） |
| -------------------------------------------------------------------- | ------------------ |
| search/EasySearchBaseCommonTests.java#testCommon                     |                    |
| search/EasySearchBaseCommonTests.java#testCommon2                    |                    |
| search/EasySearchBaseCommonTests.java#testComplexJoinConditions      |                    |
| search/EasySearchBaseCommonTests.java#testDefaultSort                |                    |
| search/EasySearchBaseCommonTests.java#testEmpty                      |                    |
| search/EasySearchBaseCommonTests.java#testMultiFieldSortOverride     |                    |
| search/EasySearchBaseCommonTests.java#testMultiSourceCondition       |                    |
| search/EasySearchBaseCommonTests.java#testNullValueHandling          |                    |
| search/EasySearchBaseOpExtraTests.java#testCrossTableCondition       |                    |
| search/EasySearchBaseOpExtraTests.java#testEmptyResult               |                    |
| search/EasySearchBaseOpExtraTests.java#testInvalidOperator           |                    |
| search/EasySearchBaseOpExtraTests.java#testLargeResultSet            |                    |
| search/EasySearchBaseOpExtraTests.java#testMultiCondition            |                    |
| search/EasySearchBaseOpExtraTests.java#testNullFieldName             |                    |
| search/EasySearchBaseOpExtraTests.java#testNullValueHandling         |                    |
| search/EasySearchBaseOpExtraTests.java#testOperator_gt_maxValue      |                    |
| search/EasySearchBaseOpExtraTests.java#testOperator_in_empty         |                    |
| search/EasySearchBaseOpExtraTests.java#testOperator_lk_emptyPattern  |                    |
| search/EasySearchBaseOpExtraTests.java#testOperator_lt_boundary      |                    |
| search/EasySearchBaseOpExtraTests.java#testOperator_roc_zero_range   |                    |
| search/EasySearchBaseOpExtraTests.java#testThreeConditionCombination |                    |
| search/EasySearchBaseOpExtraTests.java#testTypeMismatch              |                    |
| search/EasySearchBaseOpTests.java#testOperator_eq                    |                    |
| search/EasySearchBaseOpTests.java#testOperator_ge                    |                    |
| search/EasySearchBaseOpTests.java#testOperator_gt                    |                    |
| search/EasySearchBaseOpTests.java#testOperator_in                    |                    |
| search/EasySearchBaseOpTests.java#testOperator_inn                   |                    |
| search/EasySearchBaseOpTests.java#testOperator_le                    |                    |
| search/EasySearchBaseOpTests.java#testOperator_lk                    |                    |
| search/EasySearchBaseOpTests.java#testOperator_lml                   |                    |
| search/EasySearchBaseOpTests.java#testOperator_lmr                   |                    |
| search/EasySearchBaseOpTests.java#testOperator_lt                    |                    |
| search/EasySearchBaseOpTests.java#testOperator_ne                    |                    |
| search/EasySearchBaseOpTests.java#testOperator_ni                    |                    |
| search/EasySearchBaseOpTests.java#testOperator_nl                    |                    |
| search/EasySearchBaseOpTests.java#testOperator_nlml                  |                    |
| search/EasySearchBaseOpTests.java#testOperator_nlmr                  |                    |
| search/EasySearchBaseOpTests.java#testOperator_nrc                   |                    |
| search/EasySearchBaseOpTests.java#testOperator_nrco                  |                    |
| search/EasySearchBaseOpTests.java#testOperator_nro                   |                    |
| search/EasySearchBaseOpTests.java#testOperator_nroc                  |                    |
| search/EasySearchBaseOpTests.java#testOperator_rc                    |                    |
| search/EasySearchBaseOpTests.java#testOperator_rco                   |                    |
| search/EasySearchBaseOpTests.java#testOperator_ro                    |                    |
| search/EasySearchBaseOpTests.java#testOperator_roc                   |                    |

### 分库分表（`sharding`，待做）

| 用例                               | 断言的 SQL（摘要）                                                                            |
| ---------------------------------- | --------------------------------------------------------------------------------------------- |
| ShardingTest.java#sharding1        |                                                                                               |
| ShardingTest.java#sharding10       |                                                                                               |
| ShardingTest.java#sharding11       |                                                                                               |
| ShardingTest.java#sharding12       |                                                                                               |
| ShardingTest.java#sharding18       |                                                                                               |
| ShardingTest.java#sharding19       |                                                                                               |
| ShardingTest.java#sharding2        |                                                                                               |
| ShardingTest.java#sharding20       |                                                                                               |
| ShardingTest.java#sharding21       |                                                                                               |
| ShardingTest.java#sharding26       |                                                                                               |
| ShardingTest.java#sharding27       |                                                                                               |
| ShardingTest.java#sharding28       |                                                                                               |
| ShardingTest.java#sharding29       |                                                                                               |
| ShardingTest.java#sharding3        |                                                                                               |
| ShardingTest.java#sharding30       |                                                                                               |
| ShardingTest.java#sharding31       |                                                                                               |
| ShardingTest.java#sharding32       |                                                                                               |
| ShardingTest.java#sharding33       |                                                                                               |
| ShardingTest.java#sharding34       |                                                                                               |
| ShardingTest.java#sharding35       |                                                                                               |
| ShardingTest.java#sharding36       |                                                                                               |
| ShardingTest.java#sharding37       |                                                                                               |
| ShardingTest.java#sharding38       |                                                                                               |
| ShardingTest.java#sharding39       | `SELECT t.`id`,t.`stars`,t.`title`,t.`create_time`FROM`t_topic` t WHERE t.`id` = ? AND EX…`   |
| ShardingTest.java#sharding4        |                                                                                               |
| ShardingTest.java#sharding40       |                                                                                               |
| ShardingTest.java#sharding41       |                                                                                               |
| ShardingTest.java#sharding42       |                                                                                               |
| ShardingTest.java#sharding43       |                                                                                               |
| ShardingTest.java#sharding44       |                                                                                               |
| ShardingTest.java#sharding45       |                                                                                               |
| ShardingTest.java#sharding46       | `SELECT t.`id`,t.`stars`,t.`title`,(SELECT COUNT(t1.`id`) FROM `t_topic_sharding_time` t1 W…` |
| ShardingTest.java#sharding47       | `SELECT t.`id`,t.`stars`,t.`title`,(SELECT COUNT(t1.`id`) FROM `t_topic_sharding_time` t1 W…` |
| ShardingTest.java#sharding5        |                                                                                               |
| ShardingTest.java#sharding6        |                                                                                               |
| ShardingTest.java#sharding7        |                                                                                               |
| ShardingTest.java#sharding8        |                                                                                               |
| ShardingTest.java#sharding9        |                                                                                               |
| ShardingTest.java#shardingTest48   |                                                                                               |
| ShardingTest.java#shardingTest49   |                                                                                               |
| ShardingTest.java#shardingTest50   |                                                                                               |
| ShardingTest.java#shardingTest51   |                                                                                               |
| ShardingTest.java#shardingTest51_1 |                                                                                               |
| ShardingTest.java#shardingTestMap  | `SELECT t.`create_time`AS`createTime`,COUNT(t.`id`) AS `idCount`FROM (SELECT * FROM`t_t…`     |
| ShardingTest.java#shardingTestMap1 | `SELECT t.`create_time`AS`createTime`,COUNT(t.`id`) AS `idCount`FROM (SELECT * FROM`t_t…`     |
| ShardingTest.java#shardingTestMap2 | `SELECT t.`create_time`AS`createTime`,COUNT(t.`id`) AS `idCount`FROM (SELECT * FROM`t_t…`     |
| ShardingTest.java#shardingTestMap3 | `SELECT t.`create_time`AS`createTime`,COUNT(t.`id`) AS `idCount`FROM (SELECT * FROM`t_t…`     |
| ShardingTest.java#test111          |                                                                                               |

### 原生 SQL（`sql.native`，已对应）

| 用例                                       | 断言的 SQL（摘要）                                                                            |
| ------------------------------------------ | --------------------------------------------------------------------------------------------- |
| mysql8/MySQL8Test2.java#testGroupConcat2   | `SELECT t.`id`AS`value1`,GROUP_CONCAT(DISTINCT t.`content`SEPARATOR ?) AS`value2` FROM …`     |
| mysql8/MySQL8Test4.java#testToResultSet    |                                                                                               |
| MyTest1.java#testGroup20                   | `SELECT SUBSTR(t.`title`,2,2),IFNULL(t1.`score`,?) FROM `t_topic`t LEFT JOIN`t_blog` t1 O…`   |
| MyTest1.java#testGroup21                   | `SELECT SUBSTR(t.`title`,2,2) AS `value1`,COUNT(t.`title`) AS `value2`FROM`t_topic` t LEF…`   |
| MyTest1.java#testGroup22                   | `SELECT IFNULL(t.`create_time`,?) AS `value1`,COUNT(t.`title`) AS `value2`FROM`t_topic` t…`   |
| MyTest2.java#testGroup20                   | `SELECT SUBSTR(t.`title`,2,2),IFNULL(t1.`score`,?) FROM `t_topic`t LEFT JOIN`t_blog` t1 O…`   |
| MyTest2.java#testGroup21                   | `SELECT SUBSTR(t.`title`,2,2) AS `value1`,COUNT(t.`title`) AS `value2`FROM`t_topic` t LEF…`   |
| MyTest2.java#testGroup22                   | `SELECT IFNULL(t.`create_time`,?) AS `value1`,COUNT(t.`title`) AS `value2`FROM`t_topic` t…`   |
| pgsql/QueryTest19.java#concat1             |                                                                                               |
| QueryNativeSQLTest.java#testNativeSQL1     |                                                                                               |
| QueryTest.java#query11_2                   | `SELECT t.`id`,rank() over(order by t2.`stars`desc) as rank1 FROM`t_blog` t LEFT JOIN (SE…`   |
| QueryTest.java#query11_3                   | `SELECT t.`id`,rank() over(order by t2.`stars`desc) as rank1 FROM`t_blog` t LEFT JOIN (SE…`   |
| QueryTest.java#query32                     | `SELECT * FROM `t_blog` t where t.id=?`                                                       |
| QueryTest.java#query33                     | `SELECT * FROM `t_blog` t`                                                                    |
| QueryTest.java#query34                     | `SELECT * FROM `t_blog` t where t.id=?`                                                       |
| QueryTest.java#query35                     | `SELECT * FROM `t_blog` t`                                                                    |
| QueryTest.java#query36                     | `SELECT * FROM `t_blog` t where t.id=?`                                                       |
| QueryTest.java#query7_1                    | `SELECT `id`,`create_time`,`update_time`,`create_by`,`update_by`,`deleted`,`title`,`content…` |
| QueryTest.java#query7_2                    | `SELECT `id`,`create_time` AS createTime,`update_time` AS updateTime,`create_by` AS createB…` |
| QueryTest10.java#test6                     | `SELECT t.`id`AS`value1`FROM`t_topic` t GROUP BY t.`id``                                      |
| QueryTest11.java#testx1                    | `SELECT 1 AS `score`FROM`t_blog` t WHERE t.`deleted` = ? AND DATE_FORMAT(t.`create_time`,…`   |
| QueryTest12.java#testNum1                  | `SELECT SUM(t.`score`)-SUM(t.`score`) AS `score`FROM`t_blog` t WHERE t.`deleted` = ?`         |
| QueryTest12.java#testNum7                  | `SELECT t.`id`,t.`create_time`,t.`update_time`,t.`create_by`,t.`update_by`,t.`deleted`,t.`t…` |
| QueryTest12.java#testSelectPropTypeColumn1 | `SELECT SUM(case t.`score`when ? then 1 else 0 end) AS`star`FROM`t_blog` t WHERE t.`del…`     |
| QueryTest12.java#testSelectPropTypeColumn2 | `SELECT MIN(case t.`score`when ? then 1 else 0 end) AS`score`FROM`t_blog` t WHERE t.`de…`     |
| QueryTest14.java#test1119                  |                                                                                               |
| QueryTest15.java#testxxx1                  |                                                                                               |
| QueryTest16.java#testxxc                   |                                                                                               |
| QueryTest17.java#aaaa                      |                                                                                               |
| QueryTest17.java#testNativeSQL             | `SELECT `id`,`stars`,`title`,`create_time`FROM`t_topic`WHERE`id` = ? ORDER BY RAND()`         |
| QueryTest17.java#testNativeSQL1            | `SELECT `id`,`stars`,`title`,`create_time`FROM`t_topic`WHERE`id` = ? ORDER BY IFNULL(`s…`     |
| QueryTest17.java#testNativeSQL2            | `SELECT `id`,`stars`,`title`,`create_time`FROM`t_topic`WHERE`id`= ? AND`stars`!=`crea…`       |
| QueryTest17.java#testNativeSQL3            | `SELECT RAND() AS `value1`,IFNULL(t.`stars`,?) AS `value2`FROM`t_topic` t WHERE t.`id` = …`   |
| QueryTest18.java#test9                     |                                                                                               |
| QueryTest18.java#testClient                |                                                                                               |
| QueryTest2.java#query1231                  | `SELECT t.`id`,t.`stars`,t.`title`,t.`create_time`FROM`t_topic` t WHERE t.`create_time` =…`   |
| QueryTest2.java#query1231_1                | `SELECT t.`id`,t.`stars`,t.`title`,t.`create_time`FROM`t_topic` t WHERE t.`create_time` =…`   |
| QueryTest2.java#query24                    | `SELECT RAND() AS `id`,COUNT(t.`id`) AS `id_count`FROM`t_blog` t WHERE t.`deleted` = ? AN…`   |
| QueryTest21.java#test                      |                                                                                               |
| QueryTest22.java#testAggregateFx           | `SELECT sum(if(timestampdiff(DAY, t.`create_time`, ?) < ?, 1, 0)) AS `count`FROM`t_blog` …`   |
| QueryTest25.java#tupleTest8                | `SELECT t.`id`AS`value1`,t.`create_time`AS`value2`,1 AS `value3`FROM`t_blog` t WHERE …`       |
| QueryTest25.java#tupleTest9                | `SELECT t.`id`AS`value1`,t.`create_time`AS`value2`,IFNULL(t.`title`,'1') AS `value3` FR…`     |
| QueryTest27.java#updateTable               |                                                                                               |
| QueryTest3.java#nativePage5                |                                                                                               |
| QueryTest3.java#nativePage6                |                                                                                               |
| QueryTest3.java#testSelectAs1              | `SELECT 100 - t.`id`AS`stars`FROM`t_blog` t WHERE t.`deleted` = ? AND t.`id` = ?`             |
| QueryTest4.java#testSQLFuncExtension2      | `SELECT t.`id`FROM`t_topic` t WHERE t.`id` = ? AND FIND_IN_SET(?,t.`id`)`                     |
| QueryTest5.java#test2                      | `SELECT t.`id`,t.`stars`,t.`title`,t.`create_time`FROM`t_topic` t`                            |
| QueryTest8.java#test4x                     |                                                                                               |
| QueryTestRelationTest.java#relation10      | `SELECT (SELECT COUNT(t1.`id`) AS `id`FROM`school_student` t1 WHERE t1.`class_id` = t.`id…`   |

### 跨库链接（asTableLink）（`table.link`，已对应）

| 用例                                 | 断言的 SQL（摘要）                                                                            |
| ------------------------------------ | --------------------------------------------------------------------------------------------- |
| EntityQueryAggregateTest2.java#test1 | `SELECT t.`id`,t.`stars`,t.`title`,t.`create_time`FROM`t_topic`t LEFT JOIN`t_topic` t1 …`     |
| EntityQueryAggregateTest2.java#test2 | `SELECT t.`id`,t.`stars`,t.`title`,t.`create_time`FROM`t_topic`t LEFT JOIN`t_topic` t1 …`     |
| EntityQueryAggregateTest2.java#test3 | `SELECT t.`id`,t.`stars`,t.`title`,t.`create_time`FROM`t_topic`t LEFT JOIN`t_topic` t1 …`     |
| EntityQueryAggregateTest2.java#test4 | `SELECT t.`id`,t.`stars`,t.`title`,t.`create_time`FROM`t_topic`t LEFT JOIN`t_topic` t1 …`     |
| EntityQueryAggregateTest2.java#test5 | `SELECT t.`id`,t.`stars`,t.`title`,t.`create_time`FROM`t_topic`t LEFT JOIN`t_topic` t1 …`     |
| EntityQueryAggregateTest2.java#test6 | `SELECT t.`id`,t.`stars`,t.`title`,t.`create_time`FROM`t_topic`t LEFT JOIN`t_topic` t1 …`     |
| EntityQueryAggregateTest2.java#test7 | `SELECT t.`id`,t.`stars`,t.`title`,t.`create_time`FROM`t_topic`t LEFT JOIN`t_topic` t1 …`     |
| EntityQueryAggregateTest2.java#test8 | `SELECT t.`id`,t.`stars`,t.`title`,t.`create_time`FROM`t_topic`t LEFT JOIN`t_topic` t1 …`     |
| EntityQueryAggregateTest2.java#test9 | `SELECT t.`id`,t.`stars`,t.`title`,t.`create_time`FROM`t_topic`t LEFT JOIN`t_topic` t1 …`     |
| InsertTest.java#insertTableLinkTest1 | `INSERT INTO 1`t_topic_auto` (`stars`,`title`,`create_time`) VALUES (?,?,?) ON DUPLICATE KE…` |
| QueryTest14.java#test2               | `SELECT rt.* FROM (SELECT t.\`                                                                |
| QueryTest14.java#test3               | `UPDATE \`                                                                                    |
| QueryTest3.java#query124_1           | `SELECT t.`id`,t.`stars`,t.`title`,t.`create_time`FROM`t_topic`t LEFT JOIN lateral`t_bl…`     |

### 换表名（asTable）（`table.rename`，写法不同）

| 用例                                  | 断言的 SQL（摘要）                                                                            |
| ------------------------------------- | --------------------------------------------------------------------------------------------- |
| InsertTest1.java#testColumnConfigure2 | `INSERT INTO `xxx` (`id`,`stars`) VALUES (?,ifnull(`stars`,0)+?)`                             |
| QueryAggregateTest1.java#test1        | `SELECT SUM(t.`stars`) FROM `t_topic`t RIGHT JOIN`t_topic` t1 ON t.`id` = t1.`id` RIGHT J…`   |
| QueryAggregateTest1.java#test2        | `SELECT SUM(t.`stars`) FROM `t_topic`t RIGHT JOIN`t_topic` t1 ON t.`id` = t1.`id` RIGHT J…`   |
| QueryAggregateTest1.java#test3        | `SELECT SUM(t.`stars`) FROM `t_topic`t RIGHT JOIN`t_topic` t1 ON t.`id` = t1.`id` RIGHT J…`   |
| QueryAggregateTest1.java#test4        | `SELECT SUM(t.`stars`) FROM `t_topic`t RIGHT JOIN`t_topic` t1 ON t.`id` = t1.`id` RIGHT J…`   |
| QueryAggregateTest1.java#test5        | `SELECT SUM(t.`stars`) FROM `t_topic`t RIGHT JOIN`t_topic` t1 ON t.`id` = t1.`id` RIGHT J…`   |
| QueryAggregateTest1.java#test6        | `SELECT SUM(t.`stars`) FROM `t_topic`t RIGHT JOIN`t_topic` t1 ON t.`id` = t1.`id` RIGHT J…`   |
| QueryAggregateTest1.java#test7        | `SELECT SUM(t.`stars`) FROM `t_topic`t RIGHT JOIN`t_topic` t1 ON t.`id` = t1.`id` RIGHT J…`   |
| QueryAggregateTest1.java#test8        | `SELECT SUM(t.`stars`) FROM `t_topic`t RIGHT JOIN`t_topic` t1 ON t.`id` = t1.`id` RIGHT J…`   |
| QueryAggregateTest2.java#test1        | `SELECT SUM(t.`stars`) FROM `t_topic`t RIGHT JOIN`t_topic` t1 ON t.`id` = t1.`id` RIGHT J…`   |
| QueryAggregateTest2.java#test2        | `SELECT SUM(t.`stars`) FROM `t_topic`t RIGHT JOIN`t_topic` t1 ON t.`id` = t1.`id` RIGHT J…`   |
| QueryAggregateTest2.java#test3        | `SELECT SUM(t.`stars`) FROM `t_topic`t RIGHT JOIN`t_topic` t1 ON t.`id` = t1.`id` RIGHT J…`   |
| QueryAggregateTest2.java#test4        | `SELECT SUM(t.`stars`) FROM `t_topic`t RIGHT JOIN`t_topic` t1 ON t.`id` = t1.`id` RIGHT J…`   |
| QueryAggregateTest2.java#test5        | `SELECT SUM(t.`stars`) FROM `t_topic`t RIGHT JOIN`t_topic` t1 ON t.`id` = t1.`id` RIGHT J…`   |
| QueryAggregateTest2.java#test6        | `SELECT SUM(t.`stars`) FROM `t_topic`t RIGHT JOIN`t_topic` t1 ON t.`id` = t1.`id` RIGHT J…`   |
| QueryAggregateTest2.java#test7        | `SELECT SUM(t.`stars`) FROM `t_topic`t RIGHT JOIN`t_topic` t1 ON t.`id` = t1.`id` RIGHT J…`   |
| QueryAggregateTest2.java#test8        | `SELECT SUM(t.`stars`) FROM `t_topic`t RIGHT JOIN`t_topic` t1 ON t.`id` = t1.`id` RIGHT J…`   |
| QueryTest.java#query24                | `SELECT `id`,`create_time`,`update_time`,`create_by`,`update_by`,`deleted`,`title`,`content…` |
| QueryTest.java#query25                | `SELECT `id`,`create_time`,`update_time`,`create_by`,`update_by`,`deleted`,`title`,`content…` |
| QueryTest.java#query81                | `SELECT COUNT(*) FROM (SELECT DISTINCT t.`id`,t.`create_time`,t.`update_time`,t.`create_by`…` |
| QueryTest14.java#testDynamicTable     | `SELECT * FROM `multi_hot` WHERE CAST(`col8` AS DATETIME) > ? AND CAST(`col9` AS DATETIME) …` |
| QueryTest19.java#mapInsert            | `INSERT INTO `xxxxx` (`id`,`stars`) VALUES (?,?)`                                             |
| QueryTest19.java#mapUpdate            | `UPDATE `xxxxx`SET`stars`= ? WHERE`id` = ?`                                                   |
| QueryTest27.java#testAAA2             | `SELECT t.`id`,t.`create_time`,t.`username`,t.`phone`,t.`id_card`,t.`address`FROM`easy-qu…`   |
| QueryTest27.java#testAAA4             | `SELECT t.`id`,t.`create_time`,t.`username`,t.`phone`,t.`id_card`,t.`address`FROM`easy-qu…`   |
| QueryTest27.java#testAAA42            | `SELECT t.`id`,t.`create_time`,t.`username`,t.`phone`,t.`id_card`,t.`address`FROM`easy-qu…`   |
| QueryTest27.java#testAAA43            | `SELECT t.`id`,t.`create_time`,t.`username`,t.`phone`,t.`id_card`,t.`address`FROM`easy-qu…`   |
| QueryTest27.java#testAAA45            | `SELECT t.`id`,t.`create_time`,t.`username`,t.`phone`,t.`id_card`,t.`address`FROM`easy-qu…`   |
| QueryTest28.java#testQueryMap2        | `SELECT `id`FROM`t_topic`WHERE`id` = ?`                                                       |
| QueryTest4.java#queryFirstSingle      | `SELECT `id`,`create_time`,`username`,`phone`,`id_card`,`address`FROM`easy-query-test`.`s…`   |
| QueryTest5.java#joinTest1_1           | `SELECT SUM(t.`stars`) FROM `t_topic`t LEFT JOIN`t_topic` t1 ON t.`id` = t1.`id` LEFT JOI…`   |
| QueryTest5.java#joinTest1_2           | `SELECT SUM(t.`stars`) FROM `t_topic`t LEFT JOIN`t_topic` t1 ON t.`id` = t1.`id` LEFT JOI…`   |
| QueryTest5.java#joinTest1_3           | `SELECT AVG(t.`stars`) FROM `t_topic`t LEFT JOIN`t_topic` t1 ON t.`id` = t1.`id` LEFT JOI…`   |
| QueryTest5.java#joinTest1_4           | `SELECT AVG(t2.`stars`) FROM `t_topic`t LEFT JOIN`t_topic` t1 ON t.`id` = t1.`id` LEFT JO…`   |
| QueryTest5.java#joinTest1_5           | `SELECT AVG(t2.`stars`) FROM `t_topic`t LEFT JOIN`t_topic` t1 ON t.`id` = t1.`id` LEFT JO…`   |
| QueryTest5.java#joinTest1_6           | `SELECT AVG(t2.`stars`) FROM `t_topic`t LEFT JOIN`t_topic` t1 ON t.`id` = t1.`id` LEFT JO…`   |
| QueryTest5.java#joinTest1_7           | `SELECT AVG(t2.`stars`) FROM `t_topic`t LEFT JOIN`t_topic` t1 ON t.`id` = t1.`id` LEFT JO…`   |
| QueryTest5.java#joinTest1_8           | `SELECT AVG(t2.`stars`) FROM `t_topic`t LEFT JOIN`t_topic` t1 ON t.`id` = t1.`id` LEFT JO…`   |
| QueryTest5.java#joinTest1_9           | `SELECT AVG(t2.`stars`) FROM `t_topic`t LEFT JOIN`t_topic` t1 ON t.`id` = t1.`id` LEFT JO…`   |
| QueryTest5.java#joinTestx1            | `SELECT t.`title`,t.`content`,t.`url`,t.`star`,t.`publish_time`,t.`score`,t.`status`,t.`ord…` |
| UpdateTest.java#mapUpdateTest1        | `UPDATE `aaa`SET`name`= ? WHERE`id` = ?`                                                      |
| UpdateTest.java#testColumnConfigure2  | `UPDATE `xxxxx`SET`stars` = ifnull(`stars`,0)+? WHERE `id` = ?`                               |
| UpdateTest.java#testColumnConfigure3  | `UPDATE `xxxxx`SET`id` = ?,`stars`= ? WHERE`id` = ?`                                          |
| UpdateTest.java#updateTest26          | `SELECT `id`,`username`,AES_DECRYPT(from_base64(`phone`),?) AS `phone`,`id_card`,`address`,…` |
| UpdateTest.java#updateTest26_1        | `SELECT `id`,`username`,AES_DECRYPT(from_base64(`phone`),?) AS `phone`,`id_card`,`address`,…` |

### 换 schema（asSchema）（`table.schema`，写法不同）

| 用例                              | 断言的 SQL（摘要）                                                                        |
| --------------------------------- | ----------------------------------------------------------------------------------------- |
| DeleteTest.java#deletex2          | `UPDATE `asv`.`t_blog` xx SET xx.`deleted` = ? WHERE xx.`deleted` = ? AND xx.`id` = ?`    |
| InsertTest.java#insertEmpty       |                                                                                           |
| InsertTest.java#insertTest3       | `INSERT INTO `xxx`.`aaa` (`stars`,`title`,`create_time`) VALUES (?,?,?)`                  |
| InsertTest.java#insertTest5       | `INSERT INTO `xxx`.`t_topic_autoaaa` (`stars`,`title`,`create_time`) VALUES (?,?,?)`      |
| InsertTest.java#insertTest6       | `INSERT INTO `xxx`.`t_topic_autoaaa` (`stars`,`create_time`) VALUES (?,?)`                |
| InsertTest.java#insertTest7       | `INSERT INTO `xxx`.`t_topic_autoaaa` (`stars`,`title`,`create_time`) VALUES (?,?,?)`      |
| InsertTest.java#insertTest8       | `INSERT INTO `xxx`.`t_topic_autoaaa` (`stars`,`create_time`) VALUES (?,?)`                |
| InsertTest.java#insertTest8_1     | `INSERT IGNORE INTO `xxx`.`t_topic_autoaaa` (`stars`,`create_time`) VALUES (?,?)`         |
| InsertTest.java#insertTest9       |                                                                                           |
| pgsql/InsertTest.java#insertTest1 | `INSERT INTO \`                                                                           |
| UpdateTest.java#updateTest16      |                                                                                           |
| UpdateTest1.java#testUpdate1      | `UPDATE `_abc`.`t_topic_abc`SET`title`= ? WHERE`id` = ?`                                  |
| UpdateTest1.java#testUpdate1_1    | `UPDATE `_abc`.`t_topic_abc`SET`title`= ? WHERE`id` = ?`                                  |
| UpdateTest1.java#testUpdate1_2    | `UPDATE `_abc`.`t_topic_abc`SET`title` = CAST(`stars`AS CHAR) WHERE`id` = ?`              |
| UpdateTest1.java#testUpdate1_3    | `UPDATE `_abc`.`t_topic_abc`SET`title`=`stars`WHERE`id` = ?`                              |
| UpdateTest1.java#testUpdate2      | `UPDATE `_abc`.`t_topic_abc`SET`stars` = ?,`title` = ?,`create_time`= ? WHERE`id` = ?`    |
| UpdateTest1.java#testUpdate3      | `UPDATE `_abc`.`t_topic_abc`SET`title` = ?,`stars`= ? WHERE`id`= ? AND`stars` = ?`        |
| UpdateTest1.java#testUpdate4      | `UPDATE `_abc`.`t_blog_abc`SET`is_top` = (NOT (`is_top`)) WHERE `deleted`= ? AND`id` = …` |
| UpdateTest1.java#testUpdate5      | `UPDATE `_abc`.`t_blog_abc`SET`title`= (CASE WHEN`title`= ? THEN ? ELSE ? END) WHERE`…`   |

### 追踪与差异更新（`tracking`，写法不同）

| 用例                                        | 断言的 SQL（摘要）                                                                            |
| ------------------------------------------- | --------------------------------------------------------------------------------------------- |
| EntityQueryAggregateTest1.java#test10       | `SELECT SUM(t.`stars`) FROM `t_topic` t`                                                      |
| EntityQueryAggregateTest6.java#test1        | `SELECT SUM(t.`stars`) FROM `t_topic`t LEFT JOIN`t_topic` t1 ON t.`id` = t1.`id` LEFT JOI…`   |
| EntityQueryAggregateTest6.java#test2        | `SELECT SUM(t.`stars`) FROM `t_topic`t LEFT JOIN`t_topic` t1 ON t.`id` = t1.`id` LEFT JOI…`   |
| EntityQueryAggregateTest6.java#test3        | `SELECT SUM(t.`stars`) FROM `t_topic`t LEFT JOIN`t_topic` t1 ON t.`id` = t1.`id` LEFT JOI…`   |
| EntityQueryAggregateTest6.java#test4        | `SELECT SUM(t.`stars`) FROM `t_topic`t LEFT JOIN`t_topic` t1 ON t.`id` = t1.`id` LEFT JOI…`   |
| EntityQueryAggregateTest6.java#test5        | `SELECT SUM(t.`stars`) FROM `t_topic`t LEFT JOIN`t_topic` t1 ON t.`id` = t1.`id` LEFT JOI…`   |
| EntityQueryAggregateTest6.java#test6        | `SELECT SUM(t.`stars`) FROM `t_topic`t LEFT JOIN`t_topic` t1 ON t.`id` = t1.`id` LEFT JOI…`   |
| EntityQueryAggregateTest6.java#test7        | `SELECT SUM(t.`stars`) FROM `t_topic`t LEFT JOIN`t_topic` t1 ON t.`id` = t1.`id` LEFT JOI…`   |
| EntityQueryAggregateTest6.java#test8        | `SELECT SUM(t.`stars`) FROM `t_topic`t LEFT JOIN`t_topic` t1 ON t.`id` = t1.`id` LEFT JOI…`   |
| EntityQueryAggregateTest6.java#test9        | `SELECT SUM(t.`stars`) FROM `t_topic`t LEFT JOIN`t_topic` t1 ON t.`id` = t1.`id``             |
| mysql8/ManyJoinTest.java#testManyJoinGroup1 |                                                                                               |
| MyTest1.java#testSelect6_3                  | `SELECT t.`id`AS`id`,COUNT(t1.`id`) AS `id_count`FROM`t_topic`t LEFT JOIN`t_blog` t1 …`       |
| MyTest2.java#testSelect6_3                  | `SELECT t.`id`AS`id`,COUNT(t1.`id`) AS `id_count`FROM`t_topic`t LEFT JOIN`t_blog` t1 …`       |
| QueryTest.java#query14                      |                                                                                               |
| QueryTest27.java#testDiff                   |                                                                                               |
| QueryTest27.java#testDiff2                  |                                                                                               |
| QueryTest28.java#testQueryAggregate         | `SELECT COUNT(*) AS `value1`,SUM((CASE WHEN t.`title` LIKE CONCAT('%',?,'%') THEN t.`stars`…` |
| QueryTest28.java#testQueryAggregate1        | `SELECT COUNT(*) AS `value1`,SUM((CASE WHEN t.`title` LIKE CONCAT('%',?,'%') THEN t.`stars`…` |
| QueryTest6.java#joinTest1                   | `SELECT DISTINCT t.`id`,COUNT(t.`id`) AS `stars`FROM`t_topic`t RIGHT JOIN`t_topic` t1 O…`     |
| QueryTest6.java#joinTest2                   | `SELECT DISTINCT t.`id`,COUNT(t.`id`) AS `stars`FROM`t_topic`t RIGHT JOIN`t_topic` t1 O…`     |
| QueryTest6.java#joinTest3                   | `SELECT DISTINCT t.`id`,COUNT(t.`id`) AS `stars`FROM`t_topic`t RIGHT JOIN`t_topic` t1 O…`     |
| QueryTest6.java#joinTest4                   | `SELECT DISTINCT t.`id`,COUNT(t.`id`) AS `stars`FROM`t_topic`t RIGHT JOIN`t_topic` t1 O…`     |
| QueryTest6.java#joinTest5                   | `SELECT DISTINCT t.`id`,COUNT(t.`id`) AS `stars`FROM`t_topic`t RIGHT JOIN`t_topic` t1 O…`     |
| QueryTest6.java#joinTest6                   | `SELECT DISTINCT t.`id`,COUNT(t.`id`) AS `stars`FROM`t_topic`t RIGHT JOIN`t_topic` t1 O…`     |
| QueryTest6.java#joinTest7                   | `SELECT DISTINCT t.`id`,COUNT(t.`id`) AS `stars`FROM`t_topic`t RIGHT JOIN`t_topic` t1 O…`     |
| QueryTest7.java#joinTest1                   | `SELECT t.`id`,COUNT(t.`id`) AS `stars`FROM`t_topic`t INNER JOIN`t_topic` t1 ON t.`id` …`     |
| QueryTest7.java#joinTest2                   | `SELECT t.`id`,COUNT(t.`id`) AS `stars`FROM`t_topic`t INNER JOIN`t_topic` t1 ON t.`id` …`     |
| QueryTest7.java#joinTest3                   | `SELECT t.`id`,COUNT(t.`id`) AS `stars`FROM`t_topic`t INNER JOIN`t_topic` t1 ON t.`id` …`     |
| QueryTest7.java#joinTest4                   | `SELECT t.`id`,COUNT(t.`id`) AS `stars`FROM`t_topic`t INNER JOIN`t_topic` t1 ON t.`id` …`     |
| QueryTest7.java#joinTest5                   | `SELECT t.`id`,COUNT(t.`id`) AS `stars`FROM`t_topic`t INNER JOIN`t_topic` t1 ON t.`id` …`     |
| QueryTest7.java#joinTest6                   | `SELECT t.`id`,COUNT(t.`id`) AS `stars`FROM`t_topic`t INNER JOIN`t_topic` t1 ON t.`id` …`     |
| QueryTest7.java#joinTest7                   | `SELECT t.`id`,COUNT(t.`id`) AS `stars`FROM`t_topic`t INNER JOIN`t_topic` t1 ON t.`id` …`     |
| RelationTest.java#testOneToOne              | `SELECT `id`,`name`FROM`school_class``                                                        |
| TrackTest.java#track1                       |                                                                                               |
| TrackTest.java#track2                       |                                                                                               |
| TrackTest.java#track3                       |                                                                                               |
| TrackTest.java#track4                       |                                                                                               |
| TrackTest.java#track5                       |                                                                                               |
| UpdateTest.java#updateTest17                | `UPDATE `t_topic`SET`title`= ? WHERE`id`= ? AND`title` IS NULL`                               |
| UpdateTest.java#updateTest17_1              | `UPDATE `t_topic`SET`title`= ? WHERE`id`= ? AND`title` IS NULL`                               |
| UpdateTest.java#updateTest17_2              | `UPDATE `t_topic`SET`title`= ? WHERE`id`= ? AND`stars`IS NULL AND`create_time` IS N…`         |
| UpdateTest.java#updateTest20                | `UPDATE `t_topic`SET`title`= ? WHERE`id`= ? AND`title` = ?`                                   |
| UpdateTest.java#updateTest21                | `UPDATE `x1234`SET`title`= ? WHERE`id`= ? AND`title` = ?`                                     |
| UpdateTest.java#updateTest21_1              | `UPDATE `x1234`SET`title`= ? WHERE`id`= ? AND`title` = ?`                                     |
| UpdateTest.java#updateTest22                | `UPDATE `x123`SET`title`= ? WHERE`id` = ?`                                                    |
| UpdateTest.java#updateTest22_1              | `UPDATE `x123`SET`title`= ? WHERE`id` = ?`                                                    |
| UpdateTest.java#updateTest23                | `UPDATE `x123`SET`title`= ? WHERE`title` = ?`                                                 |
| UpdateTest.java#updateTest23_1              | `UPDATE `x123`SET`title`= ? WHERE`title` = ?`                                                 |
| UpdateTest.java#updateTest24                | `UPDATE `x123`SET`stars` = ?,`create_time`= ? WHERE`title` = ?`                               |
| UpdateTest.java#updateTest24_1              | `UPDATE `x123`SET`stars` = ?,`create_time`= ? WHERE`title` = ?`                               |
| UpdateTest.java#updateTest28                | `UPDATE `t_topic`SET`title`= ? WHERE`id` = ?`                                                 |
| UpdateTest.java#updateTest28_1              | `UPDATE `t_topic`SET`title`= ? WHERE`id` = ?`                                                 |
| UpdateTest.java#updateTest30                | `UPDATE `x1234`SET`content`= ? WHERE`deleted`= ? AND`id` = ?`                                 |
| UpdateTest.java#updateTest31                | `UPDATE `x1234`SET`content`= ? WHERE`deleted`= ? AND`id` = ?`                                 |
| UpdateTest.java#updateTest5                 | `UPDATE `t_topic`SET`title`= ? WHERE`id` = ?`                                                 |
| UpdateTest.java#updateTest6                 | `UPDATE `t_topic`SET`title`= ? WHERE`id` = ?`                                                 |
| UpdateTest.java#updateTest7                 | `UPDATE `t_topic`SET`title`= ? WHERE`id` = ?`                                                 |
| UpdateTest.java#updateTrackParameterTest1   | `UPDATE `aaaxxx`SET`title`= ? WHERE`id`= ? AND`title` = ?`                                    |
| UpdateTest.java#updateTrackParameterTest2   | `UPDATE `aaaxxx`SET`title`= ? WHERE`id`= ? AND`title` = ?`                                    |
| UpdateTest.java#updateTrackParameterTest3   | `UPDATE `aaaxxx`SET`stars` = ?,`create_time`= ? WHERE`id`= ? AND`title` = ?`                  |
| UpdateTest1.java#updateTest51               |                                                                                               |
| UpdateTest1.java#updateTestUpdate2          | `UPDATE `t_topic`SET`title` = ?,`create_time`= ? WHERE`id` = ?`                               |

### 树（toTreeList / asTreeCTE）（`tree`，已对应）

| 用例                                     | 断言的 SQL（摘要）                                                                          |
| ---------------------------------------- | ------------------------------------------------------------------------------------------- |
| mysql8/MySQL8Test2.java#cteViewTree1     |                                                                                             |
| mysql8/MySQL8Test2.java#cteViewTree2     |                                                                                             |
| mysql8/MySQL8Test3.java#testTree         | `WITH RECURSIVE `as_tree_cte`AS ( (SELECT 0 AS`cte_deep`,t1.`id`,t1.`parent_id`,t1.`conte…` |
| mysql8/MySQL8Test3.java#testTree_1       | `WITH RECURSIVE `as_tree_cte`AS ( (SELECT 0 AS`cte_deep`,t1.`id`,t1.`parent_id`,t1.`conte…` |
| pgsql/QueryTest19.java#cteViewTree1      |                                                                                             |
| pgsql/QueryTest19.java#testToTreeList    | `WITH RECURSIVE \`                                                                          |
| pgsql/QueryTest19.java#testToTreeList2   | `WITH RECURSIVE \`                                                                          |
| pgsql/QueryTest19.java#testToTreeList3   | `WITH RECURSIVE \`                                                                          |
| pgsql/QueryTest19.java#testToTreeListDTO | `WITH RECURSIVE \`                                                                          |
| pgsql/QueryTest19.java#tree10            | `WITH RECURSIVE \`                                                                          |
| pgsql/QueryTest19.java#tree10_1          | `WITH RECURSIVE \`                                                                          |
| pgsql/QueryTest19.java#tree11            | `WITH RECURSIVE \`                                                                          |
| pgsql/QueryTest19.java#tree12            | `WITH RECURSIVE \`                                                                          |
| pgsql/QueryTest19.java#tree7_1           | `WITH RECURSIVE \`                                                                          |
| pgsql/QueryTest19.java#tree7_2           | `WITH RECURSIVE \`                                                                          |
| pgsql/QueryTest19.java#tree9             | `WITH RECURSIVE \`                                                                          |
| QueryTest11.java#testCTE1                | `WITH RECURSIVE `as_tree_cte`AS ( (SELECT 0 AS`cte_deep`,t1.`id`,t1.`stars`,t1.`title`,t1…` |
| QueryTest7.java#testCTE1                 | `WITH RECURSIVE `as_tree_cte`AS ( (SELECT 0 AS`cte_deep`,t1.`id`,t1.`stars`,t1.`title`,t1…` |
| QueryTest7.java#testCTE1_1               | `WITH RECURSIVE `as_tree_cte`AS ( (SELECT 0 AS`cte_deep`,t1.`id`,t1.`stars`,t1.`title`,t1…` |
| QueryTest7.java#testCTE2                 | `WITH RECURSIVE `as_tree_cte`AS ( (SELECT 0 AS`cte_deep`,t1.`id`,t1.`stars`,t1.`title`,t1…` |
| QueryTest7.java#testCTE3                 | `WITH RECURSIVE `as_tree_cte`AS ( (SELECT 0 AS`cte_deep`,t1.`id`,t1.`stars`,t1.`title`,t1…` |
| QueryTest7.java#testCTE4                 | `WITH RECURSIVE `as_tree_cte`AS ( (SELECT 0 AS`cte_deep`,t1.`id`,t1.`stars`,t1.`title`,t1…` |
| QueryTest7.java#testCTE5                 | `WITH RECURSIVE `as_tree_cte`AS ( (SELECT 0 AS`cte_deep`,t1.`id`,t1.`stars`,t1.`title`,t1…` |
| QueryTest7.java#testCTE6                 | `WITH RECURSIVE `as_tree_cte`AS ( (SELECT 0 AS`cte_deep`,t1.`id`,t1.`stars`,t1.`title`,t1…` |
| QueryTest7.java#testCTE7                 | `WITH RECURSIVE `abc`AS ( (SELECT 0 AS`xyz`,t1.`id`,t1.`stars`,t1.`title`,t1.`create_time…` |

### 乐观锁版本（`version`，已对应）

| 用例                     | 断言的 SQL（摘要）                                                                          |
| ------------------------ | ------------------------------------------------------------------------------------------- |
| VersionTest.java#test1   |                                                                                             |
| VersionTest.java#test10  | `UPDATE `AXX`SET`username` = ?,`version`= ? WHERE`deleted`= ? AND`version`= ? AND`i…`       |
| VersionTest.java#test2   |                                                                                             |
| VersionTest.java#test3   | `UPDATE `t_sys_user_version`SET`phone`= ? WHERE`id` = ?`                                    |
| VersionTest.java#test3_1 | `UPDATE `t_sys_user_version`SET`phone` = ?,`version`= ? WHERE`version`= ? AND`id` = ?`      |
| VersionTest.java#test3_2 | `UPDATE `t_sys_user_version`SET`phone`= ? WHERE`id` = ?`                                    |
| VersionTest.java#test3_3 |                                                                                             |
| VersionTest.java#test4   |                                                                                             |
| VersionTest.java#test5   |                                                                                             |
| VersionTest.java#test6   | `UPDATE `t_sys_user_version_del`SET`deleted` = ?,`version`= ? WHERE`deleted`= ? AND`v…`     |
| VersionTest.java#test7   | `UPDATE `aaa`SET`username` = ?,`phone` = ?,`id_card` = ?,`address` = ?,`create_time` = ? …` |
| VersionTest.java#test8   |                                                                                             |
| VersionTest.java#test9   | `UPDATE `AXX`SET`username` = ?,`version`= ? WHERE`deleted`= ? AND`version`= ? AND`i…`       |

### 窗口函数与分区（`window`，已对应）

| 用例                                           | 断言的 SQL（摘要）                                                                            |
| ---------------------------------------------- | --------------------------------------------------------------------------------------------- |
| doc/DocTest1.java#testBlog1                    | `SELECT t.`id`,t.`title`,t.`topic`,t.`url`,t.`star`,t.`publish_time`,t.`score`,t.`status`,(…` |
| doc/DocTest1.java#testBlog2                    | `SELECT t1.`id`,t1.`title`,t1.`topic`,t1.`url`,t1.`star`,t1.`publish_time`,t1.`score`,t1.`s…` |
| doc/DocTest1.java#testBlog3                    | `SELECT t1.`id`,t1.`title`,t1.`topic`,t1.`url`,t1.`star`,t1.`publish_time`,t1.`score`,t1.`s…` |
| mysql8/ManyJoinTest.java#test111               |                                                                                               |
| mysql8/MySQL8Test3.java#nextTest               | `SELECT t.`type`AS`value1`,LAG(t.`type`, 1) OVER (ORDER BY t.`type` ASC,t.`code` DESC) AS…`   |
| mysql8/MySQL8Test3.java#nextTest1              | `SELECT t.`type`AS`value1`,LAG(t.`type`, 1) OVER (ORDER BY t.`type` ASC,t.`code` DESC) AS…`   |
| mysql8/MySQL8Test3.java#nextTest2              |                                                                                               |
| mysql8/MySQL8Test3.java#nextTest3              | `SELECT t.`type`AS`value1`,LAG(t.`type`, 1) OVER (ORDER BY t.`open_time`ASC) AS`value2`…`     |
| mysql8/MySQL8Test5.java#testOffsetChunk        |                                                                                               |
| pgsql/PartitionByTest.java#testPartitionBy16_1 | `SELECT t1.\`                                                                                 |
| pgsql/PartitionByTest.java#testPartitionBy16_2 | `SELECT t1.\`                                                                                 |
| pgsql/PartitionByTest.java#testPartitionBy16_3 | `SELECT t1.\`                                                                                 |
| pgsql/QueryTest.java#testPartitionBy1          | `SELECT t1.\`                                                                                 |
| pgsql/QueryTest.java#testPartitionBy10         | `SELECT t1.\`                                                                                 |
| pgsql/QueryTest.java#testPartitionBy11         | `SELECT t1.\`                                                                                 |
| pgsql/QueryTest.java#testPartitionBy12         | `SELECT t1.\`                                                                                 |
| pgsql/QueryTest.java#testPartitionBy13         | `SELECT t1.\`                                                                                 |
| pgsql/QueryTest.java#testPartitionBy14         | `SELECT t1.\`                                                                                 |
| pgsql/QueryTest.java#testPartitionBy15         | `SELECT t1.\`                                                                                 |
| pgsql/QueryTest.java#testPartitionBy16         | `SELECT t1.\`                                                                                 |
| pgsql/QueryTest.java#testPartitionBy16_1       | `SELECT t1.\`                                                                                 |
| pgsql/QueryTest.java#testPartitionBy2          | `SELECT t1.\`                                                                                 |
| pgsql/QueryTest.java#testPartitionBy3          | `SELECT t1.\`                                                                                 |
| pgsql/QueryTest.java#testPartitionBy3_1        | `SELECT t1.\`                                                                                 |
| pgsql/QueryTest.java#testPartitionBy3_2        | `SELECT t1.\`                                                                                 |
| pgsql/QueryTest.java#testPartitionBy4          | `SELECT t1.\`                                                                                 |
| pgsql/QueryTest.java#testPartitionBy5          | `SELECT t1.\`                                                                                 |
| pgsql/QueryTest.java#testPartitionBy6          | `SELECT t1.\`                                                                                 |
| pgsql/QueryTest.java#testPartitionBy7          | `SELECT t1.\`                                                                                 |
| pgsql/QueryTest.java#testPartitionBy8          | `SELECT t1.\`                                                                                 |
| pgsql/QueryTest.java#testPartitionBy9          | `SELECT t1.\`                                                                                 |
| QueryTest18.java#testPartitionBy1              | `SELECT t1.`id`,t1.`stars`,t1.`title`,t1.`create_time`,t1.`__part__column1`AS`__part__col…`   |
| QueryTest18.java#testPartitionBy1_1            | `SELECT t1.`id`,t1.`stars`,t1.`title`,t1.`create_time`,t1.`__part__column1`AS`__part__col…`   |
| QueryTest26.java#testChunk3                    |                                                                                               |
| QueryTest26.java#testChunk4                    |                                                                                               |
| QueryTest26.java#testChunk5                    |                                                                                               |
| QueryTest26.java#testChunk6                    |                                                                                               |
| QueryTest26.java#testChunk7                    |                                                                                               |

### 删除（`write.delete`，已对应）

| 用例                                               | 断言的 SQL（摘要）                                                                          |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| DeleteTest.java#delete                             |                                                                                             |
| DeleteTest.java#deleteTest13                       |                                                                                             |
| DeleteTest.java#deleteTest14                       |                                                                                             |
| DeleteTest.java#deleteTest19                       | `UPDATE `t_blog`SET`deleted`= ? WHERE`deleted`= ? AND`id` = ?`                              |
| DeleteTest.java#deleteTest20                       | `UPDATE `t_blog123abc`SET`deleted`= ? WHERE`deleted`= ? AND`id`= ? AND`create_time`…`       |
| DeleteTest.java#deleteTest21                       | `DELETE FROM `t_topic123abc`WHERE`id` = ?`                                                  |
| DeleteTest.java#deleteTest22                       | `UPDATE `t_blog123abc`SET`deleted`= ? WHERE`deleted`= ? AND`id` = ?`                        |
| DeleteTest.java#deleteTest5                        | `UPDATE `t_blog`SET`deleted`= ? WHERE`deleted`= ? AND`id` = ?`                              |
| DeleteTest.java#deletex                            | `DELETE FROM `t_blog`WHERE`id` = ?`                                                         |
| DeleteTest.java#deletex1                           | `UPDATE `t_blog`SET`deleted`= ? WHERE`deleted`= ? AND`id` = ?`                              |
| mysql8/MySQL8Test2.java#testDelete                 | `SELECT t.`id`,t.`uid`,t.`code`,t.`type`,t.`bank_id`,t.`open_time`FROM`t_bank_card` t INN…` |
| QueryTest12.java#testDoc23                         | `DELETE FROM `relation_user`t WHERE EXISTS(SELECT 1 FROM`relation_teacher` t1 WHERE EXIST…` |
| QueryTest26.java#testAAA                           |                                                                                             |
| TestDeleteFlatAndPredicate.java#testExpressionKey  |                                                                                             |
| TestDeleteFlatAndPredicate.java#testExpressionKey2 |                                                                                             |
| TestDeleteFlatAndPredicate.java#testExpressionKey3 |                                                                                             |
| TestDeleteFlatAndPredicate.java#testExpressionKey4 |                                                                                             |
| TestDeleteFlatAndPredicate.java#testExpressionKey5 |                                                                                             |
| TestDeleteFlatAndPredicate.java#testExpressionKey6 |                                                                                             |
| TestDeleteFlatAndPredicate.java#testExpressionKey7 |                                                                                             |
| TestDeleteFlatAndPredicate.java#testExpressionKey8 |                                                                                             |

### 插入（`write.insert`，已对应）

| 用例                                                   | 断言的 SQL（摘要）                                                                            |
| ------------------------------------------------------ | --------------------------------------------------------------------------------------------- |
| DeleteTest.java#deleteTest1                            | `DELETE FROM `t_topic`WHERE`id` = ?`                                                          |
| DeleteTest.java#deleteTest2                            | `DELETE FROM `t_topic`WHERE`title` = ?`                                                       |
| DeleteTest.java#deleteTest3                            | `DELETE FROM `t_topic`WHERE`id` = ?`                                                          |
| DeleteTest.java#deleteTest3_1                          | `DELETE FROM `t_topic`WHERE`id` = ?`                                                          |
| DeleteTest.java#deleteTest4                            | `DELETE FROM `t_topic`WHERE`id` = ?`                                                          |
| DeleteTest.java#deleteTest6                            |                                                                                               |
| GeneralFunctionsTest.java#MySQLInsertIgnore2UpdateKey3 | `INSERT INTO `t_topic_auto` (`stars`,`title`) VALUES (?,?)`                                   |
| InsertTest.java#incrementTest1                         | `INSERT INTO `custom_increment` (`id`,`name`,`address`) VALUES (mysqlNextId(),?,?)`           |
| InsertTest.java#incrementTest2                         | `INSERT INTO `custom_increment` (`id`,`name`,`address`) VALUES (mysqlNextId(),?,?)`           |
| InsertTest.java#insertCustom                           | `INSERT INTO `xxxxx` (`stars`) VALUES (?)`                                                    |
| InsertTest.java#insertCustom1                          | `INSERT INTO `xxxxx` (`id`,`stars`) VALUES (sde.next_rowid('sde',?),?)`                       |
| InsertTest.java#insertSQLConvert1                      | `INSERT INTO `xxxxx` (`id`,`username`,`phone`,`id_card`,`address`,`create_time`) VALUES (?,…` |
| InsertTest.java#insertSQLConvert2                      |                                                                                               |
| InsertTest.java#insertSQLConvert3                      |                                                                                               |
| InsertTest.java#insertTest2                            |                                                                                               |
| InsertTest1.java#inertTest1                            | `INSERT INTO `t_topic_abc` (`id`,`stars`,`title`,`create_time`) VALUES (?,?,?,?)`             |
| mysql8/MySQL8Test5.java#testLikeStartsWith             | `SELECT `column1`,`column2`,`column3`FROM`no_key_table`WHERE`column2` LIKE CONCAT(?,'%'…`     |
| MyTest1.java#testDraft11                               | `SELECT timestampdiff(DAY, t.`create_time`, t.`update_time`) AS `value1`,timestampdiff(HOUR…` |
| MyTest1.java#testDraft6                                | `SELECT date_add(date_add(t.`create_time`, interval (?) month), interval (?) day) AS `value…` |
| MyTest1.java#testDraft7                                | `SELECT YEAR(t.`create_time`) AS `value1`,MONTH(t.`create_time`) AS `value2`,DAYOFMONTH(t.`…` |
| MyTest1.java#testDraft8                                | `SELECT YEAR(t.`create_time`) AS `value1`,MONTH(t.`create_time`) AS `value2`,DAYOFMONTH(t.`…` |
| MyTest1.java#testDraft9                                | `SELECT timestampdiff(DAY, t.`update_time`, t.`create_time`) AS `value1`,timestampdiff(HOUR…` |
| MyTest2.java#testTuple11                               | `SELECT timestampdiff(DAY, t.`create_time`, t.`update_time`) AS `value1`,timestampdiff(HOUR…` |
| MyTest2.java#testTuple6                                | `SELECT date_add(date_add(t.`create_time`, interval (?) month), interval (?) day) AS `value…` |
| MyTest2.java#testTuple7                                | `SELECT YEAR(t.`create_time`) AS `value1`,MONTH(t.`create_time`) AS `value2`,DAYOFMONTH(t.`…` |
| MyTest2.java#testTuple8                                | `SELECT YEAR(t.`create_time`) AS `value1`,MONTH(t.`create_time`) AS `value2`,DAYOFMONTH(t.`…` |
| MyTest2.java#testTuple9                                | `SELECT timestampdiff(DAY, t.`update_time`, t.`create_time`) AS `value1`,timestampdiff(HOUR…` |
| pgsql/QueryTest.java#testDraft9                        |                                                                                               |
| pgsql/QueryTest.java#testDraft9_1                      |                                                                                               |
| pgsql/QueryTest18.java#testLikeStartsWith              | `SELECT \`                                                                                    |
| pgsql/QueryTest19.java#testUUId                        |                                                                                               |
| QueryTest.java#query69                                 |                                                                                               |
| QueryTest.java#query70                                 |                                                                                               |
| QueryTest.java#query70_1                               |                                                                                               |
| QueryTest.java#query71                                 |                                                                                               |
| QueryTest15.java#test2                                 | `SELECT `id`,`first_name`,`last_name`,`birthday`,CONCAT(`first_name`,`last_name`) AS `full_…` |
| QueryTest15.java#test3                                 | `SELECT `id`,`first_name`,`last_name`,`birthday`,CONCAT(`first_name`,`last_name`) AS `full_…` |
| QueryTest18.java#test111                               |                                                                                               |
| QueryTest27.java#testUUId                              |                                                                                               |
| QueryTest4.java#testJson1                              |                                                                                               |
| QueryTest4.java#testJson2                              |                                                                                               |
| QueryTest4.java#testJson2Jackson                       |                                                                                               |
| UpperPropertyTest.java#test1                           |                                                                                               |
| UpperPropertyTest.java#test2                           |                                                                                               |

### 更新 / 删除里用导航（UPDATE / DELETE 带 JOIN）（`write.join`，写法不同）

| 用例                                            | 断言的 SQL（摘要）                                                                          |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------- |
| pgsql/DeleteUpdateJoinTest.java#testDeleteJoin1 | `DELETE FROM \`                                                                             |
| pgsql/DeleteUpdateJoinTest.java#testDeleteJoin2 | `DELETE FROM \`                                                                             |
| pgsql/DeleteUpdateJoinTest.java#testUpdateJoin1 | `UPDATE \`                                                                                  |
| pgsql/DeleteUpdateJoinTest.java#testUpdateJoin2 | `UPDATE \`                                                                                  |
| pgsql/DeleteUpdateJoinTest.java#testUpdateJoin3 |                                                                                             |
| pgsql/DeleteUpdateJoinTest.java#testUpdateJoin4 |                                                                                             |
| UpdateDeleteJoinTest.java#testDeleteJoin1       | `DELETE t FROM `doc_bank_card`t INNER JOIN`doc_user` t1 ON t1.`id` = t.`uid` WHERE t1.`na…` |
| UpdateDeleteJoinTest.java#testDeleteJoin2       | `DELETE t FROM `doc_bank_card`t INNER JOIN`doc_user` t1 ON t1.`id` = t.`uid` WHERE t1.`na…` |
| UpdateDeleteJoinTest.java#testUpdateJoin1       | `UPDATE `doc_bank_card`t INNER JOIN`doc_user` t1 ON t1.`id` = t.`uid` SET t.`type` = t1.`…` |
| UpdateDeleteJoinTest.java#testUpdateJoin2       | `UPDATE `doc_bank_card`t INNER JOIN`doc_bank` t1 ON t1.`id` = t.`bank_id`INNER JOIN`doc…`   |

### 写哪些列、批量执行（`write.strategy`，写法不同）

| 用例                                 | 断言的 SQL（摘要）                                                                            |
| ------------------------------------ | --------------------------------------------------------------------------------------------- |
| DeleteTest.java#testBatchDelete      | `DELETE FROM `t_topic`WHERE`id` = ?`                                                          |
| InsertTest.java#insertBatch          |                                                                                               |
| InsertTest.java#mapInsertTest1       | `INSERT INTO `aaaaa` (`id`,`name`) VALUES (?,?)`                                              |
| InsertTest.java#mapInsertTest2       | `INSERT INTO `aaaaa` (`id`,`name`,`name1`) VALUES (?,?,?)`                                    |
| InsertTest.java#mapInsertTest3       | `INSERT INTO `aaaaa` (`id`,`name`,`name1`,`name2`) VALUES (?,?,?,?)`                          |
| InsertTest.java#testIncrement        |                                                                                               |
| InsertTest1.java#tesInsertMapKey2    | `INSERT INTO \`                                                                               |
| mysql8/MySQL8Test3.java#batchTest    |                                                                                               |
| UpdateTest.java#mapUpdateTest2       | `UPDATE `aaa`SET`name`= ? WHERE`id` = ?`                                                      |
| UpdateTest.java#mapUpdateTest3       | `UPDATE `aaa`SET`name` = ?,`name1`= ? WHERE`id` = ?`                                          |
| UpdateTest.java#mapUpdateTest4       |                                                                                               |
| UpdateTest.java#mapUpdateTest5       | `UPDATE `t_topic`SET`stars`= ? WHERE`id` = ?`                                                 |
| UpdateTest.java#mapUpdateTest511     |                                                                                               |
| UpdateTest.java#testColumnConfigure1 | `INSERT INTO `xxxxx` (`id`,`stars`,`title`,`create_time`) VALUES (?,ifnull(`stars`,0)+?,?,?…` |
| UpdateTest.java#updateTest8          | `UPDATE `t_topic`SET`title`= ? WHERE`id` = ?`                                                 |
| UpdateTest.java#updateTest9          | `UPDATE `t_topic`SET`stars` = ?,`create_time`= ? WHERE`id` = ?`                               |
| UpdateTest.java#updateTestBatch      |                                                                                               |
| UpdateTest.java#updateTestBatch1     |                                                                                               |
| UpdateTest.java#updateTestBatch2     |                                                                                               |

### 更新（`write.update`，已对应）

| 用例                                               | 断言的 SQL（摘要）                                                                          |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| mysql8/M8BankTest.java#testaa1                     |                                                                                             |
| mysql8/ManyJoinTest.java#test2GroupJoinCombine     | `UPDATE `t_sys_user` t LEFT JOIN (SELECT t1.`uid`AS`**group_key1**`,(COUNT(?) > 0) AS `__…` |
| QueryTest18.java#test123                           |                                                                                             |
| QueryTest21.java#TestReverse                       | `SELECT COUNT(*) FROM `t_topic`WHERE`id` IS NOT NULL`                                       |
| QueryTest24.java#test123                           |                                                                                             |
| QueryTest26.java#testQuery2                        | `UPDATE `sys_user_encrypt`SET`phone`= to_base64(AES_ENCRYPT(?,?)) WHERE`id` = ?`            |
| QueryTest26.java#testQuery3                        | `UPDATE `sys_user2`SET`phone`= to_base64(AES_ENCRYPT(?,?)) WHERE`id` = ?`                   |
| QueryTest26.java#updateConcat                      |                                                                                             |
| QueryTest28.java#testIncrementNullZero             | `UPDATE `t_topic`SET`stars` = (IFNULL(`stars`,?) + ?) WHERE `id` = ?`                       |
| TestUpdateFlatAndPredicate.java#testExpressionKey  |                                                                                             |
| TestUpdateFlatAndPredicate.java#testExpressionKey2 |                                                                                             |
| TestUpdateFlatAndPredicate.java#testExpressionKey3 |                                                                                             |
| TestUpdateFlatAndPredicate.java#testExpressionKey4 |                                                                                             |
| TestUpdateFlatAndPredicate.java#testExpressionKey5 |                                                                                             |
| TestUpdateFlatAndPredicate.java#testExpressionKey6 |                                                                                             |
| TestUpdateFlatAndPredicate.java#testExpressionKey7 |                                                                                             |
| TestUpdateFlatAndPredicate.java#testExpressionKey8 |                                                                                             |
| UpdateTest.java#testUpdateIdNull1                  | `UPDATE `t_topic`SET`title` = CONCAT(SUBSTR(`title`,2,10),LOWER(`id`)) WHERE `id` = ?`      |
| UpdateTest.java#updateEntityWhere                  | `UPDATE `t_blog`SET`create_time` = ?,`update_time` = ?,`create_by` = ?,`update_by` = ?,`t…` |
| UpdateTest.java#updateSet1                         | `UPDATE `t_topic`SET`stars` = ?,`stars` = CAST(`title` AS SIGNED),`title` = ?,`title` = D…` |
| UpdateTest.java#updateSetFuncTest1                 | `UPDATE `a123123`SET`title` = CONCAT(SUBSTR(`title`,2,10),`id`) WHERE `id` = ?`             |
| UpdateTest.java#updateSetFuncTest1_1               | `UPDATE `a123123`SET`title` = CONCAT(`id`,SUBSTR(`title`,2,10)) WHERE `id` = ?`             |
| UpdateTest.java#updateSetFuncTest2                 | `UPDATE `a123123`SET`title` = CONCAT(SUBSTR(`title`,2,10),?) WHERE `id` = ?`                |
| UpdateTest.java#updateSetFuncTest3                 | `UPDATE `a123123`SET`title` = CONCAT(SUBSTR(`title`,2,10),LOWER(`id`)) WHERE `id` = ?`      |
| UpdateTest.java#updateTest1                        | `UPDATE `t_topic`SET`stars`= ? WHERE`id`= ? AND`title` = ?`                                 |
| UpdateTest.java#updateTest10                       |                                                                                             |
| UpdateTest.java#updateTest11                       | `UPDATE `t_topic_type`SET`stars`= ? WHERE`topic_type` = ?`                                  |
| UpdateTest.java#updateTest11_1                     | `UPDATE `t_topic_type`SET`stars`= ? WHERE`topic_type` = ?`                                  |
| UpdateTest.java#updateTest12                       |                                                                                             |
| UpdateTest.java#updateTest12_1                     | `UPDATE `t_topic`SET`title` = ?,`create_time`= ? WHERE`id`= ? AND`stars` = ?`               |
| UpdateTest.java#updateTest12_2                     | `UPDATE `t_topic`SET`title` = ?,`create_time`= ? WHERE`id`= ? AND`stars` = ?`               |
| UpdateTest.java#updateTest18_1                     | `UPDATE `xxxxx`SET`stars` = ifnull(`stars`,0)+? WHERE `id` = ?`                             |
| UpdateTest.java#updateTest19                       | `UPDATE `xxxxx`SET`stars` = ifnull(`stars`,0)+?,`title` = ?,`create_time`= ? WHERE`id` …`   |
| UpdateTest.java#updateTest19_1                     | `UPDATE `xxxxx`SET`stars` = ifnull(`stars`,0)+?,`title` = ?,`create_time`= ? WHERE`id` …`   |
| UpdateTest.java#updateTest2                        |                                                                                             |
| UpdateTest.java#updateTest25                       | `UPDATE `xxxxx`SET`username` = ?,`phone` = to_base64(AES_ENCRYPT(?,?)),`id_card` = ?,`add…` |
| UpdateTest.java#updateTest25_1                     | `UPDATE `xxxxx`SET`username` = ?,`phone` = to_base64(AES_ENCRYPT(?,?)),`id_card` = ?,`add…` |
| UpdateTest.java#updateTest27                       | `UPDATE `x123`SET`phone`= to_base64(AES_ENCRYPT(?,?)) WHERE`id` = ?`                        |
| UpdateTest.java#updateTest27_1                     | `UPDATE `x123`SET`phone`= to_base64(AES_ENCRYPT(?,?)) WHERE`id` = ?`                        |
| UpdateTest.java#updateTest29                       | `UPDATE `t_topic`SET`stars` = ?,`create_time`= ? WHERE`id` = ?`                             |
| UpdateTest.java#updateTest29_1                     | `UPDATE `t_topic`SET`stars` = ?,`create_time`= ? WHERE`id` = ?`                             |
| UpdateTest.java#updateTest3                        |                                                                                             |
| UpdateTest.java#updateTest4                        |                                                                                             |
| UpdateTest1.java#updateNoSet                       |                                                                                             |
| UpdateTest1.java#updateTestUpdate                  |                                                                                             |
| UpdateTest1.java#updateTestUpdate1                 | `UPDATE `t_topic`SET`stars` = ?,`title` = ?,`create_time`= ? WHERE`id` = ?`                 |
| UpdateTest1.java#updateTestUpdate3                 | `UPDATE `t_topic`SET`title` = ?,`create_time`= ? WHERE`id` = ?`                             |
| UpdateTest2.java#testUpdateNull                    | `UPDATE \`                                                                                  |
| UpdateTest2.java#testUpdateValueTest               | `UPDATE \`                                                                                  |
| UpdateTest2.java#update1                           |                                                                                             |

### upsert（`write.upsert`，已对应）

| 用例                                                   | 断言的 SQL（摘要）                                                                            |
| ------------------------------------------------------ | --------------------------------------------------------------------------------------------- |
| GeneralFunctionsTest.java#MySQLInsertIgnore2UpdateKey  | `INSERT INTO `doc_bank_card` (`id`,`code`,`type`) VALUES (?,?,?) ON DUPLICATE KEY UPDATE `i…` |
| GeneralFunctionsTest.java#MySQLInsertIgnore2UpdateKey2 |                                                                                               |
| InsertOrUpdateTest.java#test1                          | `MERGE INTO [t_user] t1 USING (SELECT ? AS [column1],? AS [column2],? AS [column3],? AS [co…` |
| InsertTest.java#insertDuplicateKeyUpdate1              | `INSERT INTO `t_topic_auto` (`stars`,`title`,`create_time`) VALUES (?,?,?) ON DUPLICATE KEY…` |
| InsertTest.java#insertDuplicateKeyUpdate2              | `INSERT INTO `t_topic_auto` (`stars`,`title`,`create_time`) VALUES (?,?,?) ON DUPLICATE KEY…` |
| InsertTest.java#insertTestx                            |                                                                                               |
| InsertTest1.java#inertTest2                            | `INSERT INTO `t_topic_abc` (`id`,`stars`,`title`,`create_time`) VALUES (?,?,?,?) ON DUPLICA…` |
| pgsql/InsertTest.java#insertDuplicateKeyIgnore2        | `INSERT INTO \`                                                                               |
| pgsql/InsertTest.java#insertDuplicateKeyUpdate2        | `INSERT INTO \`                                                                               |
| pgsql/InsertTest.java#insertDuplicateKeyUpdate2_1      | `INSERT INTO \`                                                                               |
| pgsql/InsertTest.java#insertDuplicateKeyUpdate3        | `INSERT INTO \`                                                                               |
| pgsql/InsertTest.java#insertTest2                      |                                                                                               |
| QueryTest14.java#testxxxxx                             | `MERGE INTO \`                                                                                |
