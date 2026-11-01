/** 按键填充：没声明关系时 */
import { _component } from '@zerodep-dev/vue-tsx-pro-tsx';
import { CodeBlock } from '@zerodep-dev/vue-tsx-pro-ui';
import { DocPage, Note, P, Points, Section } from '../../site/content';
import { SqlExample } from '../../site/SqlExample';
import { fillFiltered, fillInclude, fillMissing, fillWithTree } from './more.examples.ts';
import { fillManyRows, fillOneRow } from './navigate.examples.ts';

const crossDb = `// 订单在业务库，操作日志在日志库：两个 Db，关系声明不了
const logs = logDb
  .queryable(Log)
  .orderBy((l) => l.at)
  .select((l) => ({ at: l.at, text: l.text }));

await db
  .queryable(Order)
  .select((o) => ({
    no: o.no,
    logs: logs.fillMany((l) => l.orderNo, o.no), // { at; text }[]
  }))
  .toList();`;

export default _component(() => () => (
  <DocPage>
    <Section id="fill" title="不声明关系也能拼">
      <P text="`fillMany`、`fillOne` 按键从另一条查询填一个数组或一行，不需要声明关系。主查询读完后按一批键（每批 500 个）查一次。对应 Java 版的 fillMany、fillOne。" />
      <SqlExample example={fillManyRows} title="fillMany：每家公司的部门" />
      <SqlExample example={fillOneRow} title="fillOne：帖子所属的分类" />
    </Section>
    <Section id="query" title="被填充的查询">
      <P text="它是普通的查询，`where`、`orderBy`、`select` 都生效，嵌套的 `toList` 也能用。" />
      <SqlExample example={fillFiltered} title="只填过千的帖子，按阅读量排序" />
      <SqlExample example={fillWithTree} title="填帖子，帖子再带标签" />
      <P text="键为 NULL 的行填不到东西：`fillOne` 是 null，`fillMany` 是空数组。" />
      <SqlExample example={fillMissing} title="顾言没有公司" />
      <P text="`include` 里也能用。" />
      <SqlExample example={fillInclude} title="订单整行，填上买家" />
    </Section>
    <Section id="cross" title="跨库">
      <P text="查询可以来自另一个 Db，也就是另一个库，这是它和导航最大的不同。" />
      <CodeBlock code={crossDb} lang="ts" />
      <Points
        items={[
          '不能带 `limit`、`offset`：那是对整批的，不是每行的。',
          '声明得了关系时优先用导航：能用在条件、排序里，保存时也能走 `save`。',
        ]}
      />
      <Note text="这些卡片的第二条查询和对象树一样按 IN 取回，没有 N+1。" />
    </Section>
  </DocPage>
));
