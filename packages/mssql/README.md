# @zerodep-dev/easy-query-ts-mssql

SQL Server 方言与驱动适配（`mssql` / tedious，纯 JS），按服务器版本渲染：

```ts
import sql from 'mssql';
import { mssql } from '@zerodep-dev/easy-query-ts-mssql';

const pool = await new sql.ConnectionPool({
  server,
  user,
  password,
  database,
  options: { trustServerCertificate: true },
}).connect();
const db = createDb({ schema, adapter: mssql(pool) }); // 默认按最新（2022）
const legacy = createDb({ schema, adapter: mssql(pool, { version: 2008 }) }); // ROW_NUMBER 分页等旧写法
```

低于某个特性的最低版本时退回旧写法，没有旧写法就报错并说明要哪个版本。详见仓库 `packages/easy-query/docs/features/ts-sqlserver.md`。需要同时安装核心包与 `mssql`。许可证：Apache-2.0。
