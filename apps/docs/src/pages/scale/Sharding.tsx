/** 分库分表 */
import { _component } from '@zerodep-dev/vue-tsx-pro-tsx';
import { CodeBlock } from '@zerodep-dev/vue-tsx-pro-ui';
import { DocPage, Note, P, Points, Section } from '../../site/content';

const tables = `import { byMod, byMonth } from '@zerodep-dev/easy-query-ts';

const Log = entity('t_log', { id: col.bigint().primaryKey(), userId: col.bigint() }, {
  sharding: byMod('userId', 4), // t_log_0 … t_log_3
});
const Order = entity('t_order', { id: col.bigint().primaryKey(), createdAt: col.datetime() }, {
  sharding: byMonth('createdAt', { from: '2025-01' }), // t_order_202501 … 到本月
});

await db.createTables(); // 建出每一张实际表
await db.insert(Order).values(rows).execute(); // 按分片键路由，一张表一条语句
await db
  .queryable(Order)
  .where((o) => o.createdAt.ge(start))
  .orderBy((o) => o.createdAt.desc())
  .toPage(1, 20);`;

const databases = `const sdb = shardDatabases({
  shards: { ds0: db0, ds1: db1 }, // 同一个 schema、各连一个库的 Db
  routes: { Order: byMod('userId', 2, { table: (_, i) => \`ds\${i}\` }) },
});

// 各库取前 60 条，归并再切
await sdb.query(Order, (q) => q.orderBy((o) => o.createdAt.desc())).toPage(3, 20);`;

export default _component(() => () => (
  <DocPage>
    <Section id="tables" title="单库分表">
      <P text="实体声明分片规则，业务代码还是普通的查询和写入。" />
      <CodeBlock code={tables} lang="ts" />
      <Points
        items={[
          '查询读 where 顶层 AND 里分片键上的条件（`=`、`IN`、范围、`between`），裁剪出要查的表。一张就直接查，几张就 `UNION ALL`，排序、分页、聚合都在库里做。',
          '没有分片键条件时查全部表。取模只能按 `=`、`IN` 裁剪；按时间的范围两端都裁剪。',
          'insert 按每行的分片键算表，少了分片键报错；update、delete 裁剪出表后逐张执行，要原子请放进事务。',
          '规则：`byMod`、`byYear`、`byMonth`、`byDay`，自定义实现 `ShardingRule` 的 `tables`、`tableOf`、`prune`。',
        ]}
      />
      <Note text="官方的跨表查询在内存里归并；这里交给库的 UNION ALL，代码简单、行为与普通查询一致，表很多时注意执行计划。按时间分表时，由部署或定时任务调用 `syncTables()` 建下一段的表。" />
    </Section>
    <Section id="databases" title="分库">
      <CodeBlock code={databases} lang="ts" />
      <Points
        items={[
          '跨库的 `count`、`sum`、`min`、`max` 各库算完再合并；跨库的 `groupBy`、`avg` 报错。',
          '写入只在各自的库里，不是分布式事务。',
        ]}
      />
    </Section>
  </DocPage>
));
