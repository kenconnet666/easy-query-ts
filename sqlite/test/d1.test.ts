/**
 * Cloudflare D1：用 node:sqlite 搭一个 D1Database 的替身（prepare → bind → all，结果是 { results, meta }），
 * 验证适配器的绑定值转换、写入结果与能力类型。真正的 D1 在 Worker 里跑，这里不起 Miniflare
 */
import assert from 'node:assert/strict';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { describe, it } from 'vitest';
import { col, createDb, defineSchema, entity } from '@zerodep-dev/easy-query-ts';
import { d1, type D1Binding } from '../src/index.ts';

/** D1 的替身：bind 时拒绝 D1 不认的值（bigint、Uint8Array、undefined），与真 D1 一样 */
function fakeD1(database: DatabaseSync): D1Binding {
  return {
    prepare: (sql) => {
      const statement = (values: unknown[]) => ({
        bind: (...next: unknown[]) => {
          for (const v of next)
            if (typeof v === 'bigint' || v instanceof Uint8Array || v === undefined)
              throw new TypeError(`D1_TYPE_ERROR: type '${typeof v}' not supported`);
          return statement(next);
        },
        all: async () => {
          const prepared = database.prepare(sql);
          const params = values.map((v) =>
            v instanceof ArrayBuffer ? new Uint8Array(v) : (v as SQLInputValue),
          );
          if (prepared.columns().length > 0)
            return { results: prepared.all(...params) as Record<string, unknown>[], meta: {} };
          const result = prepared.run(...params);
          return {
            results: [],
            meta: { changes: Number(result.changes), last_row_id: Number(result.lastInsertRowid) },
          };
        },
      });
      return statement([]);
    },
  };
}

const Note = entity('t_d1_note', {
  id: col.int().primaryKey().generated(),
  body: col.string(),
  big: col.bigint({ mode: 'bigint' }),
  raw: col.bytes(),
});

describe('d1', async () => {
  const db = createDb({
    schema: defineSchema({ Note }),
    adapter: d1(fakeD1(new DatabaseSync(':memory:'))),
  });
  await db.createTables();

  it('写入、取回自增主键、读回：bigint 与字节转成 D1 能绑定的值', async () => {
    const id = await db
      .insert(Note)
      .values({ body: 'hi', big: 42n, raw: new Uint8Array([1, 2, 3]) })
      .returnId();
    assert.equal(Number(id), 1);
    const row = await db.queryable(Note).findOrThrow(1);
    assert.deepEqual(
      { body: row.body, big: row.big, raw: [...row.raw] },
      { body: 'hi', big: 42n, raw: [1, 2, 3] },
    );
    assert.equal(
      await db
        .update(Note)
        .set({ body: 'bye' })
        .where((n) => n.id.eq(1))
        .execute(),
      1,
    );
  });

  it('没有交互式事务：类型上没有 transaction、lock、forUpdate', () => {
    if (Math.random() > 2) {
      // @ts-expect-error D1 没有事务
      void db.transaction(async () => {});
      // @ts-expect-error D1 没有行锁
      void db.lock(Note, 1);
      // @ts-expect-error D1 没有 FOR UPDATE
      db.queryable(Note).forUpdate();
    }
  });
});
