/**
 * PG 协议的兼容库跑共用套件，未设置连接串时跳过（表建在 eqts 模式里，每个用例重建）：
 * - EQTS_OPENGAUSS_URL=postgres://gaussdb:密码@127.0.0.1:25433/eqts（容器：infra/dev/db.sh --profile opengauss up -d；
 *   库要按 PG 兼容建：CREATE DATABASE eqts DBCOMPATIBILITY 'PG'）
 * - EQTS_KINGBASE_URL=postgres://SYSTEM:密码@host:54321/test（金仓要有效的许可证，社区镜像里的试用许可证都已过期，没有容器）
 */
import { afterAll, beforeAll, describe, it } from 'vitest';
import pg from 'pg';
import { createDb, type Statement } from '@zerodep-dev/easy-query-ts';
import { schema, type TestEnv } from '@zerodep-dev/easy-query-ts-test/fixture';
import { liveSuite } from '@zerodep-dev/easy-query-ts-test/suite';
import type { Adapter } from '@zerodep-dev/easy-query-ts';
import { kingbase, opengauss } from '../src/index.ts';

const DDL = [
  'CREATE SCHEMA IF NOT EXISTS eqts',
  'DROP TABLE IF EXISTS t_dept, t_doc, t_note, t_member, t_user_role, t_role, t_ext, t_comment, t_post, t_user, t_company',
  'CREATE TABLE t_company (id BIGSERIAL PRIMARY KEY, name VARCHAR(100) NOT NULL)',
  'CREATE TABLE t_user (id BIGSERIAL PRIMARY KEY, name VARCHAR(100) NOT NULL, age INT, company_id BIGINT, attrs JSONB NOT NULL, created_at TIMESTAMP(3) NOT NULL)',
  'CREATE TABLE t_post (id BIGSERIAL PRIMARY KEY, user_id BIGINT NOT NULL, title VARCHAR(200) NOT NULL, amount NUMERIC(12,2) NOT NULL)',
  'CREATE TABLE t_comment (id BIGSERIAL PRIMARY KEY, post_id BIGINT NOT NULL, body VARCHAR(200) NOT NULL)',
  'CREATE TABLE t_ext (id BIGSERIAL PRIMARY KEY, amount NUMERIC(12,2) NOT NULL, big BIGINT NOT NULL, day DATE NOT NULL, starts_at TIMESTAMP(3) NOT NULL, at TIMESTAMP(3) NOT NULL, clock TIME NOT NULL, raw BYTEA NOT NULL)',
  'CREATE TABLE t_role (id BIGSERIAL PRIMARY KEY, name VARCHAR(100) NOT NULL)',
  'CREATE TABLE t_user_role (user_id BIGINT NOT NULL, role_id BIGINT NOT NULL, PRIMARY KEY (user_id, role_id))',
  'CREATE TABLE t_member (tenant_id INT NOT NULL, id INT NOT NULL, name VARCHAR(100) NOT NULL, PRIMARY KEY (tenant_id, id))',
  'CREATE TABLE t_dept (id BIGINT PRIMARY KEY, parent_id BIGINT, name VARCHAR(100) NOT NULL)',
  'CREATE TABLE t_note (id BIGSERIAL PRIMARY KEY, tenant_id INT NOT NULL, member_id INT NOT NULL, body VARCHAR(200) NOT NULL)',
  `CREATE TABLE t_doc (id BIGSERIAL PRIMARY KEY, title VARCHAR(100) NOT NULL, status VARCHAR(20) NOT NULL DEFAULT 'draft', deleted BOOLEAN NOT NULL, version INT NOT NULL, created_by VARCHAR(100) NOT NULL, token VARCHAR(100) NOT NULL, updated_at TIMESTAMP(3) NULL, secret VARCHAR(100) NOT NULL)`,
];

/** openGauss 默认按 Oracle 兼容（A）建库：连接串里的库不存在时按 PG 兼容建出来（CI 的新容器） */
async function pgCompatibleDatabase(url: string): Promise<void> {
  const database = new URL(url).pathname.slice(1);
  const admin = new pg.Client({
    connectionString: Object.assign(new URL(url), { pathname: '/postgres' }).href,
  });
  await admin.connect();
  try {
    const { rowCount } = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [
      database,
    ]);
    if (!rowCount) await admin.query(`CREATE DATABASE "${database}" DBCOMPATIBILITY 'PG'`);
  } finally {
    await admin.end();
  }
}

const targets: [string, string, (pool: pg.Pool) => Adapter][] = [
  ['opengauss', 'EQTS_OPENGAUSS_URL', opengauss],
  ['kingbase', 'EQTS_KINGBASE_URL', kingbase],
];

for (const [name, variable, adapterOf] of targets) {
  const url = process.env[variable];
  if (!url) {
    describe(`${name} (live)`, () => {
      it(`skipped: set ${variable} to run`, { skip: true }, () => {});
    });
    continue;
  }
  const pool = new pg.Pool({ connectionString: url, max: 5, options: '-c search_path=eqts' });
  afterAll(async () => {
    await pool.end();
  });
  if (name === 'opengauss') beforeAll(() => pgCompatibleDatabase(url));

  const open = async (): Promise<TestEnv> => {
    for (const statement of DDL) await pool.query(statement);
    const statements: Statement[] = [];
    const adapter = adapterOf(pool);
    return {
      db: createDb({ schema, adapter, log: (s) => statements.push(s) }),
      statements,
      adapter,
    };
  };

  liveSuite(`${name} ${new URL(url).port}`, open, { extensionTypes: true, extraTables: true });
}
