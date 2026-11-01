/** 建表与迁移 */
import { _component } from '@zerodep-dev/vue-tsx-pro-tsx';
import { CodeBlock } from '@zerodep-dev/vue-tsx-pro-ui';
import { DocPage, Note, P, Points, Section } from '../../site/content';
import { SqlExample } from '../../site/SqlExample';
import { createOne, fromSchema } from './schema.examples.ts';

const sync = `// 开发阶段：读库里的结构与实体比较，只增不删，差异列出来由你决定
const plan = await db.planSync();
await db.syncTables();

// 生产环境：有记录、能审查、能手改的迁移。up 可以是语句，也可以是函数
const backfill = defineMigration({
  id: '20261031000000_backfill',
  up: async (db) => {
    await db.sql.execute\`UPDATE t_post SET views = 0 WHERE views IS NULL\`;
  },
});
await db.migrate([backfill]); // 返回这次执行的 id`;

const pull = `# 由已有的库生成实体
eqts pull --adapter ./db-adapter.ts --out src/schema.ts

# 对开发库算差异，写成迁移文件；再按文件名的顺序执行还没执行过的
eqts migrate generate --adapter ./db-adapter.ts --schema ./src/schema.ts --name add_orders
eqts migrate up --adapter ./db-adapter.ts

# SQL 快照：改了查询或升级了库，评审时直接看 SQL 的差异；--check 发现没更新就失败
eqts snapshot src/queries.snap.ts --check`;

export default _component(() => () => (
  <DocPage>
    <Section id="create" title="由实体建表">
      <P text="`createTables` 建表，只想拿到语句不执行时用 `createTablesSql`。类型按方言映射，切换方言看 JSON、DECIMAL、自增列怎么变；ClickHouse 没有自增列，会直接告诉你。" />
      <SqlExample example={fromSchema} title="模型里的帖子表" />
      <SqlExample example={createOne} title="一张新表：注释、JSON、可空列" />
      <Points
        items={[
          '`unique()`、`index()`、`dbDefault()`、`comment()`、生成列都声明在列上。',
          '外键、索引可以在实体的第三个参数里写组合的。',
        ]}
      />
    </Section>
    <Section id="sync" title="同步与迁移">
      <P text="开发环境用 `syncTables` 让库跟上实体，它只增不删；改名用 `renamedFrom` 声明。生产环境用 `db.migrate`，执行过的迁移记进历史表，下次跳过。" />
      <CodeBlock code={sync} lang="ts" />
    </Section>
    <Section id="cli" title="命令行">
      <CodeBlock code={pull} lang="bash" />
      <Note text="由库生成实体对应官方的 IDEA 插件；DTO、代理类不需要生成，类型都是推出来的。" />
    </Section>
  </DocPage>
));
