/**
 * MariaDB 跑共用套件。EQTS_MARIADB_URL 是连接串（不带库名也行），未设置时跳过：
 *   EQTS_MARIADB_URL=mysql://root:root@127.0.0.1:23307 pnpm test
 * 容器：infra/dev/db.sh --profile mariadb up -d。每个用例重建 eqts_test 库里的表
 */
import assert from 'node:assert/strict';
import { afterAll, describe, it } from 'vitest';
import { createPool, type Pool } from 'mysql2/promise';
import { createDb, type Statement } from '@zerodep-dev/easy-query-ts';
import { schema, type TestEnv } from '@zerodep-dev/easy-query-ts-test/fixture';
import { liveSuite } from '@zerodep-dev/easy-query-ts-test/suite';
import { MariaDbDialect, mysql } from '../src/index.ts';
import { DDL } from './ddl.ts';

const url = process.env['EQTS_MARIADB_URL'];

if (!url) {
  describe('mariadb (live)', () => {
    it('skipped: set EQTS_MARIADB_URL to run', { skip: true }, () => {});
  });
} else {
  let shared: Pool | undefined;
  const pool = async (): Promise<Pool> => {
    if (shared) return shared;
    const bootstrap = createPool({ uri: url, connectionLimit: 1 });
    await bootstrap.query('CREATE DATABASE IF NOT EXISTS eqts_test');
    await bootstrap.end();
    shared = createPool({ uri: url, database: 'eqts_test', connectionLimit: 5, timezone: 'Z' });
    return shared;
  };
  afterAll(async () => {
    await shared?.end();
  });

  const open = async (): Promise<TestEnv> => {
    const p = await pool();
    for (const statement of DDL) await p.query(statement);
    const statements: Statement[] = [];
    // mysql.detect 认出 MariaDB，用 MariaDB 的方言
    const adapter = await mysql.detect(p);
    return {
      db: createDb({ schema, adapter, log: (s) => statements.push(s) }),
      statements,
      adapter,
    };
  };

  describe('mariadb: detect', () => {
    it('picks the MariaDB dialect from the server version', async () => {
      const adapter = await mysql.detect(await pool());
      assert.ok(adapter.dialect instanceof MariaDbDialect);
    });
  });

  liveSuite('mariadb', open, {
    extensionTypes: true,
    extraTables: true,
    cube: false,
    // WITH ROLLUP 有，GROUPING() 没有
    rollup: false,
    returning: false,
    jsonEdits: true,
  });
}
