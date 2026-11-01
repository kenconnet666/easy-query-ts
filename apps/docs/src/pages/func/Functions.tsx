/** 函数：写在列上，按方言渲染 */
import { _component } from '@zerodep-dev/vue-tsx-pro-tsx';
import { DocPage, P, Section, SimpleTable } from '../../site/content';
import { SqlExample } from '../../site/SqlExample';
import { dates, nullable, numbers, strings } from './func.examples.ts';

export default _component(() => () => (
  <DocPage>
    <Section id="columns" title="写在列上">
      <P text="函数是表达式上的方法，参数可以是值也可以是别的列，返回的表达式带类型，可空性跟着输入走。各库写法的差异由方言处理：切换方言，看 `||` 和 `CONCAT`、日期加减怎么变。" />
      <SqlExample example={strings} title="字符串" />
      <SqlExample example={dates} title="日期" />
      <SqlExample example={numbers} title="数字" />
      <SqlExample example={nullable} title="空值：orElse" />
    </Section>
    <Section id="families" title="覆盖的函数族">
      <SimpleTable
        head={['分类', '函数']}
        rows={[
          [
            '字符串',
            '`upper`、`lower`、`trim`、`length`、`concat`、`substring`、`replace`、`indexOf`、`left`、`right`、`padStart`、`padEnd`、`text` 模板、`like` 家族',
          ],
          [
            '日期',
            '`year` … `second`、`dayOfWeek`、`dayOfYear`、`format`、`add`、`addYears` …、`diff`、`dateTrunc`、`now`、`utcNow`',
          ],
          [
            '数学',
            '`abs`、`floor`、`ceil`、`round`、`truncate`、`mod`、`power`、`sqrt`、`exp`、`log`、`sign`、三角函数、加减乘除',
          ],
          ['条件', '`orElse`、`nullIf`、`caseWhen`、`greatest`、`least`'],
          [
            'JSON',
            '`json`、`jsonText`、`jsonNumber`、`jsonBoolean`、`jsonHas`、`jsonLength`，更新用 `jsonSet`、`jsonRemove`、`jsonMerge`、`jsonAppend`',
          ],
          [
            '窗口',
            '`rowNumber`、`rank`、`denseRank`、`sum` / `avg` / `count` over、`lag`、`lead`、`firstValue`、`lastValue`、`nthValue`',
          ],
        ]}
      />
    </Section>
    <Section id="dialect" title="方言专属函数">
      <P text="专属函数从方言入口包装列：`Pg.jsonb(u.attrs).hasKey(...)`、`MySQL.match(u.name).against(...)`、`MsSql.contains(...)`。用到别的方言上，渲染时报出是哪个函数、哪个方言不支持。库里有、这里没有的函数用 `sql` 模板写片段。" />
    </Section>
  </DocPage>
));
