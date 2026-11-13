# @zerodep-dev/easy-query-ts-hana

SAP HANA 适配器（`hdb`，纯 JS 驱动，peer 依赖），HANA 2.0；含全文检索。

easy-query 的 TypeScript 版（[kenconnet666/easy-query-ts](https://github.com/kenconnet666/easy-query-ts)）：实体 + 导航、lambda 里写条件、隐式 join 与子查询、对象树结果，结果类型全由 TS 推导，不需要代码生成。

需要同时安装核心包 `@zerodep-dev/easy-query-ts`。

## HANA 上的差别

- 导航上的 `at(i)` 用不了：它是关联子查询里的 `ORDER BY … LIMIT`，HANA 不允许（`correlated subquery cannot have TOP or ORDER BY`）。取每个父行的第几条用 `r.oneOfMany` 或 `toList` 的 `limit`。
- `jsonLength` 不支持（`JSON_TABLE` 的文档参数不能引用外层查询的列）。JSON 路径里的键不能含单引号、反斜杠。
- 没有 `returning()`、递归 CTE、`dateTrunc`。
- 事务的隔离级别、只读设置在 HANA 里是会话级的：适配器在事务结束、连接还回池之前改回默认值（`READ COMMITTED`、可写）。
- 连接默认把 hdb 的 `packetSizeLimit` 提到 16 MB（hdb 默认 128 KB，多行插入的语句发不出去）；要别的值在 `hana({ … })` 里自己给。

- 总览与各特性文档：https://github.com/kenconnet666/easy-query-ts/tree/master/docs
- 许可证：Apache-2.0
