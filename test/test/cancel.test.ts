// 语句的超时与取消（ROADMAP 19.3）：核心把 Db 的信号与每条语句的超时合成一个信号交给驱动，到点调用方立刻失败
import assert from 'node:assert/strict';
import { describe, it } from 'vitest';
import { createDb, defineSchema, type Driver } from '@zerodep-dev/easy-query-ts';
import { SqliteDialect } from '@zerodep-dev/easy-query-ts-sqlite';
import { memoryDb } from '../src/sqlite-env.ts';

/** 永远不返回的驱动：记下每条语句收到的信号 */
function hangingDriver(signals: (AbortSignal | undefined)[]): Driver {
  const hang = (_sql: string, _params: readonly unknown[], signal?: AbortSignal) => {
    signals.push(signal);
    return new Promise<never>(() => {});
  };
  return { query: hang, execute: hang, transaction: (work) => work(hangingDriver(signals)) };
}

describe('withTimeout / statementTimeout', () => {
  it('每条语句各自计时：到点以 TimeoutError 失败，驱动收到的信号也触发了', async () => {
    const signals: (AbortSignal | undefined)[] = [];
    const db = createDb({
      schema: defineSchema({}),
      adapter: { dialect: new SqliteDialect(), driver: hangingDriver(signals) },
    });
    const started = Date.now();
    await assert.rejects(db.withTimeout(50).sql`SELECT 1`, { name: 'TimeoutError' });
    assert.ok(Date.now() - started < 1000);
    assert.equal(signals[0]?.aborted, true);
    // 没设超时、没设信号：驱动收到 undefined
    void db.sql`SELECT 2`.catch(() => undefined);
    assert.equal(signals[1], undefined);
  });

  it('Db 的信号与超时谁先到算谁；createDb 的 statementTimeout 是默认值', async () => {
    const signals: (AbortSignal | undefined)[] = [];
    const db = createDb({
      schema: defineSchema({}),
      adapter: { dialect: new SqliteDialect(), driver: hangingDriver(signals) },
      statementTimeout: 5000,
    });
    const controller = new AbortController();
    const pending = db.withSignal(controller.signal).sql`SELECT 1`;
    controller.abort(new Error('stop'));
    await assert.rejects(pending, /stop/);
    assert.equal(signals[0]?.aborted, true);
    assert.throws(() => db.withTimeout(0), /positive number of milliseconds/);
  });
});

describe('advisoryLock / notify on dialects without them', () => {
  it('reports them as not supported; advisoryLock also needs a transaction', async () => {
    const { db } = await memoryDb();
    await assert.rejects(db.notify('x', 'y'), /notify\(\) is not supported by the sqlite dialect/);
    await assert.rejects(db.advisoryLock('x'), /inside a transaction/);
    await assert.rejects(
      db.transaction((tx) => tx.advisoryLock('x')),
      /advisoryLock\(\) is not supported by the sqlite dialect/,
    );
  });
});
