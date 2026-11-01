/** 多态实体：一张表存几种子类型 */
import { _component } from '@zerodep-dev/vue-tsx-pro-tsx';
import { CodeBlock } from '@zerodep-dev/vue-tsx-pro-ui';
import { DocPage, Note, P, Points, Section } from '../../site/content';
import { SqlExample } from '../../site/SqlExample';
import {
  unionAll,
  unionGroup,
  unionInsert,
  unionNavigation,
  unionSelect,
  unionValidate,
  unionVariant,
} from './model.examples.ts';

const declare = `const Payment = entity.union('t_payment', 'kind', {
  // 共有的列
  base: {
    id: col.bigint().primaryKey().generated(),
    orderId: col.bigint(),
    amount: col.decimal(10, 2),
  },
  // 各种子类型自己的列；kind 存子类型的名字
  variants: {
    card: { cardNo: col.string(19), holder: col.string(50).nullable() },
    wechat: { openId: col.string(40) },
  },
});`;

const narrow = `const rows = await db.queryable(Payment).toList();

for (const payment of rows) {
  if (payment.kind === 'card') payment.cardNo; // 按判别列收窄：string
  if (payment.kind === 'wechat') payment.openId; // string
}

db.insert(Payment).values({ kind: 'wechat', orderId: 1, amount: '1.00', cardNo: 'x' });
// 类型错误：wechat 没有 cardNo，也缺 openId`;

export default _component(() => () => (
  <DocPage>
    <Section id="declare" title="声明">
      <P text="支付方式、消息、事件这类数据，几种子类型共用一张表，用一个判别列区分。`entity.union` 把它写进类型：读出来是按判别列区分的联合，写错子类型的列编译不过。Java 版没有对应能力，通常是继承加几张表，或者自己判断。" />
      <CodeBlock code={declare} lang="ts" />
      <P text="库里是一张表，各子类型的列都可空（别的子类型的行里是 NULL）；声明时的可空性只用于读出的类型、插入和校验器。" />
    </Section>
    <Section id="read" title="读">
      <P text="不做筛选时拿到所有子类型。别的子类型的列在结果里是 null，类型上按判别列收窄之后就碰不到它们。" />
      <SqlExample example={unionAll} title="全部" />
      <CodeBlock code={narrow} lang="ts" title="结果类型按 kind 收窄" />
      <P text="`variant` 加上判别列的条件，结果类型也收窄到这一种，子类型的列可以直接用。名字写错是类型错误，要写在 `select` 之前。" />
      <SqlExample example={unionVariant} title="只要银行卡" />
      <SqlExample example={unionSelect} title="子类型的列、条件和导航一起用" />
      <P text="判别列本身也是普通的列，能分组。" />
      <SqlExample example={unionGroup} title="按支付方式汇总" />
      <P text="多态实体照样可以是导航的目标。" />
      <SqlExample example={unionNavigation} title="用银行卡付过款的订单和实付金额" />
    </Section>
    <Section id="write" title="写">
      <P text="插入先选子类型，再给它自己的列。" />
      <SqlExample example={unionInsert} title="插入一条微信支付" />
      <P text="`validators` 同样按判别列选子类型检查：它自己的必填列要给，别的子类型的列不能有值。" />
      <SqlExample example={unionValidate} title="校验：银行卡缺卡号" />
      <Points
        items={[
          '子类型之间列名不能重复，子类型里不能用 `embed()`。',
          '判别列的名字是第二个参数，建表时自动加上。',
        ]}
      />
      <Note text="子类型差别很大、列很多时，分成几张表再用导航连起来更好维护。" />
    </Section>
  </DocPage>
));
