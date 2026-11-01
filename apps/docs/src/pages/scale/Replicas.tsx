/** 读写分离与只读 Db */
import { _component } from '@zerodep-dev/vue-tsx-pro-tsx';
import { CodeBlock } from '@zerodep-dev/vue-tsx-pro-ui';
import { DocPage, Note, P, Points, Section, SimpleTable } from '../../site/content';

const replicas = `const db = createDb({
  schema,
  adapter: mysql(primaryPool),
  replicas: [mysql(replicaPool1), mysql(replicaPool2)],
});

await db.queryable(Order).toList(); // 从库，轮询
await db.update(Order).set({ state: 'paid' }).where((o) => o.id.eq(id)).execute(); // 主库
await db.usePrimary().queryable(Order).find(id); // 刚写完就要读到：这段读走主库`;

const readonly = `const reader = createDb({ schema, adapter: replica }).readonly();

await reader.queryable(Order).toList(); // 照常
await reader.transaction(async (tx) => tx.queryable(Order).count()); // 读一致的快照，照常
reader.insert(Order); // 类型错误：'error: this Db does not support': "write"
reader.queryable(Order).forUpdate(); // 类型错误：加锁也算写`;

const inject = `// 只读接口只拿到只读的 Db：写入在编译时就过不了
function reportRoutes(db: ReturnType<typeof openReader>) {
  app.get('/report', async () => db.queryable(Order).sum((o) => o.amount));
}`;

export default _component(() => () => (
  <DocPage>
    <Section id="replicas" title="读写分离">
      <P text="`replicas` 给从库的 adapter，同一种库。事务外的读按轮询走从库，其余走主库。" />
      <CodeBlock code={replicas} lang="ts" />
      <SimpleTable
        head={['语句', '走哪里']}
        rows={[
          ['事务外的查询', '从库，轮询'],
          ['写入，含 RETURNING、`returnEntity` 的回查', '主库'],
          ['事务里的一切', '主库'],
          ['`introspect`、`syncTables`', '主库'],
          ['`usePrimary()` 之后的查询', '主库'],
          ['`db.sql` 的查询', '从库；写语句带 RETURNING 时先 `usePrimary()`'],
        ]}
      />
      <Note text="从库延迟由库自己负责，库层不做“写后读”的自动粘连：要读到刚写的数据，明确用 `usePrimary()`。" />
    </Section>
    <Section id="readonly" title="只读 Db">
      <P text="报表、只读接口、只连从库的服务不该有写入。`db.readonly()` 在类型上去掉写入、DDL、迁移和加锁，派生出来的 Db（`withSignal`、`usePrimary`、`with`、事务里的 `tx`）仍是只读的。" />
      <CodeBlock code={readonly} lang="ts" />
      <CodeBlock code={inject} lang="ts" />
      <Points
        items={[
          '运行时兜底：断言掉类型、从 JS 调用时，写入、DDL 直接报错 `this Db is read-only`。',
          '`db.sql.execute` 在类型上不受限，只在运行时报错。',
          '原来的 Db 不受影响；`readonly()` 管的是“这段代码能不能写”，`replicas` 管的是“读走哪里”。',
        ]}
      />
    </Section>
  </DocPage>
));
