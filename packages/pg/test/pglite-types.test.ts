// PG 对类型比别的库严：参数在 CASE、GROUP BY 里的两个问题，文档站把示例放到 PGlite 上真实运行时发现的
import assert from 'node:assert/strict';
import { afterAll, describe, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { caseWhen, col, createDb, defineSchema, entity } from '@zerodep-dev/easy-query-ts';
import { pglite } from '../src/pglite.ts';

const Item = entity('t_item', {
  id: col.int().primaryKey(),
  name: col.string(20),
  price: col.decimal(10, 2),
  stock: col.int(),
  day: col.date(),
  at: col.datetime(),
});

const database = new PGlite();
afterAll(() => database.close());

const db = createDb({ schema: defineSchema({ Item }), adapter: pglite(database) });
await db.createTables();
await db
  .insert(Item)
  .values(
    [1, 2, 3].map((id) => ({
      id,
      name: `item${id}`,
      price: '1.50',
      stock: id * 10,
      day: '2026-01-01' as const,
      at: new Date('2026-01-01T00:00:00Z'),
    })),
  )
  .execute();

describe('pglite: 参数的类型', () => {
  it('batch：小数、日期、时间列的 CASE 分支按列的类型转换', async () => {
    const rows = await db
      .queryable(Item)
      .where((i) => i.id.in([1, 2]))
      .toList();
    const affected = await db
      .update(Item)
      .entities(
        rows.map((row) => ({
          ...row,
          price: '9.99',
          day: '2026-02-02' as const,
          at: new Date('2026-02-02T00:00:00Z'),
        })),
      )
      .batch()
      .execute();
    assert.equal(affected, 2);
    const row = await db.queryable(Item).findOrThrow(1);
    assert.equal(row.price, '9.99');
    assert.equal(row.day, '2026-02-02');
    assert.equal(row.at.toISOString(), '2026-02-02T00:00:00.000Z');
  });

  it('GROUP BY 带参数的表达式：键选出来了就按序号分组', async () => {
    const query = db
      .queryable(Item)
      .groupBy((i) => ({ level: caseWhen(i.stock.ge(20), 'high').else('low') }))
      .orderBy((g) => g.key.level)
      .select((g) => ({ level: g.key.level, items: g.count() }));
    assert.match(query.toSQL().sql, /GROUP BY 1\b/);
    assert.deepEqual(await query.toList(), [
      { level: 'high', items: 2 },
      { level: 'low', items: 1 },
    ]);
  });

  it('键里没有参数时照常写表达式', () => {
    const { sql } = db
      .queryable(Item)
      .groupBy((i) => ({ name: i.name }))
      .select((g) => ({ name: g.key.name, items: g.count() }))
      .toSQL();
    assert.match(sql, /GROUP BY t0\."name"/);
  });
});
