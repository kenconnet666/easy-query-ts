/** 树形数据：自己指向自己的表 */
import { _component } from '@zerodep-dev/vue-tsx-pro-tsx';
import { DocPage, Note, P, Points, Section, SimpleTable } from '../../site/content';
import { SqlExample } from '../../site/SqlExample';
import {
  ancestorsWithSelf,
  descendantsWhere,
  descendantUsers,
  orgChart,
  reportsTree,
} from './more.examples.ts';
import { ancestors, commentThread, descendants, toTree } from './navigate.examples.ts';

export default _component(() => () => (
  <DocPage>
    <Section id="which" title="三种需求">
      <SimpleTable
        head={['要的是', '写法', 'SQL']}
        rows={[
          ['某个节点的全部下级、上级', '`descendantsOf`、`ancestorsOf`', '递归 CTE'],
          ['整棵树，或一批行拼成树', '`toTree`', '一条普通查询，在内存里拼'],
          ['固定几层', '`c.children.toList(...)`，见“对象树”', '每层一条查询'],
          ['递归时带深度、路径', '`withRecursive`，见“CTE 与递归”', '递归 CTE'],
        ]}
      />
    </Section>
    <Section id="descendants" title="下级和上级">
      <P text="`descendantsOf`、`ancestorsOf` 走递归 CTE，返回的还是普通查询，之后照常 `where`、`select`。切到 HANA 看看：它没有递归 CTE，会直接告诉你。" />
      <SqlExample example={descendants} title="研发部和它的全部下级" />
      <SqlExample example={ancestors} title="基础架构小组的全部上级（不含自己）" />
      <SqlExample example={ancestorsWithSelf} title="PostgreSQL 分类和它的全部上级（含自己）" />
      <P text="结果上能用导航、统计；也能当子查询，查这些部门下的东西。" />
      <SqlExample example={descendantsWhere} title="全部下级和各自的人数" />
      <SqlExample example={descendantUsers} title="研发部及下级的全部员工" />
    </Section>
    <Section id="to-tree" title="拼成树">
      <P text="`toTree` 把查出来的行按 id 和 parent 拼成树，节点就是 `select` 的形状，每个节点多一个 `children`。这一步在内存里做，只发一条语句。" />
      <SqlExample example={toTree} title="分类树，带每个分类的帖子数" />
      <SqlExample example={orgChart} title="组织架构，带每个部门的人数" />
      <P text="`children` 的名字可以换。" />
      <SqlExample example={commentThread} title="评论楼" />
      <SqlExample example={reportsTree} title="汇报关系" />
      <Points
        items={[
          '`select` 里要有 id 和 parent 这两列。',
          '上级不在结果里的行当作根，所以筛选一部分行也能拼。',
        ]}
      />
      <Note text="节点很多时只拼要显示的层，别一次读回整张表：先用条件收窄，或者按需展开时再查下一层。" />
    </Section>
  </DocPage>
));
