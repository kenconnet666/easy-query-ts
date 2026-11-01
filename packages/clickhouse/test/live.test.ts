/**
 * ClickHouse 实库测试。EQTS_CLICKHOUSE_URL=http://eqts:密码@127.0.0.1:28123/eqts，未设置时跳过
 * （容器：infra/dev/db.sh --profile clickhouse up -d）。
 * 共用套件依赖自增主键与事务，ClickHouse 都没有：跑主键由应用给值的分析型套件，再断言 mutation、建表的写法。
 */
import assert from 'node:assert/strict';
import { afterAll, describe, it } from 'vitest';
import { createClient } from '@clickhouse/client';
import { analyticSuite } from '@zerodep-dev/easy-query-ts-test/analytic';
import { clickhouse } from '../src/index.ts';

const DDL = [
  'DROP TABLE IF EXISTS t_user',
  'DROP TABLE IF EXISTS t_post',
  'DROP TABLE IF EXISTS t_company',
  'DROP TABLE IF EXISTS t_metric',
  `CREATE TABLE t_user (id Int64, name String, age Nullable(Int32), company_id Nullable(Int64), attrs String DEFAULT '{}', created_at DateTime64(3)) ENGINE = MergeTree ORDER BY id`,
  'CREATE TABLE t_post (id Int64, user_id Int64, title String, amount Decimal(12, 2)) ENGINE = MergeTree ORDER BY id',
  'CREATE TABLE t_company (id Int64, name String) ENGINE = MergeTree ORDER BY id',
];

const raw = process.env['EQTS_CLICKHOUSE_URL'];

if (!raw) {
  describe('clickhouse (live)', () => {
    it('skipped: set EQTS_CLICKHOUSE_URL to run', { skip: true }, () => {});
  });
} else {
  const url = new URL(raw);
  const client = createClient({
    url: `${url.protocol}//${url.host}`,
    username: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    database: url.pathname.slice(1),
  });
  afterAll(() => client.close());

  analyticSuite(
    `clickhouse ${url.port}`,
    {
      adapter: clickhouse(client),
      reset: async () => {
        for (const statement of DDL) await client.command({ query: statement });
      },
    },
    {
      writes: ([update, remove]) => {
        assert.match(
          update!.sql,
          /^ALTER TABLE `t_user` UPDATE `name` = \{p2:String\} WHERE `id` = \{p1:Int64\}$/,
        );
        assert.match(
          remove!.sql,
          /^ALTER TABLE `t_post` DELETE WHERE \(`id`\) IN \(SELECT t0\.`id` FROM `t_post` AS t0 /,
        );
      },
      createTable: (sql) =>
        assert.match(
          sql,
          /^CREATE TABLE IF NOT EXISTS `t_metric` \(`id` Int64, `name` String COMMENT '指标名', .*`note` Nullable\(String\)\) ENGINE = MergeTree ORDER BY \(`id`\) COMMENT '指标'$/,
        ),
    },
  );
}
