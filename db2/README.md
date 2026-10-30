# @zerodep-dev/easy-query-ts-db2

IBM Db2（LUW 11.5 / 12.1）方言与驱动适配（`ibm_db`）：

```ts
import ibmdb from 'ibm_db';
import { db2 } from '@zerodep-dev/easy-query-ts-db2';

const db = createDb({
  schema,
  adapter: db2(new ibmdb.Pool(), 'DATABASE=…;HOSTNAME=…;PORT=50000;PROTOCOL=TCPIP;UID=…;PWD=…'),
});
```

详见仓库 `packages/easy-query/docs/features/ts-db2.md`。需要同时安装核心包与 `ibm_db`（含 IBM CLI 驱动）。许可证：Apache-2.0。
