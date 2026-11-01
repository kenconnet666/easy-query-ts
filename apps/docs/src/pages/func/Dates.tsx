/** 日期与时间函数 */
import { _component } from '@zerodep-dev/vue-tsx-pro-tsx';
import { DocPage, Note, P, Section, SimpleTable } from '../../site/content';
import { SqlExample } from '../../site/SqlExample';
import { dateMath, dates, groupByMonth } from './func.examples.ts';
import {
  dateAdd,
  dateBetweenColumns,
  dateCompare,
  dateDiff,
  dateFormat,
  dateParts,
  dateTruncate,
  pastOrders,
} from './functions.examples.ts';

export default _component(() => () => (
  <DocPage>
    <Section id="list" title="一览">
      <SimpleTable
        head={['方法', '含义']}
        rows={[
          ['`year()`、`month()`、`day()`', '年、月（1 起）、日'],
          ['`hour()`、`minute()`、`second()`', '时、分、秒，只有时间列能用'],
          ['`dayOfWeek()`、`isoDayOfWeek()`、`dayOfYear()`', '星期几、一年的第几天'],
          ['`format(模板)`', '`yyyy`、`MM`、`dd`、`HH`、`mm`、`ss`，各库的函数由方言选'],
          ['`addYears(n)` … `addSeconds(n)`、`add(n, 单位)`', '加减；n 可以是负数或一列'],
          [
            '`diff(另一个, 单位)`、`diffDays(另一个)`',
            '相差多少；单位是 day、hour、minute、second',
          ],
          ['`dateTrunc(单位)`', '截断到 year、quarter、month、week、day、hour、minute、second'],
          ['`now()`', '当前时间，从包里导入'],
        ]}
      />
      <P text="这些方法只有日期时间列能调：普通字符串列调不了 `year()`，写错编译不过。" />
    </Section>
    <Section id="parts" title="取年月日">
      <SqlExample example={dateParts} title="各个部分" />
      <SqlExample example={dates} title="日期列：取年月、格式化" />
      <SqlExample example={groupByMonth} title="按月份分组" />
    </Section>
    <Section id="format" title="格式化">
      <SqlExample example={dateFormat} title="写成文字" />
      <Note text="结果是文字，展示用；排序、比较还是用原来的列，不然走不上索引。" />
    </Section>
    <Section id="math" title="加减和相差">
      <SqlExample example={dateAdd} title="加一天、一小时、一个月、一年" />
      <SqlExample example={dateMath} title="差几天、加几个月" />
      <SqlExample example={dateDiff} title="到某一天还有多久" />
    </Section>
    <Section id="compare" title="比较">
      <P text="参数直接给 `Date`，日期列给 `2026-01-02` 这样的文字，也能和别的列或算出来的值比较。" />
      <SqlExample example={dateCompare} title="某段时间内：左闭右开" />
      <SqlExample example={dateBetweenColumns} title="入职两年之后发的帖子" />
      <SqlExample example={pastOrders} title="now()：已经过去的订单" />
    </Section>
    <Section id="trunc" title="截断">
      <P text="`dateTrunc` 结果的类型和源列一样。MySQL 没有 DATE_TRUNC，用 DATE_FORMAT 取整再转回来；切换方言看看。" />
      <SqlExample example={dateTruncate} title="截到月、日、小时" />
    </Section>
  </DocPage>
));
