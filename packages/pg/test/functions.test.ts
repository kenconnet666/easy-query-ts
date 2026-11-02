/** Pg.* 与自写的方言函数在 PGlite 上真的执行一遍；入口只从 pglite 取，不依赖 pg 驱动 */
import assert from 'node:assert/strict';
import { afterAll, beforeAll, describe, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import {
  codecs,
  col,
  createDb,
  defineSchema,
  dialectFn,
  entity,
  type Expr,
  type FunctionRenderer,
} from '@zerodep-dev/easy-query-ts';
import { PostgresDialect } from '../src/dialect.ts';
import { Pg, pglite } from '../src/pglite.ts';

const Item = entity('t_fn_item', {
  id: col.int().primaryKey(),
  name: col.string(20),
  attrs: col.json<Record<string, unknown>>(),
});
const schema = defineSchema({ Item }, {});

const database = new PGlite();
const adapter = pglite(database);
const db = createDb({ schema, adapter });

beforeAll(async () => {
  await db.createTables();
  await db
    .insert(Item)
    .values([
      { id: 1, name: 'alpha', attrs: { a: 1, b: 2 } },
      { id: 2, name: 'beta', attrs: { b: 2 } },
      { id: 3, name: 'gamma', attrs: { c: 3 } },
    ])
    .execute();
});
afterAll(() => database.close());

describe('Pg.jsonb 的键', () => {
  const ids = (where: (i: { attrs: Expr<unknown> }) => Expr<boolean>) =>
    db
      .queryable(Item)
      .where(where as never)
      .orderBy((i) => i.id)
      .select((i) => i.id)
      .toList();

  it('hasAnyKey：至少有一个', async () => {
    assert.deepEqual(await ids((i) => Pg.jsonb(i.attrs).hasAnyKey('a', 'c')), [1, 3]);
  });

  it('hasAllKeys：全都有', async () => {
    assert.deepEqual(await ids((i) => Pg.jsonb(i.attrs).hasAllKeys('a', 'b')), [1]);
  });

  it('不给键时报错，不生成 ARRAY[]', () => {
    assert.throws(() => Pg.jsonb(db.queryable(Item) as never).hasAnyKey(), /at least one key/);
  });
});

describe('自写的方言函数', () => {
  class MyDialect extends PostgresDialect {
    protected override functions(): Record<string, FunctionRenderer> {
      return { ...super.functions(), 'my.initial': (a) => `left(${a[0]}, 1)` };
    }
  }
  const initial = (column: Expr<string>) =>
    dialectFn<string>('my.initial', [column], codecs.string);

  it('登记过的方言能用，别的方言渲染时报不支持', async () => {
    const mine = createDb({ schema, adapter: { ...adapter, dialect: new MyDialect() } });
    assert.deepEqual(
      await mine
        .queryable(Item)
        .orderBy((i) => i.id)
        .select((i) => initial(i.name))
        .toList(),
      ['a', 'b', 'g'],
    );
    assert.throws(
      () =>
        db
          .queryable(Item)
          .select((i) => initial(i.name))
          .toSQL(),
      /function 'my\.initial' is not supported by the postgres dialect/,
    );
  });
});
