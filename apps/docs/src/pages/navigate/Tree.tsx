/** 对象树：select 里写 toList */
import { _component } from '@zerodep-dev/vue-tsx-pro-tsx';
import { CodeBlock } from '@zerodep-dev/vue-tsx-pro-ui';
import { DocPage, Note, P, Points, Section } from '../../site/content';
import { SqlExample } from '../../site/SqlExample';
import { firstOfMany, tree } from './navigate.examples.ts';

const view = `// 常用的形状写成视图，导航里的层级自动带出，类型由形状推出
const CompanyCard = defineView(Company, (c) => ({
  name: c.name,
  staff: c.users.count(),
  users: c.users.toList((u) => ({ name: u.name })),
}));

await db.queryable(Company).select(CompanyCard).toList();`;

export default _component(() => () => (
  <DocPage>
    <Section id="tree" title="一棵对象树">
      <P text="在 `select` 里对导航写 `toList`，结果就是嵌套的列表。每一层一条 SQL：先查父行，再按外键一次取回所有子行，在内存里拼好。所以没有 N+1，层数多也只多几条语句。" />
      <P text="看中间的 SQL 一栏：三层结果就是三条语句，第二、第三条的 `IN` 里是上一层的键。" />
      <SqlExample example={tree} title="公司 → 成年员工 → 帖子（按阅读量排序）" />
      <Points
        items={[
          '每层都能加 `where`、`orderBy`，也能用 `limit` 限制每个父行的子行数。',
          '结果类型全部推导：`users` 是 `{ name: string; posts: { title: string; views: number }[] }[]`。',
        ]}
      />
    </Section>
    <Section id="first" title="只要一条子行">
      <P text="`first` 取每个父行的第一条子行，没有时是 `null`。" />
      <SqlExample example={firstOfMany} title="每位作者阅读量最高的帖子" />
    </Section>
    <Section id="view" title="复用形状：视图">
      <P text="结果形状就是 DTO 的类型，不需要另写 VO 类。常用的形状用 `defineView` 存下来，别处直接 `select`。" />
      <CodeBlock code={view} lang="ts" />
      <Note text="这对应官方的 selectAutoInclude：Java 版要写 DTO 类并用注解标导航，这里形状本身就是声明。" />
    </Section>
  </DocPage>
));
