/** 日志与可观测 */
import { _component } from '@zerodep-dev/vue-tsx-pro-tsx';
import { CodeBlock } from '@zerodep-dev/vue-tsx-pro-ui';
import { DocPage, P, Points, Section, SimpleTable } from '../../site/content';

const log = `const db = createDb({
  schema,
  adapter,
  log: (statement) => logger.debug(statement.sql, statement.params), // 执行前，最简单的日志
  onExecute: (event) => {
    // 执行后，成功失败都会调用
    metrics.timing('db', event.durationMs, { kind: event.kind, ok: event.error === undefined });
    if (event.durationMs > 500) logger.warn('slow sql', event.statement.sql);
  },
});`;

const spans = `import { trace } from '@opentelemetry/api';
import { statementSpans } from '@zerodep-dev/easy-query-ts';

createDb({ schema, adapter, onExecute: statementSpans(trace.getTracer('app')) });`;

const watch = `import { queryWatch } from '@zerodep-dev/easy-query-ts/observe';

const watch = queryWatch({
  repeat: 5,     // N+1：同一条读 SQL 执行到 5 次
  slowMs: 200,   // 单条语句到 200 毫秒
  explain: (statement) => db.explain(statement), // 慢的读语句顺带取执行计划
  report: (warning) => logger.warn(warning),     // 默认 console.warn
});

const db = createDb({ schema, adapter, onExecute: dev ? [watch.onExecute] : [] });
app.use((req, res, next) => watch.run(next)); // 每个请求一个统计范围`;

const combine = `// 几个钩子写成数组，按顺序调用
onExecute: [statementSpans(tracer), ...(dev ? [watch.onExecute] : [])],`;

const explain = `const plan = await db.queryable(Order).where((o) => o.userId.eq(7)).explain();
await db.queryable(Order).explain({ analyze: true }); // 真的执行一遍，带实际行数与耗时`;

export default _component(() => () => (
  <DocPage>
    <Section id="log" title="日志和指标">
      <P text="`log` 在执行前调用，`onExecute` 在执行后调用。构建器、`db.sql`、事务里的语句都经过同一个钩子。钩子里抛错会让这条语句失败，不吞错。" />
      <CodeBlock code={log} lang="ts" />
      <SimpleTable
        head={['事件字段', '含义']}
        rows={[
          ['`statement`', 'SQL 和参数'],
          ['`dialect`', '方言名'],
          ['`kind`', '`query` 读、`execute` 写'],
          ['`durationMs`', '耗时'],
          ['`rows`', '读返回的行数、写影响的行数，失败为 0'],
          ['`error`', '失败时的错误，错误仍会照常抛给调用方'],
        ]}
      />
    </Section>
    <Section id="tracing" title="链路追踪">
      <P text="`statementSpans` 给每条语句记一个 OpenTelemetry span，属性按数据库的语义约定。核心不依赖 `@opentelemetry/api`，按结构类型对接。" />
      <CodeBlock code={spans} lang="ts" />
      <SimpleTable
        head={['属性', '值']}
        rows={[
          [
            '`db.system.name`',
            '`postgresql`、`mysql`、`microsoft.sql_server`、`oracle.db`、`sqlite` …',
          ],
          ['`db.query.text`', '渲染后的 SQL，带占位符，不含参数值'],
          ['`db.operation.name`', 'SQL 的第一个关键字，也是 span 的名字'],
          ['`db.response.returned_rows`', '读返回的行数'],
        ]}
      />
    </Section>
    <Section id="watch" title="抓 N+1 和慢查询">
      <P text="开发环境用 `queryWatch`。同一个请求里同一条读 SQL（文本相同、参数不同）执行到 `repeat` 次，多半是循环里逐个查，改成 `toList` 导航或一次 `in`。" />
      <CodeBlock code={watch} lang="ts" />
      <CodeBlock code={combine} lang="ts" />
      <Points
        items={[
          '每条 SQL 每个范围只报一次；不在 `run` 里时不计数。',
          '慢查询不论在不在范围里都报。',
          '取计划不阻塞原来的语句，取回来之后才报。',
        ]}
      />
    </Section>
    <Section id="explain" title="执行计划">
      <CodeBlock code={explain} lang="ts" />
      <P text="PG 返回 JSON 计划，MySQL 返回计划对象，SQLite 是 EXPLAIN QUERY PLAN 的各行，别的库报不支持。只解释主语句，`toList` 的第二条查询不在里面。`analyze` 会真的执行，别用在写语句上。" />
    </Section>
  </DocPage>
));
