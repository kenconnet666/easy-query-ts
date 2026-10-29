# TS：DuckDB 方言

```ts
const db = createDb({ schema, adapter: duckdb(await DuckDBInstance.create(':memory:')) });
```

SQL 接近 PG（`RETURNING`、`ON CONFLICT`、`IS NOT DISTINCT FROM`、窗口、递归 CTE、`UPDATE … FROM` 都有）。差异：

- 没有 `IDENTITY`：自增列建成序列加 `DEFAULT nextval('seq_表_列')`，建表前先建序列；自增主键用 `RETURNING` 取回。
- 单写者、乐观并发：没有行锁与保存点。驱动让事务排队执行（与 SQLite 一样），`forUpdate()` 是空子句，`tx.lock()` 用写语句拿锁；
  嵌套事务渲染时报错。
- `NULL` 参数推不出类型，直接写 `NULL`；decimal 参数在算术里转成 `DECIMAL`；二进制包成 BLOB 值。
- 外键只能写在建表语句里，也不支持 `ON DELETE` / `ON UPDATE` 动作（渲染时报错）。
- 日期格式化用 `strftime`；JSON 用 json 扩展（`json_extract`、`json_extract_string`、`json_array_length`）；`VARCHAR` 不限长度，建表不写长度。
- 读出：BIGINT、DECIMAL、日期按文字（JSON 形式），BLOB 按 `Uint8Array`；读库结构用 `duckdb_tables()` / `duckdb_columns()` / `duckdb_indexes()` / `duckdb_constraints()`。

内存库上跑共用套件（121 个用例），不需要容器，普通的测试与 CI 都会跑。
