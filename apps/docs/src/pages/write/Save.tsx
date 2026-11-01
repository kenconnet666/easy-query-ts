/** 聚合保存与事务 */
import { _component } from '@zerodep-dev/vue-tsx-pro-tsx';
import { DocPage, P, Points, Section } from '../../site/content';
import { SqlExample } from '../../site/SqlExample';
import { lock, save, transaction } from './write.examples.ts';

export default _component(() => () => (
  <DocPage>
    <Section id="save" title="保存一棵对象树">
      <P text="`db.save` 把表单提交上来的整棵树写进库：新的插入，变了的更新，不在列表里的按 `removed` 处理。不需要追踪上下文，在事务里先按父键查出现有的子项再比较。" />
      <P text="下面这段改了年龄和一篇帖子的标题。看 SQL 一栏：林晓的另一篇帖子被删了，因为它不在列表里，而这里写的是 `removed: 'delete'`。" />
      <SqlExample example={save} title="保存用户和他的帖子" />
      <Points
        items={[
          '保存哪些导航由 `include` 决定，带类型，写错名字编译不过。',
          '多对多只维护中间表；多对一先存父行，再设外键。',
          '`removed` 可以是 `delete`（删掉）、`unlink`（外键置空）或 `keep`（不动）；没写时外键可空就置空，不可空且确实有要移除的行就报错。',
        ]}
      />
    </Section>
    <Section id="transaction" title="事务">
      <P text="回调正常返回就提交，抛错就回滚。嵌套事务用保存点。`tx.afterCommit` 注册提交之后才执行的动作，发邮件、发消息放这里。" />
      <SqlExample example={transaction} title="建公司，把没有公司的用户挂上去" />
    </Section>
    <Section id="lock" title="行锁">
      <P text="`forUpdate()`、`forUpdateNoWait()`、`forUpdateSkipLocked()` 按方言渲染，没有这种写法的库在渲染时报错。SQLite 没有行锁，切过去看它怎么处理。" />
      <SqlExample example={lock} title="锁住一行再改" />
    </Section>
  </DocPage>
));
