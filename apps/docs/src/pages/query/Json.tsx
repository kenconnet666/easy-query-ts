/** JSON 列 */
import { _component } from '@zerodep-dev/vue-tsx-pro-tsx';
import { CodeBlock } from '@zerodep-dev/vue-tsx-pro-ui';
import { DocPage, Note, P, Points, Section, SimpleTable } from '../../site/content';
import { SqlExample } from '../../site/SqlExample';
import { jsonLength, jsonPath, jsonRead, jsonWrite } from './more.examples.ts';

const declare = `const Profile = entity('t_profile', {
  userId: col.bigint().primaryKey(),
  skills: col.json<string[]>(), // 类型写在泛型里，读出来就是 string[]
});

// 也可以交给 zod 这类校验库：读写时校验
const Settings = entity('t_settings', {
  id: col.int().primaryKey(),
  value: col.json(settingsSchema),
});`;

export default _component(() => () => (
  <DocPage>
    <Section id="declare" title="声明">
      <P text="`col.json<T>()` 按方言建 JSON、JSONB 或文本列，写入时序列化，读出时解析。结构写在泛型里，路径函数按它检查。" />
      <CodeBlock code={declare} lang="ts" />
    </Section>
    <Section id="read" title="读写整列">
      <SqlExample example={jsonRead} title="读出来就是数组" />
      <SqlExample example={jsonWrite} title="整列写回" />
    </Section>
    <Section id="path" title="路径函数">
      <P text="路径函数把 JSON 里的值取出来，能放进结果、条件和排序。路径按列的 TS 类型检查，写错键名编译不过。各库的写法差别很大，切换方言看看。" />
      <SqlExample example={jsonLength} title="数组长度" />
      <SqlExample example={jsonPath} title="按下标取值" />
      <SimpleTable
        head={['方法', '含义']}
        rows={[
          ['`json(...路径)`', '取路径处的 JSON 值'],
          ['`jsonText(...路径)`', '取成文字，比较、`like` 时用'],
          ['`jsonNumber`、`jsonBoolean`', '取成数字、布尔'],
          ['`jsonHas(...路径)`', '路径存在'],
          ['`jsonLength(...路径)`', '数组长度'],
          ['`jsonSet`、`jsonRemove`、`jsonMerge`、`jsonAppend`', '只改 JSON 的一部分，写进 `set`'],
        ]}
      />
      <Points
        items={[
          '方言专属的写法从入口取：`Pg.jsonb(u.attrs).hasKey(...)`、`MySQL.json(u.attrs).contains(...)`。',
          'Db2 没有 `jsonLength`，渲染时报错，不会悄悄变成别的语义。',
        ]}
      />
      <Note text="能用普通列就用普通列：JSON 适合结构不固定、不常按它查询的数据。要按它查询时，记得按方言建表达式索引。" />
    </Section>
  </DocPage>
));
