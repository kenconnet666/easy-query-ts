/** 迁移与命令行 */
import { _component } from '@zerodep-dev/vue-tsx-pro-tsx';
import { CodeBlock } from '@zerodep-dev/vue-tsx-pro-ui';
import { DocPage, Note, P, Points, Section, SimpleTable } from '../../site/content';

const generate = `# 对开发库算差异，写成 migrations/<时间戳>_add_orders.ts，没有要改的就不写
eqts migrate generate --adapter ./db-adapter.ts --schema ./src/schema.ts --name add_orders

# 按文件名的顺序执行还没执行过的迁移，记进历史表
eqts migrate up --adapter ./db-adapter.ts`;

const generated = `// migrations/20261030083000_add_orders.ts：生成的，可以手改
export default defineMigration({
  id: '20261030083000_add_orders',
  up: [
    'CREATE TABLE "t_order" (...)',
    'CREATE INDEX "t_order_user_id_idx" ON "t_order" ("user_id")',
  ],
});
// 不会自动改的差异（需要的话把对应的语句写进 up）：
// - t_user.name: type is varchar(50), declared VARCHAR(100)`;

const data = `// 数据迁移：up 写成函数，拿到同一个连接与事务
export default defineMigration({
  id: '20261031000000_backfill',
  up: async (db) => {
    await db.sql.execute\`UPDATE t_user SET level = 1 WHERE level IS NULL\`;
  },
});`;

const startup = `import backfill from './migrations/20261031000000_backfill';

// 也可以在应用启动时执行；返回这次执行的 id
await db.migrate([addOrders, backfill]);
await db.migrate([addOrders, backfill], { table: 'my_migrations' });`;

const adapter = `// db-adapter.ts：默认导出一个 Adapter，命令行用它连库
import { createPool } from 'mysql2/promise';
import { mysql } from '@zerodep-dev/easy-query-ts-mysql';

export default mysql(createPool(process.env.DATABASE_URL));`;

const pull = `# 由已有的库生成实体：从 Java 迁过来的表不用手写
eqts pull --adapter ./db-adapter.ts --out src/schema.ts --strip-prefix t_`;

export default _component(() => () => (
  <DocPage>
    <Section id="why" title="什么时候用">
      <P text="`syncTables` 适合开发阶段；生产环境要有记录、能审查、能手改的迁移。执行过的迁移记进历史表，下次跳过。" />
      <P text="几个实例同时启动、同时执行迁移时排队，每条迁移只执行一次：PostgreSQL 系、SQL Server 按历史表的名字加事务级的咨询锁；MySQL、MariaDB 用 `GET_LOCK`，锁拿在另一条连接上，迁移期间要占两条连接（连接池只有一条时传 `{ lock: false }`，自己保证只有一个实例在跑）。别的库（Oracle、达梦、HANA、Db2 等）没有可用的锁，迁移由一个实例或部署流程里单独的一步来跑。" />
      <SimpleTable
        head={['阶段', '做法']}
        rows={[
          ['写测试', '`createTables`：每个用例一个新库'],
          ['本地开发', '`syncTables`：让库跟上实体'],
          ['生产', '`eqts migrate generate` 生成、评审、`eqts migrate up` 或 `db.migrate` 执行'],
        ]}
      />
    </Section>
    <Section id="generate" title="生成和执行">
      <CodeBlock code={adapter} lang="ts" />
      <CodeBlock code={generate} lang="bash" />
      <P text="生成的文件可以手改。`planSync` 不会自动做的改动（改类型、改可空、删列）列在文件末尾的注释里，由人决定写不写进 `up`。" />
      <CodeBlock code={generated} lang="ts" />
    </Section>
    <Section id="data" title="数据迁移">
      <CodeBlock code={data} lang="ts" />
      <CodeBlock code={startup} lang="ts" />
    </Section>
    <Section id="rules" title="规则">
      <Points
        items={[
          '迁移按 id 的字典序执行，生成时用 UTC 时间戳开头，传入的顺序不重要；id 重复报错。',
          '历史表默认 `eqts_migrations`（id、校验和、执行时间），没有就建；`--table`、`{ table }` 换名字。`eqts pull` 不会把它生成成实体。',
          '每条迁移连同它的历史记录在一个事务里（DDL 能放进事务的库：PG、SQLite、SQL Server、Db2 等）；MySQL、Oracle 的 DDL 会隐式提交。',
          '已经执行过的迁移被改了（校验和对不上）：`migrate` 直接报错，要改就加一条新迁移。函数写的迁移不校验：函数的源码文字随构建方式变，拿它比会把没改的迁移当成改过。',
          '某条迁移失败时抛 `MigrationError`：`id` 是哪一条、`statement` 是第几条语句、`rolledBack` 是做过的改动有没有回滚，`cause` 是驱动的错误。DDL 能回滚的库改好再跑就行；MySQL、Oracle 这类失败之前的语句留在库里、历史表没有记录，照错误里说的把库修好（或把执行过的语句从迁移里拿掉）再跑。一条迁移里少放几条 DDL，出了事好收拾。',
        ]}
      />
    </Section>
    <Section id="pull" title="由库生成实体">
      <P text="方向和 `createTables` 相反。生成每张表一个 `entity(...)`，外键变成两边的导航；认不得的类型用 `.dbType(...)` 原样保留并加注释，JSON 列要补上类型。生成的 schema 与库再 `planSync` 是空计划。" />
      <CodeBlock code={pull} lang="bash" />
      <Note text="这一步对应官方的 IDEA 插件。DTO、代理类不需要生成，类型都是推出来的。SQL 快照的命令 `eqts snapshot` 见“测试”。" />
    </Section>
  </DocPage>
));
