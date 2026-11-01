/** 函数：写在列上，按方言渲染 */
import { _component } from '@zerodep-dev/vue-tsx-pro-tsx';
import { DocPage, P, Points, Section, SimpleTable } from '../../site/content';
import { SqlExample } from '../../site/SqlExample';
import {
  conditions,
  dateMath,
  dates,
  groupByMonth,
  money,
  nullable,
  numbers,
  strings,
  substring,
  upperLength,
} from './func.examples.ts';

export default _component(() => () => (
  <DocPage>
    <Section id="strings" title="字符串">
      <P text="函数是表达式上的方法，参数可以是值也可以是别的列，返回的表达式带类型，可空性跟着输入走。各库写法的差异由方言处理：切换方言，看 `||` 和 `CONCAT`、`SUBSTR` 和 `SUBSTRING` 怎么变。" />
      <SqlExample example={upperLength} title="长度" />
      <SqlExample example={strings} title="截取、拼接、替换" />
      <SqlExample example={substring} title="子串、查找、补齐" />
    </Section>
    <Section id="dates" title="日期">
      <SqlExample example={dates} title="取年月、格式化" />
      <SqlExample example={dateMath} title="差几天、加几个月" />
      <SqlExample example={groupByMonth} title="按月统计订单" />
    </Section>
    <Section id="numbers" title="数字">
      <SqlExample example={numbers} title="除法、四舍五入、取大取小" />
      <P text="小数列是文字（不丢精度），能和数字、整数列运算：单价乘数量不用转换。" />
      <SqlExample example={money} title="金额：小计、打九折" />
    </Section>
    <Section id="nullable" title="空值与条件">
      <P text="`orElse` 是 COALESCE，用过之后类型不再可空；`nullIf` 相等时得 NULL。" />
      <SqlExample example={nullable} title="空值处理" />
      <SqlExample example={conditions} title="CASE：按点赞数分级、判断是不是回复" />
    </Section>
    <Section id="families" title="函数一览">
      <SimpleTable
        head={['分类', '函数']}
        rows={[
          [
            '字符串',
            '`upper`、`lower`、`trim`、`ltrim`、`rtrim`、`length`、`concat`、`substring`、`replace`、`indexOf`、`left`、`right`、`padStart`、`padEnd`、`text` 模板、`like` 家族、`matches`（正则）',
          ],
          [
            '日期',
            '`year` … `second`、`dayOfWeek`、`dayOfYear`、`format`、`add`、`addYears`、`addMonths`、`addDays` …、`diff`、`dateTrunc`、`now`、`utcNow`',
          ],
          [
            '数学',
            '`plus`、`minus`、`times`、`div`、`abs`、`floor`、`ceil`、`round`、`truncate`、`mod`、`power`、`sqrt`、`exp`、`log`、`sign`、三角函数',
          ],
          ['条件', '`orElse`、`nullIf`、`caseWhen`、`greatest`、`least`'],
          [
            '转换',
            "`cast('string' | 'int' | 'bigint' | 'double' | 'decimal' | 'date' | 'datetime')`",
          ],
          [
            'JSON',
            '`json`、`jsonText`、`jsonNumber`、`jsonBoolean`、`jsonHas`、`jsonLength`，更新用 `jsonSet`、`jsonRemove`、`jsonMerge`、`jsonAppend`',
          ],
          ['聚合', '`count`、`sum`、`avg`、`max`、`min`、`joining`（字符串聚合）'],
          [
            '窗口',
            '`rowNumber`、`rank`、`denseRank`、`sum` / `avg` / `count` over、`lag`、`lead`、`firstValue`、`lastValue`、`nthValue`',
          ],
        ]}
      />
      <Points
        items={[
          '下标一律按 JS 的习惯：从 0 起，`substring(start, end)` 左闭右开。',
          '对字符串列调数学函数、对数字列调字符串函数都是编译错误。',
        ]}
      />
    </Section>
    <Section id="dialect" title="方言专属函数">
      <P text="专属函数从方言入口包装列：`Pg.jsonb(u.attrs).hasKey(...)`、`MySQL.match(u.name).against(...)`、`MsSql.contains(...)`。用到别的方言上，渲染时报出是哪个函数、哪个方言不支持。库里有、这里没有的函数用 `sql` 模板写片段。" />
    </Section>
  </DocPage>
));
