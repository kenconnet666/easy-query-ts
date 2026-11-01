/** 查询：分组、窗口、子查询与原生 SQL */
import { _component } from '@zerodep-dev/vue-tsx-pro-tsx';
import { DocPage, P, Points, Section } from '../../site/content';
import { SqlExample } from '../../site/SqlExample';
import {
  caseExpr,
  group,
  having,
  inSubquery,
  rawFragment,
  union,
  window,
} from './advanced.examples.ts';

export default _component(() => () => (
  <DocPage>
    <Section id="group" title="分组与聚合">
      <P text="`groupBy` 返回分组键，`select` 里 `g.key` 取键、`g.count()`、`g.sum()` 取聚合。结果类型照样推导，`views` 是 `number | null`。" />
      <SqlExample example={group} title="按状态统计帖子数与总阅读量" />
      <P text="`having` 过滤分组；`joining` 是字符串聚合，各库的 GROUP_CONCAT、STRING_AGG、LISTAGG 由方言选。切换方言看看差别。" />
      <SqlExample example={having} title="发过两篇以上的作者和他们的标题" />
      <Points
        items={[
          '`rollup()`、`cube()` 按方言渲染，MySQL 是 `WITH ROLLUP`。',
          '`caseWhen`、窗口函数都是表达式，能放进 `select`、`where`、`orderBy`。',
        ]}
      />
    </Section>
    <Section id="case" title="CASE 与窗口函数">
      <SqlExample example={caseExpr} title="按阅读量分级" />
      <SqlExample example={window} title="每个作者的帖子排名与总阅读量" />
    </Section>
    <Section id="subquery" title="子查询与联合">
      <P text="查询对象可以直接当子查询用。对多的导航上的 `any`、`count` 也是子查询，写起来更短，见“导航”一章。" />
      <SqlExample example={inSubquery} title="写过热门帖子的用户" />
      <P text="`union`、`unionAll` 的各成员形状由类型检查，列对不上编译不过。" />
      <SqlExample example={union} title="未成年和四十岁以上的用户" />
    </Section>
    <Section id="native" title="原生 SQL 片段">
      <P text="`sql` 模板把库里有、这里没封装的写法插进表达式：列和值都能放进去，值绑定成参数，结果类型写在类型参数里。整条语句用 `db.sql`。" />
      <SqlExample example={rawFragment} title="条件里写一段 SQL" />
    </Section>
  </DocPage>
));
