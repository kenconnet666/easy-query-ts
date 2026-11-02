/** 快速开始：先给一个能看到结果的例子，再说安装、定义实体，最后是建议引入的包（金额、日期、加密、缓存、命令行） */
import { _component } from '@zerodep-dev/vue-tsx-pro-tsx';
import { CodeBlock } from '@zerodep-dev/vue-tsx-pro-ui';
import { DocPage, Note, P, Points, Section, SimpleTable } from '../../site/content';
import { SqlExample } from '../../site/SqlExample';
import { firstQuery, tree } from './quick-start.examples.ts';

const install = `pnpm add @zerodep-dev/easy-query-ts @zerodep-dev/easy-query-ts-pg pg`;

const recommended = `# 涉及金额、日期的业务系统，建议一开始就装上
pnpm add @zerodep-dev/easy-query-ts-decimal decimal.js
pnpm add @zerodep-dev/easy-query-ts-date @internationalized/date`;

const decimalInstall = `import { Decimal } from 'decimal.js';
import { decimalJs } from '@zerodep-dev/easy-query-ts-decimal';

const Order = entity('t_order', {
  id: col.bigint().primaryKey().generated(),
  amount: decimalJs(12, 2), // 库里是 DECIMAL(12, 2)，读出来是 Decimal
});

await db.insert(Order).values({ amount: new Decimal('10.50') }).execute();

// 算术和聚合都认它，结果还是 Decimal
const total = await db.queryable(Order).sum((o) => o.amount); // Decimal | null
await db
  .update(Order)
  .set((o) => ({ amount: o.amount.times(2) }))
  .where((o) => o.amount.gt(new Decimal(5)))
  .execute();`;

const dateInstall = `import { parseDate } from '@internationalized/date';
import {
  calendarDate,
  calendarDateTime,
  timeOfDay,
  zonedDateTime,
} from '@zerodep-dev/easy-query-ts-date';

const Event = entity('t_event', {
  id: col.bigint().primaryKey().generated(),
  day: calendarDate(), // 生日、账期这样的“某一天”：没有时区
  startsAt: calendarDateTime(), // 墙上时间：开会时间这样不随时区变的
  createdAt: zonedDateTime('Asia/Shanghai'), // 确切的时刻：库里按 UTC 存，读出时换算到这个时区
  opensAt: timeOfDay(), // 每天的营业时间
});

await db
  .queryable(Event)
  .where((e) => e.day.ge(parseDate('2026-01-01')))
  .toList();`;

const cryptoInstall = `import { aesEncryption } from '@zerodep-dev/easy-query-ts-crypto';

const phone = aesEncryption({
  key: process.env.PHONE_KEY!,
  iv: process.env.PHONE_IV!,
  searchable: true, // 至少 4 个单位的搜索词能用 like、startsWith、endsWith
});

const User = entity('t_user', {
  id: col.bigint().primaryKey(),
  phone: col.string().encrypted(phone),
});`;

const define = `import { col, createDb, defineSchema, entity } from '@zerodep-dev/easy-query-ts';
import { postgres } from '@zerodep-dev/easy-query-ts-pg';
import pg from 'pg';

const User = entity('t_user', {
  id: col.bigint().primaryKey().generated(),
  name: col.string(50),
});
const Post = entity('t_post', {
  id: col.bigint().primaryKey().generated(),
  authorId: col.bigint(),
  title: col.string(100),
  views: col.int(),
});

const schema = defineSchema(
  { User, Post },
  {
    User: (r) => ({ posts: r.many('Post', { from: 'id', to: 'authorId' }) }),
    Post: (r) => ({ author: r.one('User', { from: 'authorId', to: 'id' }) }),
  },
);

export const db = createDb({ schema, adapter: postgres(new pg.Pool({ connectionString })) });`;

export default _component(() => () => (
  <DocPage>
    <Section id="try" title="先跑一条">
      <P text="这条查询没写 join，作者名经导航 `p.author.name` 取到。结果的类型是 `{ title: string; views: number; author: string | null }[]`，全由 `select` 推出，不用代码生成。点“运行”，它会在浏览器里的 PostgreSQL 上真的执行一遍；右上角可以换成别的数据库，看同一段代码生成的 SQL。" />
      <SqlExample example={firstQuery} title="阅读量过千的帖子和作者" />
      <P text="再复杂一点：筛选条件跨两层导航，结果是一棵对象树。" />
      <SqlExample example={tree} title="有热门帖子的公司，带上员工和各自的帖子数" />
    </Section>
    <Section id="install" title="安装">
      <P text="最少要装三个：核心包、一个方言包、方言对应的驱动。核心零依赖，驱动都是方言包的 peer 依赖，用哪个库才装哪个。各库的包名和驱动见“支持的数据库”。" />
      <CodeBlock code={install} lang="bash" />
      <P text="核心不依赖任何日期、小数库，默认的列类型只用 JS 自带的类型。业务里有金额和日期时，下面两个包能少踩很多坑，建议建表之前就定下来，之后再换要改实体和用到它们的代码。各包的用法在本页后面。" />
      <CodeBlock code={recommended} lang="bash" />
      <SimpleTable
        head={['包', '什么时候装', '解决什么', '还要装']}
        rows={[
          [
            '`-decimal`',
            '有金额、数量、费率，要做运算',
            '`decimalJs()` 读成 `Decimal`，运算不经过浮点',
            '`decimal.js`',
          ],
          [
            '`-date`',
            '有日期、时区、营业时间这类业务含义',
            '`calendarDate()` 等读成带语义的日期类型，不用 JS `Date` 猜时区',
            '`@internationalized/date`',
          ],
          [
            '`-crypto`',
            '手机号、证件号要加密存储',
            '现成的 AES、国密 SM4，密文还能搜索，能读 Java 版写的数据',
            '只能在 Node 里用',
          ],
          [
            '`-cache`',
            '读多写少，要二级缓存',
            '本机缓存和 Redis 接口，写入后自动失效',
            'Redis 驱动你自己接',
          ],
          ['`-cli`', '由库生成实体、做迁移、存 SQL 快照', '`eqts` 命令行', '放进开发依赖'],
        ]}
      />
    </Section>
    <Section id="define" title="定义实体，建 Db">
      <P text="实体就是列的声明，关系写在 `defineSchema` 的第二个参数里。不需要注解、不需要生成代理类。" />
      <CodeBlock code={define} lang="ts" title="db.ts" />
      <Note text="本站所有示例都用同一套模型：公司、用户、帖子、评论、标签。" />
    </Section>
    <Section id="decimal" title="金额：easy-query-ts-decimal">
      <P text="`col.decimal(10, 2)` 读出来是字符串，不丢精度但不能直接算；转成 `number` 一算就有尾差，`0.1 + 0.2` 不等于 `0.3`。用 `decimalJs()` 后，列的类型就是 `Decimal`：条件、更新、`sum`、`avg`、窗口函数都认它。" />
      <CodeBlock code={decimalInstall} lang="ts" title="decimalJs" />
      <Points
        items={[
          '读取一律先转文字再构造 `Decimal`，不管驱动把 DECIMAL 读成数字还是字符串，都不经过浮点。',
          '写入接受 `Decimal`，也接受 `times(2)` 这种运算里的数字和数值文字。',
          '`decimal.js` 是 peer 依赖，用你项目里的那一份。',
        ]}
      />
    </Section>

    <Section id="date" title="日期：easy-query-ts-date">
      <P text="JS 的 `Date` 只有一种含义：一个确切的时刻。把生日存成 `Date`，换个时区可能就差一天。这个包按业务含义分成四种，读写 `@internationalized/date` 的类型，`year()`、`month()`、`day()` 这些函数也认它们。" />
      <SimpleTable
        head={['列', 'JS 类型', '库里', '用在哪']}
        rows={[
          ['`calendarDate()`', '`CalendarDate`', '`DATE`', '生日、账期：没有时区的某一天'],
          [
            '`calendarDateTime()`',
            '`CalendarDateTime`',
            '无时区的日期时间',
            '排班、开会：墙上时间，不随时区变',
          ],
          [
            '`zonedDateTime(时区)`',
            '`ZonedDateTime`',
            '按 UTC 存时刻',
            '下单时间、日志：确切的时刻，读出时换算',
          ],
          ['`timeOfDay()`', '`Time`', '`TIME`', '营业时间：每天的某个时刻'],
        ]}
      />
      <CodeBlock code={dateInstall} lang="ts" title="四种日期列" />
      <Note text="组件库 `@zerodep-dev/vue-tsx-pro-ui` 的日期控件也用 `@internationalized/date`，前后端用同一套类型。" />
    </Section>

    <Section id="crypto" title="加密：easy-query-ts-crypto">
      <P text="核心的 `encrypted()` 只定义接口，这个包给现成的实现。用法和要注意的地方见“加密列”。" />
      <CodeBlock code={cryptoInstall} lang="ts" title="AES" />
    </Section>

    <Section id="others" title="缓存和命令行">
      <Points
        items={[
          '`-cache`：见“二级缓存”。包里不带 Redis 和消息队列的驱动，只给接口，接法有完整示例。',
          '`-cli`：`eqts pull` 由库生成实体，`eqts migrate` 生成和执行迁移，`eqts snapshot` 存 SQL 快照。见“迁移”和“测试”。',
        ]}
      />
    </Section>
    <Section id="next" title="接下来">
      <Points
        items={[
          '查询的写法看“基础查询”“条件”，每段代码都能运行。',
          '`toList`、`single`、`find`、`count`、`any`、`toPage`、`stream` 是终结方法，调用时才发 SQL。',
        ]}
      />
    </Section>
  </DocPage>
));
