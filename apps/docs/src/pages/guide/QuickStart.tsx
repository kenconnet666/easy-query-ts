/** 快速开始：先给一个能看到结果的例子，再说安装 */
import { _component } from '@zerodep-dev/vue-tsx-pro-tsx';
import { CodeBlock } from '@zerodep-dev/vue-tsx-pro-ui';
import { DocPage, Note, P, Points, Section } from '../../site/content';
import { SqlExample } from '../../site/SqlExample';
import { firstQuery, tree } from './quick-start.examples.ts';

const install = `pnpm add @zerodep-dev/easy-query-ts @zerodep-dev/easy-query-ts-pg pg`;

const define = `import { col, createDb, defineSchema, entity } from '@zerodep-dev/easy-query-ts';
import { postgres } from '@zerodep-dev/easy-query-ts-pg';
import pg from 'pg';

const User = entity('t_user', {
  id: col.bigint().primaryKey().generated(),
  name: col.string(50),
});
const Post = entity('t_post', {
  id: col.bigint().primaryKey().generated(),
  authorId: col.bigint(),
  title: col.string(100),
  views: col.int(),
});

const schema = defineSchema(
  { User, Post },
  {
    User: (r) => ({ posts: r.many('Post', { from: 'id', to: 'authorId' }) }),
    Post: (r) => ({ author: r.one('User', { from: 'authorId', to: 'id' }) }),
  },
);

export const db = createDb({ schema, adapter: postgres(new pg.Pool({ connectionString })) });`;

export default _component(() => () => (
  <DocPage>
    <Section id="try" title="先跑一条">
      <P text="这条查询没写 join，作者名经导航 `p.author.name` 取到。结果的类型是 `{ title: string; views: number; author: string | null }[]`，全由 `select` 推出，不用代码生成。点“运行”，它会在浏览器里的 PostgreSQL 上真的执行一遍；右上角可以换成别的数据库，看同一段代码生成的 SQL。" />
      <SqlExample example={firstQuery} title="阅读量过千的帖子和作者" />
      <P text="再复杂一点：筛选条件跨两层导航，结果是一棵对象树。" />
      <SqlExample example={tree} title="有热门帖子的公司，带上员工和各自的帖子数" />
    </Section>
    <Section id="install" title="安装">
      <P text="核心包不依赖任何驱动，按数据库再装一个方言包和它的驱动。" />
      <CodeBlock code={install} lang="bash" />
    </Section>
    <Section id="define" title="定义实体，建 Db">
      <P text="实体就是列的声明，关系写在 `defineSchema` 的第二个参数里。不需要注解、不需要生成代理类。" />
      <CodeBlock code={define} lang="ts" title="db.ts" />
      <Note text="本站所有示例都用同一套模型：公司、用户、帖子、评论、标签。" />
    </Section>
    <Section id="next" title="接下来">
      <Points
        items={[
          '查询的写法看“条件、排序与分页”，每段代码都能运行。',
          '`toList`、`single`、`find`、`count`、`any`、`toPage`、`stream` 是终结方法，调用时才发 SQL。',
        ]}
      />
    </Section>
  </DocPage>
));
