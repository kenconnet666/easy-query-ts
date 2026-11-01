# TS：`caseWhen` 与函数库

## CASE WHEN

```ts
import { caseWhen } from '@zerodep-dev/easy-query-ts';

db.queryable(User).select((u) => ({
  name: u.name,
  group: caseWhen(u.age.lt(18), 'minor').when(u.age.lt(65), 'adult').else('unknown'), // string
  label: caseWhen(u.age.isNull(), u.name.upper()).end(), // 没有 ELSE：string | null
}));
```

结果类型是各分支值类型的并集。条件必须是真正的表达式（不接受 `cond && x` 的跳过写法：CASE 里"跳过"没有明确含义）。可以放在 `where`、`select`、聚合参数里（`sum(p => caseWhen(p.amount.gt('5'), 1).else(0))`）。PG 推断不出 CASE 分支里参数的类型，方言会给字面量加 `CAST`。

## 函数

下标一律按 JS 的习惯（0 起，`substring(start, end)` 左闭右开）；不会悄悄交换写反的下标，而是报错。

| 方法                                                                                   | 含义                                 | SQLite                                              | MySQL                      | PG                                  | HANA*                       |
| -------------------------------------------------------------------------------------- | ------------------------------------ | --------------------------------------------------- | -------------------------- | ----------------------------------- | --------------------------- |
| `substring(start, end?)`                                                               | 子串                                 | `SUBSTR`                                            | `SUBSTRING`                | `SUBSTRING`                         | `SUBSTRING`                 |
| `replace(search, to)`                                                                  | 替换                                 | `REPLACE`                                           | `REPLACE`                  | `REPLACE`                           | `REPLACE`                   |
| `indexOf(text)`                                                                        | 位置，没有为 -1                      | `INSTR - 1`                                         | `POSITION - 1`             | `POSITION - 1`                      | `LOCATE - 1`                |
| `left(n)` / `right(n)`                                                                 | 前 / 后 n 个字符                     | `SUBSTR` + `MAX` 夹边                               | `LEFT/RIGHT`               | `LEFT/RIGHT`                        | `LEFT/RIGHT`                |
| `abs() floor() ceil()`                                                                 | 数学                                 | `floor/ceil` 用取整加修正（不依赖数学函数编译选项） | 原生                       | 原生                                | 原生                        |
| `round(digits = 0)`                                                                    | 四舍五入                             | `ROUND`                                             | `ROUND`                    | `ROUND(CAST(x AS NUMERIC), d)`      | `ROUND`                     |
| `mod(divisor)`                                                                         | 取余                                 | `%`                                                 | `MOD`                      | `MOD`                               | `MOD`                       |
| `addDays(n)` / `addMonths(n)`                                                          | 加天 / 月（n 可负）                  | `datetime(x, 'n days')`，结果不带毫秒               | `DATE_ADD … INTERVAL`      | `x + INTERVAL 'n day'`              | `ADD_DAYS / ADD_MONTHS`     |
| `diffDays(other)`                                                                      | 整天数差                             | `julianday(date(a)) - julianday(date(b))`           | `DATEDIFF`                 | `CAST(a AS DATE) - CAST(b AS DATE)` | `DAYS_BETWEEN(b, a)`        |
| `nullIf(v)`                                                                            | 相等得 NULL                          | 原生                                                | 原生                       | 原生                                | 原生                        |
| `cast('string' \| 'int' \| 'bigint' \| 'double' \| 'decimal' \| 'date' \| 'datetime')` | 类型转换（decimal 要给精度与小数位） | 见 `SqliteDialect`                                  | `CHAR / SIGNED / DOUBLE …` | 标准类型名，字符串用 `TEXT`         | `NVARCHAR(5000) / DOUBLE …` |

\* HANA 一栏按官方文档写，**本机没有 HANA 实例，未实库验证**；SQLite、MySQL 8.0.18 / 8.4、PG 17 均实测通过。

限制：

- 位置、长度、天数、月数写成整数字面量（校验为整数后直接进 SQL），不占绑定参数——PG 的 `SUBSTRING` 等对参数类型很挑。
- `diffDays` 只看日期部分；`addMonths` 遇到月末按各库自己的规则收敛。
- 对 `Expr<string>` 以外的类型调用字符串函数、对非数值调用数学函数，编译期报错（`this` 参数限定）。

## 匹配、排序规则、锁与提示（ROADMAP 19.6）

```ts
u.name.startsWith('al', { ignoreCase: true }); // like 家族都能忽略大小写：PG 写成 ILIKE，别的库两边 LOWER
u.name.matches('^(a|b)', { ignoreCase: true }); // 正则：PG ~ / ~*，MySQL 8.0.4+ 与 Oracle REGEXP_LIKE，DuckDB regexp_matches
u.name.collate('utf8mb4_bin').eq(x); // 按指定排序规则比较（PG 的规则名加双引号）
db.queryable(Post).distinctOn((p) => p.userId).orderBy((p) => p.id.desc()); // PG：每个用户最新的一篇
tx.queryable(Order).where(…).forShare(); // 共享锁（PG、MySQL 8.0.1+）；PG 另有 forNoKeyUpdate()
db.queryable(Order).optimizerHint('MAX_EXECUTION_TIME(1000)'); // 写进 SELECT 后面的提示注释
```

- `distinctOn` 的键自动排在 ORDER BY 最前面（PG 的要求），留哪一行由后面的 `orderBy` 决定；别的库渲染时报不支持。
- 正则的写法各库略有不同（PG 是 POSIX，MySQL 8 是 ICU），只用常见的写法；没有正则函数的库渲染时报不支持。
- MySQL 的索引提示（`USE INDEX`、`FORCE INDEX`）用已有的 `tableHint('USE INDEX (idx)')`。
- 暂缓：`LATERAL` 连接（每父行前 n 条已经用 `toList` 的 `limit` 在库里按窗口函数截取，分组聚合有 `groupJoin`）、
  `FOR UPDATE OF 表`（多表锁定的场景少，要给 join 的表起名的 API）。

## 自己加函数

在方言函数表里登记名字，再用 `dialectFn('名字', [参数…])` 构造表达式；写法见 [easy-query 仓库的 dialect-functions.md](https://github.com/kenconnet666/easy-query/blob/main/docs/fork/features/dialect-functions.md) 的"自写扩展"，TS 版同形（`Dialect.functions()` + `dialectFn`）。
