/** 实体与列：声明表、列修饰器、索引、值对象、品牌类型、从实体取类型 */
import { _component } from '@zerodep-dev/vue-tsx-pro-tsx';
import { CodeBlock } from '@zerodep-dev/vue-tsx-pro-ui';
import { DocPage, Note, P, Points, Section, SimpleTable, Sub } from '../../site/content';
import { SqlExample } from '../../site/SqlExample';
import {
  declareTable,
  defaults,
  embedGroup,
  embedInsert,
  embedRead,
  embedSelect,
} from './model.examples.ts';

const first = `import { col, createDb, defineSchema, entity } from '@zerodep-dev/easy-query-ts';

// 第一个参数是表名，第二个是列。属性名转成下划线就是列名：createdAt → created_at
export const User = entity('t_user', {
  id: col.bigint().primaryKey().generated(),
  name: col.string(50),
  age: col.int().nullable(),
  createdAt: col.datetime().$default(() => new Date()),
});

// 把实体登记进 schema，关系写在第二个参数里，见“隐式 join 与子查询”
export const schema = defineSchema({ User });
export const db = createDb({ schema, adapter });`;

const indexes = `const Line = entity(
  't_line',
  {
    id: col.int().primaryKey(),
    sku: col.string(32),
    attrs: col.json<{ tags: string[] }>(),
    qty: col.int(),
    price: col.int(),
    total: col.int().generatedAs('qty * price'), // 生成列：库算出来，写入时给值报错
  },
  {
    comment: '订单行',
    renamedFrom: 't_lines', // 表改过名：同步时改名，不是新建
    indexes: [
      { columns: ['sku', 'qty'], unique: true },
      { columns: ['attrs'], using: 'gin', name: 't_line_attrs_gin' }, // PG 的 GIN
      { columns: ['qty'], where: 'qty > 0', name: 't_line_live_idx' }, // 部分索引：PG、SQLite
      { expressions: ['lower(sku)'], name: 't_line_lower_sku_idx' }, // 表达式索引
    ],
  },
);`;

const foreignKey = `defineSchema({ Shelf, Book }, {
  Book: (r) => ({
    shelf: r.one('Shelf', { from: 'shelfId', to: 'id' }, {
      foreignKey: { onDelete: 'cascade' }, // 外键声明在多对一导航上，名字默认 fk_表_列
    }),
  }),
});`;

const embedDeclare = `const Shop = entity('t_shop', {
  id: col.bigint().primaryKey().generated(),
  name: col.string(50),
  address: embed({
    city: col.string(20),                    // 列 address_city
    street: col.string(100).nullable(),      // 列 address_street
    geo: embed({ lat: col.double(), lng: col.double() }, { prefix: 'geo_' }), // 列 geo_lat、geo_lng
  }),
});`;

const brand = `const Customer = entity('t_customer', {
  id: col.bigint().primaryKey().generated().brand<'CustomerId'>(),
  name: col.string(50),
});
const Order = entity('t_order', {
  id: col.bigint().primaryKey().generated().brand<'OrderId'>(),
  customerId: col.bigint().brand<'CustomerId'>(),
});

type CustomerId = Row<typeof Customer>['id']; // Branded<number, 'CustomerId'>

db.queryable(Order).where((o) => o.customerId.eq(orderId)); // 类型错误：OrderId 不是 CustomerId
db.queryable(Order).where((o) => o.customerId.eq(1 as CustomerId)); // 裸数字要显式断言

r.one('Customer', { from: 'id', to: 'id' }); // 定义关系时品牌对不上，同样编译不过`;

const types = `import type { Insert, Row, Update } from '@zerodep-dev/easy-query-ts';

type UserRow = Row<typeof User>;       // 读出来的一行：{ id: number; name: string; age: number | null; ... }
type NewUser = Insert<typeof User>;    // 插入的形状：自增列、有默认值的列、可空列都可省
type UserPatch = Update<typeof User>;  // 更新的形状：每一列都可省

// 查询结果的类型不用写：把返回值交给函数，或者用 ViewOf 拿到视图的形状
async function listAdults() {
  return db.queryable(User).where((u) => u.age.ge(18)).select((u) => ({ name: u.name })).toList();
}
type Adult = Awaited<ReturnType<typeof listAdults>>[number]; // { name: string }`;

export default _component(() => () => (
  <DocPage>
    <Section id="declare" title="声明实体">
      <P text="实体是一张表的声明：类型和运行时信息都从这一份来，不用注解、不用代码生成。列上的链式方法既告诉数据库怎么建列，也决定 TypeScript 里的类型。" />
      <CodeBlock code={first} lang="ts" title="schema.ts" />
    </Section>
    <Section id="columns" title="列的声明">
      <SimpleTable
        head={['写法', '作用', '对类型的影响']}
        rows={[
          ['`primaryKey()`', '主键；写在多列上就是复合主键', '`find`、`whereKey` 的参数'],
          ['`generated()`', '库生成的值（自增）', '插入时可省'],
          ['`nullable()`', '可空', '读出 `T | null`，插入时可省'],
          ['`defaulted()`', '库里有默认值', '插入时可省'],
          ['`dbDefault(sql)`', '建表时写 `DEFAULT`，也算 `defaulted`', '插入时可省'],
          ['`$default(fn)`', '插入时没给就调用，在应用里算', '插入时可省'],
          ['`$onUpdate(fn)`', '更新时没给就调用', '不变'],
          ['`$onDelete(fn)`', '逻辑删除时一并写入：删除人、删除时间', '不变'],
          ['`$type<U>()`、`brand<B>()`', '只改 TypeScript 类型', '变成 `U`、带品牌的值'],
          ['`named(name)`', '列名不按默认的下划线规则', '不变'],
          ['`unique()`', '唯一约束', '不变'],
          ['`comment(text)`', '列注释', '不变'],
          ['`dbType(sql)`', '直接指定库里的类型，优先于按种类推断', '不变'],
          ['`unsigned()`', 'MySQL 的无符号，别的库建表时忽略', '不变'],
          ['`generatedAs(sql)`', '生成列（PG、MySQL、SQLite）', '写入时给值报错'],
          ['`renamedFrom(old)`', '列改过名：同步时改名而不是加列', '不变'],
          ['`softDelete()`、`version()`、`insertOnly()`、`encrypted()`', '见“列规则与拦截器”', '-'],
        ]}
      />
      <P text="下面这张表用到了其中几个，切换方言看同一份声明怎么变成各库的语句。" />
      <SqlExample example={declareTable} title="唯一约束、注释、列名、默认值、组合索引" />
      <P text="有默认值的列插入时可以不给，`returnEntity` 拿回来的行里都有：`version` 是乐观锁的初值，`deleted` 是未删除。" />
      <SqlExample example={defaults} title="只给必填的列" />
    </Section>
    <Section id="indexes" title="索引与外键">
      <P text="组合索引写在实体的第三个参数里，列名按实体检查，写错编译不过。名字默认是 `表_列_idx`、`表_列_uidx`。方言不支持的写法在建表时报错，不发半截语句。" />
      <CodeBlock code={indexes} lang="ts" />
      <P text="外键不是必须的：导航只看声明，不看库里有没有外键。需要时声明在多对一导航上。" />
      <CodeBlock code={foreignKey} lang="ts" />
    </Section>
    <Section id="embed" title="值对象">
      <P text="地址、金额加币种这类总是一起出现的几列，用 `embed` 收成一个属性：库里还是平铺的列，代码里是嵌套对象。对应 Java 版的 `@ValueObject`。" />
      <CodeBlock code={embedDeclare} lang="ts" />
      <SqlExample example={embedRead} title="读出来是嵌套对象" />
      <SqlExample example={embedSelect} title="子属性直接点：条件、排序、select 都行" />
      <SqlExample example={embedGroup} title="按城市分组" />
      <SqlExample example={embedInsert} title="整个对象写入，展开成几列" />
      <Points
        items={[
          '列名默认是“属性名_子属性名”，`prefix` 换掉前缀，子列 `named()` 时用它给的全名。',
          '全都可空的值对象插入时可省，更新时可以整个给 `null`。',
          '列表请求里写路径：`sort=-address.city`、`filter.address.city=杭州`。',
          '主键不能放进值对象；整行带值对象的查询不能 `asTable()`，先 `select` 成平的列。',
        ]}
      />
    </Section>
    <Section id="brand" title="品牌类型">
      <P text="主键、外键都是数字，把订单号当客户号传进去，类型上看不出来。打上品牌之后值类型互不相容。品牌只存在于类型里，运行时就是原来的数字，算术照常。" />
      <CodeBlock code={brand} lang="ts" />
      <Note text="`find(key)` 接受行里任何一列的值类型（实体类型上没有标出哪几列是主键），别的品牌的值在这里拦不住。" />
    </Section>
    <Section id="types" title="从实体取类型">
      <Sub id="row-types" title="接口、表单、函数参数要用的类型" />
      <CodeBlock code={types} lang="ts" />
    </Section>
  </DocPage>
));
