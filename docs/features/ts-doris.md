# TS：Apache Doris 方言

官方 easy-query 没有 Doris 方言，这是我们额外支持的。Doris 是 MPP 分析库，走 MySQL 协议：驱动同样用 mysql2，方言继承 MySQL 方言（`DorisDialect`），放在 MySQL 包里。

```ts
import { createPool } from 'mysql2/promise';
import { doris } from '@zerodep-dev/easy-query-ts-mysql';

const db = createDb({ schema, adapter: doris(createPool({ uri, timezone: 'Z' })) });
const dev = createDb({ schema, adapter: doris(pool, { replication: 1 }) }); // 单 BE 的测试环境
```

## 与 MySQL 不同

- 建表用主键模型：`UNIQUE KEY(主键) [COMMENT …] DISTRIBUTED BY HASH(主键) BUCKETS AUTO`，键列自动排到最前；`replication` 写进 `PROPERTIES ("replication_num" = …)`。
  没有唯一约束、外键（唯一索引、外键报错）；索引建成倒排索引（`USING INVERTED`），读库结构时用 `SHOW INDEX` 读回来。二进制列存 `STRING`。
- 写入同一主键就是整行覆盖：upsert 只支持"冲突时覆盖全部插入的列"（写成普通的 `INSERT`）；`ignore()`、只更新部分列报错。
- 自增列能建（`AUTO_INCREMENT`），但取不回生成的值（没有 `LAST_INSERT_ID()`）：主键由应用给值。
- 经过导航的更新、删除用通用写法 `UPDATE … FROM …`、`DELETE … WHERE EXISTS (…)`（Doris 不认 MySQL 的多表写法）。
- 没有行锁；事务不能回滚：`transaction()` 里的语句依次执行，出错时不回滚。
- `jsonHas` 写成 `JSON_EXISTS_PATH`（没有 `JSON_CONTAINS_PATH`）。

## 测试

取不回自增主键、不能回滚，共用套件（suite.ts）跑不了：与 ClickHouse 共用"主键由应用给值"的分析型套件（`test/src/analytic.ts`：查询、导航、聚合、窗口、函数、
更新删除、建表与 planSync 往返）。实测 Doris 4.1.3（`apache/doris:all-in-one`）；CI 里单独一个 runner。
