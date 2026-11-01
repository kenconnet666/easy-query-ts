/** 分表 */
import { _component } from '@zerodep-dev/vue-tsx-pro-tsx';
import { CodeBlock } from '@zerodep-dev/vue-tsx-pro-ui';
import { DocPage, Note, P, Points, Section, SimpleTable } from '../../site/content';
import { SqlExample } from '../../site/SqlExample';
import {
  modAll,
  modEq,
  modIn,
  modTables,
  monthEq,
  monthRange,
  shardAggregate,
} from './scale.examples.ts';

const tables = `import { byMod, byMonth } from '@zerodep-dev/easy-query-ts';

const Log = entity('t_log', { id: col.bigint().primaryKey(), userId: col.bigint() }, {
  sharding: byMod('userId', 4), // t_log_0 … t_log_3
});
const Bill = entity('t_bill', { id: col.bigint().primaryKey(), createdAt: col.datetime() }, {
  sharding: byMonth('createdAt', { from: '2025-01' }), // t_bill_202501 … 到本月
});

await db.createTables(); // 建出每一张实际表
await db.insert(Bill).values(rows).execute(); // 按分片键路由，一张表一条语句
await db
  .queryable(Bill)
  .where((b) => b.createdAt.ge(start))
  .orderBy((b) => b.createdAt.desc())
  .toPage(1, 20);`;

const custom = `// 自定义规则：表有哪些、一行进哪张表、条件能裁剪到哪几张
const byRegion: ShardingRule<'region'> = {
  column: 'region',
  tables: (base) => ['cn', 'us'].map((r) => \`\${base}_\${r}\`),
  tableOf: (base, value) => \`\${base}_\${String(value)}\`,
  prune: (base, filter) => (filter.op === 'eq' ? [\`\${base}_\${String(filter.value)}\`] : undefined),
};`;

export default _component(() => () => (
  <DocPage>
    <Section id="declare" title="声明规则">
      <P text="实体声明分片规则，业务代码还是普通的查询和写入。" />
      <CodeBlock code={tables} lang="ts" />
      <SimpleTable
        head={['规则', '表名', '能裁剪的条件']}
        rows={[
          ['`byMod(列, n)`', '`表_0` … `表_n-1`', '`eq`、`in`'],
          ['`byYear(列, 选项)`', '`表_2025`', '`eq`、`in`、范围'],
          ['`byMonth(列, 选项)`', '`表_202501`', '`eq`、`in`、范围'],
          ['`byDay(列, 选项)`', '`表_20250101`', '`eq`、`in`、范围'],
        ]}
      />
      <P text="`createTables`、`createTablesSql` 展开成每一张实际的表。" />
      <SqlExample example={modTables} title="四张表" />
    </Section>
    <Section id="prune" title="按条件裁剪">
      <P text="查询读 `where` 顶层 AND 里分片键上的条件，裁剪出要查的表。一张就直接查，几张就 UNION ALL。下面这些卡片只渲染 SQL，不执行：示例库里没有这些表。" />
      <SqlExample example={modEq} title="取模：一个值，一张表" />
      <SqlExample example={modIn} title="取模：两个值，两张表" />
      <SqlExample example={monthEq} title="按月：等值" />
      <SqlExample example={monthRange} title="按月：范围两端都裁剪" />
    </Section>
    <Section id="all" title="没有分片键时">
      <P text="没有分片键条件时查全部表。排序、分页、聚合都在库里做。" />
      <SqlExample example={modAll} title="全部表，排序取前几行" />
      <SqlExample example={shardAggregate} title="聚合" />
      <Points
        items={[
          '`insert` 按每行的分片键算表，少了分片键报错。',
          '`update`、`delete` 裁剪出表后逐张执行，要原子请放进事务；`expectRows`、`returning` 按汇总算。',
          '取模只能按 `eq`、`in` 裁剪；范围条件查全部表。',
        ]}
      />
      <Note text="官方的跨表查询在内存里归并；这里交给库的 UNION ALL，代码简单、行为与普通查询一致，表很多时注意执行计划。" />
    </Section>
    <Section id="ops" title="运维">
      <P text="按时间分表时，由部署或定时任务调用 `syncTables()` 建下一段的表。`to` 选项指定最后一张表的时间，默认到现在。" />
      <P text="`byMod` 的 `table` 选项能换表名的写法，也能把表放到别的 schema。" />
    </Section>
    <Section id="custom" title="自定义规则">
      <P text="实现 `ShardingRule` 的 `tables`、`tableOf`、`prune`。`prune` 返回 `undefined` 表示裁剪不了，查全部。" />
      <CodeBlock code={custom} lang="ts" />
      <Note text="跨库的分片见“分库”。只是想由代码明确指定用哪张表时用 `mapTables`，见“动态表名”。" />
    </Section>
  </DocPage>
));
