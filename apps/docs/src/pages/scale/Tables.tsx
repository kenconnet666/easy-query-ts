/** 动态表名：mapTables、inSchema、withTableLink */
import { _component } from '@zerodep-dev/vue-tsx-pro-tsx';
import { CodeBlock } from '@zerodep-dev/vue-tsx-pro-ui';
import { DocPage, Note, P, Section, SimpleTable } from '../../site/content';
import { SqlExample } from '../../site/SqlExample';
import { mapTable, mapTableRun, tableLink, useSchema, useSchemaOnly } from './scale.examples.ts';

const adhoc = `// 表名运行时才知道、schema 里没有：临时定义一个实体，直接查
const logOf = (month: string) =>
  entity(\`t_log_\${month}\`, {
    id: col.int().primaryKey().generated(),
    msg: col.string(),
  });

await db.queryable(logOf('202610')).where((l) => l.id.gt(100)).toList();`;

export default _component(() => () => (
  <DocPage>
    <Section id="which" title="选哪种">
      <SimpleTable
        head={['需求', '写法']}
        rows={[
          ['热表和归档表，由代码指定', '`mapTables`'],
          ['每个租户一个 schema、归档库', '`inSchema`'],
          ['跨库链接（Oracle db link）', '`withTableLink`'],
          ['按分片键自动路由', '实体的 `sharding`，见“分表”'],
          ['表名运行时才知道', '临时定义实体'],
        ]}
      />
    </Section>
    <Section id="map-tables" title="换表：mapTables">
      <P text="热表和归档表、按月的表，结构相同只是名字不同。`mapTables` 返回一个新的 Db，查询和写入都换到别的表，导航、join、子查询、`include` 全跟着换，不用改查询代码。原来的 `db` 不变。" />
      <SqlExample example={mapTable} title="只渲染：帖子换成归档表，用户表不动" />
      <P text="键是实体在 schema 里的名字，写错编译不过。映射的表要有同样的列；写入和 `createTables`、`dropTables` 这些 DDL 也都走映射后的名字，不会动到原表。" />
      <SqlExample example={mapTableRun} title="真的跑一遍：建归档表、更新、查询、删掉" />
    </Section>
    <Section id="schema" title="换 schema：inSchema">
      <P text="多租户分库、归档库：表还是那些表，换一个 schema（MySQL 里是库）。表名已带 schema 前缀的会换掉前缀。" />
      <P text="建表也跟着走：`db.inSchema('archive_2025').createTables()`、`syncTables`、`tableExists`、`dropTables` 读的是那个 schema 的表结构，当前 schema 里有同名的表不算数；`db.introspect('archive_2025')` 直接读它。PostgreSQL 系、MySQL 系、SQLite 的附加库、SQL Server、HANA、Db2、DuckDB、ClickHouse 支持；Oracle、达梦的 schema 就是用户，只读当前用户的表，前缀要和当前用户一致。" />
      <SqlExample example={useSchema} title="所有表换到 archive_2025" />
      <P text="第二个参数只换这几个实体。" />
      <SqlExample example={useSchemaOnly} title="只换帖子表" />
    </Section>
    <Section id="link" title="跨库链接：withTableLink">
      <P text="表名后面加上 `@link`，比如 Oracle 的 db link。第二个参数同样可以只换几个实体。" />
      <SqlExample example={tableLink} title="查询走 db link" />
    </Section>
    <Section id="adhoc" title="schema 里没有的表">
      <P text="实体不一定要登记进 schema：临时定义一个就能查、能写，类型由列推出。只是不能用导航。" />
      <CodeBlock code={adhoc} lang="ts" />
      <Note text="大项目按模块组合 schema，见“模块组合”。" />
    </Section>
  </DocPage>
));
