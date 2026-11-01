/** 自己写拦截器 */
import { _component } from '@zerodep-dev/vue-tsx-pro-tsx';
import { CodeBlock } from '@zerodep-dev/vue-tsx-pro-ui';
import { DocPage, Note, P, Points, Section, SimpleTable } from '../../site/content';
import { SqlExample } from '../../site/SqlExample';
import { auditForDb, auditOff, auditOn } from './rules.examples.ts';

const audit = `declare module '@zerodep-dev/easy-query-ts' {
  interface InterceptorNames {
    audit: true; // 登记名字：noInterceptor('audit') 写错了编译不过
  }
}

const audit: Interceptor = {
  name: 'audit',
  enabled: false, // 默认关着，要的地方 useInterceptor('audit')
  afterWrite(event) {
    auditLog.push(\`\${event.kind} \${event.entity.table}：\${event.affected} 行\`);
  },
};

const db = createDb({ schema, adapter, interceptors: [audit] });`;

const before = `const audit: Interceptor = {
  name: 'audit',
  // 要改之前的行：只有这些实体多读一次
  before: (entity) => entity.table === 't_post',
  afterWrite(event) {
    switch (event.kind) {
      case 'insert':
        return log('insert', event.entity.table, event.rows);
      case 'update':
        return log('update', event.entity.table, event.before, event.set);
      case 'delete':
        return log(event.soft ? 'soft delete' : 'delete', event.entity.table, event.before);
    }
  },
};`;

const filter = `// 数据范围：只看自己部门的数据，默认关着，只在某些接口打开
const dataScope: Interceptor = {
  name: 'dataScope',
  enabled: false,
  filter: (ref, entity) =>
    'departmentId' in entity.columns &&
    refColumn(ref, 'departmentId').eq(request.get().departmentId),
};

await db.queryable(Order).useInterceptor('dataScope').toList();`;

const fill = `// 写入前补值
const stamp: Interceptor = {
  name: 'stamp',
  beforeInsert(row, entity) {
    if ('createdBy' in entity.columns) row.createdBy ??= request.get().userId;
  },
  beforeUpdate(set, entity) {
    if ('updatedBy' in entity.columns) set.updatedBy ??= request.get().userId;
  },
};`;

const outbox = `// 发件箱：和写入同生共死。event.execute 在同一个事务里执行，不经过拦截器
const outbox: Interceptor = {
  name: 'outbox',
  async afterWrite(event) {
    if (event.entity !== Order || event.kind !== 'insert') return;
    await event.execute(
      db.insert(Outbox).values({ topic: 'order.created', body: JSON.stringify(event.rows) }).toSQL(),
    );
  },
};`;

const toggles = `db.queryable(User).noInterceptor('softDelete');        // 这条语句关掉
db.queryable(User).useInterceptor('dataScope');        // 这条语句打开
db.queryable(User).interceptors({ use: ['dataScope'], skip: ['softDelete'] });
db.withInterceptors({ skip: 'all' });                  // 这个 Db 全关，受保护的除外
u.roles.noInterceptor('softDelete').any();             // 只在这个导航上关
db.queryable(User).leftJoin(Post, on, { skip: ['softDelete'] }); // 只在这张 join 的表上关`;

export default _component(() => () => (
  <DocPage>
    <Section id="what" title="能做什么">
      <SimpleTable
        head={['钩子', '时机', '用途']}
        rows={[
          ['`filter`', '读、改、删', '给每张表加条件：数据范围、排除测试数据'],
          ['`beforeInsert`', '插入前', '补值、改值'],
          ['`beforeUpdate`', '更新前', '补值、改值'],
          ['`deleteAs`', '删除前', '把删除改成更新，逻辑删除就是这么做的'],
          ['`afterWrite`', '写入成功后，同一个事务里', '审计、发件箱、失效缓存；抛错会回滚'],
        ]}
      />
      <P text="内置的 `softDelete`、`defaults`、`tenant`、`touch` 都是拦截器。" />
    </Section>
    <Section id="audit" title="审计：一个能运行的例子">
      <P text="本站的示例 Db 配了一个默认关着的 `audit`，把每次写入记进一个数组。" />
      <CodeBlock code={audit} lang="ts" />
      <SqlExample example={auditOff} title="默认关着：什么也没记" />
      <SqlExample example={auditOn} title="语句上打开：insert、update、delete 都记了" />
      <SqlExample example={auditForDb} title="整段打开" />
    </Section>
    <Section id="toggle" title="开关">
      <P text="`{ use, skip }` 在语句、Db、导航、join 上都能用，后面的覆盖前面的：`[{ skip: 'all' }, { use: ['tenant'] }]` 是“只留租户”。名字登记过才能用，写错编译不过。" />
      <CodeBlock code={toggles} lang="ts" />
      <Points
        items={[
          '`enabled: false`：默认关着，用的时候打开。只在某些接口生效的数据范围用它。',
          '`protected: true`：`skip: "all"` 关不掉，只能按名字关。',
        ]}
      />
    </Section>
    <Section id="filter" title="加条件">
      <CodeBlock code={filter} lang="ts" />
    </Section>
    <Section id="fill" title="补值">
      <CodeBlock code={fill} lang="ts" />
    </Section>
    <Section id="after-write" title="写入之后">
      <P text="`afterWrite` 和这条语句在同一个事务里，抛错会让写入失败、事务回滚，可以当否决用。事件带影响的行数和执行的语句。声明 `before` 后，update、delete 执行前按同样的条件先读一次整行，放进 `event.before`，审计要前后对比时用。" />
      <CodeBlock code={before} lang="ts" />
      <P text="`event.afterCommit(task)` 登记提交之后做的事：在事务里等提交，回滚就不做；不在事务里时在这条语句之后马上做。二级缓存的延迟双删就用它。" />
      <CodeBlock code={outbox} lang="ts" />
      <Note text="`fromQuery` 不经过 `beforeInsert`，它的 `event.rows` 是空的：数据不经过应用。" />
    </Section>
  </DocPage>
));
