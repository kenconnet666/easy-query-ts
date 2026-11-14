/** 锁：行锁、查询加锁、咨询锁与通知 */
import { _component } from '@zerodep-dev/vue-tsx-pro-tsx';
import { CodeBlock } from '@zerodep-dev/vue-tsx-pro-ui';
import { DocPage, Note, P, Section, SimpleTable } from '../../site/content';
import { SqlExample } from '../../site/SqlExample';
import { forUpdateThenWrite, lockMissing } from './more.examples.ts';
import { lock, lockRow } from './write.examples.ts';

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
await stop();

// PGlite（浏览器、测试）：从 pglite 入口导入，传 PGlite 实例，用法一样
import { listen as listenPglite } from '@zerodep-dev/easy-query-ts-pg/pglite';
const stopLocal = await listenPglite(database, 'todo_changed', (user) => refresh(user));`;

export default _component(() => () => (
  <DocPage>
    <Section id="choose" title="选哪种">
      <SimpleTable
        head={['场景', '写法']}
        rows={[
          ['状态流转：只有草稿能发布', '不用锁：`where` 带上当前状态，加 `expectRows(1)`'],
          ['读改写的并发：编辑表单', '乐观锁，见“乐观锁”'],
          ['读改写的并发，冲突很多', '`tx.lock`、`forUpdate`'],
          ['抢任务', '`forUpdateSkipLocked`'],
          ['定时任务只让一个实例做', '`advisoryLock`（PG、SQL Server）'],
        ]}
      />
    </Section>
    <Section id="row-lock" title="锁住一行">
      <P text="`tx.lock(实体, 主键)` 锁住这一行直到事务结束，返回它在不在。有行锁的库是 SELECT ... FOR UPDATE；SQLite 没有行锁，写成一条把主键写回自己的 UPDATE，让事务马上拿到写锁。锁不经过拦截器，不动版本列。" />
      <SqlExample example={lockRow} title="锁住商品再扣库存" />
      <SqlExample example={lockMissing} title="行不存在：返回 false" />
    </Section>
    <Section id="query-lock" title="查询时加锁">
      <P text="要锁一批行，或者要带条件时，加在查询上。切换方言看 SQL Server 的表提示。" />
      <SqlExample example={lock} title="锁一行，再改" />
      <SqlExample example={forUpdateThenWrite} title="锁一批，再改" />
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
    <Section id="advisory" title="咨询锁（PostgreSQL、SQL Server）">
      <P text="定时任务只让一个实例做、按业务键串行化，用咨询锁：按名字加锁，事务结束自动释放，`wait: false` 拿不到时立刻返回 false。只能在事务里用。PostgreSQL 把名字哈希成 64 位整数（`pg_advisory_xact_lock`），SQL Server 用 `sp_getapplock`。MySQL 的 `GET_LOCK` 是连接级的，提交时不会释放，所以没有当成 `advisoryLock`；`db.migrate` 自己在一条专门的连接上用它排队。" />
      <CodeBlock code={advisory} lang="ts" />
    </Section>
    <Section id="notify" title="通知（PostgreSQL）">
      <P text="`notify` 是 `pg_notify`，收听用 PG 包的 `listen`：借一条专用连接，返回的函数归还连接；连接断了不自动重连。PGlite 从 `pglite` 入口导入同名的 `listen`，传 PGlite 实例（它只有一条连接，自己收听）。二级缓存的跨进程失效、事件推送、浏览器里的实时刷新可以接它。" />
      <CodeBlock code={notify} lang="ts" />
    </Section>
  </DocPage>
));
