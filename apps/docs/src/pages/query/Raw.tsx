/** 原生 SQL：片段、整条语句、看语句、提示 */
import { _component } from '@zerodep-dev/vue-tsx-pro-tsx';
import { CodeBlock } from '@zerodep-dev/vue-tsx-pro-ui';
import { DocPage, Note, P, Points, Section, SimpleTable } from '../../site/content';
import { SqlExample } from '../../site/SqlExample';
import {
  customFunction,
  fragmentParam,
  fragmentSelect,
  fragmentWhere,
  optimizerHint,
  rawArray,
  rawExecute,
  rawIdent,
  rawInTransaction,
  rawStatement,
  textTemplate,
  toSql,
} from './raw.examples.ts';

const hints = `// 表后面追加一段：只能是受信任的文字，原样写进 SQL
db.queryable(Order).tableHint('WITH (NOLOCK)');          // SQL Server
db.queryable(Event).tableHint('FINAL');                  // ClickHouse
db.queryable(Order).tableHint('USE INDEX (idx_time)');   // MySQL
db.queryable(User).innerJoin(Post, on).tableHint('...'); // 给最近 join 进来的表`;

const explain = `const plan = await db.queryable(Order).where((o) => o.userId.eq(7)).explain();
await db.queryable(Order).explain({ analyze: true }); // 真的执行一遍，带实际行数与耗时

// 慢查询自动带计划
const watch = queryWatch({ slowMs: 200, explain: (statement) => db.explain(statement) });`;

const hook = `const db = createDb({
  schema,
  adapter,
  log: (statement) => console.log(statement.sql, statement.params), // 执行前
  onExecute: (event) => {
    // 执行后，成功失败都会调用：构建器、db.sql、事务里的语句都经过这里
    metrics.timing('db', event.durationMs, { kind: event.kind, ok: event.error === undefined });
  },
});`;

export default _component(() => () => (
  <DocPage>
    <Section id="when" title="先想想要不要">
      <P text="构建器已经按方言处理了引号、分页、日期这些差异，能用就用。原生 SQL 留给库的专有写法和一次性的维护脚本。" />
      <SimpleTable
        head={['你要的', '写法']}
        rows={[
          ['一段库里有、这里没封装的表达式', '`sql` 模板，放进 `where`、`select`、`orderBy`'],
          ['字符串拼接', '`text` 模板，各库的 `||`、`CONCAT` 由方言选'],
          ['调一个库里的函数', '`sql` 模板，写法和库的原生语法一样'],
          ['一整条语句', '`db.sql`、`db.sql.execute`'],
          ['只想看生成的 SQL', '`q.toSQL()`'],
          ['索引提示、表提示', '`optimizerHint`、`tableHint`'],
        ]}
      />
    </Section>
    <Section id="fragment" title="SQL 片段">
      <P text="`sql` 模板得到一个表达式，能放在任何能放列的地方。插进去的列渲染成带别名的列名，结果类型写在类型参数里。" />
      <SqlExample example={fragmentWhere} title="条件里写一段" />
      <SqlExample example={fragmentSelect} title="选列里写一段" />
      <P text="插进去的值一律是绑定参数，不会拼进 SQL 文本，所以不用担心注入。看 SQL 一栏的参数。" />
      <SqlExample example={fragmentParam} title="值绑定成参数" />
      <P text="`text` 是字符串拼接，切到 MySQL、SQL Server 看看写法的差别。" />
      <SqlExample example={textTemplate} title="text 模板：导航也能放进去" />
      <P text="没封装的函数也用 `sql` 模板调。这段写的是库的原生语法，换数据库不会帮你改写；要跨库的写法，优先用“函数”一章里按方言渲染的方法。" />
      <SqlExample example={customFunction} title="调一个库里的函数" />
    </Section>
    <Section id="statement" title="整条语句">
      <P text="`db.sql` 查询，`db.sql.execute` 写入并返回影响的行数。这时写的就是库的原生语法，换数据库不会帮你改写，切换方言只有占位符会变。" />
      <SqlExample example={rawStatement} title="查询" />
      <P text="数组展开成逗号分隔的多个参数，空数组报错（`IN ()` 不是合法 SQL）；`null` 绑成 NULL；`undefined` 报错，多半是漏传的变量。" />
      <SqlExample example={rawArray} title="IN 列表" />
      <P text="表名、列名不是值，不能绑定参数，用 `db.sql.ident`，按方言加引号，支持 `schema.table`。" />
      <SqlExample example={rawIdent} title="标识符" />
      <SqlExample example={rawExecute} title="写入：返回影响的行数" />
      <P text="事务里用 `tx.sql`，和其它语句在同一个事务里。" />
      <SqlExample example={rawInTransaction} title="事务里的原生 SQL" />
      <Points
        items={[
          '结果是驱动读出的原始值，不经过列的编解码：MySQL 的 DECIMAL、BIGINT、日期是文字，别的库可能是 number、Date。',
          '类型参数只是你对形状的断言，不会被检查。',
          '`readonly()` 的 Db 上 `db.sql.execute` 运行时报错。',
        ]}
      />
    </Section>
    <Section id="inspect" title="看生成的 SQL">
      <P text="`toSQL` 只渲染不执行，写入构造器也有。迁移、写日志、单测断言 SQL 时用。" />
      <SqlExample example={toSql} title="只渲染，不执行" />
      <P text="`explain` 取执行计划：PG 返回 JSON 计划，MySQL 返回计划对象，SQLite 是 EXPLAIN QUERY PLAN 的各行；只解释主语句，`toList` 带出的第二条查询不在里面。`analyze` 会真的执行，别用在写语句上。" />
      <CodeBlock code={explain} lang="ts" />
      <P text="`log`、`onExecute` 拿到实际执行的每条语句。" />
      <CodeBlock code={hook} lang="ts" />
    </Section>
    <Section id="hints" title="优化器提示与表提示">
      <P text="`optimizerHint` 写进 SELECT 后面的提示注释；不认的库当成注释，不影响执行。切到 MySQL 看位置。" />
      <SqlExample example={optimizerHint} title="MySQL 的执行时间上限" />
      <CodeBlock code={hints} lang="ts" />
      <Note text="`tableHint`、`optimizerHint`、索引的 `expressions` 都原样写进 SQL，只能传代码里写死的文字，不要放用户输入。" />
    </Section>
  </DocPage>
));
