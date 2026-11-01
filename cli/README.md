# @zerodep-dev/easy-query-ts-cli

`eqts` 命令行：由已有的库生成实体（对应 Java 版 IDEA 插件的 table2entity）、生成与执行迁移、导出 SQL 快照。

```bash
eqts pull --adapter ./db-adapter.ts --out src/schema.ts [--tables t_a,t_b] [--strip-prefix t_]
eqts migrate generate --adapter ./db-adapter.ts --schema ./src/schema.ts --name add_orders [--dir migrations]
eqts migrate up --adapter ./db-adapter.ts [--dir migrations] [--table eqts_migrations]
eqts snapshot src/queries.snap.ts [--out sql-snapshots] [--check]
```

`--adapter` 指向一个模块，默认导出（或导出名为 `adapter`）一个 Adapter，例如 `export default mysql(createPool(process.env.DATABASE_URL!))`。
读当前 schema 的表、列、主键、索引、外键，生成的 schema 与库再 `db.planSync()` 是空计划。程序里用 `entitySource(await db.introspect(), options)`。

`migrate generate` 对开发库算 `planSync` 写成迁移文件，`migrate up` 按文件名顺序执行没执行过的（`db.migrate`）。
`snapshot` 加载默认导出 `defineSnapshots(...)` 的模块，不连库按每个方言渲染成 `<out>/<模块名>.<方言标签>.sql`；`--check` 只比较，快照过期时失败。

需要同时安装核心包与对应方言包。许可证：Apache-2.0。
