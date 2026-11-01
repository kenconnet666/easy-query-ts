/** 复用查询：不可变、通用条件、预编译 */
import { _component } from '@zerodep-dev/vue-tsx-pro-tsx';
import { DocPage, Note, P, Points, Section } from '../../site/content';
import { SqlExample } from '../../site/SqlExample';
import { prepare, reuse, scope } from './more.examples.ts';

export default _component(() => () => (
  <DocPage>
    <Section id="immutable" title="查询对象不可变">
      <P text="`where`、`orderBy` 都返回新的查询，原来的不变。公共部分存到变量里，往下接不同的条件，互不影响，不用克隆。" />
      <SqlExample example={reuse} title="同一段条件接出三条查询" />
    </Section>
    <Section id="scope" title="通用条件">
      <P text="`defineScope` 只声明条件依赖的列，任何有这些列的实体都能 `apply`。实体缺列、参数类型不对都是类型错误。适合“按作者”“按租户”“某时间段内”这类到处都有的条件。" />
      <SqlExample example={scope} title="帖子和评论共用“某人写的”" />
    </Section>
    <Section id="prepare" title="预编译查询">
      <P text="热点接口每次都拼一遍查询、渲染一遍 SQL。`db.prepare` 只渲染一次，之后每次只换参数，类型写在回调参数上。" />
      <SqlExample example={prepare} title="渲染一次，执行两次" />
      <Points
        items={[
          '占位值只能当标量用，带 `toList` 导航的查询不能预编译。',
          '`byAuthor.sql` 拿到渲染好的 SQL。',
        ]}
      />
      <Note text="多数接口用不上预编译：渲染 SQL 的开销和一次网络往返比很小。先量，再优化。" />
    </Section>
  </DocPage>
));
