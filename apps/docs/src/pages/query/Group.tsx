/** 分组与聚合 */
import { _component } from '@zerodep-dev/vue-tsx-pro-tsx';
import { CodeBlock } from '@zerodep-dev/vue-tsx-pro-ui';
import { DocPage, Note, P, Section, SimpleTable } from '../../site/content';
import { SqlExample } from '../../site/SqlExample';
import {
  caseInGroup,
  group,
  groupAggregates,
  groupByMonth,
  having,
  salesByProduct,
} from './advanced.examples.ts';
import {
  groupByYearMonth,
  groupCountIf,
  groupDistinct,
  groupMultiKey,
  groupOrder,
  groupThenFilter,
  groupWholeTable,
  havingMany,
  joiningOptions,
} from './analytics.examples.ts';

const rollup = `db.queryable(Order)
  .groupBy((o) => ({ status: o.status }))
  .rollup()
  .select((g) => ({
    status: g.key.status,         // rollup 之后键的类型可空：小计行是 null
    isTotal: g.grouping((o) => o.status),
    orders: g.count(),
  }))
  .toList();
// PostgreSQL：GROUP BY ROLLUP (t0."status")
// MySQL：    GROUP BY t0.\`status\` WITH ROLLUP`;

const distinctOn = `// 每位作者最新的一篇：键自动排在 ORDER BY 最前面，后面接你写的排序
db.queryable(Post)
  .distinctOn((p) => p.authorId)
  .orderBy((p) => p.publishedAt.desc())
  .toList();
// SELECT DISTINCT ON (t0."author_id") ... ORDER BY t0."author_id", t0."published_at" DESC`;

export default _component(() => () => (
  <DocPage>
    <Section id="group" title="分组">
      <P text="`groupBy` 返回分组键，`select` 里 `g.key` 取键、`g.count()`、`g.sum()` 取聚合。结果类型照样推导。" />
      <SqlExample example={group} title="按状态数一数" />
      <P text="分组键、聚合里都能用导航，join 自动加上。" />
      <SqlExample example={groupAggregates} title="每个分类的帖子数、总阅读量、平均和最高" />
      <SqlExample example={groupMultiKey} title="几个键：按作者和状态" />
      <P text="分组键可以是表达式。`dateTrunc` 把时间截到月、周、天，周从星期一开始。" />
      <SqlExample example={groupByMonth} title="按月统计订单" />
      <SqlExample example={groupByYearMonth} title="按年、月两个键" />
      <SqlExample example={caseInGroup} title="按 CASE 分组" />
      <P text="`groupBy(() => ({}))` 不分组，一行里算好几个聚合。" />
      <SqlExample example={groupWholeTable} title="整张表一行统计" />
    </Section>
    <Section id="aggregates" title="聚合函数">
      <SimpleTable
        head={['方法', '含义']}
        rows={[
          ['`g.count()`', '行数'],
          ['`g.count(条件)`', '满足条件的行数，一条语句分别数几类'],
          ['`g.countDistinct(列)`', '去重后的个数'],
          ['`g.sum`、`g.avg`', '只接受数值；decimal 列的结果还是文字，不丢精度'],
          ['`g.max`、`g.min`', '任意可比较的列'],
          ['`g.joining(列, 选项)`', '字符串聚合，可以指定分隔符、排序、去重'],
          ['`g.grouping(列)`', '`rollup` 的小计行为 1'],
        ]}
      />
      <SqlExample example={groupCountIf} title="分别数已发布和草稿" />
      <SqlExample example={groupDistinct} title="每篇帖子有几条评论、几个人评论" />
      <P text="`joining` 各库的 GROUP_CONCAT、STRING_AGG、LISTAGG 由方言选，切换方言看看差别。" />
      <SqlExample example={joiningOptions} title="标题按阅读量排序连起来" />
      <P text="表达式也能放进聚合。下面跨订单和商品两张表，只算已付款的订单。" />
      <SqlExample example={salesByProduct} title="商品销量榜：卖出两件以上的" />
    </Section>
    <Section id="having" title="过滤和排序分组">
      <P text="`having` 过滤分组，能写聚合条件；条件数组同样是 AND。" />
      <SqlExample example={having} title="发过两篇以上的作者和他们的标题" />
      <SqlExample example={havingMany} title="两个条件：多于一件、总额过 300" />
      <P text="`orderBy` 的回调也能用键和聚合。" />
      <SqlExample example={groupOrder} title="阅读量最高的三个分类" />
      <P text="分组结果再加条件、再分页，先 `asTable()` 变成派生表。" />
      <SqlExample example={groupThenFilter} title="总阅读量过 2000 的作者，分页" />
    </Section>
    <Section id="rollup" title="小计和总计">
      <P text="`rollup`、`cube` 算小计和总计，`g.grouping` 在小计行为 1，用来区分“小计行的 NULL”和“数据本身的 NULL”。MySQL 是 `WITH ROLLUP`，没有 `cube`；SQLite 都不支持，渲染时报错，所以这里没有做成能运行的卡片。" />
      <CodeBlock code={rollup} lang="ts" />
    </Section>
    <Section id="distinct-on" title="每组一行">
      <P text="`distinctOn` 是 PostgreSQL 的 DISTINCT ON：按键每组只留一行，留哪行由排序决定。别的库用“窗口函数”一章的每组取前几名。" />
      <CodeBlock code={distinctOn} lang="ts" />
      <Note text="子表统计优先用导航上的聚合（`u.posts.count()`），不用自己写分组再 join，见“对多：隐式子查询”。" />
    </Section>
  </DocPage>
));
