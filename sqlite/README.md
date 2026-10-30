# @zerodep-dev/easy-query-ts-sqlite

SQLite 适配器：`sqlite()` 接 Node 自带的 `node:sqlite`（无需安装驱动）或 Bun 的 `bun:sqlite`；`d1()` 接 Cloudflare D1；`libsql()` 接 `@libsql/client`（本地文件库与远端 Turso）。驱动都按结构类型对接，本包不依赖它们。

easy-query 的 TypeScript 版（[kenconnet666/easy-query](https://github.com/kenconnet666/easy-query) 的 `ts/`）：实体 + 导航、lambda 里写条件、隐式 join 与子查询、对象树结果，结果类型全由 TS 推导，不需要代码生成。

需要同时安装核心包 `@zerodep-dev/easy-query-ts`。

- 总览与各特性文档：https://github.com/kenconnet666/easy-query/tree/main/docs/fork
- 许可证：Apache-2.0
