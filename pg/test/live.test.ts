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
import { Pg, postgres } from '../src/index.ts';
import { arraySuite } from './arrays.ts';
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

  liveSuite(`postgres ${new URL(url).port}`, open, { extensionTypes: true, extraTables: true });
  arraySuite(`postgres ${new URL(url).port}`, async () => postgres(pool));
  enumSuite(`postgres ${new URL(url).port}`, async () => postgres(pool));

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
