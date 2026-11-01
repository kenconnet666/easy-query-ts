/** 聚合保存与事务 */
import { _component } from '@zerodep-dev/vue-tsx-pro-tsx';
import { DocPage, P, Points, Section } from '../../site/content';
import { SqlExample } from '../../site/SqlExample';
import {
  afterCommit,
  lock,
  placeOrder,
  rollback,
  save,
  saveDeep,
  saveManyToMany,
  saveNew,
  transaction,
} from './write.examples.ts';

export default _component(() => () => (
  <DocPage>
    <Section id="save" title="保存一棵对象树">
      <P text="`db.save` 把表单提交上来的整棵树写进库：新的插入，变了的更新，不在列表里的按 `removed` 处理。不需要追踪上下文，在事务里先按父键查出现有的子项再比较。" />
      <SqlExample example={saveNew} title="新建：用户和一对一的资料一起写" />
      <P text="下面这段改了年龄和帖子的标题。看 SQL 一栏：先查现有的帖子，比较之后只更新变了的列。" />
      <SqlExample example={save} title="更新：用户和他的帖子" />
      <P text="多对多只维护中间表：只给 id 的连上已有的标签，带别的字段的先建标签。中间表按现状比较，只插入新的、删除去掉的。" />
      <SqlExample example={saveManyToMany} title="帖子的标签：连两个已有的，新建一个" />
      <P text="`removed: 'delete'` 时不在列表里的子项会被删掉。看 SQL 一栏：贴纸礼包这条明细没了。" />
      <SqlExample example={saveDeep} title="订单明细：改数量、加一条、删一条" />
      <Points
        items={[
          '保存哪些导航由 `include` 决定，带类型，写错名字编译不过；没出现的导航不动。',
          '多对一先存目标，再设外键。整个过程在一个事务里，任何一步失败都不会留下半棵树。',
          '`removed` 可以是 `delete`（删掉）、`unlink`（外键置空）或 `keep`（不动）；没写时外键可空就置空，不可空且确实有要移除的行就报错。',
        ]}
      />
    </Section>
    <Section id="transaction" title="事务">
      <P text="回调正常返回就提交，抛错就回滚。嵌套事务用保存点。" />
      <SqlExample example={transaction} title="建公司，把没有公司的用户挂上去" />
      <SqlExample example={rollback} title="抛错就回滚：公司数没变" />
      <P text="一个真实的下单：扣库存、写订单、写明细。扣库存的条件带上 `stock >= 1`，再 `expectRows(1)`，并发时不会超卖。" />
      <SqlExample example={placeOrder} title="下单" />
      <P text="`tx.afterCommit` 注册提交之后才执行的动作，发邮件、发消息放这里；回滚了就不执行。" />
      <SqlExample example={afterCommit} title="提交之后才做的事" />
    </Section>
    <Section id="lock" title="行锁">
      <P text="`forUpdate()`、`forUpdateNoWait()`、`forUpdateSkipLocked()` 按方言渲染，没有这种写法的库在渲染时报错。SQLite 只有库级的写锁，这里不加 FOR UPDATE。" />
      <SqlExample example={lock} title="锁住一行再改" />
    </Section>
  </DocPage>
));
