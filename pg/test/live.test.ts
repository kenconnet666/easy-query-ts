/**
 * 在实库上跑共用套件。EQTS_PG_URLS 为逗号分隔的连接串，未设置时跳过：
 *   EQTS_PG_URLS=postgres://postgres:postgres@127.0.0.1:54321/easy-query-test pnpm test
 * 表建在 eqts 模式里（search_path），每个用例重建。
 */
import { afterAll, describe, it } from 'vitest';
import pg from 'pg';
import assert from 'node:assert/strict';
import { createDb, sql, type Statement } from '@zerodep-dev/easy-query-ts';
import { Post, schema, seed, User, type TestEnv } from '@zerodep-dev/easy-query-ts-test/fixture';
import { liveSuite } from '@zerodep-dev/easy-query-ts-test/suite';
import { listen, Pg, postgres } from '../src/index.ts';
import { arraySuite } from './arrays.ts';
import { bulkSuite } from './bulk.ts';
import { enumSuite } from './enums.ts';
import { DDL } from './ddl.ts';

const urls = (process.env['EQTS_PG_URLS'] ?? '')
  .split(',')
  .map((u) => u.trim())
  .filter(Boolean);

if (urls.length === 0) {
  describe('postgres (live)', () => {
    it('skipped: set EQTS_PG_URLS to run', { skip: true }, () => {});
  });
}

for (const url of urls) {
  const pool = new pg.Pool({ connectionString: url, max: 5, options: '-c search_path=eqts' });
  afterAll(async () => {
    await pool.end();
  });

  const open = async (): Promise<TestEnv> => {
    for (const statement of DDL) await pool.query(statement);
    const statements: Statement[] = [];
    const adapter = postgres(pool);
    return {
      db: createDb({ schema, adapter, log: (s) => statements.push(s) }),
      statements,
      adapter,
    };
  };

  liveSuite(`postgres ${new URL(url).port}`, open, {
    extensionTypes: true,
    extraTables: true,
    jsonEdits: true,
  });
  arraySuite(`postgres ${new URL(url).port}`, async () => postgres(pool));
  bulkSuite(`postgres ${new URL(url).port}`, async () => postgres(pool));
  enumSuite(`postgres ${new URL(url).port}`, async () => postgres(pool));

  describe(`postgres ${new URL(url).port}: advisory locks and notifications`, () => {
    it('serializes by lock name until the transaction ends; notify reaches listeners after commit', async () => {
      const db = createDb({ schema, adapter: postgres(pool) });
      let release!: () => void;
      const held = new Promise<void>((resolve) => (release = resolve));
      let acquired!: () => void;
      const locked = new Promise<void>((resolve) => (acquired = resolve));
      const first = db.transaction(async (tx) => {
        assert.equal(await tx.advisoryLock('report:2026-10'), true);
        acquired();
        await held;
      });
      await locked;
      // 同名的锁别的事务拿不到，别的名字照常
      assert.equal(
        await db.transaction((tx) => tx.advisoryLock('report:2026-10', { wait: false })),
        false,
      );
      assert.equal(
        await db.transaction((tx) => tx.advisoryLock('report:2026-11', { wait: false })),
        true,
      );
      release();
      await first;
      assert.equal(
        await db.transaction((tx) => tx.advisoryLock('report:2026-10', { wait: false })),
        true,
      );
      await assert.rejects(db.advisoryLock('x'), /inside a transaction/);

      const got: string[] = [];
      let heard!: () => void;
      const arrived = new Promise<void>((resolve) => (heard = resolve));
      const stop = await listen(pool, 'eqts_evict', (payload) => {
        got.push(payload);
        heard();
      });
      try {
        await db.transaction(async (tx) => {
          await tx.notify('eqts_evict', 'user:7');
          // 提交之前收不到
          assert.deepEqual(got, []);
        });
        await arrived;
        assert.deepEqual(got, ['user:7']);
      } finally {
        await stop();
      }
    });
  });

  describe(`postgres ${new URL(url).port}: server-side cancellation`, () => {
    const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
    it('stops the statement on the server when the timeout fires or the signal aborts, also inside a transaction', async () => {
      const db = createDb({ schema, adapter: postgres(pool) });
      // 别的连接上还在跑的 pg_sleep(3)；取消是异步的，给它一点时间结束
      const running = async () => {
        for (let i = 0; i < 40; i++) {
          const [row] = await db.sql<{ n: number }>`SELECT count(*)::int AS n FROM pg_stat_activity
            WHERE query LIKE ${'%pg_sleep(3)%'} AND state = 'active' AND pid <> pg_backend_pid()`;
          if (row!.n === 0) return 0;
          await pause(50);
        }
        return 1;
      };
      const started = Date.now();
      await assert.rejects(db.withTimeout(300).sql`SELECT pg_sleep(3)`, { name: 'TimeoutError' });
      assert.ok(Date.now() - started < 2000);
      assert.equal(await running(), 0);

      const controller = new AbortController();
      setTimeout(() => controller.abort(new Error('stop')), 200);
      await assert.rejects(
        db.withSignal(controller.signal).transaction((tx) => tx.sql`SELECT pg_sleep(3)`),
        /stop/,
      );
      assert.equal(await running(), 0);
      // 连接还回池里照常可用
      assert.deepEqual(await db.sql<{ v: number }>`SELECT 1 AS v`, [{ v: 1 }]);
    });
  });

  describe(`postgres ${new URL(url).port}: Pg.* functions`, () => {
    it('jsonb, arrays and full-text search', async () => {
      const { db } = await seed(await open());
      assert.equal(
        await db
          .queryable(User)
          .where((u) => Pg.jsonb(u.attrs).contains('{"tags":["vip"]}'))
          .count(),
        1,
      );
      assert.equal(
        await db
          .queryable(User)
          .where((u) => Pg.jsonb(u.attrs).hasKey('tags'))
          .count(),
        3,
      );
      // DISTINCT ON：每个用户最新的一篇
      assert.deepEqual(
        await db
          .queryable(Post)
          .distinctOn((p) => p.userId)
          .orderBy((p) => p.id.desc())
          .select((p) => ({ userId: p.userId, id: p.id }))
          .toList(),
        await Promise.all(
          [1, 2].map(async (userId) => ({
            userId,
            id: (await db
              .queryable(Post)
              .where((p) => p.userId.eq(userId as never))
              .orderBy((p) => p.id.desc())
              .first())!.id,
          })),
        ),
      );
      // 共享锁、FOR NO KEY UPDATE 在事务里照常
      await db.transaction(async (tx) => {
        assert.equal((await tx.queryable(Post).forShare().toList()).length, 4);
        assert.equal((await tx.queryable(Post).forNoKeyUpdate().toList()).length, 4);
      });
      // JSONPath：过滤表达式、谓词
      assert.equal(
        await db
          .queryable(User)
          .where((u) => Pg.jsonb(u.attrs).pathExists('$.tags[*] ? (@ == "vip")'))
          .count(),
        1,
      );
      assert.equal(
        await db
          .queryable(User)
          .where((u) => Pg.jsonb(u.attrs).pathMatch('$.tags.size() == 0'))
          .count(),
        2,
      );
      const tags = sql<string[]>`ARRAY['a', 'b']`;
      assert.equal(
        await db
          .queryable(User)
          .where(() => [Pg.array(tags).hasAll('a', 'b'), Pg.array(tags).length().eq(2)])
          .count(),
        3,
      );
      assert.equal(
        await db
          .queryable(User)
          .where(() => Pg.array(tags).hasAny('z'))
          .count(),
        0,
      );
      const hits = await db
        .queryable(Post)
        .where((p) => Pg.fulltext(p.title).matches('tips'))
        .select((p) => ({ title: p.title, rank: Pg.fulltext(p.title).rank('tips') }))
        .toList();
      assert.deepEqual(
        hits.map((h) => h.title),
        ['orm tips'],
      );
      assert.ok(hits[0]!.rank > 0);
    });
  });
}
