# @zerodep-dev/easy-query-ts-duckdb

DuckDB 方言与驱动适配（`@duckdb/node-api`，进程内的分析库，不用服务器）：

```ts
import { DuckDBInstance } from '@duckdb/node-api';
import { duckdb } from '@zerodep-dev/easy-query-ts-duckdb';

const db = createDb({ schema, adapter: duckdb(await DuckDBInstance.create('app.duckdb')) });
```

详见仓库 `packages/easy-query/docs/features/ts-duckdb.md`。需要同时安装核心包与 `@duckdb/node-api`。许可证：Apache-2.0。
