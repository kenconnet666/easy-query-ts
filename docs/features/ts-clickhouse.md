# TS：ClickHouse 方言

```ts
import { createClient } from '@clickhouse/client';
import { clickhouse } from '@zerodep-dev/easy-query-ts-clickhouse';

const db = createDb({
  schema,
  adapter: clickhouse(createClient({ url, username, password, database })),
});
```

驱动用官方的 `@clickhouse/client`（HTTP 接口）。ClickHouse 是列式分析库：查询能力完整，写入按它的能力裁剪（与官方 sql-clickhouse 的取舍一致）。

## 查询

- 参数是带类型的 `{p1:Int64}`：类型按绑定的值推断（整数 Int64、小数 Float64、布尔 Bool、其余 String，由服务端按列的类型转换）。
- 引号用反引号；条件、排序、分页、导航 join、分组聚合、子查询、窗口函数、递归 CTE 都按通用写法。
- 每条语句带上 `join_use_nulls = 1`（LEFT JOIN 缺的行是 `NULL`，不是类型的默认值）、DECIMAL 按文字输出并保留小数位、会话时区 UTC。
- 函数换成 ClickHouse 的写法：`substringUTF8`、`positionUTF8`、`toYear`、`addDays`、`dateDiff`、`date_trunc`、`JSONExtract*` / `JSONHas` / `JSONLength`、
  `joining` 用 `arrayStringConcat(groupArray(…))`；`isNotDistinctFrom` 只能用在 JOIN ON，null 安全相等用展开的写法。

## 写入

- 没有自增列与 `RETURNING`：主键由应用给值（雪花 ID、UUID），声明了 `generated()` 的列建表时报错。
- 插入是普通的 `INSERT … VALUES`，能报出写入的行数。
- 更新、删除是 mutation：`ALTER TABLE t UPDATE … WHERE …` / `ALTER TABLE t DELETE WHERE …`，每条带 `mutations_sync = 2` 等它做完；
  经过导航时范围写成 `(主键) IN (带 join 的子查询)`，新值只能用本表的列。驱动报不出影响的行数（返回 0），乐观锁（version 列）的检查不可用。
- 没有事务：`transaction()` 里的语句依次执行，出错时不回滚；没有行锁。

## 建表

`ENGINE = MergeTree ORDER BY (主键)`；可空列写成 `Nullable(T)`；注释写在列与表的定义里；索引是跳数索引（`TYPE minmax`）。
没有唯一约束与外键：`unique` 不写进建表语句，唯一索引、外键报错。读库结构用 `system.columns` 等系统表，建好的表再 `planSync` 是空计划。

实测：ClickHouse 25.8 LTS（查询、函数、mutation、建表与读库结构）；CI 里有 ClickHouse 服务容器。
