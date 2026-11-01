/** 事务：回调式、手动、保存点、隔离级别、提交后的动作 */
import { _component } from '@zerodep-dev/vue-tsx-pro-tsx';
import { CodeBlock } from '@zerodep-dev/vue-tsx-pro-ui';
import { DocPage, Note, P, Points, Section } from '../../site/content';
import { SqlExample } from '../../site/SqlExample';
import {
  afterCommit,
  afterRollback,
  beginCommit,
  beginRollback,
  nested,
  placeOrder,
  readOnly,
  rollback,
  transaction,
} from './write.examples.ts';

const awaitUsing = `// 离开作用域时没提交就自动回滚：提前 return、抛错都不会漏掉
await using tx = await db.begin({ isolation: 'repeatable read' });
await tx.insert(User).values(row).execute();
if (bad) return; // 自动回滚
await tx.commit(); // 提交之后离开作用域是安全的`;

const options = `await db.transaction(work, { isolation: 'serializable' });
await db.transaction(work, { readOnly: true });`;

const cancel = `const ac = new AbortController();
req.on('close', () => ac.abort()); // 客户端断开就取消

await db.withSignal(ac.signal).transaction(async (tx) => {
  // 执行中取消：语句失败，事务回滚；PG、MySQL 还会在服务端终止正在跑的语句
});`;

export default _component(() => () => (
  <DocPage>
    <Section id="transaction" title="回调式事务">
      <P text="回调正常返回就提交，抛错就回滚，返回值就是 `transaction` 的返回值。回调里用 `tx`，不要用外面的 `db`：`db` 的语句不在这个事务里。" />
      <SqlExample example={transaction} title="建公司，把没有公司的用户挂上去" />
      <SqlExample example={rollback} title="抛错就回滚：公司数没变" />
      <P text="一个真实的下单：扣库存、写订单、写明细。扣库存的条件带上 `stock >= 1`，再 `expectRows(1)`，并发时不会超卖。" />
      <SqlExample example={placeOrder} title="下单" />
    </Section>
    <Section id="nested" title="嵌套事务">
      <P text="事务里再调 `transaction` 开的是保存点：成功就释放，失败只回滚到保存点，错误照常抛出，由你决定要不要接住。看 SQL 一栏的 SAVEPOINT。" />
      <SqlExample example={nested} title="内层失败，外层继续" />
      <Note text="嵌套事务不能改隔离级别和只读，要在最外层设。" />
    </Section>
    <Section id="manual" title="手动提交">
      <P text="事务要跨几个函数、或者提交的时机由外面决定时，用 `begin`。`commit`、`rollback` 只能各用一次。" />
      <SqlExample example={beginCommit} title="begin、commit" />
      <SqlExample example={beginRollback} title="begin、rollback" />
      <P text="支持 `await using` 的环境（Node 24、TS 5.2 起）这样写最稳，不会忘了回滚。" />
      <CodeBlock code={awaitUsing} lang="ts" />
    </Section>
    <Section id="options" title="隔离级别与只读">
      <CodeBlock code={options} lang="ts" />
      <P text="隔离级别按方言渲染。只读事务适合要一致快照的报表：MySQL、PG 是 READ ONLY，SQLite 没有只读事务，用 `PRAGMA query_only` 拒绝写入，结束后还原。" />
      <SqlExample example={readOnly} title="只读事务：两个数来自同一个快照" />
    </Section>
    <Section id="hooks" title="提交之后做的事">
      <P text="`afterCommit` 登记提交之后才执行的动作，发邮件、发消息、清缓存放这里；回滚了就不执行。`afterRollback` 反过来。" />
      <SqlExample example={afterCommit} title="提交之后才做的事" />
      <SqlExample example={afterRollback} title="回滚之后做的事" />
      <Points
        items={[
          '只能在事务里调用。保存点里登记的：保存点成功就并进外层；保存点回滚时丢掉它的 `afterCommit`，马上执行它的 `afterRollback`。',
          '`afterCommit` 的钩子出错时数据已经提交，错误抛给发起事务的调用方，别的钩子照常执行。',
        ]}
      />
    </Section>
    <Section id="cancel" title="取消">
      <CodeBlock code={cancel} lang="ts" />
      <Note text="没有事务的库（D1、ClickHouse、Doris、TDengine）`transaction` 里的语句依次执行，出错时不回滚，详见“方言差异”。" />
    </Section>
  </DocPage>
));
