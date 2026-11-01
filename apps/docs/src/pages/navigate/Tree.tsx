/** 对象树、视图与树形数据 */
import { _component } from '@zerodep-dev/vue-tsx-pro-tsx';
import { DocPage, Note, P, Points, Section } from '../../site/content';
import { SqlExample } from '../../site/SqlExample';
import {
  ancestors,
  commentThread,
  deepTree,
  descendants,
  firstOfMany,
  limitPerParent,
  nestedView,
  orderTree,
  toTree,
  tree,
  treeOneLevel,
  view,
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
          '关联键为空时不查子项；同一层的 `count`、对一的导航照常能用。',
        ]}
      />
    </Section>
    <Section id="limit" title="每个父行取几条">
      <P text="`limit` 限制的是每个父行的子行数，不是总数；`first` 取一条，结果不是数组，没有时是 `null`。" />
      <SqlExample example={limitPerParent} title="每位作者最新的一篇" />
      <SqlExample example={firstOfMany} title="每位作者阅读量最高的一篇" />
    </Section>
    <Section id="deep" title="更复杂的树">
      <P text="一个详情页要的东西：对一的导航、多对多、自关联的回复，各自几层都能放在一段 `select` 里。" />
      <SqlExample example={deepTree} title="帖子详情：作者、标签、评论和每条评论的回复" />
      <SqlExample example={orderTree} title="用户 → 订单 → 明细（带商品名）" />
    </Section>
    <Section id="view" title="复用形状：视图">
      <P text="结果形状就是 DTO 的类型，不需要另写 VO 类。常用的形状用 `defineView` 存下来，别处直接 `select`。" />
      <SqlExample example={view} title="把形状存下来，到处复用" />
      <P text="视图能嵌套：把另一个视图传给 `toList`。`ViewOf<typeof PostCard>` 拿到这个形状的类型，给接口返回值用。" />
      <SqlExample example={nestedView} title="视图里嵌视图" />
      <Note text="这对应官方的 selectAutoInclude：Java 版要写 DTO 类并用注解标导航，这里形状本身就是声明。" />
    </Section>
    <Section id="tree-data" title="树形数据">
      <P text="部门、分类这种一张表自己指向自己的数据。`descendantsOf`、`ancestorsOf` 走递归 CTE，之后照常 `where`、`select`。切到 HANA 看看：它没有递归 CTE，会直接告诉你。" />
      <SqlExample example={descendants} title="研发部和它的全部下级" />
      <SqlExample example={ancestors} title="基础架构小组的全部上级" />
      <P text="`toTree` 把查出来的行按 id 和 parent 拼成树，节点就是 `select` 的形状，每个节点多一个 `children`。这一步在内存里做，只发一条语句。" />
      <SqlExample example={toTree} title="分类树，带每个分类的帖子数" />
      <SqlExample example={commentThread} title="评论楼：children 的名字可以换" />
    </Section>
  </DocPage>
));
