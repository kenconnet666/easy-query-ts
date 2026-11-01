/** 分库 */
import { _component } from '@zerodep-dev/vue-tsx-pro-tsx';
import { CodeBlock } from '@zerodep-dev/vue-tsx-pro-ui';
import { DocPage, Note, P, Section, SimpleTable } from '../../site/content';

const databases = `import { byMod, shardDatabases } from '@zerodep-dev/easy-query-ts';

const sdb = shardDatabases({
  shards: { ds0: db0, ds1: db1 }, // 同一个 schema、各连一个库的 Db
  routes: { Order: byMod('userId', 2, { table: (_, i) => \`ds\${i}\` }) },
});`;

const query = `// 按分片键：只查一个库
await sdb.query(Order, (q) => q.where((o) => o.userId.eq(7))).toList();

// 没有分片键：各库都查，结果归并
await sdb.query(Order, (q) => q.orderBy((o) => o.createdAt.desc()).select((o) => ({ id: o.id, createdAt: o.createdAt }))).toList();

// 分页：各库取前 60 条，归并再切
await sdb.query(Order, (q) => q.orderBy((o) => o.createdAt.desc())).toPage(3, 20);

// 单个库：直接拿到那个 Db，开事务也在这里
await sdb.shard('ds0').transaction(async (tx) => { ... });

// 聚合：各库算完再合并
await sdb.query(Order, (q) => q).count();
await sdb.query(Order, (q) => q.where((o) => o.status.eq('paid'))).sum((o) => o.amount);`;

const write = `await sdb.insert(Order, rows); // 按行路由，一个库一条语句
await sdb.update(Order, (u) => u.set({ status: 'paid' }).where((o) => o.userId.eq(7)));
await sdb.delete(Order, (d) => d.where((o) => o.status.eq('cancelled')));`;

const combo = `// 分库再分表：每个库里的实体继续声明 sharding
const Order = entity('t_order', { ... }, { sharding: byMonth('createdAt', { from: '2025-01' }) });

const sdb = shardDatabases({
  shards: { ds0: db0, ds1: db1 },
  routes: { Order: byMod('userId', 2, { table: (_, i) => \`ds\${i}\` }) },
});`;

export default _component(() => () => (
  <DocPage>
    <Section id="setup" title="接入">
      <P text="`shardDatabases` 把几个连不同库的 Db 组合起来，按规则路由。每个 Db 是同一个 schema。对应官方的 sharding-datasource。" />
      <CodeBlock code={databases} lang="ts" />
    </Section>
    <Section id="query" title="查询">
      <CodeBlock code={query} lang="ts" />
      <SimpleTable
        head={['操作', '跨库时']}
        rows={[
          ['`toList`', '各库查完，按 `orderBy` 归并'],
          ['`toPage`', '各库取前 `页码 × 条数` 行，归并再切；总数相加'],
          ['`count`、`sum`、`min`、`max`', '各库算完再合并'],
          ['`first`', '等于 `toPage(1, 1)`'],
          ['`avg`、`groupBy`', '不支持：各库的结果合并不出正确的值，在单个库上算'],
          ['带 `limit`、`offset` 的 `toList`', '报错，跨库分页用 `toPage`'],
        ]}
      />
    </Section>
    <Section id="write" title="写入">
      <P text="`insert` 按分片键把行分到各库，少了分片键报错；`update`、`delete` 在条件裁剪出的各库上执行，返回合计的行数。写入只在各自的库里，不是分布式事务。需要跨库一致时用发件箱，见“拦截器”。" />
      <CodeBlock code={write} lang="ts" />
    </Section>
    <Section id="combo" title="分库再分表">
      <CodeBlock code={combo} lang="ts" />
      <Note text="跨库排序在内存里归并，所以排序的列要选进结果。翻到很后面时每个库都要取很多行，深分页的场景按分片键把查询限制在一个库里。同时查几个库由 `concurrency` 决定，默认 4。没写路由的实体只在 `defaultShard` 里。" />
    </Section>
  </DocPage>
));
