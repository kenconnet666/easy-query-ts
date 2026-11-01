/** 对多：隐式子查询 */
import { _component } from '@zerodep-dev/vue-tsx-pro-tsx';
import { DocPage, Note, P, Section, SimpleTable } from '../../site/content';
import { SqlExample } from '../../site/SqlExample';
import {
  aggregateInWhere,
  allAggregates,
  allChildren,
  anyWithoutFilter,
  childOfChild,
  groupJoinWhere,
  joiningChildren,
  navigationInChild,
  noneWithFilter,
  whereThenAggregate,
} from './more.examples.ts';
import {
  aggregates,
  any,
  conditionalCount,
  countDistinctNav,
  fixedCondition,
  groupJoin,
  nestedAny,
  none,
  nthChild,
  nthInWhere,
} from './navigate.examples.ts';

export default _component(() => () => (
  <DocPage>
    <Section id="overview" title="一览">
      <P text="对多的导航不能直接点列（一个用户有好几篇帖子），要说清楚怎么用。不会把父行乘出好几倍。" />
      <SimpleTable
        head={['方法', 'SQL', '放在哪']}
        rows={[
          ['`any(条件?)`、`none(条件?)`', 'EXISTS、NOT EXISTS', '条件'],
          ['`all(条件)`', 'NOT EXISTS (不满足的)', '条件'],
          ['`count(条件?)`、`countDistinct(列)`', '相关子查询', '结果、条件、排序'],
          ['`sum`、`avg`、`max`、`min`、`joining`', '相关子查询', '结果、条件、排序'],
          ['`at(i)`', '标量子查询，取第 i 行', '结果、条件、排序'],
          ['`where(...)`、`orderBy(...)`、`limit(n)`', '给子查询加条件、排序', '接着调上面的方法'],
          ['`toList(...)`、`first(...)`', '第二条查询', '结果，见“对象树”'],
          ['`groupJoin()`', '分组后 LEFT JOIN', '结果，见下'],
        ]}
      />
    </Section>
    <Section id="exists" title="有没有">
      <SqlExample example={anyWithoutFilter} title="写过帖子的用户" />
      <SqlExample example={any} title="写过热门帖子的用户" />
      <SqlExample example={none} title="一篇帖子也没写的用户" />
      <SqlExample example={noneWithFilter} title="有帖子，但没有一篇过千" />
      <P text="`all` 是全部满足。没有子项时也成立，通常再加一个 `any`。" />
      <SqlExample example={allChildren} title="帖子都已发布的作者" />
      <P text="可以嵌套，一路穿过一对多和多对多；子查询里能用对一的导航。" />
      <SqlExample example={childOfChild} title="帖子下有 15 赞评论的作者" />
      <SqlExample example={nestedAny} title="有员工写过“架构”标签帖子的公司" />
      <SqlExample example={navigationInChild} title="有员工在后端组的公司" />
    </Section>
    <Section id="aggregate" title="统计">
      <SqlExample example={aggregates} title="阅读量最高的三位作者" />
      <SqlExample example={allAggregates} title="评论数、总赞、平均、最高、最低" />
      <P text="统计结果也能当条件。" />
      <SqlExample example={aggregateInWhere} title="总阅读量过 2000 的作者" />
      <P text="`count` 能带条件；别的聚合先 `where` 再调。" />
      <SqlExample example={conditionalCount} title="分别数已发布和草稿" />
      <SqlExample example={whereThenAggregate} title="过千的有几篇、已发布里最高多少" />
      <SqlExample example={countDistinctNav} title="countDistinct：写过几个分类" />
      <SqlExample example={joiningChildren} title="joining：标题连成一串" />
    </Section>
    <Section id="fixed" title="带固定条件的关系">
      <P text="`hotPosts` 声明时就带了 `views >= 1000`，用的时候不用再写。" />
      <SqlExample example={fixedCondition} title="热门帖子" />
    </Section>
    <Section id="nth" title="取第几个">
      <P text="`at(i)` 按排序取第几行，每一列是一条标量子查询，条件和结果里都能用；没有这一行时列为 NULL。对应 Java 版的 `element`。要整行或多列时用 `first`，见“对象树”。" />
      <SqlExample example={nthChild} title="阅读量最高那篇的标题" />
      <SqlExample example={nthInWhere} title="最高的一篇过了 2000 阅读的作者" />
    </Section>
    <Section id="group-join" title="子查询太多时：groupJoin">
      <P text="一个导航上要好几个聚合时，逐行子查询要跑好几遍。`groupJoin()` 改成先分组再 LEFT JOIN，一次算完，写法不变。同一个导航（含它的 `where`）上的几个聚合共用一个分组 join。" />
      <SqlExample example={groupJoin} title="一次算出帖子数和总阅读量" />
      <SqlExample example={groupJoinWhere} title="先过滤再分组" />
      <Note text="没有子项时 `count` 是 0，其余是 null，和子查询的写法一致。分组 join 是独立的语句，导航的 `where` 里不能引用外层的表。" />
    </Section>
  </DocPage>
));
