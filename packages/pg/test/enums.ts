/**
 * PG 的原生枚举与 interval（ROADMAP 19.1），pg 与 PGlite 共用：同步时 ALTER TYPE … ADD VALUE 补上新加的值，
 * 库里多出来的值报成差异；interval 按 PG 输出的文字读出
 */
import assert from 'node:assert/strict';
import { describe, it } from 'vitest';
import { col, createDb, defineSchema, entity, type Adapter } from '@zerodep-dev/easy-query-ts';

const columns = {
  id: col.int().primaryKey(),
  wait: col.interval().nullable(),
};
const TaskV1 = entity('t_task', {
  ...columns,
  state: col.enum(['todo', 'done']).native('eqts_task_state'),
});
const TaskV2 = entity('t_task', {
  ...columns,
  state: col.enum(['todo', 'doing', 'done']).native('eqts_task_state'),
});

export function enumSuite(name: string, adapter: () => Promise<Adapter>): void {
  describe(`${name}: native enums and intervals`, () => {
    it('creates the enum type before the table, adds new values on sync and reports the ones it cannot drop', async () => {
      const v1 = createDb({ schema: defineSchema({ Task: TaskV1 }), adapter: await adapter() });
      await v1.sql.execute`DROP TABLE IF EXISTS t_task`;
      await v1.sql.execute`DROP TYPE IF EXISTS eqts_task_state`;
      await v1.createTables();
      // 建表语句可以重复执行：类型已在就跳过
      await v1.createTables();
      await v1.insert(TaskV1).values({ id: 1, state: 'done', wait: '2 hours' }).execute();
      assert.deepEqual(await v1.queryable(TaskV1).findOrThrow(1), {
        id: 1,
        state: 'done',
        wait: '02:00:00',
      });
      assert.deepEqual(await v1.planSync(), { statements: [], differences: [] });
      // 库里的类型不认的值：库拒绝
      await assert.rejects(v1.sql.execute`INSERT INTO t_task (id, state) VALUES (2, 'gone')`);

      const v2 = createDb({ schema: defineSchema({ Task: TaskV2 }), adapter: await adapter() });
      assert.deepEqual((await v2.planSync()).statements, [
        `ALTER TYPE "eqts_task_state" ADD VALUE 'doing'`,
      ]);
      await v2.syncTables();
      await v2.insert(TaskV2).values({ id: 2, state: 'doing', wait: null }).execute();
      assert.equal(
        await v2
          .queryable(TaskV2)
          .where((t) => t.state.eq('doing'))
          .count(),
        1,
      );
      assert.deepEqual(await v2.planSync(), { statements: [], differences: [] });

      // 退回 v1：PG 删不了枚举值，报成差异
      assert.deepEqual((await v1.planSync()).differences, [
        `type eqts_task_state: the database also has 'doing' (PG cannot drop enum values)`,
      ]);
      await v1.sql.execute`DROP TABLE t_task`;
      await v1.sql.execute`DROP TYPE eqts_task_state`;
    });
  });
}
