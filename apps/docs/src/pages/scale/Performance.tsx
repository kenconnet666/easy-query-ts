/** 性能：先看 SQL，再按症状选写法 */
import { _component } from '@zerodep-dev/vue-tsx-pro-tsx';
import { CodeBlock } from '@zerodep-dev/vue-tsx-pro-ui';
import { DocPage, Note, P, Points, Section, SimpleTable, Sub } from '../../site/content';
import { SqlExample } from '../../site/SqlExample';
import { aggregates, groupJoin, limitPerParent, tree } from '../navigate/navigate.examples.ts';
import { prepare } from '../query/more.examples.ts';
import { batch } from '../write/write.examples.ts';
import { existsNotCount, pushDown, streamRows } from './scale.examples.ts';

const watch = `import { queryWatch } from '@zerodep-dev/easy-query-ts/observe';

// 开发环境：同一个请求里同一条读 SQL 执行到 5 次（N+1）、单条语句超过 200 毫秒，都报出来
const watch = queryWatch({ repeat: 5, slowMs: 200, explain: (s) => db.explain(s) });
const db = createDb({ schema, adapter, onExecute: dev ? [watch.onExecute] : [] });
app.use((req, res, next) => watch.run(next)); // 每个请求一个统计范围`;

const guards = `const db = createDb({
  schema,
  adapter,
  maxRows: 10_000,        // 没写 limit 的 toList 超过就报错，防止误拉整表；toPage、stream 不受限
  reversePageAfter: 5000, // 偏移超过它、也超过总数一半时倒序取，再翻回来
  statementTimeout: 30_000,
});`;

const stream = `for await (const order of db.queryable(Order).orderBy((o) => o.id).stream({ batchSize: 500 })) {
  await exportRow(order);
}`;

const bulk = `await db.insert(Event).values(rows).execute();
// 按方言的参数上限自动分块：SQLite 32766，MySQL、PG 65535
// PG：100 行起写成一条 INSERT ... SELECT * FROM unnest(...)，只解析一次，不受参数上限限制
// MySQL：再按 max_allowed_packet 的四分之三切，mysql.detect 读服务器的实际值`;

export default _component(() => () => (
  <DocPage>
    <Section id="start" title="先看 SQL">
      <P text="本站每张卡片都能直接看到生成的 SQL，项目里同样能看：`log` 打印每条语句，`toSQL` 只渲染不执行，`explain` 取执行计划。别猜，先看。" />
      <CodeBlock code={watch} lang="ts" />
      <SimpleTable
        head={['症状', '先试']}
        rows={[
          ['循环里逐个查', '`select` 里写 `toList`、`first`，或 `include`'],
          ['列表页每行几个统计，慢', '`groupJoin()`'],
          ['只判断有没有，却写了 count', '`any()`、`none()`'],
          ['只用几列，却取了整行', '`select` 只选用到的列'],
          ['翻到很后面的页很慢', '`reversePageAfter`，或按主键游标翻页'],
          ['导出、跑批内存爆', '`stream()`'],
          ['批量更新一条条发', '`entities(rows).batch()`'],
          ['大表清理锁太久', '`orderBy().limit(n)` 分批'],
          ['热点接口渲染 SQL 占比高', '`db.prepare`，先量再说'],
        ]}
      />
    </Section>
    <Section id="n-plus-one" title="N+1">
      <P text="对象树一层一条语句，第二条按外键 `IN` 一次取回所有子行，不会逐行查。看 SQL 一栏：三层就是三条语句。" />
      <SqlExample example={tree} title="三层结果，三条语句" />
      <P text="`limit` 是每个父行的条数，渲染成 ROW_NUMBER 分区，不会把所有子行读回来再截断。" />
      <SqlExample example={limitPerParent} title="每位作者最新的一篇" />
    </Section>
    <Section id="aggregate" title="子表统计">
      <P text="`u.posts.count()` 是每行一个相关子查询，行少时最好，也最直观。" />
      <SqlExample example={aggregates} title="相关子查询" />
      <P text="列表页行多、同一导航上好几个聚合时，换成 `groupJoin()`：子表先分组一次，再 LEFT JOIN 回来。写法只多一个调用，结果一样；没有子项时 `count` 是 0，其余是 null。" />
      <SqlExample example={groupJoin} title="分组后连接" />
      <P text="只判断有没有时用 `any`：EXISTS 找到第一行就停，不用数完。" />
      <SqlExample example={existsNotCount} title="EXISTS，不用 COUNT" />
    </Section>
    <Section id="derived" title="派生表的条件穿透">
      <P text="外层对派生表的条件，能推进去的自动推到子查询里，让库在子查询里就用上索引。看 SQL：`views >= 2000` 在里层。有窗口函数、分组、LIMIT 时语义会变，就不推。" />
      <SqlExample example={pushDown} title="条件推进子查询" />
    </Section>
    <Section id="big" title="大结果与大批量">
      <Sub id="stream" title="流式读取" />
      <P text="`stream` 不把整个结果集读进内存。MySQL 用结果流，中途 `break` 会销毁这条连接；PG 用服务端游标；SQLite 用 `iterate`；HANA 的驱动没有流，退化成一次读完再分批。不能和 `toList` 导航一起用。" />
      <SqlExample example={streamRows} title="读三行就停" />
      <CodeBlock code={stream} lang="ts" />
      <Sub id="bulk" title="批量写入" />
      <CodeBlock code={bulk} lang="ts" />
      <P text="`entities(rows).batch()` 把一批更新合成一条 CASE WHEN，一次往返，按参数上限切块。超长的 `in(...)` 列表没法这样拆，渲染时超过上限直接报错，分批查询。" />
      <SqlExample example={batch} title="批量更新" />
    </Section>
    <Section id="prepare" title="预编译">
      <P text="`db.prepare` 只渲染一次 SQL，之后每次只换参数。和一次网络往返比，渲染的开销很小，多数接口用不上。" />
      <SqlExample example={prepare} title="渲染一次，执行两次" />
    </Section>
    <Section id="guards" title="护栏">
      <CodeBlock code={guards} lang="ts" />
      <Points
        items={[
          '`maxRows` 超了报错，不悄悄截断。',
          '倒序取要有 `orderBy`；总数已知时用 `table` 带上 `total`，少一条 COUNT。',
          '`withTimeout` 到点取消单条语句，PG、MySQL 的驱动还会在服务端终止它。',
        ]}
      />
      <Note text="索引在实体的第三个参数里声明，见“实体与列”。读写分离见“读写分离与只读”，缓存见“二级缓存”。" />
    </Section>
  </DocPage>
));
