import assert from 'node:assert/strict';
import { describe, it } from 'vitest';
import type { Pool } from 'mysql2/promise';
import { col, createDb, Dialect, entity, win, type Driver } from '@zerodep-dev/easy-query-ts';
import { ddlSchema, Gadget, schema, Token, User } from '@zerodep-dev/easy-query-ts-test/fixture';
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

describe('mysql: toList() in one statement', () => {
  it('aggregates the children with JSON_ARRAYAGG, binary columns as hex; needs 8.0.14', () => {
    const db = createDb({ schema, adapter: mysql({} as Pool) });
    assert.equal(
      db
        .queryable(User)
        .where((u) => u.id.eq(1))
        .select((u) => ({
          name: u.name,
          posts: u.posts
            .orderBy((p) => p.id.desc())
            .limit(2)
            .toList((p) => ({ title: p.title, amount: p.amount })),
        }))
        .listStrategy('json')
        .toSQL().sql,
      "SELECT t0.`name` AS `c0`, (SELECT COALESCE(JSON_ARRAYAGG(JSON_OBJECT('c0', eq_l.`c0`, 'c1', eq_l.`c1`, 'eq_ord', eq_l.`eq_ord`)), JSON_ARRAY())" +
        ' FROM (SELECT CAST(t1.`title` AS CHAR) AS `c0`, CAST(t1.`amount` AS CHAR) AS `c1`, ROW_NUMBER() OVER (ORDER BY t1.`id` DESC) AS `eq_ord`' +
        ' FROM `t_post` t1 WHERE t1.`user_id` = t0.`id` ORDER BY t1.`id` DESC LIMIT 2) eq_l) AS `c1` FROM `t_user` t0 WHERE t0.`id` = ?',
    );
    const old = createDb({ schema, adapter: mysql({} as Pool, { version: '8.0.13' }) });
    assert.throws(
      () =>
        old
          .queryable(User)
          .select((u) => ({ posts: u.posts.toList() }))
          .listStrategy('json')
          .toSQL(),
      /8\.0\.14/,
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
