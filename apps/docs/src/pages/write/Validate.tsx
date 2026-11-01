/** 由实体生成校验器 */
import { _component } from '@zerodep-dev/vue-tsx-pro-tsx';
import { CodeBlock } from '@zerodep-dev/vue-tsx-pro-ui';
import { DocPage, Note, P, Section, SimpleTable } from '../../site/content';
import { SqlExample } from '../../site/SqlExample';
import { unionValidate } from '../model/model.examples.ts';
import {
  validateDate,
  validateDecimal,
  validateEnum,
  validateMissing,
  validateThenWrite,
  validateUpdate,
  validateWrongType,
} from './more.examples.ts';
import { validate } from './write.examples.ts';

const shapes = `const v = validators(User);

v.insert; // 插入：必填的列要有
v.update; // 更新：都可省，给了的要合法
v.row; // 整行：每一列都要有

// 三个都实现了 Standard Schema，表单、接口框架直接用
const result = await v.insert['~standard'].validate(input);
// { value } 或 { issues: [{ message: 'required', path: ['name'] }] }`;

const framework = `// 接收 Standard Schema 的地方都能直接用，比如 Hono 的校验中间件
import { sValidator } from '@hono/standard-validator';

app.post('/users', sValidator('json', validators(User).insert), async (c) => {
  const input = c.req.valid('json'); // 类型就是插入的形状
  return c.json(await db.insert(User).values(input).returnEntity());
});`;

export default _component(() => () => (
  <DocPage>
    <Section id="validators" title="不用再写一遍">
      <P text="列上已经写了类型、可空、默认值、长度、小数位、枚举和 JSON 结构，表单和接口的校验不用再写一遍。`validators(实体)` 给出三个校验器，都实现了 Standard Schema：接收 zod、valibot 的地方都能直接用。" />
      <CodeBlock code={shapes} lang="ts" />
      <SqlExample example={validate} title="一份合法的输入，一份不合法的" />
    </Section>
    <Section id="rules" title="校验什么">
      <SimpleTable
        head={['规则', '来自']}
        rows={[
          ['必填', '插入时不可空、不是自增、没有默认值'],
          ['可空', '`nullable()`'],
          ['类型', '列的类型：字符串、数字、日期、布尔、枚举'],
          ['长度、小数位', '`col.string(50)`、`col.decimal(10, 2)`'],
          ['枚举', '`col.enum([...])`'],
          ['JSON 结构', '`col.json(zodSchema)` 给的校验库'],
          ['多态实体', '按判别列选子类型，见“多态实体”'],
        ]}
      />
      <P text="每条错误带 `path`，指向哪一列，前端可以直接标到表单项上。" />
      <SqlExample example={validateMissing} title="缺必填的列" />
      <SqlExample example={validateWrongType} title="类型不对" />
      <SqlExample example={validateEnum} title="枚举里没有" />
      <SqlExample example={validateDate} title="日期格式不对" />
      <SqlExample example={validateDecimal} title="小数超出精度" />
      <SqlExample example={unionValidate} title="多态实体：银行卡缺卡号" />
    </Section>
    <Section id="update" title="更新的校验">
      <P text="`update` 里每一列都可省，给了的要合法，适合 PATCH 接口。" />
      <SqlExample example={validateUpdate} title="只给一部分" />
    </Section>
    <Section id="use" title="校验之后写库">
      <P text="校验通过的 `value` 类型就是插入的形状，可以直接交给 `values`。" />
      <SqlExample example={validateThenWrite} title="校验、写入" />
      <CodeBlock code={framework} lang="ts" />
      <Note text="校验器只看这一列自己的声明。唯一性、外键存在这种要查库的约束，交给数据库报错。" />
    </Section>
  </DocPage>
));
