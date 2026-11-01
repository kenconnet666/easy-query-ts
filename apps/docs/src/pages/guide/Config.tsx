/** 创建 Db 与配置 */
import { _component } from '@zerodep-dev/vue-tsx-pro-tsx';
import { CodeBlock } from '@zerodep-dev/vue-tsx-pro-ui';
import { DocPage, Note, P, Points, Section, SimpleTable } from '../../site/content';

const create = `// db.ts：一个应用通常一个 Db，到处 import
import { createPool } from 'mysql2/promise';
import { createDb } from '@zerodep-dev/easy-query-ts';
import { mysql } from '@zerodep-dev/easy-query-ts-mysql';
import { schema } from './schema';

export const db = createDb({
  schema,
  adapter: await mysql.detect(createPool({ uri: process.env.DATABASE_URL, timezone: 'Z' })),
});`;

const full = `const db = createDb({
  schema,
  adapter,
  replicas: [replica1, replica2],
  log: (statement) => logger.debug(statement.sql, statement.params),
  onExecute: [statementSpans(tracer), watch.onExecute],
  interceptors: [tenant('tenantId', () => request.get().tenantId), audit],
  hardDelete: 'forbid',
  maxRows: 10_000,
  reversePageAfter: 5000,
  statementTimeout: 30_000,
});`;

const derived = `db.withTimeout(5000);                  // 这个 Db 上每条语句最多 5 秒
db.withSignal(controller.signal);      // 跟着请求取消
db.usePrimary();                       // 读也走主库
db.readonly();                         // 类型上去掉写入和加锁
db.withInterceptors({ skip: ['tenant'] }); // 关掉拦截器，管理端用
db.mapTables({ Post: 't_post_2025' }); // 换表
db.inSchema('archive_2025');           // 换 schema
db.with('hot', query);                 // 多一个 CTE
db.mount(content);                     // 多一组实体

// 派生出来的都是新的 Db，共用连接，原来的不变，可以连着写
await db.withTimeout(5000).usePrimary().queryable(Order).toList();`;

const context = `import { requestContext } from '@zerodep-dev/easy-query-ts/context';

const request = requestContext<{ tenantId: number; userId: string }>();

const db = createDb({
  schema,
  adapter,
  interceptors: [tenant('tenantId', () => request.get().tenantId)],
});

app.use((req, res, next) => request.run({ tenantId: req.tenant, userId: req.user }, next));

request.get();  // 不在 run 里时报错：忘了包中间件、后台任务没设上下文
request.find(); // 不在 run 里时返回 undefined`;

const shutdown = `// Db 不持有连接池，池是你建的，关闭也是你的事
const pool = createPool({ uri });
const db = createDb({ schema, adapter: mysql(pool) });

process.on('SIGTERM', async () => {
  await pool.end();
  process.exit(0);
});`;

export default _component(() => () => (
  <DocPage>
    <Section id="create" title="创建 Db">
      <P text="`createDb` 只要两样：schema 和 adapter。adapter 由方言包的工厂函数从驱动的连接池建出来，各库的写法见“方言差异”。" />
      <CodeBlock code={create} lang="ts" title="db.ts" />
      <CodeBlock code={shutdown} lang="ts" />
    </Section>
    <Section id="options" title="选项">
      <CodeBlock code={full} lang="ts" />
      <SimpleTable
        head={['选项', '作用', '默认']}
        rows={[
          ['`schema`', '`defineSchema`、`mergeSchemas` 的结果', '必填'],
          ['`adapter`', '方言包给的适配器', '必填'],
          ['`replicas`', '从库的 adapter：事务外的读按轮询走从库', '无'],
          ['`log`', '每条语句执行前调用', '无'],
          ['`onExecute`', '每条语句执行后调用，带耗时和行数；可以是数组', '无'],
          ['`interceptors`', '谓词与写入拦截器', '无'],
          ['`hardDelete`', '`forbid` 时没有逻辑删除列的实体 delete 要写 `.hard()`', '`allow`'],
          ['`maxRows`', '没写 limit 的 `toList` 最多读多少行，多了报错', '不限'],
          ['`reversePageAfter`', '深分页倒序取的偏移阈值', '不倒序'],
          ['`statementTimeout`', '每条语句默认的超时（毫秒）', '不限'],
        ]}
      />
      <P text="`onExecute` 收到 `statement`、`dialect`、`kind`（`query` 或 `execute`）、`durationMs`、`rows`、`error`。钩子里抛错会让这条语句失败，不吞错。" />
    </Section>
    <Section id="derived" title="派生的 Db">
      <P text="需要改配置时不用再建一个：下面这些方法返回新的 Db，共用连接，原来的不变。事务里的 `tx` 上也能用。" />
      <CodeBlock code={derived} lang="ts" />
    </Section>
    <Section id="context" title="请求上下文">
      <P text="拦截器要拿当前请求的租户、用户。`requestContext` 给 AsyncLocalStorage 包一层，值的类型在声明处写一次，不用一层层传参。Node、Bun、Deno、开了 `nodejs_compat` 的 Workers 都能用。" />
      <CodeBlock code={context} lang="ts" />
    </Section>
    <Section id="entries" title="包的入口">
      <SimpleTable
        head={['入口', '内容']}
        rows={[
          ['`@zerodep-dev/easy-query-ts`', '核心，零依赖，不依赖 Node 专有接口，浏览器里能跑'],
          ['`.../context`', '`requestContext`，用到 `node:async_hooks`'],
          ['`.../observe`', '`queryWatch`，用到 `node:async_hooks`'],
          ['`@zerodep-dev/easy-query-ts-pg` 等', '方言包，驱动是 peer 依赖'],
          ['`-pg/pglite`', 'PGlite 的适配器，不用装 `pg`'],
          ['`-cache`', '二级缓存，只给接口，不带 Redis 驱动'],
          ['`-decimal`、`-date`', 'decimal.js、`@internationalized/date` 的列类型'],
          ['`-crypto`', '列加密：AES、SM4，可分段搜索'],
          ['`-cli`', '`eqts` 命令：由库生成实体、迁移、SQL 快照'],
        ]}
      />
      <Points
        items={[
          '源码只用可擦除的 TS 语法，Node 不经编译能直接运行。',
          '没有注解和装饰器，也不需要构建插件或代码生成。',
        ]}
      />
      <Note text="包名都以 `@zerodep-dev/easy-query-ts` 开头。" />
    </Section>
  </DocPage>
));
