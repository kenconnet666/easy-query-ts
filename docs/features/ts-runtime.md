# TS：流式读取、取消、嵌套事务、`await using`、提交后的回调与锁、只读事务

## 流式读取 `stream()`

```ts
for await (const order of db.queryable(Order).orderBy(o => o.id).stream({ batchSize: 500 })) {
  await export(order)            // 不把整个结果集读进内存
}
```

| 方言   | 实现                                                                                                                                                       |
| ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| MySQL  | mysql2 的结果流；池级会话借一条专用连接，读完归还，**中途 `break` 就销毁这条连接**（服务端随之终止查询）；事务里中途放弃时把剩余的行读掉丢弃，事务照常可用 |
| PG     | 服务端游标：`DECLARE … CURSOR` + 分批 `FETCH`（池级自动开临时事务，事务里直接声明），不需要 `pg-cursor` 依赖                                               |
| SQLite | `node:sqlite` 的 `iterate`                                                                                                                                 |
| HANA   | 驱动没有流：退化成一次读完再分批产出（API 一致，没有省内存）                                                                                               |

不能和 `toList()` 导航（对象树）一起用——对象树要先拿到所有父行，会报错。`onExecute` 在流结束（或被放弃）时触发，`rows` 是实际产出的行数。

## 取消与超时：`withSignal`、`withTimeout`

```ts
const rows = await db.withTimeout(5000).queryable(Order).toList(); // 每条语句最多 5 秒
const ac = new AbortController();
req.on('close', () => ac.abort()); // 客户端断开就取消
await db.withSignal(ac.signal).transaction(async (tx) => { … });
createDb({ schema, adapter, statementTimeout: 30_000 }); // 整个 Db 的默认
```

通过这个 Db 发出的所有语句（含事务、`db.sql`）遵守信号与超时：已取消的信号让新语句直接失败；执行中取消或超时则**立刻**以信号的
`reason` 失败（超时是 `TimeoutError`）。超时每条语句各自计时；`stream()` 只受信号控制，不受超时限制。

**服务端也停下**（ROADMAP 19.3）：PG 驱动从池里另一条连接发 `pg_cancel_backend(进程号)`，MySQL 驱动发 `KILL QUERY 线程号`，
正在跑的语句在库里被终止（连接保留、还回池里照常可用）；事务里取消时语句失败、事务随之回滚。为了知道语句跑在哪个连接上，
带信号或超时的语句会先从池里借一条连接；取消请求发完才归还，不会落到复用这条连接的下一条语句上。
别的库的驱动只做到"客户端不再等"，库里的语句照样跑完。驱动在 `Session.query / execute` 的第三个参数收到这条语句的信号。

## 咨询锁与通知（PG，ROADMAP 19.10）

```ts
await db.transaction(async (tx) => {
  if (!(await tx.advisoryLock(`report:${month}`, { wait: false }))) return; // 别人在做，跳过
  …
}); // 事务结束自动释放

const stop = await listen(pool, 'cache_evict', (key) => cache.delete(key)); // easy-query-ts-pg 的 listen
await db.notify('cache_evict', 'user:7'); // 在事务里时随提交发出、回滚不发
await stop();
```

- `advisoryLock(名字, { wait })`：事务级的咨询锁（`pg_advisory_xact_lock`，名字经 `hashtextextended` 哈希成 64 位整数），没有对应的行也能锁，
  跨进程、跨机器生效；`wait: false` 拿不到立即返回 false。只能在事务里用。
- `notify(频道, 内容)` 是 `pg_notify`；收听用 PG 包的 `listen(pool, 频道, handler)`：借一条专用连接 LISTEN，返回的函数 UNLISTEN 并归还连接，
  连接断了不自动重连。二级缓存的跨进程失效、事件推送可以接它。
- 别的库渲染时报不支持（MySQL 的 GET_LOCK 是连接级的，提交时释放不了，没有做）。

## 嵌套事务（保存点）

```ts
await db.transaction(async (tx) => {
  await tx.insert(A).values(a).execute();
  try {
    await tx.transaction(async (inner) => {
      await inner.insert(B).values(b).execute();
      throw new Error('x');
    });
  } catch {
    /* B 回滚了，A 还在 */
  }
});
```

在事务里再调用 `transaction()` 开的是保存点：成功就释放，失败只回滚到保存点，异常仍然抛出（由你决定吞不吞）。嵌套事务不能改隔离级别或只读（要在最外层设）。HANA 没有 `RELEASE SAVEPOINT`，跳过这一步。

## `await using`（Node 24 / TS 5.2+）

```ts
await using tx = await db.begin({ isolation: 'repeatable read' });
await tx.insert(User).values(row).execute();
if (bad) return; // 提前返回：离开作用域自动回滚
await tx.commit(); // 提交之后再离开作用域是安全的（回滚是空操作）
```

`begin()` 用驱动现有的回调式事务实现：回调里等一个"提交 / 回滚"的决定，决定下来回调才返回，驱动随即提交或回滚，所以各库行为与 `transaction()` 完全一致。`commit()` / `rollback()` 只能各用一次，已结束再 `commit()` 报错。

## 提交后的回调、锁一行、改到的行数

```ts
await db.transaction(async (tx) => {
  if (!(await tx.lock(Instance, id))) throw new NotFound(id); // 锁住这一行直到事务结束；返回它在不在
  await tx
    .update(WorkItem)
    .set({ state: 'done' })
    .where((w) => [w.id.eq(itemId), w.state.eq('open')])
    .expectRows(1, () => new AlreadyHandled(itemId)) // 改到的不是 1 行就抛这个错，整个事务回滚
    .execute();
  tx.afterCommit(() => notify(itemId)); // 提交之后才执行；回滚了不执行
});
```

- `afterCommit` / `afterRollback` 只能在事务里调用。保存点（嵌套事务）里登记的：保存点成功就并进外层，跟着外层提交或回滚；
  保存点回滚时丢掉它登记的提交后的事、马上执行它登记的回滚后的事。提交后的钩子出错时数据已经提交，错误抛给发起事务的调用方，别的钩子照常执行。
- `lock(实体, 主键)`：有行锁的库是 `SELECT … FOR UPDATE`；SQLite 没有行锁，写成一条把主键写回自己的 `UPDATE`，让延迟事务马上拿到写锁
  （否则两个事务都先读后写会互相等）。锁不经拦截器（不加租户条件、不改更新时间）、不动版本列。
- `expectRows(行数, 错误)`：`update`、`delete` 上用，带状态条件的更新改到 0 行说明已被别人处理。

## 只读事务

`db.transaction(work, { readOnly: true })`：MySQL `START TRANSACTION READ ONLY`、PG `BEGIN … READ ONLY`、HANA `SET TRANSACTION READ ONLY`；SQLite 没有只读事务，用 `PRAGMA query_only` 让写入被拒绝，事务结束后还原。

## 读写分离 `replicas`

```ts
const db = createDb({
  schema,
  adapter: mysql(primaryPool),
  replicas: [mysql(replicaPool1), mysql(replicaPool2)],
});
await db.queryable(Order).toList(); // 事务外的读：按轮询走从库
await db
  .update(Order)
  .set({ state: 'paid' })
  .where((o) => o.id.eq(id))
  .execute(); // 写入：主库
await db.usePrimary().queryable(Order).findOrThrow(id); // 刚写完马上要读到：强制主库
```

写入（含 RETURNING、读改之前的行、`returnEntity` 的回查）、事务里的一切、`introspect` / `syncTables` 都走主库；从库要是同一种库。
`db.sql` 的查询属于读，写语句带 RETURNING 时先 `usePrimary()`。从库延迟由库自己负责，库层不做"写后读"的自动粘连。

## 验证与限制

SQLite、MySQL 8.0.18 / 8.4、PG 17 实测；HANA 随 CI（流式读取、保存点释放、只读事务的 HANA 写法按文档，未实库验证）。实测中发现并修了 MySQL 池级流式读取中途放弃会泄漏连接的问题。
