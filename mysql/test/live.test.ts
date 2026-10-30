/**
 * 在实库上跑共用套件。EQTS_MYSQL_URLS 为逗号分隔的连接串（不带库名），未设置时跳过：
 *   EQTS_MYSQL_URLS=mysql://root:root@127.0.0.1:3318,mysql://root:root@127.0.0.1:3306 pnpm test
 * 每个用例重建 eqts_test 库里的表。
 */
import { afterAll, describe, it } from 'vitest';
import { createPool, type Pool } from 'mysql2/promise';
import { createDb, type Statement } from '@zerodep-dev/easy-query-ts';
import assert from 'node:assert/strict';
import { Post, schema, seed, User, type TestEnv } from '@zerodep-dev/easy-query-ts-test/fixture';
import { liveSuite } from '@zerodep-dev/easy-query-ts-test/suite';
import { MySQL, mysql } from '../src/index.ts';
import { DDL } from './ddl.ts';

const urls = (process.env['EQTS_MYSQL_URLS'] ?? '')
  .split(',')
  .map((u) => u.trim())
  .filter(Boolean);

if (urls.length === 0) {
  describe('mysql (live)', () => {
    it('skipped: set EQTS_MYSQL_URLS to run', { skip: true }, () => {});
  });
}

for (const url of urls) {
  const pools: Pool[] = [];
  const pool = async (): Promise<Pool> => {
    if (pools[0]) return pools[0];
    const bootstrap = createPool({ uri: url, connectionLimit: 1 });
    await bootstrap.query('CREATE DATABASE IF NOT EXISTS eqts_test');
    await bootstrap.end();
    const p = createPool({ uri: url, database: 'eqts_test', connectionLimit: 5, timezone: 'Z' });
    pools.push(p);
    return p;
  };
  afterAll(async () => {
    await pools[0]?.end();
  });

  const open = async (): Promise<TestEnv> => {
    const p = await pool();
    for (const statement of DDL) await p.query(statement);
    const statements: Statement[] = [];
    // 按服务器的真实版本渲染（8.0.18 的 upsert 用 VALUES()，8.4 用行别名）
    const adapter = await mysql.detect(p);
    return {
      db: createDb({ schema, adapter, log: (s) => statements.push(s) }),
      statements,
      adapter,
    };
  };

  liveSuite(`mysql ${new URL(url).port}`, open, {
    extensionTypes: true,
    extraTables: true,
    cube: false,
    returning: false,
    jsonEdits: true,
  });

  describe(`mysql ${new URL(url).port}: detect`, () => {
    it('reads the server version and max_allowed_packet', async () => {
      const adapter = await mysql.detect(await pool());
      assert.ok(adapter.dialect.version);
      // 8.0 起默认 64 MiB；按它的四分之三切语句
      assert.ok(adapter.dialect.maxStatementBytes! >= 3 * 1024 * 1024);
    });
  });

  describe(`mysql ${new URL(url).port}: server-side cancellation`, () => {
    const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
    it('kills the statement on the server when the timeout fires or the signal aborts, also inside a transaction', async () => {
      const db = createDb({ schema, adapter: mysql(await pool()) });
      const running = async () => {
        for (let i = 0; i < 40; i++) {
          const [row] = await db.sql<{
            n: number;
          }>`SELECT COUNT(*) AS n FROM information_schema.PROCESSLIST
            WHERE INFO LIKE ${'SELECT SLEEP(3)%'} AND ID <> CONNECTION_ID()`;
          if (Number(row!.n) === 0) return 0;
          await pause(50);
        }
        return 1;
      };
      const started = Date.now();
      await assert.rejects(db.withTimeout(300).sql`SELECT SLEEP(3)`, { name: 'TimeoutError' });
      assert.ok(Date.now() - started < 2000);
      assert.equal(await running(), 0);

      const controller = new AbortController();
      setTimeout(() => controller.abort(new Error('stop')), 200);
      await assert.rejects(
        db.withSignal(controller.signal).transaction((tx) => tx.sql`SELECT SLEEP(3)`),
        /stop/,
      );
      assert.equal(await running(), 0);
      // 连接还回池里照常可用（整数按文字读）
      assert.deepEqual(await db.sql<{ v: string }>`SELECT 1 AS v`, [{ v: '1' }]);
    });
  });

  describe(`mysql ${new URL(url).port}: MySQL.* functions`, () => {
    it('json predicates and full-text match', async () => {
      const { db } = await seed(await open());
      assert.equal(
        await db
          .queryable(User)
          .where((u) => MySQL.json(u.attrs).contains('"vip"', '$.tags'))
          .count(),
        1,
      );
      assert.equal(
        await db
          .queryable(User)
          .where((u) => MySQL.json(u.attrs).hasMember('vip', '$.tags'))
          .count(),
        1,
      );
      assert.equal(
        await db
          .queryable(User)
          .where((u) => MySQL.json(u.attrs).containsPath('$.tags', '$.nope'))
          .count(),
        3,
      );
      assert.equal(
        await db
          .queryable(User)
          .where((u) => MySQL.json(u.attrs).containsAllPaths('$.tags', '$.nope'))
          .count(),
        0,
      );
      const hits = await db
        .queryable(Post)
        .where((p) => MySQL.match(p.title).against('hello'))
        .select((p) => ({ title: p.title, score: MySQL.match(p.title).score('hello') }))
        .toList();
      assert.equal(hits.length, 1);
      assert.ok(hits[0]!.score > 0);
    });
  });
}
