/** 自动填充：默认值、更新时填值、只插入 */
import { _component } from '@zerodep-dev/vue-tsx-pro-tsx';
import { CodeBlock } from '@zerodep-dev/vue-tsx-pro-ui';
import { DocPage, Note, P, Section, SimpleTable } from '../../site/content';
import { SqlExample } from '../../site/SqlExample';
import { insertDefaults, insertOnlyBlocked, onUpdateFills, touchFills } from './rules.examples.ts';

const declare = `const Doc = entity('t_doc', {
  id: col.uuid().primaryKey().$default(uuidv7),      // 插入时没给就生成
  title: col.string(100),
  status: col.string(10).dbDefault("'draft'"),       // 库里的默认值
  createdAt: col.datetime().$default(() => new Date()),
  createdBy: col.string(50).insertOnly(),            // 更新永远不碰
  updatedAt: col.datetime().nullable().$onUpdate(() => new Date()), // 更新时没给就填
  deletedBy: col.string(50).nullable().$onDelete(() => currentUser()), // 逻辑删除时写入
});`;

const fromSql = `// $default 也可以返回 sql 片段：在库里算
createdAt: col.datetime().$default(() => sql<Date>\`CURRENT_TIMESTAMP\`),`;

const touchExample = `import { touch } from '@zerodep-dev/easy-query-ts';

const db = createDb({
  schema,
  adapter,
  // 所有有这一列的实体，插入和更新时写入；已显式给值时不覆盖
  interceptors: [touch('updatedAt'), touch('updatedBy', () => request.get().userId)],
});`;

export default _component(() => () => (
  <DocPage>
    <Section id="overview" title="声明在列上">
      <CodeBlock code={declare} lang="ts" />
      <SimpleTable
        head={['写法', '什么时候', '插入时可省']}
        rows={[
          ['`$default(fn)`', '插入时没给就调用，在应用里算', '是'],
          ['`dbDefault(sql)`', '建表时写 DEFAULT，由库填', '是'],
          ['`defaulted()`', '库里已有默认值，只告诉类型', '是'],
          ['`$onUpdate(fn)`', '更新时没给就调用', '-'],
          ['`$onDelete(fn)`', '逻辑删除时写入，物理删除不写', '-'],
          ['`insertOnly()`', '`set` 里赋值报错，`entity(row)` 自动跳过', '-'],
          ['`touch(列, fn?)`', '拦截器：所有有这一列的实体', '-'],
        ]}
      />
    </Section>
    <Section id="insert" title="插入时">
      <P text="`returnEntity` 拿回来的行里，默认值都在。`$default` 只算一次，插入和回查用同一份。" />
      <SqlExample example={insertDefaults} title="只给必填的列" />
      <CodeBlock code={fromSql} lang="ts" />
    </Section>
    <Section id="update" title="更新时">
      <P text="看 SQL 一栏：`updated_at` 自动带上了。示例模型把时间固定成了一个值，方便比较。" />
      <SqlExample example={onUpdateFills} title="$onUpdate 填更新时间" />
    </Section>
    <Section id="insert-only" title="只插入的列">
      <P text="创建人、创建时间不该被改。`set` 里给它赋值报错；`entity(row)` 自动跳过，就算行里的值变了。" />
      <SqlExample example={insertOnlyBlocked} title="SQL 里没有 created_by" />
    </Section>
    <Section id="touch" title="统一填：touch">
      <P text="很多实体都有的更新时间、操作人，不想每个实体写一遍时用 `touch`。它是拦截器，单条语句可以 `noInterceptor('touch:列名')`。" />
      <CodeBlock code={touchExample} lang="ts" />
      <SqlExample example={touchFills} title="工单的 touchedAt 自动填上了" />
      <Note text="`$default` 这些由内置的 `defaults` 拦截器执行。表达式更新也会补 `$onUpdate`；`fromQuery` 不经过，要自己在 `select` 里给。" />
    </Section>
  </DocPage>
));
