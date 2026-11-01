# TS：列类型（decimal.js、64 位整数、`@internationalized/date`、二进制）与扩展

核心不依赖任何第三方库。decimal.js 与 `@internationalized/date` 各是一个独立小包，库本身是 **peer 依赖**（版本由应用决定，避免装两份）。

```ts
import { col, entity } from '@zerodep-dev/easy-query-ts';
import { decimalJs } from '@zerodep-dev/easy-query-ts-decimal';
import {
  calendarDate,
  calendarDateTime,
  timeOfDay,
  zonedDateTime,
} from '@zerodep-dev/easy-query-ts-date';

export const Order = entity('t_order', {
  id: col.bigint({ mode: 'bigint' }).primaryKey().generated(), // bigint；超过 2^53 也不丢精度
  amount: decimalJs(12, 2), // decimal.js 的 Decimal
  day: calendarDate(), // CalendarDate
  startsAt: calendarDateTime(), // CalendarDateTime（无时区的墙上时间）
  paidAt: zonedDateTime('Asia/Shanghai'), // ZonedDateTime（库里按 UTC 存时刻）
  opensAt: timeOfDay(), // Time
  receipt: col.bytes(), // Uint8Array
});
```

## 与 json-wire、vue-tsx-pro 对接

这些类型正好是 json-wire（zerodep 的 typed JSON 库，Java 与 TypeScript 两边同一套写法）的种类表在 TypeScript 一侧的类型，也是 vue-tsx-pro 日期组件接受的值类型，所以**查询结果可以直接 `stringifyWire(row)` 发给前端，前端 `parseWireJson` 还原后能原样写回**，中间不需要转换：

| 列                                      | JS 类型                 | json-wire 种类 | 库里                                            |
| --------------------------------------- | ----------------------- | -------------- | ----------------------------------------------- |
| `col.bigint({ mode: 'bigint' })`        | `bigint`                | `bigint`       | BIGINT / DECIMAL(p,0)                           |
| `decimalJs()`                           | `Decimal`               | `decimal`      | DECIMAL / NUMERIC                               |
| `calendarDate()`                        | `CalendarDate`          | `date`         | DATE                                            |
| `timeOfDay()`                           | `Time`                  | `time`         | TIME                                            |
| `calendarDateTime()`                    | `CalendarDateTime`      | `timestamp`    | DATETIME / TIMESTAMP（无时区）                  |
| `zonedDateTime(zone)`、`col.datetime()` | `ZonedDateTime`、`Date` | `timestamptz`  | DATETIME / TIMESTAMP，按 UTC 存                 |
| `col.bytes()`                           | `Uint8Array`            | `bytes`        | BLOB / BYTEA                                    |
| `col.uuid()`                            | `string`（小写）        | —              | UUID / BINARY(16) / UNIQUEIDENTIFIER / CHAR(36) |
| `col.array(元素列)`                     | `元素[]`                | —              | PG 的 `元素类型[]`（只支持 PG）                 |

已用 json-wire 的 TypeScript 包做过一次端到端检查：数据库行 → `stringifyWire`（`$types` 自动标出 `decimal / bigint / date / timestamp / timestamptz / time / bytes`）→ `parseWireJson` → 写回数据库，两边的行一致。注意 json-wire 用 `instanceof` 判断类型，应用里 `decimal.js` 与 `@internationalized/date` 必须只有一份（peer 依赖正常安装就是这样）。

## 行为说明

- **bigint**：MySQL 读写走文字，PG 的 int8 以文字返回，都不丢精度；SQLite 要在适配器上打开 `sqlite(db, { bigInts: true })`，否则 node:sqlite 把大于 2^53 的整数读成 number。MySQL 适配器把 bigint 参数写成整数字面量——mysql2 把它当带引号的字符串插值，`BIGINT + '1'` 会按 DOUBLE 运算而丢精度（实测踩到过）。
- **Decimal**：读写都走文字（`toFixed()`，不会写成 `1e+21`），不依赖驱动把 DECIMAL 读成 number 还是 string；`sum / avg` 保持 Decimal。
- **日期**：`calendarDate` 不经过时区；`calendarDateTime` 原样存取墙上时间；`zonedDateTime(zone)` 存时刻（UTC），读出换算到指定时区，所以不同机器、不同会话时区读出的结果一致。三者都可以用 `year() / month() / day() / addDays() / diffDays()`。
- **二进制**：读出的是普通 `Uint8Array`（不是 Buffer）。
- **uuid**：JS 里是小写的标准写法文字，写入时检查格式（大写也收）。PG、DuckDB、ClickHouse 存 UUID，SQL Server 存 UNIQUEIDENTIFIER，
  MySQL 存 BINARY(16)（绑定时换成 16 个字节，读出再换回来；比 CHAR(36) 省一半多，比较更快），Doris 与其它库存文字。
  主键用 `col.uuid().primaryKey().$default(uuidv7)`：v7 按时间有序（同一进程里同一毫秒也单调递增），新行插在索引末尾。
  SQL Server 的 UNIQUEIDENTIFIER 排序先比较最后 6 个字节，按它排序不是按时间。
- **数组（PG）**：`col.array(col.string(30))` 建成 `VARCHAR(30)[]`，元素逐个经过元素列的 codec（日期时间、bigint、decimal 的数组按文字读，
  不经过驱动按本地时区解析）；元素可空写 `col.array(col.int().nullable())`。条件：`has(v)`（`? = ANY(col)`）、`hasAll([…])`（`@>`）、
  `hasAny([…])`（`&&`）、`arrayLength()`（`cardinality`）。只支持一维；别的库建表时报不支持，改用 `col.json<T[]>()`。
- **原生枚举**：`col.enum(['todo', 'done']).native('task_state')`。MySQL 建成 `ENUM('todo', 'done')`；PG 建成名为 `task_state` 的类型，
  建表前先建（`DO $$ … EXCEPTION WHEN duplicate_object …`，能重复执行），`planSync` 发现新加的值就 `ALTER TYPE … ADD VALUE`，
  库里多出来的值（PG 删不了）写进差异。PG 上必须给类型名；别的库照常是 VARCHAR，取值由列的 codec 检查。`eqts pull` 把 MySQL 的 enum 生成原生枚举。
- **时间间隔（PG）**：`col.interval()` 建成 INTERVAL，读出 PG 输出的文字（`'02:00:00'`、`'1 day'`、`'3 mons'`），写入给 PG 认得的写法；别的库建表时报不支持。
- **无符号**：`col.int().unsigned()`、`col.bigint().unsigned()` 在 MySQL 建成 `INT UNSIGNED` 等；别的库没有无符号类型，建表时忽略。
  `eqts pull` 认得 `uuid`、`uniqueidentifier` 与 `unsigned`。

## 加自己的类型（扩展点）

三步，和 `@zerodep-dev/easy-query-ts-decimal` 一样，不用改核心：

```ts
import { col } from '@zerodep-dev/easy-query-ts';

// 1. 列工厂：kind 是读写口径（未知的 kind 当普通值处理；'decimal' 会让 avg 保持这个类型）
export const money = () =>
  col.custom<Money>(
    'decimal',
    (raw) => Money.parse(String(raw)),
    (m) => m.toFixed(),
  );

// 2.（可选）让算术 / 聚合认它：声明合并
declare module '@zerodep-dev/easy-query-ts' {
  interface NumericExtensions {
    money: Money;
  }
}
// 日期时间类型同理登记到 TemporalExtensions，之后 year() / month() / day() 就能用在它上面
```

## 限制

- HANA 未验证这些类型（建表语句未加进 HANA 实库套件）。
- `Time` 不登记到 `TemporalExtensions`（没有年月日）。
- 直接写 `db.sql\`…\`` 读出的是驱动原始值，不经过列 codec。

## JSON 列与 Standard Schema

```ts
import { z } from 'zod'; // 或 valibot、arktype：任何实现了 Standard Schema 的校验器
const Profile = z.object({ tags: z.array(z.string()), level: z.number().int().min(0) });
const Account = entity('t_account', {
  id: col.bigint().primaryKey().generated(),
  profile: col.json(Profile),
});
// 行类型里 profile 的类型取自校验器：{ tags: string[]; level: number }
```

- **读出和写入都校验**：写入不合格在发 SQL 之前抛错，读出时库里的旧数据不再符合 schema 也会抛错，消息带上失败的路径（`write: invalid JSON value: level: …`）。
- 只依赖协议里的 `~standard.validate`（核心不引入任何校验库，接口在 `@zerodep-dev/easy-query-ts` 里以 `StandardSchema` 导出）；**校验器必须是同步的**，异步的会明确报错。
- 只写泛型的 `col.json<Tags>()` 仍然可用，不做运行时校验。
- 用 zod 4.6.7 验证过（zod 只是测试的开发依赖）。

## JSON 的更新写法与按元素过滤

```ts
// 一条 UPDATE 里改 JSON 的某一处，不用读出来改完再整个写回
await db
  .update(Account)
  .set((a) => ({ profile: a.profile.jsonSet(['level'], 2) }))
  .where((a) => a.id.eq(id))
  .execute();
a.profile.jsonRemove('nickname'); // 删掉键或数组元素
a.profile.jsonMerge({ level: 3, tags: [] }); // 浅合并：给出的顶层键整个换掉
a.profile.jsonAppend(['tags'], 'vip'); // 数组末尾加一项（数组不在时 PG 当成空数组）

// JSON 数组里有满足条件的元素：同一个元素同时满足所有条件
db.queryable(Order).where((o) =>
  o.payload.jsonSome(['items'], { sku: col.string(), qty: col.int() }, (it) => [
    it.sku.eq('A1'),
    it.qty.gt(2),
  ]),
);
```

- 路径与值的类型按 JSON 列的 TS 类型检查（`jsonSet(['level'], 'x')` 在 level 是数字时报错）；值按 JSON 写进去，字符串不会变成带引号的文字。
- `jsonSome` 的 columns 只能写元素上有的键；数组不在（NULL、路径不存在）时为假。
- PG：`jsonb_set`、`#-`、`||`、`jsonb_insert` 一类与 `jsonb_to_recordset`；MySQL：`JSON_SET`、`JSON_REMOVE`、`JSON_ARRAY_APPEND` 与 `JSON_TABLE`
  （8.0.4+；不用 EXISTS 而是数个数：MySQL 把关联 JSON_TABLE 的 EXISTS 改写成不带关联条件的连接，结果错，8.4.11 实测）；
  SQLite：`json_set`、`json_remove`、`json_insert` 与 `json_each`。别的方言渲染时报不支持。
- PG 另有 JSONPath：`Pg.jsonb(col).pathExists('$.items[*] ? (@.qty > 2)')`、`pathMatch('$.level > 2')`。

## date 列的类型

`col.date()` 在 JS 里是 `DateText`（`` `${number}-${number}-${number}` ``，即 `'2026-01-02'` 这种形状的文字）：字面量可以直接写入和比较，**普通字符串列不能调用 `year() / month() / day() / addDays() / dateTrunc()`**，写成 `'not a date'` 也会编译不过。要对象形式用 `@zerodep-dev/easy-query-ts-date` 的 `calendarDate()`。

## 值对象（对应 @ValueObject）

```ts
const Shop = entity('t_shop', {
  id: col.int().primaryKey().generated(),
  address: embed({
    city: col.string(),
    street: col.string().nullable(),
    geo: embed({ lat: col.double(), lng: col.double() }, { prefix: 'geo_' }), // 可以再嵌
  }),
});
// 库里的列：address_city、address_street、geo_lat、geo_lng
await db.queryable(Shop).where((s) => s.address.city.eq('hz')).toList(); // 行里 address 是嵌套对象
await db.update(Shop).set({ address: { city: 'nb' } }).where(...).execute(); // 只改这一项
```

- 列名默认是"属性名_子属性名"，`prefix` 换掉"属性名_"，子列 `named()` 时用它给的全名。
- 实体上 `fields` 是声明的形状（类型推导看它），`columns` 是展开后的列（键是 `'address.city'`）。
- 全都可空的值对象插入时可省、更新时可以整个给 `null`（每一列写 NULL）。
- 列表请求里写路径：`sort=-address.city`、`filter.address.province=zj`。
- 主键不能放进值对象；整行里带值对象时不能 `asTable()`（派生表只能是平的列）。

## 列值在 SQL 里转换（对应 ColumnValueSQLConverter）

```ts
phone: col.string().sqlConvert({
  read: (c) => sql<string>`AES_DECRYPT(${c}, ${key})`,
  write: (v) => sql<string>`AES_ENCRYPT(${v}, ${key})`,
}),
```

`read` 包住读这一列的每个地方（select、where、orderBy、导航条件），`write` 包住 insert、update 写进去的值；转换后的值仍按列的类型解码。
与 `encrypted` 的区别：`encrypted` 在应用里加解密，库里只能等值比较；这里在库里转换，`like`、排序、函数都能用。
RETURNING 只能拿到存的值：`returning()` 选到这种列时报错，`returnEntity()` 改为插入后按主键查回。
