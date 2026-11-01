/** 最佳实践与常见问题 */
import { _component } from '@zerodep-dev/vue-tsx-pro-tsx';
import { CodeBlock } from '@zerodep-dev/vue-tsx-pro-ui';
import { DocPage, P, Points, Section, SimpleTable, Sub } from '../../site/content';

const brand = `const Order = entity('t_order', {
  id: col.bigint().primaryKey().generated().brand<'OrderId'>(),
  customerId: col.bigint().brand<'CustomerId'>(),
});

db.queryable(Order).where((o) => o.customerId.eq(orderId)); // 类型错误：OrderId 不是 CustomerId`;

const modules = `// 大项目按模块各写一份 defineSchema，模块之间互不 import，在入口合成一份
export const schema = mergeSchemas([accounts, content], {
  Post: (r) => ({ author: r.one('User', { from: 'userId', to: 'id' }) }),
});`;

const shared = `// 只依赖几列的通用条件：任何有这些列的实体都能 apply，实体缺列是类型错误
const ofTenant = defineScope<{ tenantId: number }, [tenantId: number]>(
  (row, id) => row.tenantId.eq(id),
);

await db.queryable(Order).apply(ofTenant, 7).toList();`;

export default _component(() => () => (
  <DocPage>
    <Section id="entity" title="实体怎么设计">
      <Points
        items={[
          '能非空的列就声明非空：结果类型跟着收窄，少写很多判空。',
          '关系都声明上，哪怕暂时只用一个方向：查询里的 join 与子查询靠它省掉。',
          '`required: true` 只给外键确实必有值的多对一：它会变成 INNER JOIN，结果类型不可空。',
        ]}
      />
      <Sub id="brand" title="主键带品牌" />
      <P text="不同表的 id 都是数字，传错了编译器看不出来。带上品牌，传错就是类型错误。" />
      <CodeBlock code={brand} lang="ts" />
      <Sub id="modules" title="按模块组合 schema" />
      <CodeBlock code={modules} lang="ts" />
      <Sub id="scope" title="复用条件" />
      <CodeBlock code={shared} lang="ts" />
    </Section>
    <Section id="choose" title="什么时候用什么写法">
      <Points
        items={[
          '要关联表的字段：先用导航，不用手写 join。只有导航表达不了的条件才用 `innerJoin`、`leftJoin`。',
          '要子表的统计：先用 `count`、`sum`；同一导航上聚合多了换 `groupJoin()`。',
          '要子表的明细：用 `toList`，不要在循环里查。',
          '列表页：用 `table`，别自己解析页码和排序。',
          '多条写入要么都成功要么都失败：放进 `transaction`；发邮件、发消息放进 `afterCommit`。',
          '状态流转：`where` 里带上当前状态，再加 `expectRows(1)`，比先查再改可靠。',
        ]}
      />
    </Section>
    <Section id="errors" title="错误怎么处理">
      <SimpleTable
        head={['错误', '什么时候', '怎么办']}
        rows={[
          ['`NotFoundError`', '`findOrThrow` 找不到', '接口层翻译成 404'],
          ['`optimistic lock failed`', '带版本的写入没改到行', '提示刷新后重试，或重读再试一次'],
          ['`expectRows` 给的错误', '改到的行数不对', '自己抛业务错误，事务回滚'],
          ['`TimeoutError`', '`withTimeout` 到点', '语句已被取消，按超时处理'],
          ['信号的 `reason`', '`withSignal` 取消', '客户端断开时通常不用处理'],
          [
            '渲染时的 `... is not supported by ...`',
            '方言不支持这种写法',
            '开发阶段就会碰到，换写法或换方言',
          ],
          ['`the query returned more than N rows`', '超过 `maxRows`', '加分页或改 `stream`'],
          ['驱动的错误', '唯一约束、外键、断连', '原样抛出，按驱动的错误码判断'],
        ]}
      />
      <P text="错误都原样抛给调用方，不吞错。事务里抛错就回滚；`onExecute` 的 `error` 能看到失败的语句，错误仍会照常抛出。" />
    </Section>
    <Section id="faq" title="常见问题">
      <Sub id="faq-select" title="为什么结果里的类型是 string | null？" />
      <P text="经可空的导航取到的列都可能是空：`u.company.name` 在用户没有公司时是 null，这是 LEFT JOIN 的真实结果。关系声明 `required: true`，或在 `where` 里排除空值之后取值。" />
      <Sub id="faq-n1" title="toList 会有 N+1 吗？" />
      <P text="不会。每一层一条语句，用 `IN` 一次取回所有子行，再在内存里拼。可以打开任何一张卡片看实际的 SQL。" />
      <Sub id="faq-orm" title="能看到实际执行的 SQL 吗？" />
      <P text="`createDb` 的 `log` 选项拿到每条语句和参数，`q.toSQL()` 只渲染不执行。开发环境用 `queryWatch` 抓 N+1 和慢查询。" />
      <Sub id="faq-browser" title="能在浏览器里用吗？" />
      <P text="能。核心不依赖 Node 专有接口，配 PGlite 或 SQLite WASM 就能跑，本站的“运行”按钮就是这么做的。" />
      <Sub id="faq-java" title="和 Java 版的差别？" />
      <P text="能力对齐，写法不同：没有注解和代码生成，形状就是类型；查询对象不可变，可以直接复用；分表的跨表查询交给库的 UNION ALL，不在内存里归并。" />
    </Section>
  </DocPage>
));
