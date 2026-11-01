/** 排序与分页 */
import { _component } from '@zerodep-dev/vue-tsx-pro-tsx';
import { DocPage, Note, P, Points, Section } from '../../site/content';
import { SqlExample } from '../../site/SqlExample';
import {
  cursorPage,
  dynamicOrder,
  nullsLast,
  orderByCount,
  orderByExpression,
  orderByNavigation,
  pageBeyond,
  pageEmpty,
  pageWithNavigation,
  pageWithTree,
} from './basics.examples.ts';
import { limitOffset, sort, sortPage } from './query.examples.ts';

export default _component(() => () => (
  <DocPage>
    <Section id="order" title="排序">
      <P text="`orderBy` 可以返回一个数组，列本身就是升序，也可以写 `asc()`、`desc()`。" />
      <SqlExample example={sort} title="多列排序" />
      <P text="排序里能用导航，join 自动加上。" />
      <SqlExample example={orderByNavigation} title="按公司、再按阅读量" />
      <P text="也能按表达式，和按对多导航的聚合。" />
      <SqlExample example={orderByExpression} title="按库存总价值" />
      <SqlExample example={orderByCount} title="按粉丝数" />
      <P text="各库对 NULL 的排序位置不一样。要固定放在最后，先按 `isNull()` 排。" />
      <SqlExample example={nullsLast} title="NULL 放最后" />
      <P text="回调里就是普通代码，可以按条件选排序列。前端传字段名时别拼 SQL，用“列表页查询”的 `sortBy`，只认登记过的名字。" />
      <SqlExample example={dynamicOrder} title="按条件选排序" />
    </Section>
    <Section id="limit" title="取几行">
      <P text="分页的写法各库差别很大：PostgreSQL 是 LIMIT OFFSET，Oracle、SQL Server 是 OFFSET FETCH，切换方言看看。" />
      <SqlExample example={limitOffset} title="跳过 4 行取 3 行" />
    </Section>
    <Section id="to-page" title="toPage">
      <P text="`toPage` 先数总数，再取这一页，返回 `{ rows, total, page, size }`。页码从 1 开始。" />
      <SqlExample example={sortPage} title="第二页" />
      <P text="COUNT 语句会去掉用不到的 join 和排序。对象树的第二条查询也只查这一页的父行。" />
      <SqlExample example={pageWithNavigation} title="带导航列和子表统计" />
      <SqlExample example={pageWithTree} title="带对象树" />
      <P text="没有数据时不再发第二条查询；页码超出时 `rows` 是空的，`total` 照常。" />
      <SqlExample example={pageEmpty} title="没有数据" />
      <SqlExample example={pageBeyond} title="页码超出" />
    </Section>
    <Section id="cursor" title="深分页">
      <P text="OFFSET 越大，库要跳过的行越多。能接受“只能下一页”时，按主键游标翻页，翻多深都一样快。" />
      <SqlExample example={cursorPage} title="游标翻页" />
      <Points
        items={[
          '必须用偏移翻页时：`createDb({ reversePageAfter })`，偏移超过它、也超过总数一半时倒序取再翻回来。',
          '只翻页不改条件时，前端把总数带回来，`table` 不再数，见“列表页查询”。',
        ]}
      />
      <Note text="每页条数没有默认上限，由 `table` 限制（2000）。`createDb({ maxRows })` 防止没写 limit 的 `toList` 误拉整表。" />
    </Section>
  </DocPage>
));
