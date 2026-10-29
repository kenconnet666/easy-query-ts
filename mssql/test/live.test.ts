/**
 * 在实库上跑共用套件。EQTS_MSSQL_URL=mssql://sa:密码@127.0.0.1:21433，未设置时跳过（容器：infra/dev/db.sh --profile mssql up -d）。
 * 每个用例重建 eqts 库里的表。
 */
import assert from 'node:assert/strict';
import { afterAll, describe, it } from 'vitest';
import sql from 'mssql';
import { createDb, greatest, least, type Statement } from '@zerodep-dev/easy-query-ts';
import { Post, schema, seed, User, type TestEnv } from '@zerodep-dev/easy-query-ts-test/fixture';
import { liveSuite } from '@zerodep-dev/easy-query-ts-test/suite';
import { mssql, type SqlServerVersion } from '../src/index.ts';

const TABLES = [
  't_dept',
  't_doc',
  't_note',
  't_member',
  't_user_role',
  't_role',
  't_ext',
  't_comment',
  't_post',
  't_user',
  't_company',
];

const DDL = [
  'CREATE TABLE t_company (id BIGINT IDENTITY(1,1) PRIMARY KEY, name NVARCHAR(100) NOT NULL)',
  'CREATE TABLE t_user (id BIGINT IDENTITY(1,1) PRIMARY KEY, name NVARCHAR(100) NOT NULL, age INT, company_id BIGINT, attrs NVARCHAR(MAX) NOT NULL, created_at DATETIME2(3) NOT NULL)',
  'CREATE TABLE t_post (id BIGINT IDENTITY(1,1) PRIMARY KEY, user_id BIGINT NOT NULL, title NVARCHAR(200) NOT NULL, amount DECIMAL(12,2) NOT NULL)',
  'CREATE TABLE t_comment (id BIGINT IDENTITY(1,1) PRIMARY KEY, post_id BIGINT NOT NULL, body NVARCHAR(200) NOT NULL)',
  'CREATE TABLE t_ext (id BIGINT IDENTITY(1,1) PRIMARY KEY, amount DECIMAL(12,2) NOT NULL, big BIGINT NOT NULL, day DATE NOT NULL, starts_at DATETIME2(3) NOT NULL, at DATETIME2(3) NOT NULL, clock TIME(3) NOT NULL, raw VARBINARY(MAX) NOT NULL)',
  'CREATE TABLE t_role (id BIGINT IDENTITY(1,1) PRIMARY KEY, name NVARCHAR(100) NOT NULL)',
  'CREATE TABLE t_user_role (user_id BIGINT NOT NULL, role_id BIGINT NOT NULL, PRIMARY KEY (user_id, role_id))',
  'CREATE TABLE t_member (tenant_id INT NOT NULL, id INT NOT NULL, name NVARCHAR(100) NOT NULL, PRIMARY KEY (tenant_id, id))',
  'CREATE TABLE t_dept (id BIGINT PRIMARY KEY, parent_id BIGINT, name NVARCHAR(100) NOT NULL)',
  'CREATE TABLE t_note (id BIGINT IDENTITY(1,1) PRIMARY KEY, tenant_id INT NOT NULL, member_id INT NOT NULL, body NVARCHAR(200) NOT NULL)',
  `CREATE TABLE t_doc (id BIGINT IDENTITY(1,1) PRIMARY KEY, title NVARCHAR(100) NOT NULL, status NVARCHAR(20) NOT NULL DEFAULT 'draft', deleted BIT NOT NULL, version INT NOT NULL, created_by NVARCHAR(100) NOT NULL, token NVARCHAR(100) NOT NULL, updated_at DATETIME2(3) NULL, secret NVARCHAR(100) NOT NULL)`,
];

const raw = process.env['EQTS_MSSQL_URL'];

if (!raw) {
  describe('sqlserver (live)', () => {
    it('skipped: set EQTS_MSSQL_URL to run', { skip: true }, () => {});
  });
} else {
  const url = new URL(raw);
  const config = (database: string): sql.config => ({
    server: url.hostname,
    port: Number(url.port),
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    database,
    options: { encrypt: false, trustServerCertificate: true },
    pool: { max: 5 },
  });
  let pool: sql.ConnectionPool | undefined;
  const connect = async (): Promise<sql.ConnectionPool> => {
    if (pool) return pool;
    const admin = await new sql.ConnectionPool(config('master')).connect();
    await admin.request().query(`IF DB_ID('eqts') IS NULL CREATE DATABASE eqts`);
    await admin.close();
    pool = await new sql.ConnectionPool(config('eqts')).connect();
    return pool;
  };
  afterAll(async () => {
    await pool?.close();
  });

  const open = async (): Promise<TestEnv> => {
    const p = await connect();
    for (const t of TABLES) await p.request().query(`DROP TABLE IF EXISTS ${t}`);
    for (const statement of DDL) await p.request().query(statement);
    const statements: Statement[] = [];
    const adapter = mssql(p);
    return {
      db: createDb({
        schema,
        adapter,
        log: (s) => statements.push(s),
      }),
      statements,
      adapter,
    };
  };

  liveSuite(`sqlserver ${url.port}`, open, {
    extensionTypes: true,
    extraTables: true,
    returning: false,
    readOnlyTransactions: false,
    createTableAs: false,
    nthValue: false,
  });

  /** 同一个 2022 实例上按旧版本渲染（旧写法新版本也认）：结果与新写法一致 */
  const older = async (version: SqlServerVersion) => {
    await seed(await open());
    return createDb({ schema, adapter: mssql(await connect(), { version }) });
  };

  describe(`sqlserver ${url.port}: rendering for older versions`, () => {
    it('2008：ROW_NUMBER 分页、TOP 之外的偏移、GREATEST / TRIM / DATETRUNC 的旧写法', async () => {
      const db = await older(2008);
      const page = await db
        .queryable(Post)
        .orderBy((p) => p.id.desc())
        .toPage(2, 3);
      assert.deepEqual([page.rows.map((p) => p.id), page.total], [[1], 4]);
      const second = db
        .queryable(Post)
        .orderBy((p) => p.id)
        .offset(1)
        .limit(2)
        .select((p) => p.title);
      assert.match(second.toSQL().sql, /ROW_NUMBER\(\) OVER/);
      assert.deepEqual(await second.toList(), ['sql 100%', 'orm_v2']);
      const row = await db
        .queryable(User)
        .where((u) => u.name.eq('alice'))
        .select((u) => ({
          most: greatest(u.age, u.companyId),
          least: least(u.age, u.companyId),
          trimmed: u.name.concat('  ').trim(),
          month: u.createdAt.dateTrunc('month'),
        }))
        .single();
      assert.deepEqual(
        { ...row, month: row.month.toISOString() },
        { most: 30, least: 1, trimmed: 'alice', month: '2026-01-01T00:00:00.000Z' },
      );
    });

    it('没有旧写法的特性报出要哪个版本', async () => {
      const db = await older(2016);
      assert.throws(
        () =>
          db
            .queryable(Post)
            .groupBy((p) => ({ userId: p.userId }))
            .select((g) => ({ titles: g.joining((p) => p.title) }))
            .toSQL(),
        /STRING_AGG needs sqlserver 2017 or later \(the dialect is configured for 2016\)/,
      );
      const old = await older(2008);
      assert.throws(
        () =>
          old
            .queryable(User)
            .select((u) => u.attrs.jsonLength('tags'))
            .toSQL(),
        /needs sqlserver 2016 or later/,
      );
    });
  });
}
