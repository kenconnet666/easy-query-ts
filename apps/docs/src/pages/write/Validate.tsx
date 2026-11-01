/** 由实体生成校验器 */
import { _component } from '@zerodep-dev/vue-tsx-pro-tsx';
import { CodeBlock } from '@zerodep-dev/vue-tsx-pro-ui';
import { DocPage, P, Section, SimpleTable } from '../../site/content';
import { SqlExample } from '../../site/SqlExample';
import { validate } from './write.examples.ts';

const shapes = `const v = validators(User);

v.insert; // 插入：必填的列要有
v.update; // 更新：都可省，给了的要合法
v.row; // 整行：每一列都要有

// 三个都实现了 Standard Schema，表单、接口框架直接用
const result = await v.insert['~standard'].validate(input);
// { value } 或 { issues: [{ message: 'required', path: ['name'] }] }`;

export default _component(() => () => (
  <DocPage>
    <Section id="validators" title="不用再写一遍">
      <P text="列上已经写了类型、可空、默认值、长度、小数位、枚举和 JSON 结构，表单和接口的校验不用再写一遍。`validators(实体)` 给出三个校验器，都实现了 Standard Schema：接收 zod、valibot 的地方都能直接用。" />
      <CodeBlock code={shapes} lang="ts" />
      <SqlExample example={validate} title="一份合法的输入，一份不合法的" />
      <SimpleTable
        head={['规则', '来自']}
        rows={[
          ['必填', '插入时不可空、不是自增、没有默认值'],
          ['可空', '`nullable()`'],
          ['类型', '列的类型：字符串、数字、日期、布尔、枚举'],
          ['长度、小数位', '`col.string(50)`、`col.decimal(10, 2)`'],
          ['枚举', '`col.enum([...])`'],
          ['JSON 结构', '`col.json(zodSchema)` 给的校验库'],
        ]}
      />
    </Section>
  </DocPage>
));
