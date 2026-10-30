import assert from 'node:assert/strict';
import { describe, it } from 'vitest';
import type { Pool } from 'mysql2/promise';
import { col, createDb, Dialect, entity, win, type Driver } from '@zerodep-dev/easy-query-ts';
import {
  ddlSchema,
  Gadget,
  Post,
  schema,
  Token,
  User,
} from '@zerodep-dev/easy-query-ts-test/fixture';
import { MySQL, mysql } from '../src/index.ts';

describe('mysql: SQL text', () => {
  // 只渲染不执行，不需要真的连接池
  const db = createDb({ schema, adapter: mysql({} as Pool) });

  it('quotes with backticks and relies on the default LIKE escape', () => {
    const s = db
      .queryable(User)
      .where((u) => [u.name.startsWith('a_'), u.company.name.eq('acme')])
      .select((u) => ({ id: u.id }))
      .toSQL();
    assert.equal(
      s.sql,
      'SELECT t0.`id` AS `c0` FROM `t_user` t0 LEFT JOIN `t_company` t1 ON t1.`id` = t0.`company_id` WHERE t0.`name` LIKE ? AND t1.`name` = ?',
    );
    assert.deepEqual(s.params, [String.raw`a\_%`, 'acme']);
  });

  it('adds a LIMIT when only an offset is given', () => {
    assert.match(db.queryable(User).offset(5).toSQL().sql, / LIMIT 18446744073709551615 OFFSET 5$/);
  });

  it('locks rows for update', () => {
    assert.match(
      db
        .queryable(User)
        .where((u) => u.id.eq(1))
        .forUpdate()
        .toSQL().sql,
      / FOR UPDATE$/,
    );
  });

  it('renders deletes with a table alias (MySQL 8.0.16+)', () => {
    assert.equal(
      db
        .delete(User)
        .where((u) => u.id.eq(1))
        .toSQL().sql,
      'DELETE FROM `t_user` AS t0 WHERE t0.`id` = ?',
    );
  });
  it('renders MySQL.* functions', () => {
    const s = db
      .queryable(User)
      .where((u) => [
        MySQL.json(u.attrs).contains('"vip"', '$.tags'),
        MySQL.match(u.name).against('easy', 'boolean'),
      ])
      .select((u) => ({ id: u.id }))
      .toSQL();
    assert.equal(
      s.sql,
      'SELECT t0.`id` AS `c0` FROM `t_user` t0 WHERE JSON_CONTAINS(t0.`attrs`, ?, ?) AND MATCH(t0.`name`) AGAINST(? IN BOOLEAN MODE)',
    );
  });

  it('rejects MySQL.* functions on other dialects when rendering', () => {
    class Plain extends Dialect {
      readonly name = 'plain';
    }
    const other = createDb({ schema, adapter: { dialect: new Plain(), driver: {} as Driver } });
    assert.throws(
      () =>
        other
          .queryable(User)
          .where((u) => MySQL.json(u.attrs).contains('1'))
          .toSQL(),
      /mysql.json_contains' is not supported by the plain dialect/,
    );
  });
});

describe('mysql: JSON edits and jsonSome', () => {
  const db = createDb({ schema, adapter: mysql({} as Pool) });
  type Order = { items: { sku: string; qty: number }[] };
  const JOrder = entity('t_jorder', { id: col.int().primaryKey(), body: col.json<Order>() });

  it('renders JSON_SET with a JSON parameter and counts JSON_TABLE rows instead of EXISTS', () => {
    const s = db
      .update(JOrder)
      .set((o) => ({ body: o.body.jsonSet(['items', 0, 'qty'], 2) }))
      .where((o) =>
        o.body.jsonSome(['items'], { sku: col.string(), qty: col.int() }, (it) => [
          it.sku.eq('A1'),
          it.qty.gt(2),
        ]),
      )
      .toSQL();
    assert.equal(
      s.sql,
      'UPDATE `t_jorder` AS t0 SET `body` = JSON_SET(t0.`body`, \'$."items"[0]."qty"\', CAST(? AS JSON))' +
        ' WHERE ((SELECT COUNT(*) FROM JSON_TABLE(t0.`body`, \'$."items"[*]\' COLUMNS (`sku` VARCHAR(255) PATH \'$."sku"\', `qty` INT PATH \'$."qty"\')) eq_j' +
        ' WHERE eq_j.`sku` = ? AND eq_j.`qty` > ?) > 0)',
    );
  });
});

describe('mysql: batched writes', () => {
  const db = createDb({ schema, adapter: mysql({} as Pool) });

  it('splits a bulk insert by the server max_allowed_packet', () => {
    const small = createDb({ schema, adapter: mysql({} as Pool, { maxPacket: 8000 }) });
    const rows = Array.from({ length: 10 }, (_, i) => ({
      userId: 1,
      title: `${i}`.padEnd(800, 'x'),
      amount: '1.00' as const,
    }));
    const statements = small.insert(Post).values(rows).toSQL();
    // 预算 6000 字节、每行估计 2400 多：两行一条
    assert.equal(statements.length, 5);
    for (const s of statements) assert.ok(s.sql.length + s.params.join('').length < 8000);
    // 默认按 4 MiB：一条
    assert.equal(db.insert(Post).values(rows).toSQL().length, 1);
  });

  it('writes orderBy().limit(n) on a delete as ORDER BY … LIMIT', () => {
    assert.equal(
      db
        .delete(Post)
        .where((p) => p.userId.eq(1))
        .orderBy((p) => p.id)
        .limit(500)
        .toSQL().sql,
      'DELETE FROM `t_post` AS t0 WHERE t0.`user_id` = ? ORDER BY t0.`id` LIMIT 500',
    );
  });
});

describe('mysql: code-first DDL', () => {
  const db = createDb({ schema, adapter: mysql({ query: async () => [[]] } as unknown as Pool) });

  it('renders CREATE TABLE with MySQL types and AUTO_INCREMENT', () => {
    assert.equal(
      db.createTableSql(Gadget),
      'CREATE TABLE IF NOT EXISTS `t_gadget` (`id` BIGINT AUTO_INCREMENT NOT NULL, `name` VARCHAR(50) NOT NULL, `price` DECIMAL(10, 2) NOT NULL,' +
        ' `qty` INT NOT NULL DEFAULT 0, `active` BOOLEAN NOT NULL, `born` DATE, `seen_at` DATETIME(3) NOT NULL, `tags` JSON NOT NULL, `photo` BLOB, PRIMARY KEY (`id`), UNIQUE (`name`))',
    );
  });

  it('stores uuids as BINARY(16) and binds them as 16 bytes; unsigned columns get UNSIGNED; native enums are ENUM(…)', () => {
    assert.equal(
      db.createTableSql(Token),
      "CREATE TABLE IF NOT EXISTS `t_token` (`id` BINARY(16) NOT NULL, `owner` BINARY(16), `hits` BIGINT UNSIGNED NOT NULL, `level` ENUM('low', 'mid', 'high') NOT NULL, PRIMARY KEY (`id`))",
    );
    const { params } = db
      .queryable(Token)
      .where((t) => t.owner.eq('0192F3A4-1B2C-7D8E-9F01-23456789ABCD'))
      .toSQL();
    assert.deepEqual(params, [Buffer.from('0192f3a41b2c7d8e9f0123456789abcd', 'hex')]);
  });

  it('asks for an explicit dbType when the kind has no database type', () => {
    const Odd = entity('t_odd', { v: col.custom<string>('geometry', String, String) });
    assert.throws(() => db.createTableSql(Odd), /dbType/);
    assert.match(
      db.createTableSql(
        entity('t_odd', { v: col.custom<string>('geometry', String, String).dbType('POINT') }),
      ),
      /`v` POINT NOT NULL/,
    );
  });
});

describe('mysql: create statements with comments, indexes and foreign keys', async () => {
  const db = createDb({ schema: ddlSchema, adapter: mysql({} as Pool) });

  it('renders every statement in order', () => {
    assert.deepEqual(db.createTablesSql(), [
      "CREATE TABLE IF NOT EXISTS `t_shelf` (`id` BIGINT AUTO_INCREMENT NOT NULL, `name` VARCHAR(50) NOT NULL COMMENT '书架''s 名', PRIMARY KEY (`id`)) COMMENT='书架'",
      'CREATE TABLE IF NOT EXISTS `t_book` (`id` BIGINT AUTO_INCREMENT NOT NULL, `shelf_id` BIGINT NOT NULL, `title` VARCHAR(100) NOT NULL, PRIMARY KEY (`id`))',
      'CREATE UNIQUE INDEX `t_book_shelf_id_title_uidx` ON `t_book` (`shelf_id`, `title`)',
      'ALTER TABLE `t_book` ADD CONSTRAINT `fk_t_book_shelf_id` FOREIGN KEY (`shelf_id`) REFERENCES `t_shelf` (`id`) ON DELETE CASCADE',
    ]);
  });
});

describe('mysql: rendering by server version', () => {
  const at = (version?: '8.0.18' | '8.0.16' | '5.7') =>
    createDb({ schema, adapter: mysql({} as Pool, version ? { version } : {}) });
  const upsert = (db: ReturnType<typeof at>) =>
    db
      .insert(User)
      .values({ id: 1, name: 'a', createdAt: new Date(0), attrs: { tags: [] } })
      .onConflict((u) => u.id)
      .merge((u) => u.name)
      .toSQL()[0]!.sql;

  it('upsert：8.0.19 起用行别名，8.0.18（PolarDB）用 VALUES()', () => {
    assert.match(upsert(at()), / AS eq_new ON DUPLICATE KEY UPDATE `name` = eq_new\.`name`$/);
    assert.match(upsert(at('8.0.18')), / ON DUPLICATE KEY UPDATE `name` = VALUES\(`name`\)$/);
  });

  it('用到更高版本的特性时报出最低版本', () => {
    assert.throws(
      () =>
        at('8.0.16')
          .queryable(User)
          .where((u) => MySQL.json(u.attrs).overlaps('["vip"]'))
          .toSQL(),
      /JSON_OVERLAPS needs mysql 8\.0\.17 or later \(the dialect is configured for 8\.0\.16\)/,
    );
    assert.throws(
      () =>
        at('5.7')
          .queryable(User)
          .select((u) => ({ n: win.rowNumber((w) => w.orderBy(u.id)) }))
          .toSQL(),
      /window functions needs mysql 8\.0 or later/,
    );
  });
});
