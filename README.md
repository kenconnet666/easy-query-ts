# easy-query-ts 版（@zerodep-dev/easy-query-ts\*）

与 Java 版 easy-query 同一套思路：实体 + 导航、lambda 里写条件、隐式 join、隐式子查询、对象树结果；结果类型全由 TS 推导，不需要代码生成。
文档站：https://easy-query-ts.zerodep.dpdns.org（源码在 `apps/docs`，`pnpm dev:docs`），每段代码都能看到各方言的 SQL、在浏览器里运行。设计与取舍见 [docs/decisions/0002-ts-design.md](docs/decisions/0002-ts-design.md)，现状与上手见 [HANDOFF.md](HANDOFF.md)。

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
