# @zerodep-dev/easy-query-ts-oracle

Oracle 方言与驱动适配（`oracledb` 的 Thin 模式，纯 JS，不装 Instant Client），按服务器版本渲染：

```ts
import oracledb from 'oracledb';
import { oracle, oracleSession } from '@zerodep-dev/easy-query-ts-oracle';

const pool = await oracledb.createPool({
  user,
  password,
  connectString: 'host:1521/FREEPDB1',
  sessionCallback: oracleSession,
});
const db = createDb({ schema, adapter: oracle(pool) }); // 默认按最新（23ai）
const legacy = createDb({ schema, adapter: oracle(pool, { version: '11.2' }) }); // ROWNUM 分页、NUMBER(1) 布尔
```

详见仓库 `packages/easy-query/docs/features/ts-oracle.md`。需要同时安装核心包与 `oracledb`。许可证：Apache-2.0。
