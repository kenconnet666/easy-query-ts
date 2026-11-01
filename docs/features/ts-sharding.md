# TS：分表与分库（对应官方 super/*）

```ts
import { byMod, byMonth } from '@zerodep-dev/easy-query-ts';

const Log = entity('t_log', { id: …, userId: col.bigint(), … }, { sharding: byMod('userId', 4) }); // t_log_0 … t_log_3
const Order = entity(
  't_order',
  { id: …, createdAt: col.datetime(), … },
  { sharding: byMonth('createdAt', { from: '2025-01' }) }, // t_order_202501 … 到本月
);

await db.createTables(); // 建出每一张实际表（按时间的建到 to，默认现在）
await db.insert(Order).values(rows).execute(); // 按分片键路由，一张表一条语句
await db.queryable(Order).where((o) => o.createdAt.ge(start)).orderBy((o) => o.createdAt.desc()).toPage(1, 20);
```

## 怎么查

- 查询构建时读 where 顶层 AND 里分片键上的条件：`=`、`IN`、`>` / `>=` / `<` / `<=`、`between`，由规则裁剪出要查的表。
  取模只能按 `=` / `IN` 裁剪；按时间的按 UTC 的年 / 月 / 日算，范围的开头、结尾都裁剪（`< 3 月 1 日 0 点` 不查 3 月表）。
- 一张表就直接查它；几张就 `UNION ALL` 成派生表，每个成员都带上分片键的条件，外层照常 where、排序、分页、聚合——都在库里做，不在内存里归并。
- 没有分片键条件时查全部表；裁剪出的表都不存在（按时间的未来月份）时查第一张，条件让结果为空。
- 导航、join 进来的分表实体查全部表。

## 写入

- insert 按每行的分片键算表，列相同、表相同的行一条语句；少了分片键报错。
- update / delete 按条件裁剪出表，逐张执行、行数合计后再检查 `expectRows` 与乐观锁；要原子请放进事务。`returning()` 不支持分表实体。

## 规则

`byMod(column, count, { table? })`、`byTime(column, 'year' | 'month' | 'day', { from, to?, table? })`（简写 `byYear` / `byMonth` / `byDay`）。
自定义规则实现 `ShardingRule`：`tables(base)`、`tableOf(base, value)`、`prune(base, filter)`。分片键的列名在类型上限定为实体的列。

## 与官方的差异

- 官方的分表跨表查询在内存里归并（排序、分页、聚合），这里交给库的 `UNION ALL`，代码简单、行为与普通查询一致；表很多时注意执行计划。
- 官方按时间分表有定时任务建下一个月的表；这里 `syncTables()` / `createTables()` 建到 `to`，由部署时或定时任务调用。

## 分库（对应官方 sharding-datasource、sharding-all）

```ts
const sdb = shardDatabases({
  shards: { ds0: db0, ds1: db1 }, // 同一个 schema、各连一个库的 Db
  routes: { Order: byMod('userId', 2, { table: (_, i) => `ds${i}` }) }, // 规则复用分表的，"表名"就是库名
});
await sdb.insert(Order, rows); // 按行路由
await sdb.query(Order, (q) => q.where((o) => o.userId.eq(7))).toList(); // 只查 ds1
await sdb.query(Order, (q) => q.orderBy((o) => o.createdAt.desc())).toPage(3, 20); // 各库取前 60 条归并再切
await sdb.update(Order, (u) => u.set({ state: 'closed' }).where((o) => o.userId.in(ids)));
```

- 路由同样读 where 里分片键的条件；没有路由的实体只在 `defaultShard`（默认第一个库）。
- 跨库查询：各库并发（`concurrency`，默认 4）执行同一个查询，按查询自己的 `orderBy` 在内存里归并——排序的表达式要在结果里（select 出来或整行）；
  `toPage` 各库取前 page × size 条、总数相加；`count` / `sum`（decimal 文字精确相加）/ `min` / `max` 各库算完再合并。
- 不支持跨库的 `groupBy`、`avg`、带 `limit` / `offset` 的 `toList`（用 `toPage`）；空值排序按"NULL 最小"，PG 上与库里的默认不同。
- 写入只在各自的库里，跨库写入不是分布式事务；要事务就 `sdb.shard(name).transaction(…)` 在一个库里做。

SQLite、MySQL 8.4、PG 17 实测（`suite.ts` table sharding：路由、单表裁剪、IN / 范围 UNION ALL、计数分页求和、逐表更新删除）；规则单测 `sharding.test.ts`；分库 `shards.test.ts`（两个 SQLite 库：路由、裁剪、跨库排序分页、聚合、更新删除）。
