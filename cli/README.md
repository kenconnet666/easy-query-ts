# @zerodep-dev/easy-query-ts-cli

`eqts` 命令行：由已有的库生成 easy-query-ts 的实体与 `defineSchema`（对应 Java 版 IDEA 插件的 table2entity）。

```bash
eqts pull --adapter ./db-adapter.ts --out src/schema.ts [--tables t_a,t_b] [--strip-prefix t_]
```

`--adapter` 指向一个模块，默认导出（或导出名为 `adapter`）一个 Adapter，例如 `export default mysql(createPool(process.env.DATABASE_URL!))`。
读当前 schema 的表、列、主键、索引、外键，生成的 schema 与库再 `db.planSync()` 是空计划。程序里用 `entitySource(await db.introspect(), options)`。

需要同时安装核心包与对应方言包。许可证：Apache-2.0。
