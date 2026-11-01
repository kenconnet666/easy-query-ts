/** 查询：分组、窗口、子查询、CTE */
import { _component } from '@zerodep-dev/vue-tsx-pro-tsx';
import { CodeBlock } from '@zerodep-dev/vue-tsx-pro-ui';
import { DocPage, P, Section } from '../../site/content';
import { SqlExample } from '../../site/SqlExample';
import {
  caseExpr,
  caseInGroup,
  cte,
  group,
  groupAggregates,
  groupByMonth,
  having,
  inSubquery,
  ntile,
  recursive,
  rowNumber,
  salesByProduct,
  scalar,
  topPerGroup,
  union,
  window,
} from './advanced.examples.ts';

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
    <Section id="group" title="分组与聚合">
      <P text="`groupBy` 返回分组键，`select` 里 `g.key` 取键、`g.count()`、`g.sum()` 取聚合。结果类型照样推导。" />
      <SqlExample example={group} title="按状态数一数" />
      <P text="分组键、聚合里都能用导航，join 自动加上。" />
      <SqlExample example={groupAggregates} title="每个分类的帖子数、总阅读量、平均和最高" />
      <P text="`having` 过滤分组；`joining` 是字符串聚合，各库的 GROUP_CONCAT、STRING_AGG、LISTAGG 由方言选，切换方言看看差别。" />
      <SqlExample example={having} title="发过两篇以上的作者和他们的标题" />
      <P text="再复杂一点：跨订单和商品两张表，只算已付款的订单，表达式 `price * quantity` 放进聚合。" />
      <SqlExample example={salesByProduct} title="商品销量榜：卖出两件以上的" />
      <P text="`dateTrunc` 把时间截到月、周、天，按月统计就是按它分组。周从星期一开始。" />
      <SqlExample example={groupByMonth} title="按月统计订单" />
    </Section>
    <Section id="case" title="CASE">
      <P text="`caseWhen` 是表达式，能放进 `select`、`where`、`orderBy`，也能当分组键。结果类型是各分支值类型的并集。" />
      <SqlExample example={caseExpr} title="按阅读量分级" />
      <SqlExample example={caseInGroup} title="按等级分组" />
    </Section>
    <Section id="window" title="窗口函数">
      <SqlExample example={rowNumber} title="全站排名" />
      <SqlExample example={window} title="分作者：排名、总阅读量、上一篇的阅读量" />
      <P text="想按窗口函数的结果过滤，先 `asTable()` 变成派生表，外层再 `where`。这是“每组取前几名”的通用写法。" />
      <SqlExample example={topPerGroup} title="每位作者阅读量最高的一篇" />
      <P text="`win.ntile` 把行分成几等份，算分位数、分档时用。" />
      <SqlExample example={ntile} title="按阅读量把帖子分成三档" />
    </Section>
    <Section id="subquery" title="子查询与联合">
      <P text="查询对象可以直接当子查询用。对多的导航上的 `any`、`count` 也是子查询，写起来更短，见“导航”一章。" />
      <SqlExample example={inSubquery} title="IN 子查询：写过热门帖子的用户" />
      <SqlExample example={scalar} title="标量子查询：阅读量高于平均的帖子" />
      <P text="`union`、`unionAll` 按列名对齐，形状由类型检查，列对不上编译不过。" />
      <SqlExample example={union} title="未成年和四十岁以上的用户" />
    </Section>
    <Section id="cte" title="CTE 与递归">
      <P text="`db.with` 返回一个多了这张“表”的 Db，类型也跟着变。子查询里用到的 CTE 会提到语句开头。" />
      <SqlExample example={cte} title="WITH：先算出热门帖子，再 join" />
      <P text="`withRecursive` 给起点和递归的一步。树形数据有更简单的 `descendantsOf`，见“对象树与树形数据”。" />
      <SqlExample example={recursive} title="递归：研发部的全部下级部门和深度" />
    </Section>
    <Section id="pg-only" title="小计、总计与每组一行">
      <P text="`rollup`、`cube` 算小计和总计，`g.grouping` 在小计行为 1，用来区分“小计行的 NULL”和“数据本身的 NULL”。MySQL 是 `WITH ROLLUP`，MySQL 没有 `cube`；SQLite 都不支持，渲染时报错，所以这里没有做成能运行的卡片。" />
      <CodeBlock code={rollup} lang="ts" />
      <P text="`distinctOn` 是 PostgreSQL 的 DISTINCT ON：按键每组只留一行，留哪行由排序决定。别的库用上面的“每位作者阅读量最高的一篇”。" />
      <CodeBlock code={distinctOn} lang="ts" />
    </Section>
  </DocPage>
));
