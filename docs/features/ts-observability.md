# TS：可观测性——链路 span、N+1 与慢查询

两样都是 `onExecute` 钩子，写成数组一起用：

```ts
import { trace } from '@opentelemetry/api';
import { statementSpans } from '@zerodep-dev/easy-query-ts';
import { queryWatch } from '@zerodep-dev/easy-query-ts/observe';

const watch = queryWatch({ repeat: 5, slowMs: 200 });
const db = createDb({
  schema,
  adapter,
  onExecute: [statementSpans(trace.getTracer('app')), ...(dev ? [watch.onExecute] : [])],
});
app.use((req, res, next) => watch.run(next)); // 每个请求一个统计范围
```

## statementSpans(tracer)

每条语句一个 OpenTelemetry span（`SpanKind.CLIENT`），属性按数据库的语义约定：

| 属性                        | 值                                                                    |
| --------------------------- | --------------------------------------------------------------------- |
| `db.system.name`            | `postgresql`、`mysql`、`microsoft.sql_server`、`oracle.db`、`sqlite`… |
| `db.query.text`             | 渲染后的 SQL（带占位符，不含参数值）                                  |
| `db.operation.name`         | SQL 的第一个关键字：`SELECT`、`INSERT`…（也是 span 的名字）           |
| `db.response.returned_rows` | 读返回的行数                                                          |

失败的语句记下异常并把状态设为 `ERROR`。核心不依赖 `@opentelemetry/api`：只用到 `Tracer.startSpan`，按结构类型
（`SpanTracer`）对接。span 在语句结束后补记（开始时间往前推耗时），父 span 是发起语句时的活动 span。

## queryWatch(options)

开发环境用，报两种问题（默认 `console.warn`，`report` 可换）：

- `repeated`：同一个 `run` 范围里，同一条读 SQL（文本相同、参数不同）执行到 `repeat` 次（默认 5）——循环里逐个查、逐行 `find`
  的 N+1，改成 `include` / `toList()` 导航或一次 `in` 查询。每条 SQL 每个范围只报一次；不在 `run` 里时不计数。
- `slow`：单条语句耗时到 `slowMs`（默认 500 毫秒），不论在不在范围里。

慢的读语句可以顺带取执行计划再报：`queryWatch({ explain: (s) => db.explain(s) })`，警告里多一个 `plan`（取计划失败时是 `planError`），
计划取回来之后才报，不阻塞原来的语句。

## 执行计划：`q.explain()`、`db.explain(statement)`（ROADMAP 19.8）

```ts
const plan = await db
  .queryable(Order)
  .where((o) => o.userId.eq(7))
  .explain();
await db.queryable(Order).explain({ analyze: true }); // 真的执行一遍，带实际行数与耗时
```

- PG：`EXPLAIN (FORMAT JSON[, ANALYZE])`，返回计划数组（`[{ Plan: … }]`）；MySQL：`EXPLAIN FORMAT=JSON`，返回计划对象（`{ query_block: … }`），
  `analyze` 是 8.0.18+ 的 `EXPLAIN ANALYZE`，返回文字树；SQLite：`EXPLAIN QUERY PLAN`，返回 `{ id, parent, detail }` 各行，没有 analyze。别的库报不支持。
- 只解释主语句：toList 导航的第二条查询不在里面。`analyze` 会真的执行，别用在写语句上。

`@zerodep-dev/easy-query-ts/observe` 是单独的入口，用到 `node:async_hooks`；核心不依赖它。

测试见 `test/test/observe.test.ts`。
