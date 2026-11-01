/** 计算属性 */
import { _component } from '@zerodep-dev/vue-tsx-pro-tsx';
import { CodeBlock } from '@zerodep-dev/vue-tsx-pro-ui';
import { DocPage, Note, P, Section } from '../../site/content';
import { SqlExample } from '../../site/SqlExample';
import {
  computedInGroup,
  computedInNavigation,
  computedInTree,
  computedPage,
  computedSortRequest,
} from '../query/extras.examples.ts';
import { computedSelect, computedTable, computedWhere } from '../query/more.examples.ts';

const declare = `export const schema = defineComputed(base, 'User', {
  // 拼接
  label: (u) => text\`\${u.name}（\${u.company.name}）\`,
  // 状态
  stage: (u) => caseWhen(u.age.ge(18), '成年').when(u.age.isNull(), '未知').else('未成年'),
  // 跨表聚合
  postCount: (u) => u.posts.count(),
});`;

export default _component(() => () => (
  <DocPage>
    <Section id="declare" title="声明">
      <P text="计算属性是数据库里算出来的属性：拼接、状态、跨表聚合。声明一次，之后像一列那样用，类型自动推出。对应官方的 prop 一章。" />
      <CodeBlock code={declare} lang="ts" title="model.ts" />
      <P text="回调拿到这个实体的列和导航，返回一个表达式。多个实体有计算属性时 `defineComputed` 连着包。" />
    </Section>
    <Section id="use" title="到处都能用">
      <SqlExample example={computedSelect} title="放进结果：SQL 里展开成表达式" />
      <SqlExample example={computedWhere} title="放进条件和排序" />
      <SqlExample example={computedInGroup} title="当分组键" />
      <P text="经导航也能取到别的实体的计算属性。" />
      <SqlExample example={computedInNavigation} title="作者的标签和帖子数" />
      <SqlExample example={computedInTree} title="评论的作者" />
    </Section>
    <Section id="list" title="列表页">
      <SqlExample example={computedPage} title="分页" />
      <P text="`table` 也认：请求里可以按计算属性筛选、排序。" />
      <SqlExample example={computedTable} title="按计算属性筛选、排序" />
      <SqlExample example={computedSortRequest} title="只按它排序" />
    </Section>
    <Section id="write" title="写入">
      <Note text="计算属性没有对应的列，不能写入，也不在 `Insert`、`Update` 的类型里。在 SQL 里每用一次就展开一次：跨表聚合放在大表的排序里时看一眼执行计划，必要时写一个普通列冗余存下来。" />
    </Section>
  </DocPage>
));
