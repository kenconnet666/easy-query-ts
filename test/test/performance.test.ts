// 性能项（对应官方 performance/deep-page、adv/smart-predicate）：深分页倒序取、派生表条件穿透
import assert from 'node:assert/strict';
import { describe, it } from 'vitest';
import { createDb, win } from '@zerodep-dev/easy-query-ts';
import { Company, schema, seed, User } from '../src/fixture.ts';
import { memoryDb } from '../src/sqlite-env.ts';

describe('sqlite: performance', () => {
  it('深分页：偏移量过了门槛且超过一半时倒序取再翻回来，结果与正序一致', async () => {
    const env = await memoryDb();
    await env.db
      .insert(Company)
      .values(
        Array.from({ length: 22 }, (_, i) => ({ name: `c${String(i + 1).padStart(2, '0')}` })),
      )
      .execute();
    const db = createDb({
      schema,
      adapter: env.adapter,
      reversePageAfter: 5,
      log: (s) => env.statements.push(s),
    });
    const q = db
      .queryable(Company)
      .orderBy((c) => c.id)
      .select((c) => c.name);
    env.statements.length = 0;
    const page4 = await q.toPage(4, 5);
    assert.deepEqual(page4.rows, ['c16', 'c17', 'c18', 'c19', 'c20']);
    assert.match(env.statements.at(-1)!.sql, /ORDER BY t0\."id" DESC LIMIT 5 OFFSET 2$/);
    // 最后一页不满
    assert.deepEqual((await q.toPage(5, 5)).rows, ['c21', 'c22']);
    // 前半段照常正序
    assert.deepEqual((await q.toPage(2, 5)).rows, ['c06', 'c07', 'c08', 'c09', 'c10']);
    assert.match(env.statements.at(-1)!.sql, /ORDER BY t0\."id" ASC LIMIT 5 OFFSET 5$/);
    assert.deepEqual((await q.toPage(9, 5)).rows, []);
  });

  it('派生表条件穿透：外层的条件换成子查询里的表达式推进去；子查询有窗口函数时一条都不推', async () => {
    const env = await seed(await memoryDb());
    const { db } = env;
    const plain = db
      .queryable(User)
      .select((u) => ({ id: u.id, upper: u.name.upper(), age: u.age }))
      .asTable();
    const query = plain.where((t) => [t.upper.startsWith('A'), t.age.gt(18)]);
    // 条件进了子查询，外层没有 WHERE
    assert.match(
      query.toSQL().sql,
      /FROM "t_user" t0 WHERE UPPER\(t0\."name"\) LIKE \? ESCAPE '\\' AND t0\."age" > \?\) t0$/,
    );
    assert.deepEqual(
      (await query.toList()).map((r) => r.upper),
      ['ALICE'],
    );

    const ranked = db
      .queryable(User)
      .select((u) => ({ id: u.id, rn: win.rowNumber((w) => w.orderBy(u.id)) }))
      .asTable()
      .where((t) => [t.id.gt(1), t.rn.le(2)]);
    // 先过滤会改变编号：条件都留在外层，结果是第 2 个
    assert.match(ranked.toSQL().sql, /\) t0 WHERE t0\."c0" > \? AND t0\."c1" <= \?$/);
    assert.deepEqual(
      (await ranked.toList()).map((r) => r.rn),
      [2],
    );
  });
});
