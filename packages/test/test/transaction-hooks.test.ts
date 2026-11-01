// 事务的钩子（afterCommit / afterRollback）与保存点、begin() 的配合，lock() 在 SQLite 上的写法；跨方言的行为在 src/suite.ts
import assert from 'node:assert/strict';
import { describe, it } from 'vitest';
import { seed, User } from '../src/fixture.ts';
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

  it('lock()：SQLite 用一条把主键写回自己的 UPDATE 拿写锁，不经拦截器', async () => {
    const env = await seed(await memoryDb());
    env.statements.length = 0;
    await env.db.transaction((tx) => tx.lock(User, 1));
    const lock = env.statements.find((s) => s.sql.startsWith('UPDATE'));
    assert.equal(lock?.sql, 'UPDATE "t_user" AS t0 SET "id" = t0."id" WHERE t0."id" = ?');
  });
});
