import assert from 'node:assert/strict';
import { describe, it } from 'vitest';
import { createDb } from '@zerodep-dev/easy-query-ts';
import { Gadget, Post, schema } from '@zerodep-dev/easy-query-ts-test/fixture';
import { kingbase, opengauss, postgres } from '../src/index.ts';

const pool = {} as never;

describe('PG 协议的兼容库: SQL text', () => {
  const gauss = createDb({ schema, adapter: opengauss(pool) });
  const kb = createDb({ schema, adapter: kingbase(pool) });
  const pgDb = createDb({ schema, adapter: postgres(pool) });

  it('openGauss：upsert 写成 ON DUPLICATE KEY UPDATE；自增列是 BIGSERIAL', () => {
    const [upsert] = gauss
      .insert(Post)
      .values([{ id: 1, userId: 1, title: 'a', amount: '1.00' }])
      .onConflict((p) => p.id)
      .merge((p) => [p.title])
      .toSQL();
    assert.equal(
      upsert!.sql,
      `INSERT INTO "t_post" ("id", "user_id", "title", "amount") VALUES ($1, $2, $3, $4) ON DUPLICATE KEY UPDATE "title" = VALUES("title")`,
    );
    assert.match(
      gauss.createTableSql(Gadget),
      /^CREATE TABLE IF NOT EXISTS "t_gadget" \("id" BIGSERIAL NOT NULL, /,
    );
  });

  it('金仓（PG 模式）：与 PG 相同', () => {
    const sql = (db: typeof kb) => db.createTableSql(Gadget);
    assert.equal(sql(kb), sql(pgDb));
  });
});
