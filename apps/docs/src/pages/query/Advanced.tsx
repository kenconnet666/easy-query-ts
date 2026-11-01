/** 查询：分组、窗口、子查询、CTE 与原生 SQL */
import { _component } from '@zerodep-dev/vue-tsx-pro-tsx';
import { DocPage, P, Points, Section } from '../../site/content';
import { SqlExample } from '../../site/SqlExample';
import {
  caseExpr,
  caseInGroup,
  cte,
  group,
  groupAggregates,
  having,
  inSubquery,
  rawFragment,
  rawStatement,
  recursive,
  rowNumber,
  salesByProduct,
  scalar,
  topPerGroup,
  union,
  window,
} from './advanced.examples.ts';

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
      <Points items={['`rollup()`、`cube()` 按方言渲染，MySQL 是 `WITH ROLLUP`。']} />
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
    <Section id="native" title="原生 SQL">
      <P text="`sql` 模板把库里有、这里没封装的写法插进表达式：列和值都能放进去，值绑定成参数，结果类型写在类型参数里。" />
      <SqlExample example={rawFragment} title="条件里写一段 SQL" />
      <P text="整条语句用 `db.sql`。这时写的就是库的原生语法，换数据库不会帮你改写。" />
      <SqlExample example={rawStatement} title="一整条原生 SQL" />
    </Section>
  </DocPage>
));
