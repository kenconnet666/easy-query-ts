/** 值对象 */
import { _component } from '@zerodep-dev/vue-tsx-pro-tsx';
import { CodeBlock } from '@zerodep-dev/vue-tsx-pro-ui';
import { DocPage, Note, P, Points, Section } from '../../site/content';
import { SqlExample } from '../../site/SqlExample';
import {
  embedDdl,
  embedSave,
  embedTable,
  embedUpdateExpr,
  embedUpdatePart,
  embedWholeObject,
} from '../query/extras.examples.ts';
import { embedGroup, embedInsert, embedRead, embedSelect } from './model.examples.ts';

const embedDeclare = `const Shop = entity('t_shop', {
  id: col.bigint().primaryKey().generated(),
  name: col.string(50),
  address: embed({
    city: col.string(20),                    // 列 address_city
    street: col.string(100).nullable(),      // 列 address_street
    geo: embed({ lat: col.double(), lng: col.double() }, { prefix: 'geo_' }), // 列 geo_lat、geo_lng
  }),
});`;

const reuse = `// 同一个形状用在好几处：写成函数，每处给自己的前缀
const money = (prefix: string) =>
  embed(
    { amount: col.decimal(12, 2), currency: col.string(3) },
    { prefix },
  );

const Invoice = entity('t_invoice', {
  id: col.bigint().primaryKey().generated(),
  subtotal: money('subtotal_'),
  tax: money('tax_'),
});`;

export default _component(() => () => (
  <DocPage>
    <Section id="declare" title="声明">
      <P text="地址、金额加币种这类总是一起出现的几列，用 `embed` 收成一个属性：库里还是平铺的列，代码里是嵌套对象。对应 Java 版的 `@ValueObject`。" />
      <CodeBlock code={embedDeclare} lang="ts" />
      <SqlExample example={embedDdl} title="库里是平铺的列" />
      <P text="列名默认是“属性名_子属性名”，`prefix` 换掉前缀，子列 `named()` 时用它给的全名。值对象可以再嵌。" />
    </Section>
    <Section id="read" title="读">
      <P text="读出来是嵌套对象。" />
      <SqlExample example={embedRead} title="整行" />
      <SqlExample example={embedWholeObject} title="只选值对象" />
      <P text="子属性直接点，条件、排序、分组、`select` 都行。" />
      <SqlExample example={embedSelect} title="条件、排序、选列" />
      <SqlExample example={embedGroup} title="按城市分组" />
      <P text="列表请求里写 `select` 的键。不选出来时写路径：`sort=-address.city`、`filter.address.city=杭州`。" />
      <SqlExample example={embedTable} title="列表页" />
    </Section>
    <Section id="write" title="写">
      <SqlExample example={embedInsert} title="整个对象写入，展开成几列" />
      <P text="更新时只写给出的那几项，没给的保持原值。" />
      <SqlExample example={embedUpdatePart} title="只改街道" />
      <SqlExample example={embedUpdateExpr} title="表达式里也能点" />
      <SqlExample example={embedSave} title="聚合保存" />
      <Points
        items={[
          '全都可空的值对象插入时可省，更新时可以整个给 `null`（每一列写 NULL）。',
          '`changes` 比较时逐项比较。',
        ]}
      />
    </Section>
    <Section id="reuse" title="复用形状">
      <CodeBlock code={reuse} lang="ts" />
      <Note text="主键不能放进值对象；整行带值对象的查询不能 `asTable()`，先 `select` 成平的列。多态实体的子类型里不能用 `embed`。" />
    </Section>
  </DocPage>
));
