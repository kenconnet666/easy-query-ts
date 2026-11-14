// 导航的边角：拦截器开关只管导航自己的表、直达关系各段的开关、定义时拦下拼不出来的关系、每个父行取前几条的排序
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { describe, it } from 'vitest';
import {
  col,
  createDb,
  defineSchema,
  embed,
  entity,
  type Statement,
} from '@zerodep-dev/easy-query-ts';
import { sqlite } from '@zerodep-dev/easy-query-ts-sqlite';

const A = entity('t_a', { id: col.int().primaryKey(), deleted: col.boolean().softDelete() });
const B = entity('t_b', {
  id: col.int().primaryKey(),
  aId: col.int(),
  deleted: col.boolean().softDelete(),
});
const C = entity('t_c', {
  id: col.int().primaryKey(),
  bId: col.int(),
  deleted: col.boolean().softDelete(),
});
// 没有主键的子表
const Line = entity('t_line', { aId: col.int(), text: col.string() });

const schema = defineSchema(
  { A, B, C, Line },
  {
    A: (r) => ({
      bs: r.many('B', { from: 'id', to: 'aId' }),
      bsWithDeleted: r.many(
        'B',
        { from: 'id', to: 'aId' },
        { interceptors: { skip: ['softDelete'] } },
      ),
      cs: r.path('C', ['bs', 'cs']),
      csOfAnyB: r.path('C', ['bsWithDeleted', 'cs']),
      lines: r.many('Line', { from: 'id', to: 'aId' }),
    }),
    B: (r) => ({ cs: r.many('C', { from: 'id', to: 'bId' }) }),
  },
);

const database = new DatabaseSync(':memory:');
database.exec(`
CREATE TABLE t_a (id INTEGER PRIMARY KEY, deleted INTEGER NOT NULL);
CREATE TABLE t_b (id INTEGER PRIMARY KEY, a_id INTEGER NOT NULL, deleted INTEGER NOT NULL);
CREATE TABLE t_c (id INTEGER PRIMARY KEY, b_id INTEGER NOT NULL, deleted INTEGER NOT NULL);
CREATE TABLE t_line (a_id INTEGER NOT NULL, text TEXT NOT NULL);
INSERT INTO t_a VALUES (1, 0);
INSERT INTO t_b VALUES (1, 1, 0), (2, 1, 1);
INSERT INTO t_c VALUES (1, 1, 0), (2, 2, 0), (3, 2, 1);
INSERT INTO t_line VALUES (1, 'x'), (1, 'y'), (1, 'z');
`);
const statements: Statement[] = [];
const db = createDb({ schema, adapter: sqlite(database), log: (s) => statements.push(s) });
const softDeletes = (sql: string) => sql.match(/"deleted" = \?/g)?.length ?? 0;

describe('sqlite: navigation guards', () => {
  it('导航上的 noInterceptor 只管这个导航的表，里面嵌套的导航照常过滤', async () => {
    const query = db
      .queryable(A)
      .where((a) => a.bs.noInterceptor('softDelete').any((b) => b.cs.any()));
    // 主表与 t_c 各一处，t_b 没有
    const { sql } = query.toSQL();
    assert.equal(softDeletes(sql), 2);
    assert.doesNotMatch(sql, /t1\."deleted"/);
    // 对象树的第二、第三条查询同样：已删除的 b 读得到，它下面已删除的 c 读不到
    const rows = await db
      .queryable(A)
      .select((a) => ({
        bs: a.bs
          .noInterceptor('softDelete')
          .orderBy((b) => b.id)
          .toList((b) => ({ id: b.id, cs: b.cs.orderBy((c) => c.id).toList((c) => c.id) })),
      }))
      .toList();
    assert.deepEqual(rows, [
      {
        bs: [
          { id: 1, cs: [1] },
          { id: 2, cs: [2] },
        ],
      },
    ]);
  });

  it('直达关系里各段定义时写的拦截器开关照样生效', async () => {
    const count = (name: 'cs' | 'csOfAnyB') =>
      db
        .queryable(A)
        .select((a) => a[name].count())
        .single();
    // 经过没删的 b：c1；连已删除的 b 也算：c1、c2（c3 自己删了）
    assert.equal(await count('cs'), 1);
    assert.equal(await count('csOfAnyB'), 2);
  });

  it('定义时拦下：直达关系经过 oneOfMany、导航与值对象同名', () => {
    assert.throws(
      () =>
        defineSchema(
          { A, B, C },
          {
            A: (r) => ({
              bs: r.many('B', { from: 'id', to: 'aId' }),
              lastB: r.oneOfMany('B', 'bs', { orderBy: (b) => b.id.desc() }),
              lastCs: r.path('C', ['lastB', 'cs']),
            }),
            B: (r) => ({ cs: r.many('C', { from: 'id', to: 'bId' }) }),
          },
        ),
      /'lastB' is a oneOfMany relation and cannot be part of a path/,
    );
    const Shop = entity('t_shop', {
      id: col.int().primaryKey(),
      address: embed({ city: col.string() }),
    });
    assert.throws(
      () =>
        defineSchema(
          { Shop, B },
          { Shop: (r) => ({ address: r.many('B', { from: 'id', to: 'aId' }) }) },
        ),
      /has the same name as a column/,
    );
  });

  it('limit 之后不能 groupJoin：它聚合的是所有行', () => {
    assert.throws(
      () =>
        db
          .queryable(A)
          .select((a) => ({ n: a.bs.limit(1).groupJoin().count() }))
          .toSQL(),
      /groupJoin\(\) aggregates every row/,
    );
  });

  it('每个父行取前几条：没写排序按主键，没有主键按关联列（窗口里总有 ORDER BY）', async () => {
    const from = statements.length;
    const rows = await db
      .queryable(A)
      .select((a) => ({
        bs: a.bs.limit(1).toList((b) => b.id),
        lines: a.lines.limit(2).toList((l) => l.text),
      }))
      .toList();
    assert.deepEqual(rows[0]!.bs, [1]);
    assert.equal(rows[0]!.lines.length, 2);
    const [, bs, lines] = statements.slice(from).map((s) => s.sql);
    assert.match(bs!, /ROW_NUMBER\(\) OVER \(PARTITION BY t\d+\."a_id" ORDER BY t\d+\."id" ASC\)/);
    assert.match(lines!, /ROW_NUMBER\(\) OVER \(PARTITION BY (t\d+\."a_id") ORDER BY \1 ASC\)/);
  });
});
