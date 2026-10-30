/**
 * 数组列（ROADMAP 19.1）的实库用例，pg 与 PGlite 共用：建表、各种元素类型的往返（日期时间、bigint、decimal 的数组按文字读）、
 * 元素里的 NULL 与引号、has / hasAll / hasAny / arrayLength
 */
import assert from 'node:assert/strict';
import { describe, it } from 'vitest';
import { col, createDb, defineSchema, entity, type Adapter } from '@zerodep-dev/easy-query-ts';

const Article = entity('t_article', {
  id: col.int().primaryKey(),
  tags: col.array(col.string(30)),
  scores: col.array(col.int().nullable()),
  days: col.array(col.date()),
  stamps: col.array(col.datetime()),
  bigs: col.array(col.bigint({ mode: 'bigint' })),
  prices: col.array(col.decimal(10, 2)),
  refs: col.array(col.uuid()).nullable(),
});

export function arraySuite(name: string, adapter: () => Promise<Adapter>): void {
  describe(`${name}: array columns`, () => {
    it('round-trips arrays of every element type, filters with has / hasAll / hasAny and syncs to an empty plan', async () => {
      const db = createDb({ schema: defineSchema({ Article }), adapter: await adapter() });
      await db.sql.execute`DROP TABLE IF EXISTS t_article`;
      await db.createTables();
      const stamp = new Date('2026-03-04T05:06:07.008Z');
      await db
        .insert(Article)
        .values([
          {
            id: 1,
            tags: ['orm', 'a "quoted", tag', 'NULL'],
            scores: [3, null, 5],
            days: ['2026-01-02', '2026-12-31'],
            stamps: [stamp],
            bigs: [9007199254740993n],
            prices: ['12.50', '0.01'],
            refs: ['0192f3a4-1b2c-7d8e-9f01-23456789abcd'],
          },
          { id: 2, tags: [], scores: [], days: [], stamps: [], bigs: [], prices: [], refs: null },
        ])
        .execute();
      const [first, second] = await db
        .queryable(Article)
        .orderBy((a) => a.id)
        .toList();
      // 'NULL' 文字与真正的 NULL 分得开，引号、逗号原样
      assert.deepEqual(first!.tags, ['orm', 'a "quoted", tag', 'NULL']);
      assert.deepEqual(first!.scores, [3, null, 5]);
      assert.deepEqual(first!.days, ['2026-01-02', '2026-12-31']);
      assert.equal(first!.stamps[0]!.toISOString(), stamp.toISOString());
      assert.deepEqual(first!.bigs, [9007199254740993n]);
      assert.deepEqual(first!.prices.map(Number), [12.5, 0.01]);
      assert.deepEqual(first!.refs, ['0192f3a4-1b2c-7d8e-9f01-23456789abcd']);
      assert.deepEqual([second!.tags, second!.refs], [[], null]);

      const matching = async (q: { toList(): Promise<{ id: number }[]> }) =>
        (await q.toList()).map((r) => r.id);
      const articles = db.queryable(Article);
      assert.deepEqual(await matching(articles.where((a) => a.tags.has('orm'))), [1]);
      assert.deepEqual(await matching(articles.where((a) => a.tags.hasAll(['orm', 'NULL']))), [1]);
      assert.deepEqual(await matching(articles.where((a) => a.tags.hasAny(['x', 'NULL']))), [1]);
      assert.deepEqual(await matching(articles.where((a) => a.days.has('2026-12-31'))), [1]);
      assert.deepEqual(await matching(articles.where((a) => a.tags.arrayLength().eq(0))), [2]);
      assert.deepEqual(
        await db
          .queryable(Article)
          .orderBy((a) => a.id)
          .select((a) => a.scores.arrayLength())
          .toList(),
        [3, 0],
      );

      await db
        .update(Article)
        .set({ tags: ['changed'] })
        .where((a) => a.id.eq(2))
        .execute();
      assert.deepEqual((await db.queryable(Article).findOrThrow(2)).tags, ['changed']);
      assert.deepEqual((await db.planSync()).statements, []);
      await db.dropTables();
    });
  });
}
