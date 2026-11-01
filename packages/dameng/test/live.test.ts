/**
 * 在实库上跑共用套件。EQTS_DAMENG_URL=dm://SYSDBA:密码@127.0.0.1:25236，未设置时跳过
 * （容器：infra/dev/db.sh --profile dameng up -d）。每个用例重建表。
 */
import { afterAll, describe, it, vi } from 'vitest';
import dmdb from 'dmdb';
import { createDb, type Statement } from '@zerodep-dev/easy-query-ts';
import { schema, type TestEnv } from '@zerodep-dev/easy-query-ts-test/fixture';
import { liveSuite } from '@zerodep-dev/easy-query-ts-test/suite';
import { dameng } from '../src/index.ts';

vi.setConfig({ testTimeout: 30_000 });

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

const id = '"id" BIGINT IDENTITY(1, 1) PRIMARY KEY';
const DDL = [
  `CREATE TABLE "t_company" (${id}, "name" VARCHAR(100) NOT NULL)`,
  `CREATE TABLE "t_user" (${id}, "name" VARCHAR(100) NOT NULL, "age" INT, "company_id" BIGINT, "attrs" CLOB NOT NULL, "created_at" TIMESTAMP(3) NOT NULL)`,
  `CREATE TABLE "t_post" (${id}, "user_id" BIGINT NOT NULL, "title" VARCHAR(200) NOT NULL, "amount" DECIMAL(12, 2) NOT NULL)`,
  `CREATE TABLE "t_comment" (${id}, "post_id" BIGINT NOT NULL, "body" VARCHAR(200) NOT NULL)`,
  `CREATE TABLE "t_ext" (${id}, "amount" DECIMAL(12, 2) NOT NULL, "big" BIGINT NOT NULL, "day" DATE NOT NULL, "starts_at" TIMESTAMP(3) NOT NULL, "at" TIMESTAMP(3) NOT NULL, "clock" TIME(3) NOT NULL, "raw" BLOB NOT NULL)`,
  `CREATE TABLE "t_role" (${id}, "name" VARCHAR(100) NOT NULL)`,
  `CREATE TABLE "t_user_role" ("user_id" BIGINT NOT NULL, "role_id" BIGINT NOT NULL, PRIMARY KEY ("user_id", "role_id"))`,
  `CREATE TABLE "t_member" ("tenant_id" INT NOT NULL, "id" INT NOT NULL, "name" VARCHAR(100) NOT NULL, PRIMARY KEY ("tenant_id", "id"))`,
  `CREATE TABLE "t_dept" ("id" BIGINT PRIMARY KEY, "parent_id" BIGINT, "name" VARCHAR(100) NOT NULL)`,
  `CREATE TABLE "t_note" (${id}, "tenant_id" INT NOT NULL, "member_id" INT NOT NULL, "body" VARCHAR(200) NOT NULL)`,
  `CREATE TABLE "t_doc" (${id}, "title" VARCHAR(100) NOT NULL, "status" VARCHAR(20) DEFAULT 'draft' NOT NULL, "deleted" BIT NOT NULL, "version" INT NOT NULL, "created_by" VARCHAR(100) NOT NULL, "token" VARCHAR(100) NOT NULL, "updated_at" TIMESTAMP(3), "secret" VARCHAR(100) NOT NULL)`,
];

const raw = process.env['EQTS_DAMENG_URL'];

if (!raw) {
  describe('dameng (live)', () => {
    it('skipped: set EQTS_DAMENG_URL to run', { skip: true }, () => {});
  });
} else {
  const url = new URL(raw);
  let pool: dmdb.Pool | undefined;
  // Node 的 OpenSSL 3 不认驱动登录加密用的旧算法：测试环境关掉登录加密
  const connect = async (): Promise<dmdb.Pool> =>
    (pool ??= await dmdb.createPool({
      connectString: `dm://${url.username}:${url.password}@${url.host}?loginEncrypt=false`,
      poolMax: 5,
    }));
  afterAll(async () => {
    await pool?.close();
  });

  const open = async (): Promise<TestEnv> => {
    const p = await connect();
    const conn = await p.getConnection();
    try {
      for (const t of TABLES) await conn.execute(`DROP TABLE IF EXISTS "${t}" CASCADE`);
      for (const statement of DDL) await conn.execute(statement);
      await conn.commit();
    } finally {
      await conn.close();
    }
    const statements: Statement[] = [];
    const adapter = dameng(p);
    return {
      db: createDb({ schema, adapter, log: (s) => statements.push(s) }),
      statements,
      adapter,
    };
  };

  liveSuite(`dameng ${url.port}`, open, {
    extensionTypes: true,
    extraTables: true,
    returning: false,
  });
}
