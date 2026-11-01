/** 读写分离、只读、超时、可观测 */
import { _component } from '@zerodep-dev/vue-tsx-pro-tsx';
import { CodeBlock } from '@zerodep-dev/vue-tsx-pro-ui';
import { DocPage, P, Points, Section } from '../../site/content';

const replicas = `const db = createDb({ schema, adapter: primary, replicas: [replica1, replica2] });

await db.queryable(Order).toList(); // 从库，轮询
await db.update(Order).set({ state: 'paid' }).where((o) => o.id.eq(id)).execute(); // 主库
await db.usePrimary().queryable(Order).find(id); // 刚写完就要读到：这段读走主库`;

const readonly = `const reader = createDb({ schema, adapter: replica }).readonly();

await reader.queryable(Order).toList(); // 照常
reader.insert(Order); // 类型错误：只读
reader.queryable(Order).forUpdate(); // 类型错误：加锁也算写`;

const timeout = `const ac = new AbortController();
req.on('close', () => ac.abort());

await db.withSignal(ac.signal).withTimeout(5000).queryable(Order).toList();`;

const observe = `import { queryWatch, statementSpans } from '@zerodep-dev/easy-query-ts/observe';

// 一个请求里同一条 SQL 反复执行（N+1）、单条语句太慢，都报出来
const watch = queryWatch({ repeat: 5, slowMs: 200 });
const db = createDb({
  schema,
  adapter,
  log: (statement) => logger.debug(statement.sql, statement.params),
  onExecute: [statementSpans(trace.getTracer('app')), watch.onExecute],
});
app.use((req, res, next) => watch.run(next));`;

export default _component(() => () => (
  <DocPage>
    <Section id="replicas" title="读写分离">
      <P text="读走从库（轮询），写和事务里的读走主库；`usePrimary()` 让一段读也走主库。" />
      <CodeBlock code={replicas} lang="ts" />
    </Section>
    <Section id="readonly" title="只读 Db">
      <P text="报表、只连从库的服务不该有写入。`db.readonly()` 在类型上去掉写入、DDL、迁移和加锁，运行时写入也报错。" />
      <CodeBlock code={readonly} lang="ts" />
    </Section>
    <Section id="timeout" title="超时与取消">
      <P text="`withTimeout` 给每条语句计时，`withSignal` 跟着请求取消；到点调用方立刻失败，PostgreSQL、MySQL 的驱动还会在服务端终止正在跑的语句。" />
      <CodeBlock code={timeout} lang="ts" />
    </Section>
    <Section id="observe" title="日志、追踪与慢查询">
      <CodeBlock code={observe} lang="ts" />
      <Points
        items={[
          '`statementSpans` 给每条语句记一个 OpenTelemetry span，按数据库语义约定，不依赖 OTel 包。',
          '`q.explain()` 取执行计划；`eqts snapshot` 把一组查询按方言渲染成文本，提交进仓库，评审时直接看 SQL 的差异。',
        ]}
      />
    </Section>
  </DocPage>
));
