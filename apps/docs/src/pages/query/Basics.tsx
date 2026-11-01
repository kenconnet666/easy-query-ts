/** 查询：条件、排序与分页 */
import { _component } from '@zerodep-dev/vue-tsx-pro-tsx';
import { DocPage, P, Points, Section } from '../../site/content';
import { SqlExample } from '../../site/SqlExample';
import {
  dynamic,
  filter,
  implicitJoin,
  implicitSubquery,
  objectTree,
  orCondition,
  sortPage,
} from './query.examples.ts';

export default _component(() => () => (
  <DocPage>
    <Section id="where" title="条件">
      <P text="`where` 的回调拿到这张表的列，返回一个条件；数组就是 AND。列上的方法名就是比较方式，参数类型跟着列走，写错类型编译不过。" />
      <SqlExample example={filter} title="几个条件同时满足" />
      <SqlExample example={orCondition} title="或者：or(...)" />
    </Section>
    <Section id="dynamic" title="动态条件">
      <P text="页面上的筛选项多半是可选的。条件数组里的 `undefined`、`false`、空字符串都被跳过，用 `&&` 就够了，不用写一串 if。" />
      <SqlExample example={dynamic} title="没填的条件自动跳过" />
    </Section>
    <Section id="page" title="排序与分页">
      <P text="`orderBy` 可以返回一个数组；`toPage(页码, 每页条数)` 发两条语句：先数总数，再取这一页。" />
      <SqlExample example={sortPage} title="按阅读量排序，取第一页" />
    </Section>
    <Section id="implicit" title="导航：不用写 join">
      <Points
        items={[
          '对一的导航（`u.company`）生成 LEFT JOIN，用到才 join，同一个导航只 join 一次。',
          '对多的导航（`c.users`）生成子查询：`any` 是 EXISTS，`count` 是 COUNT。',
          '`toList` 带出一棵对象树：主查询之外再发一条按外键取子表的查询，没有 N+1。',
        ]}
      />
      <SqlExample example={implicitJoin} title="隐式 join" />
      <SqlExample example={implicitSubquery} title="隐式子查询" />
      <SqlExample example={objectTree} title="对象树结果" />
    </Section>
  </DocPage>
));
