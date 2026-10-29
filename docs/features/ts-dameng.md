# TS：达梦 DM8 方言

```ts
import dmdb from 'dmdb';
import { dameng } from '@zerodep-dev/easy-query-ts-dameng';

const pool = await dmdb.createPool({ connectString: 'dm://SYSDBA:密码@host:5236' });
const db = createDb({ schema, adapter: dameng(pool) });
```

驱动用官方的 `dmdb`。`dameng(pool)` 会把 dmdb 的全局读取设置改成：日期时间、数字、CLOB 按文字读（时区、精度不经过 JS 的转换，由列的 codec 解码），BLOB 按 Buffer 读。

Node 17 起的 OpenSSL 3 不认 dmdb 登录加密用的旧算法（报 `消息加密失败` / `digital envelope routines::unsupported`）：
连接串加 `?loginEncrypt=false`，或用 `node --openssl-legacy-provider` 启动。

## 与 Oracle 相同（方言继承 Oracle 方言）

双引号、参数 `:1`、表别名不写 `AS`、`OFFSET … FETCH`、upsert 写成 `MERGE`、`LISTAGG`、`USER_*` 数据字典、递归 CTE 不写 `RECURSIVE`、
经过导航的更新写成多列子查询加 `EXISTS`、单行插入取自增主键用 `RETURNING … INTO`。

## 与 Oracle 不同

- 没有 SQL 的 `BOOLEAN`：条件当值写成 `CASE WHEN … THEN 1 ELSE 0 END`，布尔列是 `BIT`。
- 没有 `JSON` 类型：JSON 存 `CLOB`；没有 `JSON_EXISTS` / `JSON_LENGTH`：`jsonHas` 写成 `JSON_QUERY(…) IS NOT NULL`（值是 JSON 的 null 时与缺失一样），
  `jsonLength` 按 `JSON_TABLE` 展开数组计数。
- 自增列 `BIGINT IDENTITY(1, 1)`；给自增列写值时同一个块里 `SET IDENTITY_INSERT … ON / OFF`（同 SQL Server）。
- 多行插入是一条多行 `VALUES`（Oracle 要匿名块）。
- `DATE` 只有日期：日期加减、相差用 `DATEADD` / `DATEDIFF`；有 `TIME(3)` 类型；`now()` 是 `GETUTCDATE()`。
- 空字符串不是 `NULL`；`IF [NOT] EXISTS` 建表、删表、建索引都有。
- `VARCHAR(n)` 的 n 按库初始化时的 `LENGTH_IN_CHAR`：建库时设成 1（按字符）与其它库口径一致。

只有 DM8 一个基线，不按版本分支。实测：DM8（社区镜像 `xuxuclassmate/dameng`）共用套件 124 个用例、SQL 文本单测；CI 里有达梦服务容器。
