/** 对象树：select 里的 toList、first，以及 include */
import { _component } from '@zerodep-dev/vue-tsx-pro-tsx';
import { DocPage, Note, P, Points, Section } from '../../site/content';
import { SqlExample } from '../../site/SqlExample';
import {
  countsInTree,
  firstWholeRow,
  includeChildren,
  includeThenFilter,
  oneInTree,
  treeFourLevels,
  treeWithPage,
  wholeChildren,
} from './more.examples.ts';
import {
  deepTree,
  firstOfMany,
  limitPerParent,
  orderTree,
  tree,
  treeOneLevel,
} from './navigate.examples.ts';

export default _component(() => () => (
  <DocPage>
    <Section id="tree" title="一棵对象树">
      <P text="在 `select` 里对导航写 `toList`，结果就是嵌套的列表。每一层一条 SQL：先查父行，再按外键一次取回所有子行，在内存里拼好。所以没有 N+1，层数多也只多几条语句。" />
      <SqlExample example={treeOneLevel} title="最简单的：公司和员工名字" />
      <P text="看中间的 SQL 一栏：三层结果就是三条语句，第二、第三条的 `IN` 里是上一层的键。每层都能加 `where`、`orderBy`。" />
      <SqlExample example={tree} title="公司 → 成年员工 → 帖子（按阅读量排序）" />
      <Points
        items={[
          '结果类型全部推导：`users` 是 `{ name: string; posts: { title: string; views: number }[] }[]`。',
          '关联键为空时不查子项。',
        ]}
      />
    </Section>
    <Section id="shape" title="每一层的形状">
      <P text="`toList` 不给参数时是子表的整行。" />
      <SqlExample example={wholeChildren} title="分类和它的下级（整行）" />
      <P text="每一层都是普通的 `select`：对一的导航、统计都能放。统计还在这一层的语句里，不多发查询。" />
      <SqlExample example={countsInTree} title="员工：所在城市、帖子数、最高阅读量" />
      <P text="对一的导航放进形状就是整行。" />
      <SqlExample example={oneInTree} title="用户和一对一的资料" />
    </Section>
    <Section id="include" title="整行再带上导航">
      <P text="`include` 在整行之外再带上导航，不用把列一个个写出来。一对多是数组，多对一是对象，可以和 `select` 一样写统计和条件。" />
      <SqlExample example={includeChildren} title="用户整行，带公司和帖子" />
      <SqlExample example={includeThenFilter} title="公司整行，带员工数和资深员工" />
    </Section>
    <Section id="limit" title="每个父行取几条">
      <P text="`limit` 限制的是每个父行的子行数，不是总数；渲染成 ROW_NUMBER 分区，不会读回全部再截断。" />
      <SqlExample example={limitPerParent} title="每位作者最新的一篇" />
      <P text="`first` 取一条，结果不是数组，没有时是 `null`。" />
      <SqlExample example={firstOfMany} title="每位作者阅读量最高的一篇" />
      <SqlExample example={firstWholeRow} title="点赞最多的评论（整行）" />
    </Section>
    <Section id="deep" title="更复杂的树">
      <P text="一个详情页要的东西：对一的导航、多对多、自关联的回复，各自几层都能放在一段 `select` 里。" />
      <SqlExample example={deepTree} title="帖子详情：作者、标签、评论和每条评论的回复" />
      <SqlExample example={orderTree} title="用户 → 订单 → 明细（带商品名）" />
      <SqlExample example={treeFourLevels} title="公司 → 部门 → 下级部门 → 员工 → 帖子" />
      <P text="`toPage` 也能带树：第二条查询只查这一页的父行。" />
      <SqlExample example={treeWithPage} title="帖子列表页：标签和最热的两条评论" />
      <Note text="不能和 `stream` 一起用：对象树要先拿到所有父行。第二条查询是独立的语句，在事务里时它们读到的是同一个事务。" />
    </Section>
  </DocPage>
));
