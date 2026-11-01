# TS：方言能力写进类型

各数据库能做的事不一样：TDengine 没有 `UPDATE`，ClickHouse、Doris 没有能回滚的事务和行锁，MySQL 没有 `RETURNING`。以前这些都要到渲染或执行时才报错；
现在方言包的 adapter 带上它支持的能力，`createDb` 把能力挂在 schema 类型上，不支持的写法在编辑器里直接标红：

```ts
const db = createDb({ schema, adapter: tdengine(sql) });
db.update(Reading);
// 类型错误：Property ''error: this Db does not support'' is missing … 'Unsupported<"update">'
```

## 能力

| 能力            | 管哪些方法                       | 没有的库                                      |
| --------------- | -------------------------------- | --------------------------------------------- |
| `write`         | 写入、DDL、迁移                  | 只由 `db.readonly()` 去掉，见 ts-readonly.md  |
| `update`        | `db.update`                      | TDengine                                      |
| `transactions`  | `db.transaction`、`db.begin`     | ClickHouse、Doris、TDengine                   |
| `lock`          | `db.lock`                        | ClickHouse、Doris、TDengine                   |
| `forUpdate`     | `forUpdate()`                    | SQLite、ClickHouse、Doris、TDengine           |
| `skipLocked`    | `forUpdateSkipLocked()`          | 同上，加 DuckDB                               |
| `noWait`        | `forUpdateNoWait()`              | 同上，加 DuckDB、Db2                          |
| `returning`     | 插入、更新、删除的 `returning()` | MySQL、SQL Server、Oracle、达梦、Db2、HANA 等 |
| `generatedKeys` | `returnId()`                     | ClickHouse、Doris、TDengine                   |
| `upsert`        | `onConflict()`                   | ClickHouse                                    |
| `upsertIgnore`  | `onConflict(…).ignore()`         | Doris、TDengine                               |

## 写法

- 方言包的 factory 返回 `Adapter<Without<'returning' | 'noWait'>>` 这样的类型；自定义 adapter 不写就是全部都有。
- 能力挂在 schema 类型的一个可选 phantom 属性上（运行时没有），schema 本来就贯穿 Db、查询与写入构造器，所以不用给每个类型加泛型参数；
  `with`、`mount` 之后的 Db 保留能力。
- 方法用 `this` 参数检查：缺能力时 `this` 的类型是 `Unsupported<'能力'>`，错误信息里写出缺的是哪个。
- 受限的 Db 赋给标成 `Db<typeof schema>`（默认全部能力）的变量会报错：变量用推出来的类型（`ReturnType<typeof open>`）。
- 运行时的报错照旧保留（从 JS 调用、类型被断言掉时兜底）。库内部（`save`、`syncTables`、分库）不看能力：没有事务的库由驱动依次执行。
- 表达式层面的差异（Db2 没有 `jsonLength`、TDengine 没有窗口函数）仍在渲染时报出。

类型测试见 `test/test/capabilities.check.ts`。
