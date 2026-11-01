# TS：openGauss / GaussDB 与人大金仓（PG 协议的兼容库）

```ts
import pg from 'pg';
import { kingbase, opengauss } from '@zerodep-dev/easy-query-ts-pg';

const gauss = createDb({ schema, adapter: opengauss(new pg.Pool({ connectionString })) });
const kb = createDb({ schema, adapter: kingbase(new pg.Pool({ connectionString })) });
```

驱动都是 node-postgres，方言继承 PG 方言（`OpenGaussDialect`、`KingbaseDialect`）后覆盖差异，放在 PG 包里，不另装包。

## openGauss / GaussDB

- 库按 PG 兼容建：`CREATE DATABASE eqts DBCOMPATIBILITY 'PG'`。默认的 Oracle 兼容（A）里空字符串就是 `NULL`、`DATE` 带时分秒，与 PG 方言的口径不一致。
- 没有 `GENERATED … AS IDENTITY`：自增列建成 `SERIAL` / `BIGSERIAL`（读库结构时按默认值取序列认出自增列）。
- 没有 `ON CONFLICT`：upsert 写成 `ON DUPLICATE KEY UPDATE col = VALUES(col)`，只忽略时写 `ON DUPLICATE KEY UPDATE NOTHING`（冲突列由表上的主键、唯一约束决定）。
- 其余与 PG 相同。做适配时发现的三处差异都改成了 PG 与 openGauss 通用的写法，不按库分支：
  `jsonHas` 的 `#>` 加括号（openGauss 里它的优先级低于 `IS NOT NULL`）、`log10` 写成单参数 `LOG`、读外键用 `generate_series` 代替多参数 `unnest`。

实测：openGauss 7.0（官方镜像 `opengauss/opengauss-server`）共用套件 124 个用例；CI 里有 openGauss 服务容器。

## 人大金仓 KingbaseES

按 PG 模式初始化（`initdb -m pg`）时语法与 PG 一致，`kingbase(pool)` 只换了方言名。Oracle 模式初始化的金仓请按 Oracle 的写法评估。

金仓要有效的许可证：Docker Hub 上的社区镜像带的试用许可证都已过期（启动时报 `License file expired`），所以没有开发容器与 CI；
有许可证的实例设 `EQTS_KINGBASE_URL` 就会跑同一套共用套件（`pg/test/compatible-live.test.ts`）。
