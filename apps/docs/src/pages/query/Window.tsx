/** 窗口函数 */
import { _component } from '@zerodep-dev/vue-tsx-pro-tsx';
import { DocPage, Note, P, Section, SimpleTable } from '../../site/content';
import { SqlExample } from '../../site/SqlExample';
import { ntile, rowNumber, topPerGroup, window } from './advanced.examples.ts';
import {
  firstLast,
  lagLead,
  movingAverage,
  rankCompare,
  runningTotal,
  shareOfTotal,
  topThreePerAuthor,
} from './analytics.examples.ts';

export default _component(() => () => (
  <DocPage>
    <Section id="basics" title="写法">
      <P text="窗口函数从 `win` 取，第二个参数描述窗口：`partitionBy` 分区、`orderBy` 排序、`rows`、`range` 指定范围。它不像 `groupBy` 那样把行折起来，每行都还在。" />
      <SqlExample example={rowNumber} title="全站排名" />
      <SimpleTable
        head={['函数', '含义']}
        rows={[
          ['`win.rowNumber`', '行号，同值也不同号'],
          ['`win.rank`', '排名，同值同号，后面跳号'],
          ['`win.denseRank`', '排名，同值同号，不跳号'],
          ['`win.ntile(n)`', '分成 n 等份，返回第几份'],
          ['`win.sum`、`avg`、`count`、`max`、`min`', '窗口里的聚合'],
          ['`win.lag`、`win.lead`', '前一行、后一行的值'],
          ['`win.firstValue`、`lastValue`、`nthValue`', '窗口里第一行、最后一行、第 n 行的值'],
        ]}
      />
    </Section>
    <Section id="rank" title="排名">
      <P text="三种排名的差别在同值上。下面按城市排序，同城的算同值。" />
      <SqlExample example={rankCompare} title="rowNumber、rank、denseRank" />
      <P text="`partitionBy` 让排名在每组里各算各的。" />
      <SqlExample example={window} title="分作者：排名、总阅读量、上一篇的阅读量" />
      <P text="`ntile` 把行分成几等份，算分位数、分档时用。" />
      <SqlExample example={ntile} title="按阅读量把帖子分成三档" />
    </Section>
    <Section id="top-n" title="每组取前几名">
      <P text="想按窗口函数的结果过滤，先 `asTable()` 变成派生表，外层再 `where`。这是“每组取前几名”的通用写法，各库都能跑。" />
      <SqlExample example={topPerGroup} title="每位作者阅读量最高的一篇" />
      <SqlExample example={topThreePerAuthor} title="每篇帖子点赞最多的两条评论" />
      <Note text="只是要给每个父行带上前几条子项时，`u.posts.orderBy(...).limit(n).toList()` 更短，见“对象树”。" />
    </Section>
    <Section id="totals" title="累计和占比">
      <P text="窗口有 `orderBy` 时默认从分区开头算到当前行，就是累计；没有 `orderBy` 时是整个分区，就是总数。" />
      <SqlExample example={runningTotal} title="累计订单数和总数" />
      <SqlExample example={shareOfTotal} title="作者总阅读量和全站总阅读量" />
      <P text="`rows` 指定范围：`{ preceding: n }`、`{ following: n }`、`currentRow`、`unboundedPreceding`、`unboundedFollowing`。" />
      <SqlExample example={movingAverage} title="移动平均：当前行和前两行" />
    </Section>
    <Section id="offset" title="前后行">
      <P text="`lag`、`lead` 取前后行的值，算环比、差值时用。第一行的 `lag` 是 null。" />
      <SqlExample example={lagLead} title="上一篇和下一篇的阅读量" />
      <P text="`lastValue` 要注意：有 `orderBy` 时默认的窗口只到当前行，取整个分区的最后一行要写明范围。" />
      <SqlExample example={firstLast} title="每位作者最好和最差的一篇" />
      <Note text="SQL Server 没有 `nthValue`，TDengine 没有窗口函数，渲染时报错并说明是哪个函数。" />
    </Section>
  </DocPage>
));
