/** 测试：内存库、SQL 断言、快照、类型测试 */
import { _component } from '@zerodep-dev/vue-tsx-pro-tsx';
import { CodeBlock } from '@zerodep-dev/vue-tsx-pro-ui';
import { DocPage, Note, P, Points, Section, SimpleTable } from '../../site/content';

const sqliteTest = `import { DatabaseSync } from 'node:sqlite';
import { beforeEach, expect, test } from 'vitest';
import { createDb } from '@zerodep-dev/easy-query-ts';
import { sqlite } from '@zerodep-dev/easy-query-ts-sqlite';
import { schema, User } from '../src/schema';

let db: ReturnType<typeof open>;

function open() {
  return createDb({ schema, adapter: sqlite(new DatabaseSync(':memory:')) });
}

beforeEach(async () => {
  db = open();
  await db.createTables(); // 每个用例一个新库，互不影响
});

test('只查成年用户', async () => {
  await db.insert(User).values([{ name: 'a', age: 20 }, { name: 'b', age: 10 }]).execute();
  const names = await listAdults(db);
  expect(names).toEqual(['a']);
});`;

const pgliteTest = `import { PGlite } from '@electric-sql/pglite';
import { pglite } from '@zerodep-dev/easy-query-ts-pg/pglite';

// 生产是 PostgreSQL 时用它：真的 PG 语法和类型，不用起容器
const db = createDb({ schema, adapter: pglite(new PGlite()) });
await db.createTables();`;

const rollbackTest = `// 库建一次，每个用例跑在一个回滚的事务里，比每次重建快
async function inRollback(work: (tx: Transaction<typeof schema>) => Promise<void>) {
  const tx = await db.begin();
  try {
    await work(tx);
  } finally {
    await tx.rollback();
  }
}`;

const sqlAssert = `test('按城市筛选时带上 join', () => {
  const { sql, params } = db
    .queryable(User)
    .where((u) => u.company.city.eq('杭州'))
    .select((u) => u.name)
    .toSQL();

  expect(sql).toContain('LEFT JOIN');
  expect(params).toEqual(['杭州']);
});`;

const snapshotDefine = `// src/queries.snap.ts
import { defineSnapshots } from '@zerodep-dev/easy-query-ts';
import { MySqlDialect } from '@zerodep-dev/easy-query-ts-mysql';
import { PostgresDialect } from '@zerodep-dev/easy-query-ts-pg';

export default defineSnapshots({
  schema,
  // 键是标签，用在文件名里：同一个方言的不同版本给不同的标签
  dialects: { pg: new PostgresDialect(), mysql80: new MySqlDialect({ version: '8.0.18' }) },
  queries: {
    adults: (db) => db.queryable(User).where((u) => u.age.ge(18)),
    renameUser: (db) => db.update(User).set({ name: 'x' }).where((u) => u.id.eq(1)),
  },
});`;

const snapshotRun = `eqts snapshot src/queries.snap.ts --out sql-snapshots          # 写 sql-snapshots/queries.snap.pg.sql 等
eqts snapshot src/queries.snap.ts --out sql-snapshots --check  # CI：快照没更新时失败并列出文件`;

const snapshotOutput = `-- adults
SELECT t0."name" AS "c0" FROM "t_user" t0 WHERE t0."age" >= $1;
-- params: [18]

-- postsByAuthor
-- error: rollup() is not supported by SQLite`;

const snapshotVitest = `import { renderSnapshots } from '@zerodep-dev/easy-query-ts';
import definition from '../src/queries.snap';

test('SQL 没变', async () => {
  const texts = renderSnapshots(definition); // 标签 → 文本
  await expect(texts.pg).toMatchFileSnapshot('./__snapshots__/queries.pg.sql');
});`;

const typeTest = `import { expectTypeOf, test } from 'vitest';

test('结果的形状', async () => {
  const rows = await db.queryable(User).select((u) => ({ name: u.name, city: u.company.city })).toList();
  expectTypeOf(rows).toEqualTypeOf<{ name: string; city: string | null }[]>();
});

// 写错就该编译不过：tsc 检查这些注释下面确实有错
// @ts-expect-error age 是数字
db.queryable(User).where((u) => u.age.eq('18'));`;

export default _component(() => () => (
  <DocPage>
    <Section id="which" title="测试放在哪一层">
      <SimpleTable
        head={['要验证', '用什么', '速度']}
        rows={[
          ['查询写得对不对、业务逻辑', 'SQLite 内存库', '每个用例几毫秒'],
          ['用到了 PG 的类型、函数', 'PGlite', '启动约一秒，之后很快'],
          ['SQL 没有意外变化', '`toSQL` 断言、SQL 快照', '不连库'],
          ['结果类型', '`expectTypeOf`、`@ts-expect-error`', '随 tsc'],
          ['特定版本的行为、并发、锁', '真实的库（CI 上起容器）', '慢，留给少数用例'],
        ]}
      />
      <Note text="不用 mock Db：SQLite 内存库比 mock 更快也更真实。查询对象不连库就能渲染，SQL 断言也不需要假的驱动。" />
    </Section>
    <Section id="sqlite" title="SQLite 内存库">
      <P text="`node:sqlite` 是 Node 自带的，不用装驱动。每个用例建一个新库，`createTables` 由实体建好表。" />
      <CodeBlock code={sqliteTest} lang="ts" title="users.test.ts" />
      <Points
        items={[
          'SQLite 没有严格类型：日期是文字，DECIMAL 是 NUMERIC。依赖库里精度、日期运算的逻辑放到 PGlite 或真实的库。',
          '用到方言专属的写法（`rollup`、数组列）时，SQLite 渲染时就报错，换 PGlite。',
        ]}
      />
    </Section>
    <Section id="pglite" title="PGlite">
      <P text="WASM 版的 PostgreSQL，跑在进程里。本站的“运行”按钮就是它。这个库自己的 PostgreSQL 共用测试套件也在 PGlite 上跑。" />
      <CodeBlock code={pgliteTest} lang="ts" />
      <P text="库只建一次时，让每个用例跑在一个最后回滚的事务里。注意 PGlite 只有一条连接，用例要串行。" />
      <CodeBlock code={rollbackTest} lang="ts" />
    </Section>
    <Section id="sql" title="断言 SQL">
      <P text="`toSQL` 不连库，查询和写入构造器都有。只断言关心的部分，比如有没有 join、参数对不对，别整段比较，否则别名一变全部失败。" />
      <CodeBlock code={sqlAssert} lang="ts" />
    </Section>
    <Section id="snapshot" title="SQL 快照">
      <P text="查询链改了一行、升级了这个库、加了一个方言，生成的 SQL 变没变？把关心的查询声明成快照，按每个方言渲染成文本提交进仓库，评审时直接看 SQL 的差异。" />
      <CodeBlock code={snapshotDefine} lang="ts" />
      <CodeBlock code={snapshotRun} lang="bash" />
      <P text="文本按查询名排序，每段是名字、SQL、参数；某个方言不支持的写法写成一行错误，同样进差异。" />
      <CodeBlock code={snapshotOutput} lang="sql" />
      <P text="单测里也可以直接比。" />
      <CodeBlock code={snapshotVitest} lang="ts" />
      <P text="查询函数拿到的 `db` 只能渲染，执行会报错。定义文件由 Node 直接加载，查询链要运行时求值才能渲染，所以写成显式的定义，不从业务代码里扫描。" />
    </Section>
    <Section id="types" title="类型测试">
      <P text="这个库的卖点之一是类型。结果形状、写错就该报错的地方，都可以测。" />
      <CodeBlock code={typeTest} lang="ts" />
    </Section>
  </DocPage>
));
