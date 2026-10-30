# TS：SQL 快照（eqts snapshot）

查询链改了一行、升级了 easy-query、加了一个方言，生成的 SQL 变没变？把关心的查询声明成快照，按每个方言渲染成文本提交进仓库，
评审时直接看 SQL 的差异：

```ts
// src/queries.snap.ts
import { defineSnapshots } from '@zerodep-dev/easy-query-ts';
import { PostgresDialect } from '@zerodep-dev/easy-query-ts-pg';
import { MySqlDialect } from '@zerodep-dev/easy-query-ts-mysql';

export default defineSnapshots({
  schema,
  dialects: { pg: new PostgresDialect(), mysql80: new MySqlDialect({ version: '8.0.18' }) },
  queries: {
    adults: (db) => db.queryable(User).where((u) => u.age.ge(18)),
    renameUser: (db) =>
      db
        .update(User)
        .set({ name: 'x' })
        .where((u) => u.id.eq(1)),
  },
});
```

```bash
eqts snapshot src/queries.snap.ts --out sql-snapshots           # 写 sql-snapshots/queries.snap.pg.sql 等
eqts snapshot src/queries.snap.ts --out sql-snapshots --check   # CI：快照没更新时失败并列出文件
```

快照文本按查询名排序，每段是名字、SQL、参数（bigint 带 `n`，字节写成十六进制）；某个方言不支持的写法写成一行
`-- error: …`，同样进差异：

```sql
-- adults
SELECT t0."name" AS "c0" FROM "t_user" t0 WHERE t0."age" >= ?;
-- params: [18]

-- postsByAuthor
-- error: rollup() is not supported by SQLite
```

- 不连库：查询函数拿到的 `db` 只能渲染（`toSQL`），执行会报错。查询与各种写入构造器都可以。
- `dialects` 的键是标签，用在文件名里：同一个方言的不同版本给不同的标签。
- 单测里也可以直接比：`renderSnapshots(def)` 返回 标签 → 文本，配合 Vitest 的 `toMatchFileSnapshot`。
- 定义文件由 Node 直接加载（Node 22.18+ 自己去掉类型），不经过仓库的 Babel 编译器：查询链要在运行时求值才能渲染，
  静态分析源码拿不到结果，所以快照写成显式的定义而不是从业务代码里扫描。

测试见 `test/test/snapshot.test.ts`。
