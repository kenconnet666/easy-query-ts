/**
 * PG 的 unnest 批量插入（ROADMAP 19.5），pg 与 PGlite 共用：100 行起每列一个数组参数，一条语句插完；
 * 各种列类型（含 NULL、bigint、decimal、日期时间、JSON、二进制、uuid、原生枚举）读回与写入一致
 */
import assert from 'node:assert/strict';
import { describe, it } from 'vitest';
import {
  col,
  createDb,
  defineSchema,
  entity,
  type Adapter,
  type DecimalText,
  type Statement,
} from '@zerodep-dev/easy-query-ts';

const Sample = entity('t_bulk', {
  id: col.int().primaryKey(),
  name: col.string(40),
  note: col.string().nullable(),
  big: col.bigint({ mode: 'bigint' }),
  price: col.decimal(12, 2),
  ok: col.boolean(),
  day: col.date(),
  at: col.datetime(),
  attrs: col.json<{ n: number; tags: string[] }>(),
  raw: col.bytes().nullable(),
  ref: col.uuid(),
  level: col.enum(['low', 'high']).native('eqts_bulk_level'),
});

export function bulkSuite(name: string, adapter: () => Promise<Adapter>): void {
  describe(`${name}: bulk insert with unnest`, () => {
    it('inserts 150 rows of every column type in one statement and reads them back unchanged', async () => {
      const statements: Statement[] = [];
      const db = createDb({
        schema: defineSchema({ Sample }),
        adapter: await adapter(),
        log: (s) => statements.push(s),
      });
      await db.sql.execute`DROP TABLE IF EXISTS t_bulk`;
      await db.createTables();
      const rows = Array.from({ length: 150 }, (_, i) => ({
        id: i + 1,
        name: i === 7 ? 'quote " and , comma' : `row ${i}`,
        note: i % 3 === 0 ? null : `note ${i}`,
        big: 9007199254740993n + BigInt(i),
        price: `${i}.25` as DecimalText,
        ok: i % 2 === 0,
        day: '2026-10-30' as const,
        at: new Date(Date.UTC(2026, 9, 30, 1, 2, 3, i)),
        attrs: { n: i, tags: i === 0 ? [] : ['a', `t${i}`] },
        raw: i % 5 === 0 ? null : Uint8Array.from([i % 256, 0, 255]),
        ref: `0192f3a4-1b2c-7d8e-9f01-${String(i).padStart(12, '0')}`,
        level: i % 2 === 0 ? ('low' as const) : ('high' as const),
      }));
      statements.length = 0;
      await db.insert(Sample).values(rows).execute();
      assert.equal(statements.length, 1);
      assert.match(statements[0]!.sql, /SELECT \* FROM unnest\(CAST\(\$1 AS INTEGER\[\]\)/);
      assert.equal(statements[0]!.params.length, 12);

      const back = await db
        .queryable(Sample)
        .orderBy((s) => s.id)
        .toList();
      assert.equal(back.length, 150);
      for (const [i, row] of back.entries()) {
        const expected = rows[i]!;
        assert.deepEqual(
          { ...row, price: Number(row.price), raw: row.raw && [...row.raw] },
          { ...expected, price: Number(expected.price), raw: expected.raw && [...expected.raw] },
        );
      }
      // 99 行以下照旧是 VALUES
      statements.length = 0;
      await db
        .insert(Sample)
        .values({ ...rows[0]!, id: 1000 })
        .execute();
      assert.match(statements[0]!.sql, / VALUES \(/);
      await db.dropTables();
    });
  });
}
