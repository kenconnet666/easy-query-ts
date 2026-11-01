/** 超时与取消 */
import { _component } from '@zerodep-dev/vue-tsx-pro-tsx';
import { CodeBlock } from '@zerodep-dev/vue-tsx-pro-ui';
import { DocPage, Note, P, Points, Section } from '../../site/content';

const timeout = `// 这个 Db 上每条语句最多 5 秒
const rows = await db.withTimeout(5000).queryable(Order).toList();

// 整个 Db 的默认
createDb({ schema, adapter, statementTimeout: 30_000 });`;

const signal = `const ac = new AbortController();
req.on('close', () => ac.abort()); // 客户端断开就取消

await db.withSignal(ac.signal).queryable(Order).toList();
await db.withSignal(ac.signal).transaction(async (tx) => { ... });

// 两个可以一起用
await db.withSignal(ac.signal).withTimeout(5000).queryable(Order).toList();`;

const errors = `try {
  await db.withTimeout(5000).queryable(Order).toList();
} catch (error) {
  // 超时是 TimeoutError；取消时是信号的 reason
  if (error instanceof Error && error.name === 'TimeoutError') return reply.status(504);
  throw error;
}`;

export default _component(() => () => (
  <DocPage>
    <Section id="timeout" title="超时">
      <P text="`withTimeout` 给每条语句各自计时，到点调用方立刻以 `TimeoutError` 失败。" />
      <CodeBlock code={timeout} lang="ts" />
    </Section>
    <Section id="signal" title="取消">
      <P text="`withSignal` 让语句跟着请求取消。已取消的信号让新语句直接失败；执行中取消则立刻以信号的 `reason` 失败。" />
      <CodeBlock code={signal} lang="ts" />
      <CodeBlock code={errors} lang="ts" />
    </Section>
    <Section id="server" title="服务端也停下">
      <Points
        items={[
          'PostgreSQL 的驱动从池里另一条连接发 `pg_cancel_backend`，MySQL 的驱动发 `KILL QUERY`，正在跑的语句在库里被终止，连接保留、还回池里照常可用。',
          '事务里取消时语句失败，事务随之回滚。',
          '别的库的驱动只做到“客户端不再等”，库里的语句照样跑完。',
          '`stream()` 只受信号控制，不受超时限制。',
        ]}
      />
      <Note text="带信号或超时的语句会先从池里借一条连接，这样才知道语句跑在哪个连接上；取消请求发完才归还。自己写驱动时，`Session.query`、`execute` 的第三个参数收到这条语句的信号。" />
    </Section>
  </DocPage>
));
