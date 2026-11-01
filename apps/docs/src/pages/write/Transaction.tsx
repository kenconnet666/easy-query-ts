/** 事务与锁：回调式、手动、保存点、提交后的动作、行锁、咨询锁 */
import { _component } from '@zerodep-dev/vue-tsx-pro-tsx';
import { CodeBlock } from '@zerodep-dev/vue-tsx-pro-ui';
import { DocPage, Note, P, Points, Section, SimpleTable } from '../../site/content';
import { SqlExample } from '../../site/SqlExample';
import {
  afterCommit,
  afterRollback,
  beginCommit,
  beginRollback,
  lock,
  lockRow,
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

const locks = `await db.transaction(async (tx) => {
  await tx.queryable(Job).where((j) => j.id.eq(1)).forUpdate().first();     // 排他锁
  await tx.queryable(Job).where((j) => j.id.eq(1)).forUpdateNoWait().first(); // 拿不到立刻报错
  // 抢任务：跳过别人锁住的行，多个 worker 互不等待
  await tx.queryable(Job).where((j) => j.state.eq('open')).limit(10).forUpdateSkipLocked().toList();
  await tx.queryable(Job).where((j) => j.id.eq(1)).forShare().first();      // 共享锁：别人能读不能改
  await tx.queryable(Job).where((j) => j.id.eq(1)).forNoKeyUpdate().first(); // PG：不挡住引用这行的外键插入
});`;

const advisory = `await db.transaction(async (tx) => {
  // 没有对应的行也能锁，跨进程、跨机器生效，事务结束自动释放
  if (!(await tx.advisoryLock(\`report:\${month}\`, { wait: false }))) return; // 别人在做，跳过
  await buildReport(tx);
});`;

const notify = `import { listen } from '@zerodep-dev/easy-query-ts-pg';

const stop = await listen(pool, 'cache_evict', (key) => cache.delete(key));
await db.notify('cache_evict', 'user:7'); // 在事务里时随提交发出，回滚不发
await stop();`;

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
    <Section id="row-lock" title="行锁">
      <P text="`tx.lock(实体, 主键)` 锁住这一行直到事务结束，返回它在不在。有行锁的库是 SELECT ... FOR UPDATE；SQLite 没有行锁，写成一条把主键写回自己的 UPDATE，让事务马上拿到写锁。锁不经过拦截器，不动版本列。" />
      <SqlExample example={lockRow} title="锁住商品再扣库存" />
      <P text="查询上也能加锁。" />
      <SqlExample example={lock} title="查询时加锁，再改" />
      <CodeBlock code={locks} lang="ts" />
      <SimpleTable
        head={['方法', '渲染', '没有的库']}
        rows={[
          [
            '`forUpdate()`',
            'FOR UPDATE，SQL Server 是 WITH (UPDLOCK, ROWLOCK)',
            'ClickHouse、Doris、TDengine',
          ],
          ['`forUpdateNoWait()`', 'NOWAIT', '同上，加 DuckDB、Db2'],
          ['`forUpdateSkipLocked()`', 'SKIP LOCKED，HANA 是 IGNORE LOCKED', '同上，加 DuckDB'],
          ['`forShare()`', 'FOR SHARE，MariaDB 是 LOCK IN SHARE MODE', 'PG、MySQL 8、MariaDB 以外'],
          ['`forNoKeyUpdate()`', 'FOR NO KEY UPDATE', 'PG 以外'],
        ]}
      />
      <Note text="这些方法在类型上标了方言能力：连的库不支持时编辑器里直接标红，见“方言差异”。SQLite 只有库级的写锁，这里是空操作。MySQL 按没有索引的列加锁会锁住扫描过的所有行，抢任务要按主键或索引列取。" />
    </Section>
    <Section id="advisory" title="咨询锁与通知（PostgreSQL）">
      <P text="定时任务只让一个实例做、按业务键串行化，用咨询锁。名字哈希成 64 位整数，`wait: false` 拿不到时立刻返回 false。只能在事务里用。" />
      <CodeBlock code={advisory} lang="ts" />
      <P text="`notify` 是 `pg_notify`，收听用 PG 包的 `listen`：借一条专用连接，返回的函数归还连接；连接断了不自动重连。二级缓存的跨进程失效、事件推送可以接它。" />
      <CodeBlock code={notify} lang="ts" />
    </Section>
    <Section id="cancel" title="取消">
      <CodeBlock code={cancel} lang="ts" />
      <P text="`withSignal` 和 `withTimeout` 见“读写分离与可观测”。没有事务的库（D1、ClickHouse、Doris、TDengine）`transaction` 里的语句依次执行，出错时不回滚。" />
    </Section>
  </DocPage>
));
