/** 函数总览：写在列上，按方言渲染 */
import { _component } from '@zerodep-dev/vue-tsx-pro-tsx';
import { CodeBlock } from '@zerodep-dev/vue-tsx-pro-ui';
import { DocPage, P, Points, Section, SimpleTable } from '../../site/content';
import { SqlExample } from '../../site/SqlExample';
import { strings } from './func.examples.ts';

const dialect = `import { Pg } from '@zerodep-dev/easy-query-ts-pg';
import { MySQL } from '@zerodep-dev/easy-query-ts-mysql';
import { MsSql } from '@zerodep-dev/easy-query-ts-mssql';

db.queryable(User).where((u) => Pg.jsonb(u.attrs).hasKey('vip'));
db.queryable(Post).where((p) => MySQL.match(p.title).against('缓存'));
db.queryable(Post).where((p) => MsSql.contains(p.title, '缓存'));`;

export default _component(() => () => (
  <DocPage>
    <Section id="how" title="函数怎么写">
      <P text="函数是表达式上的方法，参数可以是值也可以是别的列，返回的表达式带类型，可空性也跟着走。同一段代码按方言渲染成各库的写法，切换方言看看。" />
      <SqlExample example={strings} title="截取、拼接、替换" />
      <Points
        items={[
          '下标一律按 JS 的习惯：从 0 起，`substring(start, end)` 左闭右开。',
          '对字符串列调数学函数、对数字列调字符串函数都是编译错误。',
          '方言不支持的函数渲染时报错，说明是哪个函数、哪个方言，不会悄悄变成别的语义。',
        ]}
      />
    </Section>
    <Section id="families" title="函数一览">
      <SimpleTable
        head={['分类', '函数', '在哪一章']}
        rows={[
          [
            '字符串',
            '`upper`、`lower`、`trim`、`ltrim`、`rtrim`、`length`、`concat`、`substring`、`replace`、`indexOf`、`left`、`right`、`padStart`、`padEnd`、`text` 模板',
            '字符串函数',
          ],
          [
            '日期',
            '`year` … `second`、`dayOfWeek`、`isoDayOfWeek`、`dayOfYear`、`format`、`add`、`addYears` … `addSeconds`、`diff`、`diffDays`、`dateTrunc`、`now`',
            '日期与时间函数',
          ],
          [
            '数学',
            '`plus`、`minus`、`times`、`div`、`abs`、`floor`、`ceil`、`round`、`truncate`、`mod`、`power`、`sqrt`、`exp`、`ln`、`log`、`log10`、`sign`、`sin`、`cos`、`tan`、`asin`、`acos`、`atan`、`atan2`、`greatest`、`least`',
            '数字函数',
          ],
          ['空值与条件', '`orElse`、`nullIf`、`caseWhen`、`compare`、`cast`', '空值与条件'],
          [
            'JSON',
            '`json`、`jsonText`、`jsonNumber`、`jsonBoolean`、`jsonHas`、`jsonLength`、`jsonSome`、`jsonSet`、`jsonRemove`、`jsonMerge`、`jsonAppend`',
            'JSON 列',
          ],
          [
            '聚合',
            '`count`、`countDistinct`、`sum`、`avg`、`max`、`min`、`joining`、`grouping`',
            '分组与聚合',
          ],
          [
            '窗口',
            '`rowNumber`、`rank`、`denseRank`、`ntile`、`sum` 等、`lag`、`lead`、`firstValue`、`lastValue`、`nthValue`',
            '窗口函数',
          ],
        ]}
      />
    </Section>
    <Section id="dialect" title="方言专属函数">
      <P text="库的专有能力从方言入口包装列：用到别的方言上，渲染时报出是哪个函数、哪个方言不支持。完整列表见“方言专属函数”一章；库里有、这里没有的函数用 `sql` 模板写片段，见“原生 SQL”。" />
      <CodeBlock code={dialect} lang="ts" />
    </Section>
  </DocPage>
));
