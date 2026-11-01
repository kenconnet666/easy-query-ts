/** 建表与同步 */
import { _component } from '@zerodep-dev/vue-tsx-pro-tsx';
import { CodeBlock } from '@zerodep-dev/vue-tsx-pro-ui';
import { DocPage, Note, P, Points, Section, SimpleTable } from '../../site/content';
import { SqlExample } from '../../site/SqlExample';
import {
  compositePrimaryKey,
  createOne,
  fromSchema,
  generatedColumn,
  manyTables,
  oneTable,
  tableIndexes,
  uniqueAndDefault,
} from './schema.examples.ts';

const create = `await db.createTables();       // 建库里还没有的表（连同注释、索引、外键），已有的表不动
await db.createTables(Post);   // 只建这几张
db.createTablesSql();          // 只要语句，不执行
db.createTableSql(Post);       // 只看一张表的 CREATE TABLE
await db.tableExists(Post);
await db.dropTables(Post);     // 库里没有的跳过`;

const plan = `const plan = await db.planSync(); // 读库里的结构与实体比较，不执行
console.log(plan.statements.join(';\\n')); // 要执行的语句：只增不删
console.log(plan.differences);            // 不会自动改的差异

await db.syncTables(); // 算计划并执行（PG、SQLite 在一个事务里）`;

const rename = `const Book = entity(
  't_book',
  {
    id: col.bigint().primaryKey().generated(),
    title: col.string(100).renamedFrom('name'), // 原来叫 name：同步时改名而不是加列
  },
  { renamedFrom: 't_books' },                   // 表改过名
);`;

const introspect = `const tables = await db.introspect();
// [{ name, columns: [{ name, type, nullable, ... }], primaryKey, indexes, foreignKeys }]`;

export default _component(() => () => (
  <DocPage>
    <Section id="create" title="由实体建表">
      <P text="`createTables` 建表，只想拿到语句不执行时用 `createTablesSql`。类型按方言映射，切换方言看 JSON、DECIMAL、自增列怎么变；ClickHouse 没有自增列，会直接告诉你。" />
      <CodeBlock code={create} lang="ts" />
      <SqlExample example={fromSchema} title="模型里的帖子表" />
      <SqlExample example={createOne} title="一张新表：注释、JSON、可空列" />
      <SqlExample example={compositePrimaryKey} title="复合主键" />
      <SqlExample example={manyTables} title="几张表一起" />
      <SqlExample example={oneTable} title="createTableSql：只有 CREATE TABLE" />
    </Section>
    <Section id="columns" title="列上能声明的">
      <SqlExample example={uniqueAndDefault} title="唯一约束、默认值、改列名" />
      <P text="生成列的值由库算，写入时给值报错，`entity(row)`、`changes` 自动跳过它。PG 只有 STORED，MySQL、SQLite 可以 VIRTUAL。" />
      <SqlExample example={generatedColumn} title="生成列" />
    </Section>
    <Section id="indexes" title="索引">
      <P text="索引写在实体的第三个参数里，名字默认是 `表_列_idx`、`表_列_uidx`。方言不支持的写法在建表时报错，不发半截语句。" />
      <SqlExample example={tableIndexes} title="组合、唯一、表达式、部分索引" />
      <SimpleTable
        head={['选项', '作用', '支持']}
        rows={[
          ['`columns`', '索引的列，按实体检查', '全部'],
          ['`unique`', '唯一索引', 'ClickHouse、Doris 报错'],
          ['`expressions`', '表达式索引，受信任的 SQL', 'PG、SQLite、MySQL 8.0.13 起'],
          ['`where`', '部分索引，受信任的 SQL', 'PG、SQLite'],
          ['`using`', '索引方法：GIN、GiST、BRIN、HASH、BTREE', 'PG、MySQL'],
        ]}
      />
    </Section>
    <Section id="sync" title="同步">
      <P text="开发阶段用 `syncTables` 让库跟上实体。它只增不删，差异列出来由你决定。" />
      <CodeBlock code={plan} lang="ts" />
      <Points
        items={[
          '会做：建缺的表、加缺的列、按 `renamedFrom` 改表名与列名、建缺的索引与外键。',
          '只列出不做：类型、可空、注释不一致，库里多出来的列，SQLite 上已有表缺的外键。',
          '永不删表删列；要删用 `dropTables`。刚建好的表再比一次是空计划。',
          '`planSync` 按名字比较索引：已有同名索引但定义变了不会自动改。',
        ]}
      />
      <CodeBlock code={rename} lang="ts" title="改名" />
      <Note text="适合测试、原型和中小项目的起步。结构复杂的正式环境用迁移，见“迁移”。" />
    </Section>
    <Section id="introspect" title="读库结构">
      <CodeBlock code={introspect} lang="ts" />
      <P text="MySQL 读 information_schema，PG 读系统目录，SQLite 读 pragma。由表生成实体的 `eqts pull` 也用它，见“迁移”。" />
    </Section>
  </DocPage>
));
