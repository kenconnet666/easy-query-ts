/** 复用查询：不可变、函数、通用条件、预编译 */
import { _component } from '@zerodep-dev/vue-tsx-pro-tsx';
import { CodeBlock } from '@zerodep-dev/vue-tsx-pro-ui';
import { DocPage, Note, P, Points, Section } from '../../site/content';
import { SqlExample } from '../../site/SqlExample';
import {
  prepareSeveral,
  queryFunction,
  reuseAsSubquery,
  reuseSelect,
  scopeAndMore,
  scopeTwoArgs,
} from './extras.examples.ts';
import { prepare, reuse, scope } from './more.examples.ts';

const typed = `import type { Db } from '@zerodep-dev/easy-query-ts';

type AppDb = Db<typeof schema>;

// 查询封装成函数，返回还没执行的查询：调用方接着 select、toPage
export function publishedPosts(db: AppDb, keyword?: string) {
  return db
    .queryable(Post)
    .where((p) => [p.status.eq('published'), keyword && p.title.like(keyword)]);
}

await publishedPosts(tx, '缓存').count(); // 传 tx 就在事务里`;

export default _component(() => () => (
  <DocPage>
    <Section id="immutable" title="查询对象不可变">
      <P text="`where`、`orderBy` 都返回新的查询，原来的不变。公共部分存到变量里，往下接不同的条件，互不影响，不用克隆。" />
      <SqlExample example={reuse} title="同一段条件接出三条查询" />
      <SqlExample example={reuseSelect} title="同一条查询分页和取第一行" />
      <P text="没执行的查询也能当子查询用。" />
      <SqlExample example={reuseAsSubquery} title="存下来当子查询" />
    </Section>
    <Section id="function" title="封装成函数">
      <P text="最常用的复用就是写个函数返回查询。类型都是推出来的，不用写返回类型。" />
      <CodeBlock code={typed} lang="ts" title="posts.ts" />
      <SqlExample example={queryFunction} title="一个函数，数和查" />
    </Section>
    <Section id="scope" title="通用条件">
      <P text="`defineScope` 只声明条件依赖的列，任何有这些列的实体都能 `apply`。实体缺列、参数类型不对都是类型错误。适合“按作者”“按租户”“某时间段内”这类到处都有的条件。" />
      <SqlExample example={scope} title="帖子和评论共用“某人写的”" />
      <SqlExample example={scopeTwoArgs} title="带参数" />
      <SqlExample example={scopeAndMore} title="接着写条件和排序" />
      <Note text="每条查询都要带的条件用拦截器，见“拦截器”；复用形状用视图，见“视图”。" />
    </Section>
    <Section id="prepare" title="预编译查询">
      <P text="热点接口每次都拼一遍查询、渲染一遍 SQL。`db.prepare` 只渲染一次，之后每次只换参数，类型写在回调参数上。" />
      <SqlExample example={prepare} title="渲染一次，执行两次" />
      <SqlExample example={prepareSeveral} title="sql 属性拿到渲染好的语句" />
      <Points
        items={[
          '占位值只能当标量用，带 `toList` 导航的查询不能预编译。',
          '`like`、`startsWith` 的占位值也能用：通配符照样转义。',
        ]}
      />
      <Note text="多数接口用不上预编译：渲染 SQL 的开销和一次网络往返比很小。先量，再优化。" />
    </Section>
  </DocPage>
));
