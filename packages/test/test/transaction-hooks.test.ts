// 事务的钩子（afterCommit / afterRollback）与保存点、begin() 的配合，lock() 在 SQLite 上的写法；跨方言的行为在 src/suite.ts
import assert from 'node:assert/strict';
import { describe, it } from 'vitest';
import { createDb, DeadlockError } from '@zerodep-dev/easy-query-ts';
import { SqliteDialect } from '@zerodep-dev/easy-query-ts-sqlite';
import { schema, seed, User } from '../src/fixture.ts';
import { memoryDb } from '../src/sqlite-env.ts';

describe('sqlite: transaction hooks and lock', () => {
  it('钩子只能在事务里登记', async () => {
    const { db } = await memoryDb();
    assert.throws(() => db.afterCommit(() => {}), /inside a transaction/);
    await assert.rejects(db.lock(User, 1), /inside a transaction/);
  });

  it('保存点回滚：它登记的提交后的事丢掉、回滚后的事马上执行；成功的保存点并进外层', async () => {
    const { db } = await seed(await memoryDb());
    const seen: string[] = [];
    await db.transaction(async (tx) => {
      await tx
        .transaction(async (inner) => {
          inner.afterCommit(() => seen.push('inner failed: commit'));
          inner.afterRollback(() => seen.push('inner failed: rollback'));
          throw new Error('inner');
        })
        .catch(() => undefined);
      await tx.transaction(async (inner) => {
        inner.afterCommit(() => seen.push('inner ok: commit'));
      });
      tx.afterCommit(() => seen.push('outer: commit'));
      assert.deepEqual(seen, ['inner failed: rollback']);
    });
    assert.deepEqual(seen, ['inner failed: rollback', 'inner ok: commit', 'outer: commit']);
  });

  it('提交后的钩子出错：数据已提交，错误抛给调用方；别的钩子照常执行', async () => {
    const { db } = await seed(await memoryDb());
    const seen: string[] = [];
    await assert.rejects(
      db.transaction(async (tx) => {
        await tx
          .update(User)
          .set({ age: 99 })
          .where((u) => u.id.eq(1))
          .execute();
        tx.afterCommit(() => {
          throw new Error('mail down');
        });
        tx.afterCommit(() => seen.push('cache cleared'));
      }),
      /mail down/,
    );
    assert.deepEqual(seen, ['cache cleared']);
    assert.equal((await db.queryable(User).findOrThrow(1)).age, 99);
  });

  it('begin()：commit 后执行提交后的事，离开作用域自动回滚时执行回滚后的事', async () => {
    const { db } = await seed(await memoryDb());
    const seen: string[] = [];
    {
      await using tx = await db.begin();
      tx.afterCommit(() => seen.push('commit'));
      await tx.commit();
    }
    {
      await using tx = await db.begin();
      tx.afterRollback(() => seen.push('rollback'));
    }
    assert.deepEqual(seen, ['commit', 'rollback']);
  });

  it('begin()：事务没开起来时只把错误交给调用方，不留下未处理的拒绝', async () => {
    const { adapter } = await memoryDb();
    const down = {
      ...adapter,
      driver: Object.assign(Object.create(adapter.driver), {
        transaction: () => Promise.reject(new Error('connect failed')),
      }),
    };
    const unhandled: unknown[] = [];
    const record = (reason: unknown) => unhandled.push(reason);
    process.on('unhandledRejection', record);
    try {
      await assert.rejects(createDb({ schema, adapter: down }).begin(), /connect failed/);
      // 未处理的拒绝在微任务清空之后才报
      await new Promise((resolve) => setTimeout(resolve, 20));
      assert.deepEqual(unhandled, []);
    } finally {
      process.off('unhandledRejection', record);
    }
  });

  it('保存点的名字在一个事务里不重复：从 tx 派生的 Db（withTimeout 等）接着同一个序号', async () => {
    const env = await seed(await memoryDb());
    env.statements.length = 0;
    await env.db.transaction((tx) =>
      tx.transaction((inner) =>
        inner.withTimeout(1000).transaction((innermost) => innermost.queryable(User).count()),
      ),
    );
    assert.deepEqual(
      env.statements.map((s) => s.sql).filter((sql) => sql.startsWith('SAVEPOINT')),
      ['SAVEPOINT eqts_sp_1', 'SAVEPOINT eqts_sp_2'],
    );
  });

  it('retries：死锁、串行化失败时把整个事务重来；别的错误、用完次数就抛出', async () => {
    const { adapter } = await seed(await memoryDb());
    // 方言把消息里带 deadlock 的错误认成死锁：模拟库挑中这个事务回滚
    const dialect = new (class extends SqliteDialect {
      override errorKind(error: unknown) {
        return /deadlock/.test(String(error)) ? ('deadlock' as const) : super.errorKind(error);
      }
    })();
    const db = createDb({ schema, adapter: { ...adapter, dialect } });
    const seen: string[] = [];
    let attempts = 0;
    const flaky = (failures: number) => async (tx: typeof db) => {
      attempts += 1;
      await tx
        .update(User)
        .set({ age: attempts })
        .where((u) => u.id.eq(1))
        .execute();
      tx.afterCommit(() => seen.push(`committed on attempt ${attempts}`));
      if (attempts <= failures) throw new Error('deadlock detected');
      return attempts;
    };
    assert.equal(await db.transaction(flaky(2), { retries: 3 }), 3);
    // 前两遍回滚了：提交后的事只做了一次，库里是第三遍写的值
    assert.deepEqual(seen, ['committed on attempt 3']);
    assert.equal((await db.queryable(User).findOrThrow(1)).age, 3);

    attempts = 0;
    await assert.rejects(db.transaction(flaky(5), { retries: 1 }), DeadlockError);
    assert.equal(attempts, 2);

    attempts = 0;
    await assert.rejects(
      db.transaction(
        async () => {
          attempts += 1;
          throw new Error('something else');
        },
        { retries: 3 },
      ),
      /something else/,
    );
    assert.equal(attempts, 1);
    await assert.rejects(
      db.transaction((tx) => tx.transaction(async () => 1, { retries: 1 })),
      /outermost transaction/,
    );
  });

  it('lock()：SQLite 用一条把主键写回自己的 UPDATE 拿写锁，不经拦截器', async () => {
    const env = await seed(await memoryDb());
    env.statements.length = 0;
    await env.db.transaction((tx) => tx.lock(User, 1));
    const lock = env.statements.find((s) => s.sql.startsWith('UPDATE'));
    assert.equal(lock?.sql, 'UPDATE "t_user" AS t0 SET "id" = t0."id" WHERE t0."id" = ?');
  });
});
