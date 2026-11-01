/** 多租户 */
import { _component } from '@zerodep-dev/vue-tsx-pro-tsx';
import { CodeBlock } from '@zerodep-dev/vue-tsx-pro-ui';
import { DocPage, Note, P, Points, Section } from '../../site/content';
import { SqlExample } from '../../site/SqlExample';
import {
  tenantCount,
  tenantDelete,
  tenantInsert,
  tenantRead,
  tenantSkip,
  tenantSkipAll,
  tenantSkipByName,
  tenantUpdate,
} from './rules.examples.ts';

const setup = `import { requestContext } from '@zerodep-dev/easy-query-ts/context';

const request = requestContext<{ tenantId: number }>();

const db = createDb({
  schema,
  adapter,
  // 所有有 tenantId 列的实体：读、改、删自动带条件，插入自动填
  interceptors: [tenant('tenantId', () => request.get().tenantId)],
});

// 请求进来时把租户放进上下文
app.use((req, res, next) => request.run({ tenantId: req.tenantId }, next));`;

const column = `const Ticket = entity('t_ticket', {
  id: col.bigint().primaryKey().generated(),
  tenantId: col.int().defaulted(), // 插入时由拦截器填：类型上可省
  title: col.string(100),
});`;

const bySchema = `// 每个租户一个 schema：表结构一样，换 schema 就行
const tenantDb = db.inSchema(\`tenant_\${tenantId}\`);
await tenantDb.queryable(Ticket).toList();

// 每个租户一个库：按租户缓存 Db
const dbs = new Map<number, ReturnType<typeof open>>();`;

export default _component(() => () => (
  <DocPage>
    <Section id="setup" title="接入">
      <P text="`tenant` 是内置的拦截器。当前租户放在请求上下文里，不用一层层传参；值每条语句求值一次。" />
      <CodeBlock code={setup} lang="ts" />
      <CodeBlock code={column} lang="ts" />
      <P text="本站的示例 Db 配了 `tenant('tenantId', () => 1)`：工单表里有两个租户的数据，查询只看 1 号租户。" />
    </Section>
    <Section id="read" title="读">
      <SqlExample example={tenantRead} title="只有 1 号租户的工单" />
      <SqlExample example={tenantCount} title="count 也带" />
      <P text="条件加到主表、多对一导航的 ON、一对多的子查询、`toList` 的第二条查询和多对多的中间表上。left join 不会因此丢掉主表的行。" />
    </Section>
    <Section id="write" title="写">
      <SqlExample example={tenantInsert} title="插入：自动填上租户" />
      <P text="改、删都带条件。下面这两条要动的是 2 号租户的工单，所以改到 0 行。" />
      <SqlExample example={tenantUpdate} title="改不到别的租户" />
      <SqlExample example={tenantDelete} title="删不到别的租户" />
    </Section>
    <Section id="skip" title="管理端：关掉">
      <P text="跨租户的统计、后台接口，按名字关掉。" />
      <SqlExample example={tenantSkip} title="单条语句：noInterceptor('tenant')" />
      <SqlExample example={tenantSkipByName} title="整个 Db：skip ['tenant']" />
      <P text="租户是受保护的拦截器：`skip: 'all'` 不会关掉它，只能按名字关，免得一句“全关”把数据串了。" />
      <SqlExample example={tenantSkipAll} title="skip: 'all'：还是 3" />
      <Points
        items={[
          '`fromQuery` 不经过插入拦截器，租户要自己在 `select` 里给。',
          '`db.sql` 是原生语句，不加条件。',
          '`request.get()` 不在 `run` 里时报错：忘了包中间件、后台任务没设上下文都能发现；后台任务显式 `request.run({ tenantId }, job)`。',
        ]}
      />
    </Section>
    <Section id="schema" title="别的隔离方式">
      <P text="共用一张表是最省的。隔离要求高时按 schema 或按库分，查询代码不变。" />
      <CodeBlock code={bySchema} lang="ts" />
      <Note text="`inSchema` 见“动态表名”。组合索引要把租户列放在最前面，见“实体与列”。" />
    </Section>
  </DocPage>
));
