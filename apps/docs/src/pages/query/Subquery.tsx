/** 子查询、派生表与联合 */
import { _component } from '@zerodep-dev/vue-tsx-pro-tsx';
import { DocPage, Note, P, Points, Section } from '../../site/content';
import { SqlExample } from '../../site/SqlExample';
import { inSubquery, scalar, union } from './advanced.examples.ts';
import {
  derivedPage,
  limitThenSort,
  notInSubquery,
  scalarInSelect,
  subqueryWithNavigation,
  unionAllRows,
  unionPage,
} from './analytics.examples.ts';
import { joinSubquery } from './join.examples.ts';

export default _component(() => () => (
  <DocPage>
    <Section id="where" title="条件里的子查询">
      <P text="查询对象可以直接当子查询用：不执行，只把它放进外层。对多导航上的 `any`、`count` 也是子查询，写起来更短，能用就用，见“对多：隐式子查询”。" />
      <SqlExample example={inSubquery} title="IN：写过热门帖子的用户" />
      <SqlExample example={notInSubquery} title="NOT IN：没写过帖子的用户" />
      <SqlExample example={subqueryWithNavigation} title="子查询里也能用导航" />
      <Points
        items={[
          '`in` 的子查询必须只选一列，否则报错。',
          '它是独立的语句，不能引用外层的表；要相关子查询用对多导航。',
          '子查询里的租户、逻辑删除条件照常生效。',
        ]}
      />
    </Section>
    <Section id="scalar" title="标量子查询">
      <P text="一行一列的查询能当值用：放进比较、运算。" />
      <SqlExample example={scalar} title="阅读量高于平均的帖子" />
      <SqlExample example={scalarInSelect} title="和最高阅读量差多少" />
    </Section>
    <Section id="derived" title="派生表">
      <P text="`asTable()` 把这条查询的结果当一张表继续查：`FROM (子查询) t0`。用途是对窗口函数或分组的结果再过滤、先 `limit` 再排序。之后的 `where`、`orderBy`、`toPage`、`count` 都能用，列名就是 `select` 的键。" />
      <SqlExample example={derivedPage} title="按算出来的列过滤、分页" />
      <SqlExample example={limitThenSort} title="先取前三，再按升序排" />
      <Note text="派生表只有它自己的列，不能再 join 别的实体，要 join 用 CTE，或者反过来 join 这条子查询。" />
      <SqlExample example={joinSubquery} title="join 一条子查询" />
    </Section>
    <Section id="union" title="联合">
      <P text="`union` 去重，`unionAll` 不去重。两边按列名对齐，列顺序可以不同，形状由类型检查，对不上编译不过。" />
      <SqlExample example={union} title="未成年和四十岁以上的用户" />
      <P text="结果是一张派生表，能继续加条件、排序。下面把帖子和评论合成一个时间线。" />
      <SqlExample example={unionAllRows} title="某人写过的帖子和评论" />
      <SqlExample example={unionPage} title="联合之后分页" />
      <Note text="成员不能带 `orderBy`、`limit`、`offset`（SQLite 不允许成员加括号，各库语义也含糊），需要时先 `asTable()`。" />
    </Section>
  </DocPage>
));
