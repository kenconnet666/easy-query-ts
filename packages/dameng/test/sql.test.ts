import assert from 'node:assert/strict';
import { describe, it } from 'vitest';
import { createDb } from '@zerodep-dev/easy-query-ts';
import { Gadget, Post, schema, User } from '@zerodep-dev/easy-query-ts-test/fixture';
import { dameng } from '../src/index.ts';

const pool = {} as never;

describe('dameng: SQL text', () => {
  const db = createDb({ schema, adapter: dameng(pool) });

  it('与 Oracle 相同：:n 参数、表别名不写 AS、OFFSET … FETCH；条件当值写成 CASE WHEN', () => {
    assert.equal(
      db
        .queryable(User)
        .orderBy((u) => u.id)
        .offset(10)
        .limit(5)
        .select((u) => ({ adult: u.age.ge(18) }))
        .toSQL().sql,
      `SELECT CASE WHEN t0."age" >= :1 THEN 1 ELSE 0 END AS "c0" FROM "t_user" t0 ORDER BY t0."id" ASC OFFSET 10 ROWS FETCH NEXT 5 ROWS ONLY`,
    );
  });

  it('多行插入是一条多行 VALUES；给自增列写值时在块里打开 IDENTITY_INSERT', () => {
    const [insert] = db
      .insert(Post)
      .values([
        { userId: 1, title: 'a', amount: '1.00' },
        { userId: 2, title: 'b', amount: '2.00' },
      ])
      .toSQL();
    assert.equal(
      insert!.sql,
      `INSERT INTO "t_post" ("user_id", "title", "amount") VALUES (:1, :2, :3), (:4, :5, :6)`,
    );
    const [withId] = db
      .insert(Post)
      .values([{ id: 9, userId: 1, title: 'a', amount: '1.00' }])
      .toSQL();
    assert.equal(
      withId!.sql,
      `BEGIN SET IDENTITY_INSERT "t_post" ON; INSERT INTO "t_post" ("id", "user_id", "title", "amount") VALUES (:1, :2, :3, :4); SET IDENTITY_INSERT "t_post" OFF; END;`,
    );
  });

  it('建表：BIGINT IDENTITY(1, 1)、VARCHAR、BIT、TIME(3)、JSON 存 CLOB', () => {
    assert.equal(
      db.createTableSql(Gadget),
      `CREATE TABLE IF NOT EXISTS "t_gadget" ("id" BIGINT IDENTITY(1, 1) NOT NULL, "name" VARCHAR(50) NOT NULL,` +
        ` "price" DECIMAL(10, 2) NOT NULL, "qty" INT DEFAULT 0 NOT NULL, "active" BIT NOT NULL, "born" DATE, "seen_at" TIMESTAMP(3) NOT NULL,` +
        ` "tags" CLOB NOT NULL, "photo" BLOB, PRIMARY KEY ("id"), UNIQUE ("name"))`,
    );
  });
});
