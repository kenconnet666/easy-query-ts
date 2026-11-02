# easy-query-ts 版（@zerodep-dev/easy-query-ts\*）

与 Java 版 easy-query 同一套思路：实体 + 导航、lambda 里写条件、隐式 join、隐式子查询、对象树结果；结果类型全由 TS 推导，不需要代码生成。
文档站：[easy-query-ts.zerodep.dpdns.org](https://easy-query-ts.zerodep.dpdns.org)，每段代码都能看到各方言的 SQL、在浏览器里运行（源码在 `apps/docs`，`pnpm dev:docs`）。设计与取舍见 [docs/decisions/0002-ts-design.md](docs/decisions/0002-ts-design.md)，现状与上手见 [HANDOFF.md](HANDOFF.md)。

```ts
import { DatabaseSync } from 'node:sqlite';
import { col, createDb, defineSchema, entity } from '@zerodep-dev/easy-query-ts';
import { sqlite } from '@zerodep-dev/easy-query-ts-sqlite';

const User = entity('t_user', {
  id: col.bigint().primaryKey().generated(),
  name: col.string(),
  companyId: col.bigint().nullable(),
});
const Company = entity('t_company', {
  id: col.bigint().primaryKey().generated(),
  name: col.string(),
});
const schema = defineSchema(
  { User, Company },
  {
    User: (r) => ({ company: r.one('Company', { from: 'companyId', to: 'id' }) }),
    Company: (r) => ({ users: r.many('User', { from: 'id', to: 'companyId' }) }),
  },
);

const db = createDb({ schema, adapter: sqlite(new DatabaseSync('app.db')) });
const rows = await db
  .queryable(Company)
  .where((c) => c.users.any((u) => u.name.startsWith('a')))
  .select((c) => ({
    name: c.name,
    users: c.users.orderBy((u) => u.id).toList((u) => ({ id: u.id, name: u.name })),
  }))
  .toList();
// rows: { name: string; users: { id: number; name: string }[] }[]
```

## 安装

最少要装三个：核心包、一个方言包、方言对应的驱动。

```bash
pnpm add @zerodep-dev/easy-query-ts @zerodep-dev/easy-query-ts-pg pg
```

核心不依赖任何日期、小数库，默认的列类型只用 JS 自带的类型。业务里有金额和日期时，建议建表之前就引入下面两个包，之后再换要改实体和用到它们的代码：

```bash
pnpm add @zerodep-dev/easy-query-ts-decimal decimal.js
pnpm add @zerodep-dev/easy-query-ts-date @internationalized/date
```

| 包         | 什么时候装                         | 解决什么                                                       | 还要装                    |
| ---------- | ---------------------------------- | -------------------------------------------------------------- | ------------------------- |
| `-decimal` | 有金额、数量、费率，要做运算       | `decimalJs()` 读成 `Decimal`，运算不经过浮点                   | `decimal.js`              |
| `-date`    | 有日期、时区、营业时间这类业务含义 | `calendarDate()` 等读成带语义的日期类型，不用 JS `Date` 猜时区 | `@internationalized/date` |
| `-crypto`  | 手机号、证件号要加密存储           | 现成的 AES、国密 SM4，密文还能搜索，能读 Java 版写的数据       | 只能在 Node 里用          |
| `-cache`   | 读多写少，要二级缓存               | 本机缓存和 Redis 接口，写入后自动失效                          | Redis 驱动你自己接        |
| `-cli`     | 由库生成实体、做迁移、存 SQL 快照  | `eqts` 命令行                                                  | 放进开发依赖              |

各包的用法见文档站的[快速开始](https://easy-query-ts.zerodep.dpdns.org/guide/quick-start#install)。

## 包

包名都以 `@zerodep-dev/` 开头。核心零依赖，驱动是各方言包的 peer 依赖，要同时安装。

| 包                                                           | 内容                                                                                       |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------ |
| `easy-query-ts`                                              | 实体、关系、表达式、语法树、方言基类、查询与写入构建器、结果拼装                           |
| `easy-query-ts-sqlite`                                       | `node:sqlite`（Node 自带），也支持 `bun:sqlite`、Cloudflare D1、libSQL / Turso             |
| `easy-query-ts-mysql`                                        | `mysql2`：MySQL 8.0.18（PolarDB）起，以及 MariaDB、Doris                                   |
| `easy-query-ts-pg`                                           | `pg`：PG 12 起，以及 openGauss、人大金仓、PGlite、Neon                                     |
| `easy-query-ts-mssql`、`-oracle`、`-dameng`、`-db2`、`-hana` | SQL Server、Oracle、达梦、Db2、SAP HANA                                                    |
| `easy-query-ts-clickhouse`、`-duckdb`、`-tdengine`           | 分析型与时序库                                                                             |
| `easy-query-ts-decimal`、`-date`                             | decimal.js 与 `@internationalized/date` 的列类型                                           |
| `easy-query-ts-crypto`                                       | 列加密（AES、SM4，可分段搜索）                                                             |
| `easy-query-ts-cache`                                        | 二级缓存：本机缓存与 Redis 接口，见 [docs/features/ts-cache.md](docs/features/ts-cache.md) |
| `easy-query-ts-cli`                                          | `eqts`：由库生成实体、迁移、SQL 快照                                                       |

`packages/test` 是不发布的测试模块：共用夹具、跨方言套件、类型检查（见 [packages/test/README.md](packages/test/README.md)）。

## 开发

```bash
pnpm install
pnpm typecheck
pnpm test
pnpm check
```

实库套件在设了 `EQTS_*` 环境变量时才跑，容器与连接见 [HANDOFF.md](HANDOFF.md)。发布见 [RELEASE.md](RELEASE.md)。

许可证：Apache-2.0。
