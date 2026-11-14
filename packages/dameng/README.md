# @zerodep-dev/easy-query-ts-dameng

达梦 DM8 方言与驱动适配（官方驱动 `dmdb`）。方言继承 Oracle 方言（`@zerodep-dev/easy-query-ts-oracle/dialect`，不需要装 `oracledb`）：

```ts
import dmdb from 'dmdb';
import { dameng } from '@zerodep-dev/easy-query-ts-dameng';

const pool = await dmdb.createPool({
  connectString: 'dm://SYSDBA:密码@host:5236?loginEncrypt=false',
});
const db = createDb({ schema, adapter: dameng(pool) });
```

详见文档站的[各库要注意的地方](https://easy-query-ts.zerodep.dpdns.org/scale/dialects#notes)。需要同时安装核心包与 `dmdb`。许可证：Apache-2.0。
