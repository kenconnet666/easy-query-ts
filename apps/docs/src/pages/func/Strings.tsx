/** 字符串函数 */
import { _component } from '@zerodep-dev/vue-tsx-pro-tsx';
import { DocPage, Note, P, Section, SimpleTable } from '../../site/content';
import { SqlExample } from '../../site/SqlExample';
import { strings, substring, upperLength } from './func.examples.ts';
import {
  caseAndTrim,
  concatValues,
  leftRight,
  lengthFilter,
  padAndReplace,
  searchInText,
} from './functions.examples.ts';

export default _component(() => () => (
  <DocPage>
    <Section id="list" title="一览">
      <SimpleTable
        head={['方法', '含义']}
        rows={[
          ['`upper()`、`lower()`', '大小写'],
          ['`trim()`、`ltrim()`、`rtrim()`', '去空白'],
          ['`length()`', '字符数，各库都按字符算'],
          ['`concat(...)`', '拼接；参数可以是值或列，为 NULL 的项当空串'],
          ['`text` 模板', '拼接的另一种写法，读起来更清楚'],
          ['`substring(起, 止)`', '子串，从 0 起，左闭右开'],
          ['`left(n)`、`right(n)`', '开头、结尾的 n 个字符'],
          ['`indexOf(文字)`', '第一次出现的位置，从 0 起，没有时是 -1'],
          ['`replace(旧, 新)`', '替换'],
          ['`padStart(n, 文字)`、`padEnd`', '补齐；和 `LPAD` 一样，超长时截断'],
        ]}
      />
    </Section>
    <Section id="basic" title="大小写、长度">
      <SqlExample example={upperLength} title="长度" />
      <SqlExample example={caseAndTrim} title="大小写和去空白" />
      <P text="函数的结果还是表达式，条件、排序里都能用。" />
      <SqlExample example={lengthFilter} title="长评论，按长度排序" />
    </Section>
    <Section id="concat" title="拼接">
      <P text="切到 MySQL、SQL Server 看：`||`、`CONCAT`、`+` 由方言选。为 NULL 的项当空串，各库结果一致；想让 NULL 传下去用 `caseWhen`。" />
      <SqlExample example={concatValues} title="concat 和 text 模板" />
      <SqlExample example={strings} title="截取、拼接、替换" />
    </Section>
    <Section id="sub" title="截取和查找">
      <SqlExample example={leftRight} title="开头、结尾、子串" />
      <SqlExample example={substring} title="子串、查找、补齐" />
      <SqlExample example={searchInText} title="包含“的”的标题和它的位置" />
      <SqlExample example={padAndReplace} title="订单号补零，名字里的字替换掉" />
      <Note text="只是判断包含时用 `like`，它会处理通配符的转义，见“条件”。" />
    </Section>
  </DocPage>
));
