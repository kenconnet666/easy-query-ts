/** 列规则与拦截器：逻辑删除、乐观锁、多租户、审计 */
import { _component } from '@zerodep-dev/vue-tsx-pro-tsx';
import { CodeBlock } from '@zerodep-dev/vue-tsx-pro-ui';
import { DocPage, Note, P, Points, Section, SimpleTable } from '../../site/content';
import { SqlExample } from '../../site/SqlExample';
import {
  conflict,
  hardDelete,
  optimistic,
  seeDeleted,
  softDelete,
  softRead,
} from './rules.examples.ts';

const declare = `const Doc = entity('t_doc', {
  id: col.bigint().primaryKey().generated(),
  title: col.string(100),
  deleted: col.boolean().softDelete(),     // 逻辑删除
  version: col.int().version(),            // 乐观锁
  createdBy: col.string(50).insertOnly(),  // 更新永远不碰
  updatedAt: col.datetime().nullable().$onUpdate(() => new Date()), // 更新时没给就填
});`;

const tenant = `import { requestContext } from '@zerodep-dev/easy-query-ts/context';

const request = requestContext<{ tenantId: number }>();

const db = createDb({
  schema,
  adapter,
  // 读、改、删自动带上当前租户的条件，导航、子查询、toList 的第二条查询都带
  interceptors: [tenant('tenantId', () => request.get().tenantId)],
});

// 请求进来时把租户放进上下文
app.use((req, res, next) => request.run({ tenantId: req.tenantId }, next));

// 管理员接口整段关掉
const admin = db.withInterceptors({ skip: ['tenant'] });`;

const audit = `declare module '@zerodep-dev/easy-query-ts' {
  interface InterceptorNames {
    audit: true; // 登记名字：noInterceptor('audit') 写错了编译不过
  }
}

const audit: Interceptor = {
  name: 'audit',
  // 需要改之前的行时声明 before：只有这些实体多读一次
  before: (entity) => entity.table === 't_post',
  afterWrite(event) {
    // event.kind 区分 insert / update / delete，event.rows、event.before 带着数据
    event.afterCommit(() => log.info(event.kind, event.entity.table));
  },
};`;

export default _component(() => () => (
  <DocPage>
    <Section id="declare" title="声明在列上">
      <P text="这些规则同时写运行时行为和 TS 类型，对应 Java 版的注解。下面的例子都用模型里的这张表。" />
      <CodeBlock code={declare} lang="ts" title="model.ts" />
      <SimpleTable
        head={['修饰器', '行为']}
        rows={[
          ['`softDelete()`', '删除变成更新；读、改、删自动过滤已删除的行'],
          ['`version()`', '乐观锁：带版本条件更新，并写入下一个版本'],
          ['`insertOnly()`', '`set` 里给它赋值报错'],
          ['`$default(fn)`', '插入时没给值就调用'],
          ['`$onUpdate(fn)`', '更新时没给值就调用'],
          ['`encrypted(...)`', '写入前加密、读出后解密'],
          ['`col.enum([...])`', '类型是字面量联合，写入、读出都校验'],
        ]}
      />
    </Section>
    <Section id="soft-delete" title="逻辑删除">
      <P text="查询自动带上“没删除”的条件，导航、子查询、中间表也带。" />
      <SqlExample example={softRead} title="读：自动过滤" />
      <SqlExample example={softDelete} title="删：变成 UPDATE" />
      <P text="要看已删除的数据用 `noInterceptor`；真的要从库里删掉用 `hard()`。" />
      <SqlExample example={seeDeleted} title="看到已删除的行" />
      <SqlExample example={hardDelete} title="物理删除" />
      <Points
        items={[
          '布尔列默认 `false`、`true`，整数列默认 `0`、`1`；别的类型显式给：`col.datetime().nullable().softDelete({ active: null, deleted: () => new Date() })`。',
          '删除人、删除时间用 `$onDelete(() => currentUser())`：逻辑删除时一并写入，物理删除不写。',
          '只在一个导航上看已删除的：`u.roles.noInterceptor("softDelete").any()`。',
          '`createDb({ hardDelete: "forbid" })`：没有逻辑删除列的实体 delete 要显式 `.hard()` 才执行，防止误删。',
        ]}
      />
    </Section>
    <Section id="version" title="乐观锁">
      <P text="`withVersion` 带上手里的版本：条件里比较版本，同时写入下一个版本。一行都没改到，说明被别人抢先了，直接抛错。" />
      <SqlExample example={optimistic} title="带版本更新" />
      <SqlExample example={conflict} title="版本过期时被拦下" />
      <Points
        items={[
          '`update(X).entity(row)`、`changes(before, after)` 也带版本条件。',
          '管理端的批量修正不想让别人的版本失效时，写 `.ignoreVersion()`。',
        ]}
      />
    </Section>
    <Section id="tenant" title="多租户">
      <P text="`tenant` 是内置的拦截器：查询、更新、删除自动带上当前租户，新增自动补上。当前租户放在请求上下文里，不用一层层传参。" />
      <CodeBlock code={tenant} lang="ts" />
      <Note text="这一段要一个有租户列的模型和请求上下文，所以没做成能运行的卡片。" />
    </Section>
    <Section id="interceptor" title="自己写拦截器">
      <P text="拦截器可以加条件、在写入前改值、在写入后记审计。名字登记之后，开关 `{ use, skip }` 在语句、Db、导航、join 上都能用，写错名字编译不过。" />
      <CodeBlock code={audit} lang="ts" />
      <Points
        items={[
          '`afterWrite` 在 `insert`、`update`、`delete` 成功之后调用，和这条语句在同一个事务里；抛错会让写入失败、事务回滚，可以当否决用。',
          '声明 `before` 后，update、delete 执行前按同样的条件先读一次整行，放进 `event.before`，审计要前后对比时用。多一条查询，所以只在有声明时才读。',
          '`event.afterCommit(task)` 登记提交之后做的事；不在事务里时在这条语句之后马上做。',
          '单条语句上用 `noInterceptor(name)`、`useInterceptor(name)`、`interceptors({ use, skip })` 开关，`db.withInterceptors` 管一段；join 的第三个参数管这张表。',
          '内置的 `tenant`（多租户）和 `touch`（写入时补时间、操作人）也是拦截器。',
        ]}
      />
    </Section>
  </DocPage>
));
