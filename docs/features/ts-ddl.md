# TS：代码优先建表与同步（code-first）

```ts
const Gadget = entity('t_gadget', {
  id: col.bigint().primaryKey().generated(),
  name: col.string(50).unique(), // VARCHAR(50) + UNIQUE
  price: col.decimal(10, 2), // DECIMAL(10, 2)：精度现在会记在列上
  qty: col.int().dbDefault('0'), // DEFAULT 0，插入时可省
  seenAt: col.datetime(),
  tags: col.json<string[]>().dbType('JSONB'), // 直接指定库里的类型
});

const db = createDb({ schema: defineSchema({ Gadget }), adapter });
await db.createTables(); // 建库里还没有的表（连同注释、索引、外键），已有的表不动
db.createTablesSql(); // 只看语句，不执行（对应官方 createTableCommand）
db.createTableSql(Gadget); // 只看一张表的 CREATE TABLE
```

## 注释、索引、外键、改名

```ts
const Book = entity(
  't_book',
  {
    id: col.bigint().primaryKey().generated(),
    shelfId: col.bigint().comment('书架'),
    title: col.string(100).renamedFrom('name'), // 原来叫 name：同步时改名而不是加列
  },
  {
    comment: '图书',
    indexes: [{ columns: ['shelfId', 'title'], unique: true }],
    renamedFrom: 't_books',
  },
);
defineSchema(
  { Shelf, Book },
  {
    Book: (r) => ({
      shelf: r.one('Shelf', { from: 'shelfId', to: 'id' }, { foreignKey: { onDelete: 'cascade' } }),
    }),
  },
);
```

- 注释：MySQL 写在建表语句里（列 `COMMENT`、表 `COMMENT=`），PG / HANA 用 `COMMENT ON`，SQLite 没有注释。
- 索引名默认 `表_列_idx` / `uidx`；索引列的名字在类型上限定为实体的列（值对象写展开后的路径）。
- 外键声明在多对一导航上（对应官方 `@ForeignKey`），名字默认 `fk_表_列`：建完所有表再 `ALTER TABLE … ADD CONSTRAINT`；SQLite 只能写进建表语句。

## 生成列与索引的写法（ROADMAP 19.7）

```ts
const Line = entity(
  't_line',
  {
    id: col.int().primaryKey(),
    attrs: col.json<{ tags: string[] }>(),
    qty: col.int(),
    price: col.int(),
    total: col.int().generatedAs('qty * price'), // 库算出来；写入时给值会报错
  },
  {
    indexes: [
      { columns: ['attrs'], using: 'gin', name: 't_line_attrs_gin' }, // PG：jsonb、数组、全文用 GIN
      { columns: ['qty'], where: 'qty > 0', name: 't_line_live_idx' }, // 部分索引（PG、SQLite）
      { expressions: ['lower(sku)'], name: 't_line_lower_sku_idx' }, // 表达式索引（PG、SQLite、MySQL 8.0.13+）
      // MySQL 的多值索引（MEMBER OF / JSON_CONTAINS 靠它走索引）也是表达式索引
      { expressions: ["CAST(attrs->'$.tags' AS CHAR(32) ARRAY)"], name: 't_line_tags_mvi' },
    ],
  },
);
```

- 生成列：`generatedAs(sql, { stored })`，sql 是受信任的 SQL、引用库里的列名；stored 默认 true（PG 只有 STORED），MySQL、SQLite 可以 VIRTUAL。
  插入、更新给它赋值在构建时报错；`entity(row)`、`changes` 自动跳过它。PG、MySQL、SQLite 支持，别的库建表时报错。
- 索引的 `using`（PG 的 gin / gist / brin / hash，MySQL 的 btree / hash）、`where`（部分索引）、`expressions`（表达式）都是受信任的 SQL；
  方言不支持的写法在建表时报错（`Dialect.indexFeatures`），不发出半截语句。
- `planSync` 按名字比较索引：库里没有就建；已有同名索引但定义变了不会自动改。PG 读出的表达式索引在 `eqts pull` 里生成 `expressions`。

## 同步：`planSync` / `syncTables`（对应官方 syncTableCommand）

```ts
const plan = await db.planSync(); // 读库里的结构（introspect）与实体比较，不执行
console.log(plan.statements.join(';
')); // 要执行的语句：只增不删
console.log(plan.differences); // 不会自动改的差异
await db.syncTables(); // 算计划并执行（PG、SQLite 在一个事务里）
```

- 会做：建缺的表、加缺的列、按 `renamedFrom` 改表名与列名、建缺的索引与外键。
- 只列出不做：类型、可空、注释不一致，库里多出来的列，SQLite 上已有表缺的外键。与官方一样永不删表删列；要删用 `db.dropTables(…)`。
- 类型比较忽略大小写、空格与各库的同义写法（`character varying` / `varchar`、`int(11)` / `int`、`tinyint(1)` / `boolean`、`timestamp(3) without time zone` / `timestamp(3)` …），
  所以刚建好的表再比一次是空计划（实库测试验证）。
- 读库结构：`db.introspect()` 返回当前 schema 的表、列、主键、索引、外键（MySQL 读 information_schema，PG 读系统目录，SQLite 读 pragma，HANA 读 SYS 视图）；
  `db.tableExists(Entity)`。
- 官方先打印 SQL、算 hash、人确认后再 commit；这里 `planSync` 返回语句与差异，确认方式由调用方决定（打印、写成迁移文件、比对 hash）。

适合测试、原型和中小项目的起步；结构复杂的正式环境仍建议把 `planSync` 的输出落成迁移文件审阅后再执行。

## 列元数据

`col.string(length)`（默认 255）、`col.decimal(precision, scale)`（默认 38, 10）、`.dbType('…')`（优先于按种类推断，也是自定义种类必须给的）、`.dbDefault('…')`（原样写进 `DEFAULT`，受信任的 SQL）、`.unique()`。`nullable()` / `primaryKey()` / `generated()` 照旧。

## 类型映射

| 种类         | SQLite                              | MySQL            | PG                                 | HANA*            |
| ------------ | ----------------------------------- | ---------------- | ---------------------------------- | ---------------- |
| string       | TEXT                                | VARCHAR(n)       | VARCHAR(n)                         | NVARCHAR(n)      |
| int / bigint | INTEGER                             | INT / BIGINT     | INTEGER / BIGINT                   | INTEGER / BIGINT |
| decimal      | NUMERIC                             | DECIMAL(p, s)    | NUMERIC(p, s)                      | DECIMAL(p, s)    |
| double       | REAL                                | DOUBLE           | DOUBLE PRECISION                   | DOUBLE           |
| boolean      | INTEGER                             | BOOLEAN          | BOOLEAN                            | BOOLEAN          |
| date / time  | TEXT                                | DATE / TIME      | DATE / TIME                        | DATE / TIME      |
| datetime     | TEXT                                | DATETIME(3)      | TIMESTAMP(3)                       | TIMESTAMP        |
| json         | TEXT                                | JSON             | JSONB                              | NCLOB            |
| bytes        | BLOB                                | BLOB             | BYTEA                              | BLOB             |
| 自增         | `INTEGER PRIMARY KEY AUTOINCREMENT` | `AUTO_INCREMENT` | `GENERATED BY DEFAULT AS IDENTITY` | 同 PG            |

\* HANA 一栏的**文本**有单测，没有实库验证（随 CI）；HANA 建列存表（`CREATE COLUMN TABLE`），也没有 `IF NOT EXISTS`，表已存在会报错。SQLite 没有严格类型，未知的种类默认 TEXT；其它库遇到没有数据库类型的种类（自定义 kind）要求给 `dbType`。

## 由表生成实体：`eqts pull`（对应官方 plugin/table2entity）

方向与 `createTables` / `syncTables` 相反：已有的库（例如从 Java 迁过来的表）不用手写实体。

```bash
eqts pull --adapter ./db-adapter.ts --out src/schema.ts --strip-prefix t_
```

`--adapter` 模块默认导出一个 Adapter（`export default mysql(createPool(url))`）。生成每张表一个 `entity(…)`（类型、可空、主键、自增、`.defaulted()`、列名不合规则时 `.named()`、注释、索引），
外键变成两边的导航（`r.one` 带 `foreignKey`，被引用的一边 `r.many`）；认不得的类型用 `.dbType('…')` 原样保留并加注释，JSON 列要补上类型。
程序里用 `entitySource(await db.introspect(), options)`（`@zerodep-dev/easy-query-ts-cli`）。生成的 schema 与库再 `planSync` 是空计划（实库测试验证）。

SQLite、MySQL 8.4、PG 17 实测（建表 → 插入 → 读回每种列类型 → 唯一约束拒绝重复；注释、索引、外键、改名、加列、再比为空计划）；HANA 只有语句文本的单测。
