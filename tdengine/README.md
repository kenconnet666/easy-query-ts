# @zerodep-dev/easy-query-ts-tdengine

TDengine 3.x 方言与驱动适配（官方驱动 `@tdengine/websocket`，对应官方的 sql-tsdb）：时间戳主键的时序表，写入覆盖、按时间删除、查询与聚合。

```ts
import { sqlConnect, WSConfig } from '@tdengine/websocket';
import { tdengine } from '@zerodep-dev/easy-query-ts-tdengine';

const db = createDb({ schema, adapter: tdengine(await sqlConnect(conf)) });
```

详见仓库 `packages/easy-query/docs/features/ts-tdengine.md`。需要同时安装核心包与 `@tdengine/websocket`。许可证：Apache-2.0。
