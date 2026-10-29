# TS：Oracle 方言

```ts
const pool = await oracledb.createPool({
  user,
  password,
  connectString: 'host:1521/FREEPDB1',
  sessionCallback: oracleSession,
});
const db = createDb({ schema, adapter: oracle(pool) }); // 23ai
const legacy = createDb({ schema, adapter: oracle(pool, { version: '11.2' }) });
```

驱动用 `oracledb` 的 Thin 模式（纯 JS）。`oracleSession` 设好会话的日期格式与时区；日期时间按"库里存的墙上时间"读出，与其它库一样按 UTC 解码，不受 Node 的本地时区影响。

## 按版本渲染（机制见 ts-sqlserver.md）

| 版本 | 用到的写法                                                            | 更早的版本                                          |
| ---- | --------------------------------------------------------------------- | --------------------------------------------------- |
| 12.1 | `OFFSET … FETCH`、`IDENTITY` 列                                       | `ROWNUM` 包两层分页；建自增列报错（用序列）         |
| 19   | `LISTAGG(DISTINCT …)`                                                 | `joining({ distinct: true })` 报错                  |
| 21   | `JSON` 列类型                                                         | `CLOB`                                              |
| 23   | SQL 的 `BOOLEAN`（条件直接当值、布尔列直接当条件）、`IF [NOT] EXISTS` | `CASE WHEN … THEN 1 ELSE 0 END`、`= 1`、`NUMBER(1)` |

## 与其它库的差异

- 参数 `:1`、`:2`；表别名不写 `AS`；空字符串就是 `NULL`；没有 `TIME` 类型（存成 `VARCHAR2(12)` 的文字）。
- 带毫秒的日期时间参数写成 `TO_TIMESTAMP(:n, 'YYYY-MM-DD HH24:MI:SS.FF3')`；CASE 各分支的参数转成列的类型（`NULL` 的绑定变量默认是 CHAR）。
- 多行插入写成一个匿名块里的逐行 `INSERT`（一次往返，一块最多 500 行）：`INSERT ALL` 对自增列只生成一次值，多行 `VALUES` 按第一行推断类型。
- upsert 写成 `MERGE … USING (SELECT … FROM DUAL)`；自增主键用 `RETURNING … INTO` 取回；不支持 `returning()`。
- 经过导航的更新没有 `UPDATE … FROM`：写成 `SET (列) = (SELECT …)` 加 `WHERE EXISTS`，按主键自连接，LEFT JOIN 的语义不变。
- 子查询里的 `WITH` 提到最外层，递归 CTE 只能 `UNION ALL`（与 SQL Server 相同，核心的 `ctesAtTop`）。
- 字符串聚合是 `LISTAGG … WITHIN GROUP`；年、月的加减用 `NUMTOYMINTERVAL`。
- 只读事务（`SET TRANSACTION READ ONLY`）的快照不认几乎同时新建的表（ORA-01466），实库测试每个用例都重建表，所以跳过这一条。

Oracle Database 23ai Free 实测（共用套件 120 个用例、SQL 文本单测含 11.2 / 18 的旧写法）；CI 里有 Oracle 服务容器。
