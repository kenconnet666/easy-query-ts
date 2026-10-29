# TS：SQL Server 方言与按版本渲染

```ts
const db = createDb({ schema, adapter: mssql(pool) }); // 最新（2022）
const legacy = createDb({ schema, adapter: mssql(pool, { version: 2008 }) });
```

## 按版本渲染（各方言通用的机制）

方言可以带 `version`（核心的 `DialectOptions`）：新版本有更好的写法时用新的；配置成旧版本时退回旧写法；旧版本根本做不到的，渲染时报
`STRING_AGG needs sqlserver 2017 or later (the dialect is configured for 2016)`，而不是把一条库里才报错的 SQL 发出去。
`version` 的取值在类型上限定（SQL Server 是 `2008 | 2012 | … | 2025`）。不给时按最新。

MySQL 同样支持：`mysql(pool, { version: '8.0.18' })`（PolarDB 基线）时 upsert 用 `VALUES(col)`，8.0.19 起用行别名 `AS eq_new`（`VALUES()` 在 8.0.20 起弃用）；
`JSON_OVERLAPS` / `MEMBER OF` 要 8.0.17，窗口函数与 CTE 要 8.0，`NOWAIT` / `SKIP LOCKED` 要 8.0.1，低于时渲染就报错。

| 版本 | 用到的写法                                                                    | 更早的版本                                                               |
| ---- | ----------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| 2012 | `OFFSET … FETCH`、`CONCAT`、`FORMAT`                                          | `ROW_NUMBER()` 包一层分页、`+` 拼接；`FORMAT` 报错                       |
| 2016 | `DROP TABLE IF EXISTS`、`JSON_VALUE` / `OPENJSON`                             | 先读库结构再删；JSON 函数报错                                            |
| 2017 | `STRING_AGG … WITHIN GROUP`、`TRIM`                                           | `joining` 报错；`LTRIM(RTRIM())`                                         |
| 2022 | `GREATEST` / `LEAST`、`IS NOT DISTINCT FROM`、`DATETRUNC`、`JSON_PATH_EXISTS` | `VALUES` 子查询取最值、展开的 null 安全相等、`DATEADD` / `DATEDIFF` 截断 |

同一个 2022 实例上按 2008 渲染的分页、最值、截断与新写法结果一致（实库测试）。

## 与其它库的差异

- 引号 `[]`、参数 `@p1`；`OFFSET … FETCH` 要有 `ORDER BY`，没有时补 `ORDER BY (SELECT NULL)`。
- 比较等条件不能直接当值：select 里写成 `CASE WHEN … THEN 1 ELSE 0 END`；布尔列当条件写成 `= 1`。
- `UPDATE t0 SET … FROM 表 AS t0 [JOIN …]`、`DELETE t0 FROM …`（导航的 join 原生支持）；upsert 写成 `MERGE`；给自增列写值时同一批里 `SET IDENTITY_INSERT … ON / OFF`。
- 自增主键用 `SCOPE_IDENTITY()`；不支持 `returning()`、只读事务、`NTH_VALUE`（报错并建议 `rowNumber()`）。
- 行锁是表提示 `WITH (UPDLOCK, ROWLOCK[, READPAST | NOWAIT])`；保存点是 `SAVE TRANSACTION` / `ROLLBACK TRANSACTION`。
- 子查询里的 `WITH` 提到语句开头；递归 CTE 不写 `RECURSIVE`、只能 `UNION ALL`（数据里有环时由 `MAXRECURSION` 报错，而不是像 `UNION` 那样停下）。
- 字符串字面量用 `N'…'`（日期格式、`joining` 的分隔符里的汉字）；`SUBSTRING` 必须给长度；`padStart` 与 `LPAD` 一样会截断。
- 建表：`IDENTITY(1,1)`、`NVARCHAR`、`DATETIME2(3)`、`BIT`、`NVARCHAR(MAX)`（JSON）、`VARBINARY(MAX)`；注释写成扩展属性 `MS_Description`；改名用 `sp_rename`。
- 专属函数 `MsSql.contains` / `freetext`（全文检索）、`dataLength`。

SQL Server 2022 实测（共用套件 121 个用例、旧版本渲染、SQL 文本单测）；CI 里有 SQL Server 服务容器。
