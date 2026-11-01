/** 数字函数 */
import { _component } from '@zerodep-dev/vue-tsx-pro-tsx';
import { DocPage, Note, P, Section, SimpleTable } from '../../site/content';
import { SqlExample } from '../../site/SqlExample';
import { money, numbers } from './func.examples.ts';
import {
  arithmetic,
  mathFunctions,
  minMaxColumns,
  percentage,
  rounding,
} from './functions.examples.ts';

export default _component(() => () => (
  <DocPage>
    <Section id="list" title="一览">
      <SimpleTable
        head={['方法', '含义']}
        rows={[
          ['`plus`、`minus`、`times`、`div`', '加减乘除；右边可以是数字或另一列'],
          ['`round(n)`、`floor()`、`ceil()`、`truncate(n)`', '取整；n 是小数位'],
          ['`abs()`、`sign()`、`mod(n)`', '绝对值、正负号、取余'],
          ['`power(n)`、`sqrt()`、`exp()`、`ln()`、`log(底)`、`log10()`', '幂、开方、对数'],
          ['`sin`、`cos`、`tan`、`asin`、`acos`、`atan`、`atan2`', '三角函数'],
          ['`greatest(...)`、`least(...)`', '几个值里取最大、最小，从包里导入；NULL 被忽略'],
        ]}
      />
    </Section>
    <Section id="arithmetic" title="四则运算">
      <P text="右边的类型由左边决定：整数列接数字；decimal 列接数值文字或数字；`bigint` 模式的列接 bigint，不把浮点数带进 64 位运算。" />
      <SqlExample example={arithmetic} title="加减乘除" />
      <SqlExample example={money} title="金额：小计、打九折" />
      <P text="除法的结果类型各库不一样：PostgreSQL 的整数相除还是整数。`percentage` 这种先乘再除。" />
      <SqlExample example={percentage} title="发布率：导航上的聚合也能算" />
    </Section>
    <Section id="round" title="取整">
      <SqlExample example={rounding} title="四舍五入、向下、向上" />
      <SqlExample example={numbers} title="除法、四舍五入、取大取小" />
    </Section>
    <Section id="math" title="数学函数">
      <SqlExample example={mathFunctions} title="绝对值、正负号、取余、幂、开方" />
    </Section>
    <Section id="min-max" title="取大取小">
      <P text="`greatest`、`least` 是一行里几个值比较；一列里多行比较用聚合的 `max`、`min`。" />
      <SqlExample example={minMaxColumns} title="至少 1000，至多 1000" />
      <Note text="SQL Server 2022 之前没有 GREATEST、LEAST，写成 VALUES 子查询；切换方言看看。" />
    </Section>
  </DocPage>
));
