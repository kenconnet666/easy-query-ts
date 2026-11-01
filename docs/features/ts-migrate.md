# TS：迁移历史

`syncTables` 适合开发阶段；生产环境要有记录、能审查、能手改的迁移：

```bash
# 对开发库算 planSync，写成 migrations/<时间戳>_add_orders.ts（没有要改的就不写）
eqts migrate generate --adapter ./db-adapter.ts --schema ./src/schema.ts --name add_orders
# 按文件名的顺序执行还没执行过的迁移，记进历史表
eqts migrate up --adapter ./db-adapter.ts
```

```ts
// migrations/20261030083000_add_orders.ts（生成的，可以手改）
export default defineMigration({
  id: '20261030083000_add_orders',
  up: ['CREATE TABLE "t_order" (…)', 'CREATE INDEX "t_order_user_id_idx" ON "t_order" ("user_id")'],
});
// 不会自动改的差异（需要的话把对应的语句写进 up）：
// - t_user.name: type is varchar(50), declared VARCHAR(100)

// 数据迁移：up 写成函数，拿到同一个连接与事务
export default defineMigration({
  id: '20261031000000_backfill',
  up: async (db) => {
    await db.sql.execute`UPDATE t_user SET level = 1 WHERE level IS NULL`;
  },
});

await db.migrate([m1, m2]); // 应用启动时执行也可以；返回这次执行的 id
```

- 迁移按 id 的字典序执行（生成时用 UTC 时间戳开头），传入的顺序不重要；id 重复报错。
- 历史表默认 `eqts_migrations`（id、校验和、执行时间），没有就建；`--table` / `{ table }` 换名字。`eqts pull` 不会把它生成成实体。
- 每条迁移连同它的历史记录在一个事务里（DDL 能放进事务的库：PG、SQLite、SQL Server、Db2 等）；MySQL、Oracle 的 DDL 会隐式提交。
- 已经执行过的迁移被改了（校验和对不上）：`migrate` 直接报错，要改就加一条新迁移。
- `planSync` 不会自动做的改动（改类型、改可空、删列）列在生成文件末尾的注释里，由人决定写不写进 `up`。

测试见 `test/test/migrate.test.ts`。
