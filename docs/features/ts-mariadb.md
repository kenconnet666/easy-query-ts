# TS：MariaDB

MariaDB 走 MySQL 协议，驱动同样是 mysql2。方言 `MariaDbDialect` 继承 MySQL 方言，按 MySQL 8.0.18 的写法渲染
（upsert 用 `VALUES(col)`，窗口函数、CTE、`JSON_TABLE` 都有），再覆盖 MariaDB 的差异：

```ts
import { createPool } from 'mysql2/promise';
import { mariadb, mysql } from '@zerodep-dev/easy-query-ts-mysql';

const pool = createPool({ uri: process.env.DATABASE_URL, timezone: 'Z' });
const db = createDb({ schema, adapter: mariadb(pool) });
// 或者让 mysql.detect 看服务器版本自动选（连上 MariaDB 就用 MariaDB 的方言）
const db2 = createDb({ schema, adapter: await mysql.detect(pool) });
```

| 差异                   | MariaDB 的写法                                                                         |
| ---------------------- | -------------------------------------------------------------------------------------- |
| uuid 列                | 原生 `UUID` 类型（10.7+），按文字绑定；MySQL 是 BINARY(16)                             |
| 单表 DELETE            | 不能给表起别名：写成 `DELETE t0 FROM t AS t0`；`orderBy().limit(n)` 写成主键 IN 派生表 |
| 正则 `matches`         | `REGEXP` 运算符（区分大小写时先转成二进制）；没有 `REGEXP_LIKE`                        |
| `forShare()`           | `LOCK IN SHARE MODE`                                                                   |
| JSON 的更新写法        | 值用 `JSON_EXTRACT(?, '$')` 转成 JSON（JSON 不是 CAST 的目标类型）                     |
| `explain({ analyze })` | `ANALYZE FORMAT=JSON`                                                                  |
| `GROUPING()`           | 没有：`WITH ROLLUP` 能用，`g.grouping(…)` 渲染时报不支持                               |
| RETURNING              | 统一按没有处理（MariaDB 的 UPDATE 没有 RETURNING）                                     |

已知的服务端问题：11.4 上 `ROW_NUMBER()`（倒序）、`COUNT(*) OVER ()` 与 `LAG()` 在同一条语句里时 LAG 的结果不对
（两两组合都对），共用套件里这一项对 MariaDB 不比较。

测试：共用套件在 MariaDB 11.4 上全跑（`mysql/test/mariadb.test.ts`），开发容器是 `infra/dev/db.sh --profile mariadb up -d`
（端口 23307），CI 的实库任务里也有 MariaDB 服务容器。
