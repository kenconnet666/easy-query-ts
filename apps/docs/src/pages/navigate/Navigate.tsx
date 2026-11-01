/** 导航：隐式 join、隐式子查询、多对多 */
import { _component } from '@zerodep-dev/vue-tsx-pro-tsx';
import { CodeBlock } from '@zerodep-dev/vue-tsx-pro-ui';
import { DocPage, P, Points, Section } from '../../site/content';
import { SqlExample } from '../../site/SqlExample';
import {
  aggregates,
  any,
  groupJoin,
  include,
  manyToMany,
  multiLevel,
  none,
} from './navigate.examples.ts';

const relations = `defineSchema({ User, Company, Post, Tag, PostTag }, {
  User: (r) => ({
    // 多对一；{ required: true } 时是 INNER JOIN，结果类型不可空
    company: r.one('Company', { from: 'companyId', to: 'id' }),
    // 一对多
    posts: r.many('Post', { from: 'id', to: 'authorId' }),
  }),
  Post: (r) => ({
    // 多对多：经中间表
    tags: r.manyToMany('Tag', { through: 'PostTag', throughFrom: 'postId', throughTo: 'tagId' }),
  }),
});`;

export default _component(() => () => (
  <DocPage>
    <Section id="relations" title="声明关系">
      <P text="关系写在 `defineSchema` 的第二个参数里，名字和类型都会带到查询上。复合外键把 `from`、`to` 写成数组；`r.path` 是直达关系（经过几层导航），`r.manyOn` 是任意条件的关系。" />
      <CodeBlock code={relations} lang="ts" title="schema.ts" />
    </Section>
    <Section id="join" title="对一：隐式 join">
      <P text="对一的导航直接点下去，能连续点好几层，条件、排序、结果里都能用。用到才 join，同一个导航只 join 一次。" />
      <SqlExample example={multiLevel} title="经两层导航筛选和取值" />
    </Section>
    <Section id="subquery" title="对多：隐式子查询">
      <Points
        items={[
          '`any`、`none`、`all` 生成 EXISTS，可以带条件。',
          '`count`、`sum`、`avg`、`max`、`min` 生成相关子查询，也能用来排序。',
        ]}
      />
      <SqlExample example={any} title="写过热门帖子的用户" />
      <SqlExample example={none} title="一篇帖子也没写的用户" />
      <SqlExample example={aggregates} title="阅读量最高的三位作者" />
    </Section>
    <Section id="group-join" title="子查询太多时：groupJoin">
      <P text="一个导航上要好几个聚合时，逐行子查询要跑好几遍。`groupJoin()` 改成先分组再 LEFT JOIN，一次算完，写法不变。" />
      <SqlExample example={groupJoin} title="一次算出帖子数和总阅读量" />
    </Section>
    <Section id="many-to-many" title="多对多">
      <P text="多对多和一对多的用法完全一样，中间表由框架 join。下面第二个例子从标签这边反过来查。" />
      <SqlExample example={manyToMany} title="打了“架构”标签的帖子和它们的全部标签" />
      <SqlExample example={include} title="每个标签下有多少帖子" />
    </Section>
  </DocPage>
));
