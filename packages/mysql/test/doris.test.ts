/**
 * Apache Doris 实库测试。EQTS_DORIS_URL=mysql://root@127.0.0.1:29030/eqts，未设置时跳过
 * （容器：infra/dev/db.sh --profile doris up -d）。
 * Doris 取不回自增主键、事务不能回滚，共用套件跑不了：跑主键由应用给值的分析型套件，再断言建表的写法。
 */
import assert from 'node:assert/strict';
import { afterAll, beforeAll, describe, it, vi } from 'vitest';
import { createPool } from 'mysql2/promise';
import { analyticSuite } from '@zerodep-dev/easy-query-ts-test/analytic';
import { doris } from '../src/index.ts';

// Doris 的 DDL 要等元数据同步，建表要几秒
vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

/** 主键模型：键列排在最前，单 BE 的副本数 1 */
const table = (name: string, columns: string) =>
  `CREATE TABLE ${name} (${columns}) UNIQUE KEY(id) DISTRIBUTED BY HASH(id) BUCKETS 1 PROPERTIES ("replication_num" = "1")`;
const DDL = [
  ...['t_user', 't_post', 't_company', 't_metric'].map((t) => `DROP TABLE IF EXISTS ${t} FORCE`),
  table(
    't_user',
    'id BIGINT NOT NULL, name VARCHAR(100) NOT NULL, age INT, company_id BIGINT, attrs JSON NOT NULL, created_at DATETIME(3) NOT NULL',
  ),
  table(
    't_post',
    'id BIGINT NOT NULL, user_id BIGINT NOT NULL, title VARCHAR(200) NOT NULL, amount DECIMAL(12,2) NOT NULL',
  ),
  table('t_company', 'id BIGINT NOT NULL, name VARCHAR(100) NOT NULL'),
];

const url = process.env['EQTS_DORIS_URL'];

if (!url) {
  describe('doris (live)', () => {
    it('skipped: set EQTS_DORIS_URL to run', { skip: true }, () => {});
  });
} else {
  const database = new URL(url).pathname.slice(1);
  const bootstrap = createPool({
    uri: Object.assign(new URL(url), { pathname: '/' }).href,
    connectionLimit: 1,
  });
  const pool = createPool({ uri: url, connectionLimit: 5, timezone: 'Z' });
  afterAll(async () => {
    await bootstrap.end();
    await pool.end();
  });
  // FE 先起来、BE 晚一些注册（CI 的新容器）：等到有活着的 BE 再建表
  beforeAll(async () => {
    for (let i = 0; ; i++) {
      const alive = await bootstrap
        .query('SHOW BACKENDS')
        .then(([rows]) => (rows as { Alive: unknown }[]).some((r) => String(r.Alive) === 'true'))
        .catch(() => false);
      if (alive) return;
      if (i >= 90) throw new Error('no alive doris backend after 3 minutes');
      await new Promise((r) => setTimeout(r, 2000));
    }
  }, 200_000);

  analyticSuite(
    `doris ${new URL(url).port}`,
    {
      adapter: doris(pool, { replication: 1 }),
      reset: async () => {
        await bootstrap.query(`CREATE DATABASE IF NOT EXISTS ${database}`);
        for (const statement of DDL) await pool.query(statement);
      },
    },
    {
      createTable: (sql) =>
        assert.match(
          sql,
          /^CREATE TABLE IF NOT EXISTS `t_metric` \(`id` BIGINT NOT NULL, .*\) UNIQUE KEY\(`id`\) COMMENT '指标' DISTRIBUTED BY HASH\(`id`\) BUCKETS AUTO PROPERTIES \("replication_num" = "1"\)$/,
        ),
    },
  );
}
