/** 计算属性 */
import { _component } from '@zerodep-dev/vue-tsx-pro-tsx';
import { CodeBlock } from '@zerodep-dev/vue-tsx-pro-ui';
import { DocPage, Note, P, Section } from '../../site/content';
import { SqlExample } from '../../site/SqlExample';
import { computedSelect, computedTable, computedWhere } from './more.examples.ts';

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
    </Section>
    <Section id="use" title="到处都能用">
      <SqlExample example={computedSelect} title="放进结果：SQL 里展开成表达式" />
      <SqlExample example={computedWhere} title="放进条件和排序" />
      <P text="`table` 也认：请求里可以按计算属性筛选、排序。" />
      <SqlExample example={computedTable} title="列表页按计算属性筛选、排序" />
      <Note text="计算属性在 SQL 里每用一次就展开一次。跨表聚合放在大表的排序里时看一眼执行计划，必要时写一个普通列冗余存下来。" />
    </Section>
  </DocPage>
));
