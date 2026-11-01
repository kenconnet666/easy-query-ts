/** 动态表名与模块组合：mapTables、inSchema、withTableLink、mergeSchemas、mount */
import { _component } from '@zerodep-dev/vue-tsx-pro-tsx';
import { CodeBlock } from '@zerodep-dev/vue-tsx-pro-ui';
import { DocPage, Note, P, Points, Section } from '../../site/content';
import { SqlExample } from '../../site/SqlExample';
import { mapTable, mapTableRun, tableLink, useSchema, useSchemaOnly } from './scale.examples.ts';

const merge = `// accounts/schema.ts：账号模块，不知道内容模块
export const accounts = defineSchema({ Company, User }, {
  User: (r) => ({ company: r.one('Company', { from: 'companyId', to: 'id' }) }),
});

// content/schema.ts：内容模块
export const content = defineSchema({ Post, Comment }, {
  Post: (r) => ({ comments: r.many('Comment', { from: 'id', to: 'postId' }) }),
});

// app/db.ts：合成一份。跨模块的关系写在第二个参数里，r 能看到所有模块的实体
export const schema = mergeSchemas([accounts, content], {
  Post: (r) => ({ author: r.one('User', { from: 'userId', to: 'id' }) }),
  User: (r) => ({
    posts: r.many('Post', { from: 'id', to: 'userId' }),
    comments: r.path('Comment', ['posts', 'comments']), // 直达关系可以经过别的模块的导航
  }),
});
export const db = createDb({ schema, adapter });`;

const mount = `// 运行时再挂一组（插件、按需加载）：共用连接、拦截器、取消信号与事务
const all = db.mount(content, {
  Post: (r) => ({ author: r.one('User', { from: 'userId', to: 'id' }) }),
});

await db.transaction(async (tx) => {
  await tx.mount(content).insert(Post).values(row).execute(); // 与 tx 在同一个事务里
});`;

const mergeErrors = `mergeSchemas([accounts, accounts2]);
// 类型错误：'error: these entity keys appear in more than one schema': "Company"

mergeSchemas([accounts], { User: (r) => ({ name: r.one('Company', ...) }) });
// 类型错误：'error: these navigations already exist': "User.name"`;

export default _component(() => () => (
  <DocPage>
    <Section id="map-tables" title="换表：mapTables">
      <P text="热表和归档表、按月的表，结构相同只是名字不同。`mapTables` 返回一个新的 Db，查询和写入都换到别的表，导航、join、子查询、`include` 全跟着换，不用改查询代码。原来的 `db` 不变。" />
      <SqlExample example={mapTable} title="只渲染：帖子换成归档表，用户表不动" />
      <P text="键是实体在 schema 里的名字，写错编译不过。映射的表要有同样的列；写入和 `createTables`、`dropTables` 这些 DDL 也都走映射后的名字，不会动到原表。" />
      <SqlExample example={mapTableRun} title="真的跑一遍：建归档表、写入、查询、删掉归档表" />
      <Note text="按时间、按取模自动路由的分表，用实体上的 `sharding`，见“分库分表”。`mapTables` 适合由代码明确指定用哪张表的场景。" />
    </Section>
    <Section id="schema" title="换 schema：inSchema">
      <P text="多租户分库、归档库：表还是那些表，换一个 schema（MySQL 里是库）。表名已带 schema 前缀的会换掉前缀。" />
      <SqlExample example={useSchema} title="所有表换到 archive_2025" />
      <P text="第二个参数只换这几个实体。" />
      <SqlExample example={useSchemaOnly} title="只换帖子表" />
    </Section>
    <Section id="link" title="跨库链接：withTableLink">
      <P text="表名后面加上 `@link`，比如 Oracle 的 db link。第二个参数同样可以只换几个实体。" />
      <SqlExample example={tableLink} title="查询走 db link" />
    </Section>
    <Section id="modules" title="按模块组合 schema">
      <P text="大项目按模块各写一份 `defineSchema`，模块之间互不 import，在应用入口合成一份。合并后的实体、各模块自己的导航、跨模块的导航全部推出，`p.author.company.name` 照常补全。Java 版实体靠类路径扫描，没有这层模块边界。" />
      <CodeBlock code={merge} lang="ts" />
      <P text="重名在调用处就报错，错误信息里写出是哪个键。运行时还有同样的检查，从 JS 调用时兜底。" />
      <CodeBlock code={mergeErrors} lang="ts" />
      <Points
        items={[
          '跨模块的关系要内联写在调用处，构造器 `r` 才有上下文类型。',
          '实体登记成两个键、列名写错、直达关系走不通，都在合并时报出。',
        ]}
      />
    </Section>
    <Section id="mount" title="运行时挂载">
      <CodeBlock code={mount} lang="ts" />
    </Section>
  </DocPage>
));
