# TS：search 扩展的参数约定（对应官方 sql-search）

官方的 search 扩展（Bean Searcher 风格）用一套查询参数描述筛选与排序。`parseSearchRequest` 把它解析成 `table()` 认的 `TableRequest`，
执行、白名单（`filterable` / `sortable`）、整天的日期区间都沿用 `table()`：

```ts
// GET /users?userName=user_&userName-op=lml&createTime-1=2026-01-01&createTime-2=2026-02-01&createTime-op=rco&sort=createTime:desc&current=2
const request = parseSearchRequest(query, { fields: ['userName', 'userId', 'createTime', 'ext.mobile'], defaultSort: ['createTime:desc'] });
const page = await db.queryable(User).select(…).table(request, { filterable: [...], sortable: [...] });
```

| 参数                                     | 含义                                   |
| ---------------------------------------- | -------------------------------------- |
| `name=v`、`name-op=eq`                   | 比较方式默认 eq                        |
| `name=a&name=b`、`name-0`、`name-1` …    | 多个值（in / ni）                      |
| `name-1`、`name-2`                       | 区间的两端，缺一端不限                 |
| `sort=name:asc`（desc、ascend、descend） | 排序，可以多个；没给时用 `defaultSort` |
| `current`、`pageSize`                    | 分页                                   |

比较方式：`eq ne gt ge lt le`、`in ni`、`lk nl`（包含 / 不包含）、`lml nlml`（开头是 / 不是）、`lmr nlmr`（结尾是 / 不是）、
`rc ro roc rco`（闭、开、左开右闭、左闭右开区间）与 `nrc nro nroc nrco`、`inn`（true 非空、false 为空）。

严格模式（默认）下不认识的字段、比较方式报错（官方的 strict）；`{ strict: false }` 时忽略。字段是 select 结果里的名字，关联表的字段先在 select 里带出来（官方用 `table("ext", …)` 声明）。

`search.test.ts` 按官方 EasySearchBaseOpTests / CommonTests 的比较方式逐个验证。
