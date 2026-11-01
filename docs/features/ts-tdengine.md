# TS：TDengine 方言（官方 sql-tsdb）

```ts
import { sqlConnect, WSConfig } from '@tdengine/websocket';
import { tdengine } from '@zerodep-dev/easy-query-ts-tdengine';

const conf = new WSConfig('ws://host:6041');
conf.setUser('root');
conf.setPwd(password);
conf.setDb('power');
conf.setTimezone('UTC');
const db = createDb({ schema, adapter: tdengine(await sqlConnect(conf)) });
```

驱动用官方的 `@tdengine/websocket`（taosAdapter 的 WebSocket 接口，不用装客户端）。连接设时区 UTC：日期时间按 UTC 文字写入、读出。

## 时序库的模型

每张表第一列是 `TIMESTAMP` 主键，同一时间戳再写一次就是覆盖（只覆盖给出的列）。所以：

- 实体的主键必须是一个 `datetime` 列，建表时排在第一列；列不能声明 `NOT NULL`、`DEFAULT`，表注释写在 `COMMENT` 里。
- 没有 `UPDATE`：`update()` 报错，改成按时间戳再插入一次；upsert（`onConflict(…).merge(…)`）就是普通插入，`ignore()` 报错。
- 删除写成 `DELETE FROM t WHERE …`（不带别名，一般按时间范围）。
- 查询有条件、排序、分页、聚合、分组、字符串与日期函数；没有子查询（`IN` / `EXISTS`）、窗口函数、行锁、事务（`transaction()` 里依次执行）。
- 语句不带参数：值按字面量写进 SQL（字符串转义单引号与反斜杠）。
- 驱动把数字列的空值交成字符串 `'NULL'`、时间戳交成毫秒数，适配器解码成 `null` 与 UTC 文字。
- 读库结构用 `information_schema.ins_tables` / `ins_columns`：第一列是主键，其余列都可空。

官方 sql-tsdb 没有对应的单元测试；我们按上面的能力测建表、写入、查询、聚合、覆盖写、删除与 planSync 往返（TDengine 3.3.6，CI 里有服务容器）。
