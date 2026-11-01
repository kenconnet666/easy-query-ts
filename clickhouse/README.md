# @zerodep-dev/easy-query-ts-clickhouse

ClickHouse 方言与驱动适配（官方驱动 `@clickhouse/client`）：查询完整，写入按 ClickHouse 的能力裁剪（主键由应用给值、更新删除是同步的 mutation、没有事务）。

```ts
import { createClient } from '@clickhouse/client';
import { clickhouse } from '@zerodep-dev/easy-query-ts-clickhouse';

const db = createDb({
  schema,
  adapter: clickhouse(createClient({ url, username, password, database })),
});
```

详见仓库 `packages/easy-query/docs/features/ts-clickhouse.md`。需要同时安装核心包与 `@clickhouse/client`。许可证：Apache-2.0。
