# TS：Serverless 与嵌入式驱动

边缘函数、Worker、单测里没有常驻的数据库连接池。这几个驱动都按结构类型对接（方言包不依赖驱动包），方言与已有的
SQLite / PostgreSQL 相同，查询写法不变：

| 驱动            | 适配器                                      | 事务                     | 说明                                      |
| --------------- | ------------------------------------------- | ------------------------ | ----------------------------------------- |
| `bun:sqlite`    | `sqlite(new Database(path))`                | 有                       | 与 node:sqlite 是同一个适配器             |
| Cloudflare D1   | `d1(env.DB)`                                | 没有（类型上就没有方法） | Worker 绑定；bigint、字节自动转成可绑定值 |
| libSQL / Turso  | `libsql(createClient({ url, authToken }))`  | 有（交互式）             | 本地文件库与远端 Turso 同一个 Client      |
| PGlite          | `pglite(new PGlite())`（入口 `-pg/pglite`） | 有                       | WASM 版 PG，进程内；不用装 `pg`           |
| Neon serverless | `postgres(new Pool({ connectionString }))`  | 有                       | Neon 的 `Pool` 与 `pg.Pool` 兼容          |

```ts
// Cloudflare Worker
export default {
  async fetch(request, env) {
    const db = createDb({ schema, adapter: d1(env.DB) });
    return Response.json(
      await db
        .queryable(User)
        .where((u) => u.age.ge(18))
        .toList(),
    );
  },
};

// 单测：不起容器的 PostgreSQL
import { PGlite } from '@electric-sql/pglite';
import { pglite } from '@zerodep-dev/easy-query-ts-pg/pglite';
const db = createDb({ schema, adapter: pglite(new PGlite()) });
```

## 各驱动的注意点

- **bun:sqlite**：大整数在打开库时传 `new Database(path, { safeIntegers: true })`（node:sqlite 用 `sqlite(db, { bigInts: true })`）。
- **D1**：没有 `BEGIN … COMMIT`，`transaction`、`begin`、`lock`、`forUpdate` 在类型上不可调用；库内部要事务的地方（`save`、
  `syncTables`、迁移）依次执行，出错时不回滚。需要原子性的多条写入用 D1 自己的 `env.DB.batch()`。
- **libSQL**：同一个 Client 的事务按顺序排队（SQLite 只有一个写者，本地文件库并发开写事务会直接 `SQLITE_BUSY`）；
  只读事务用 `'read'` 模式并打开 `query_only`。大整数在建 Client 时传 `intMode: 'bigint'`。
  libSQL 自带的 SQLite 是 3.45：`truncate`、两个参数的 `log` 改用不依赖新版函数的写法（node:sqlite 上结果一样）。
- **PGlite**：只有一条连接，事务进行中其它异步代码的语句排在事务之后；两个事务互相等锁（`NOWAIT`、`SKIP LOCKED`）的写法会卡住。
  日期时间、int8、numeric 按文字读，再由列的 codec 解码，与 `pg` 驱动一致。
- **Neon**：HTTP 模式（`neon(url)`）没有交互式事务，没有单独适配；用 WebSocket 的 `Pool`。

## 测试

PGlite 跑 PostgreSQL 的完整共用套件，libSQL 跑 SQLite 的完整共用套件，CI 与本地都跑，不要容器
（`pg/test/pglite.test.ts`、`test/test/sqlite.libsql.test.ts`）。D1 用 node:sqlite 搭的替身验证绑定值与能力类型
（`test/test/sqlite.d1.test.ts`）；bun:sqlite 在本机用 Bun 跑过冒烟（增删改查、事务回滚、流式读、只读事务）。
