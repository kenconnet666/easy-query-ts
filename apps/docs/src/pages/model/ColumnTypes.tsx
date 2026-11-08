/** 列类型：内置类型、精度、日期、JSON、PG 专属、扩展包、自定义类型 */
import { _component } from '@zerodep-dev/vue-tsx-pro-tsx';
import { CodeBlock } from '@zerodep-dev/vue-tsx-pro-ui';
import { DocPage, Note, P, Points, Section, SimpleTable } from '../../site/content';
import { SqlExample } from '../../site/SqlExample';
import {
  dateText,
  datetimeValue,
  decimalMath,
  decimalSum,
  enumValue,
  typeMapping,
} from './model.examples.ts';

const precise = `import { decimalJs } from '@zerodep-dev/easy-query-ts-decimal';
import {
  calendarDate,
  calendarDateTime,
  timeOfDay,
  zonedDateTime,
} from '@zerodep-dev/easy-query-ts-date';

const Order = entity('t_order', {
  id: col.bigint({ mode: 'bigint' }).primaryKey().generated(), // bigint：超过 2^53 也不丢精度
  amount: decimalJs(12, 2),                 // decimal.js 的 Decimal
  day: calendarDate(),                      // CalendarDate
  startsAt: calendarDateTime(),             // CalendarDateTime：没有时区的墙上时间
  paidAt: zonedDateTime('Asia/Shanghai'),   // ZonedDateTime：库里按 UTC 存时刻
  opensAt: timeOfDay(),                     // Time
  receipt: col.bytes(),                     // Uint8Array
});`;

const uuid = `import { uuidv7 } from '@zerodep-dev/easy-query-ts';

const Event = entity('t_event', {
  // v7 按时间有序，同一进程同一毫秒也单调递增：新行插在索引末尾
  id: col.uuid().primaryKey().$default(uuidv7),
  name: col.string(50),
});`;

const jsonSchema = `import { z } from 'zod'; // 或 valibot、arktype：任何实现了 Standard Schema 的校验器

const Prefs = z.object({ tags: z.array(z.string()), level: z.number().int().min(0) });

const Account = entity('t_account', {
  id: col.bigint().primaryKey().generated(),
  prefs: col.json(Prefs), // 行类型取自校验器：{ tags: string[]; level: number }
  extra: col.json<{ note?: string }>(), // 只写泛型：有类型，不做运行时校验
});`;

const pgOnly = `const Article = entity('t_article', {
  id: col.bigint().primaryKey().generated(),
  tags: col.array(col.string(30)),                    // VARCHAR(30)[]
  scores: col.array(col.int().nullable()),            // 元素可空
  ttl: col.interval(),                                // INTERVAL，读出 PG 的文字：'02:00:00'、'1 day'
  state: col.enum(['todo', 'done']).native('task_state'), // PG 的枚举类型；MySQL 是 ENUM(...)
});

db.queryable(Article).where((a) => [
  a.tags.has('sql'),                // 'sql' = ANY(tags)
  a.tags.hasAll(['sql', 'orm']),    // tags @> ...
  a.tags.hasAny(['vue', 'react']),  // tags && ...
  a.tags.arrayLength().gt(1),       // cardinality(tags)
]);`;

const custom = `import { col } from '@zerodep-dev/easy-query-ts';

// 1. 列工厂：kind 是读写口径（'decimal' 让 avg 保持这个类型），后两个函数是读和写
export const money = () =>
  col.custom<Money>(
    'decimal',
    (raw) => Money.parse(String(raw)),
    (value) => value.toFixed(),
  );

// 2. 可选：让算术、聚合认它。日期时间类型登记到 TemporalExtensions，year()、addDays() 就能用
declare module '@zerodep-dev/easy-query-ts' {
  interface NumericExtensions {
    money: Money;
  }
}`;

const sqlConvert = `// 在库里转换：like、排序、函数都能用。encrypted 在应用里加解密，库里只能等值比较
phone: col.string(100).sqlConvert({
  read: (column) => sql<string>\`AES_DECRYPT(\${column}, \${key})\`,
  write: (value) => sql<string>\`AES_ENCRYPT(\${value}, \${key})\`,
}),`;

export default _component(() => () => (
  <DocPage>
    <Section id="builtin" title="内置类型">
      <P text="列的种类决定三件事：TypeScript 里的类型、怎么读写、库里建成什么。下面这张表包含大部分内置类型，切换方言看各库分别建成什么。" />
      <SqlExample example={typeMapping} title="一张表看完类型映射" />
      <SimpleTable
        head={['写法', 'TypeScript 类型', '说明']}
        rows={[
          ['`col.string(n)`', '`string`', '长度默认 255'],
          ['`col.int()`、`col.double()`', '`number`', ''],
          ['`col.bigint()`', '`number`', '给 `{ mode: "bigint" }` 时是 `bigint`，不丢精度'],
          ['`col.decimal(p, s)`', '数值文字 `${number}`', '精度默认 38, 10；读写走文字，不丢精度'],
          ['`col.boolean()`', '`boolean`', '没有布尔类型的库存 0、1，读出还是布尔'],
          ['`col.date()`', '`DateText`', '`2026-01-02` 这种形状的文字，不经过时区'],
          ['`col.time()`', '`string`', 'Oracle 没有 TIME，存成文字'],
          ['`col.datetime()`', '`Date`', '库里按 UTC 存'],
          [
            '`col.datetime({ timeZone: true })`',
            '`Date`',
            'PG 的 TIMESTAMPTZ：绝对时刻，不受会话时区影响（只支持 PG）',
          ],
          ['`col.enum([...] as const)`', '字面量联合', '写入、读出都校验，库里有不认识的值会报错'],
          ['`col.json<T>()`、`col.json(校验器)`', '`T`', '见下'],
          ['`col.uuid()`', '`string`', '小写标准写法，写入时检查格式；MySQL 存 BINARY(16)'],
          ['`col.bytes()`', '`Uint8Array`', '不是 Buffer'],
          ['`col.custom<T>(kind, read, write)`', '`T`', '见“自定义类型”'],
        ]}
      />
    </Section>
    <Section id="precision" title="金额和大整数">
      <P text="`col.decimal` 在 JS 里是文字，不经过浮点数，运算都在库里做。类型是数值形状的文字，`'10.50'` 可以直接写，普通字符串列不能调算术。" />
      <SqlExample example={decimalMath} title="decimal 的算术：右边可以是列、数字、数值文字" />
      <SqlExample example={decimalSum} title="sum 保持文字，不丢精度" />
      <Note text="结果一栏来自 SQLite：它的 DECIMAL 是浮点的 NUMERIC，尾部的 0 会丢，小数运算也可能有误差。切到 PostgreSQL 点“运行”看精确的结果，要在库里算钱时别用 SQLite 验证。" />
      <Points
        items={[
          '`col.bigint()` 默认读成 number，超过 2^53 会丢精度。可能超过时用 `{ mode: "bigint" }`：算术的另一边也要是 bigint，不混入 number。',
          'SQLite 要在适配器上打开 `sqlite(db, { bigInts: true })`，否则 `node:sqlite` 把大整数读成 number。',
          '要用 Decimal 对象时装 `-decimal` 扩展包，见下。',
        ]}
      />
    </Section>
    <Section id="date" title="日期和时间">
      <P text="`col.date()` 是形状受限的文字：字面量可以直接比较，写成 `'not a date'` 编译不过；普通字符串列调不了 `year()`、`addDays()`。" />
      <SqlExample example={dateText} title="日期列：比较、取年份、加减" />
      <P text="`col.datetime()` 是 `Date`，按 UTC 写入和读出，不受服务器时区影响。PostgreSQL 上要库里也是带时区的类型时写 `col.datetime({ timeZone: true })`：建成 TIMESTAMPTZ，写入带偏移，会话时区改了也是同一个时刻；别的库建表时报错。" />
      <SqlExample example={datetimeValue} title="时间列：参数直接给 Date" />
      <Note text="要有时区的对象，或者要把结果直接发给 vue-tsx-pro 的日期组件，用下面的 `-date` 扩展包。" />
    </Section>
    <Section id="enum" title="枚举">
      <P text="`col.enum` 的类型是字面量联合，写错值编译不过。库里默认是 VARCHAR，取值由列的编解码检查；要原生枚举时加 `.native('类型名')`（PG 必须给名字）。" />
      <SqlExample example={enumValue} title="枚举列的条件" />
    </Section>
    <Section id="json" title="JSON">
      <P text="给泛型只是声明类型；给校验器时读出和写入都校验，不合格的写入在发 SQL 之前就报错。校验器必须是同步的。怎么按路径查询、局部更新，见“JSON 列”一章。" />
      <CodeBlock code={jsonSchema} lang="ts" />
    </Section>
    <Section id="uuid" title="UUID">
      <CodeBlock code={uuid} lang="ts" />
      <P text="PG、DuckDB、ClickHouse 存 UUID，SQL Server 存 UNIQUEIDENTIFIER，MySQL 存 BINARY(16)（绑定时自动转换，比 CHAR(36) 省一半多），其余存文字。SQL Server 的 UNIQUEIDENTIFIER 排序先比较最后 6 个字节，按它排序不是按时间。" />
    </Section>
    <Section id="packages" title="扩展包：Decimal 和日期对象">
      <P text="核心不依赖第三方库。`decimal.js`、`@internationalized/date` 各有一个小包，库本身是 peer 依赖，应用里只有一份。" />
      <CodeBlock code={precise} lang="ts" />
      <SimpleTable
        head={['列', 'JS 类型', '库里']}
        rows={[
          ['`decimalJs(p, s)`', '`Decimal`', 'DECIMAL、NUMERIC，读写走文字'],
          ['`calendarDate()`', '`CalendarDate`', 'DATE，不经过时区'],
          ['`timeOfDay()`', '`Time`', 'TIME'],
          ['`calendarDateTime()`', '`CalendarDateTime`', 'DATETIME、TIMESTAMP，原样存墙上时间'],
          [
            '`zonedDateTime(zone)`',
            '`ZonedDateTime`',
            'DATETIME、TIMESTAMP，存 UTC 时刻，读出换算到时区',
          ],
        ]}
      />
      <P text="这些类型和 json-wire 的种类、vue-tsx-pro 日期组件的值类型是同一套：查询结果 `stringifyWire(row)` 发给前端，前端 `parseWireJson` 还原后可以原样写回，中间不用转换。" />
    </Section>
    <Section id="pg" title="PostgreSQL 专属">
      <P text="数组和时间间隔只有 PG 支持，别的库建表时报错，换成 `col.json<T[]>()`。数组只支持一维。" />
      <CodeBlock code={pgOnly} lang="ts" />
    </Section>
    <Section id="custom" title="自定义类型">
      <P text="金额类、业务 ID 这些自己的类型，三步接入，不用改核心，两个扩展包也是这么写的。" />
      <CodeBlock code={custom} lang="ts" />
      <P text="列值要在 SQL 里转换时用 `sqlConvert`：`read` 包住每个读这一列的地方，`write` 包住写进去的值。" />
      <CodeBlock code={sqlConvert} lang="ts" />
      <Note text="`db.sql` 读出的是驱动的原始值，不经过这些编解码。" />
    </Section>
  </DocPage>
));
