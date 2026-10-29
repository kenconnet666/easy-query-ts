// afterWrite 的事件带上写了什么：插入的行（补好默认值）、更新的 set、是不是逻辑删除、执行的语句
import assert from 'node:assert/strict';
import { describe, it } from 'vitest';
import { createDb, touch, type Interceptor, type WriteEvent } from '@zerodep-dev/easy-query-ts';
import { Doc, schema } from '../src/fixture.ts';
import { memoryDb } from '../src/sqlite-env.ts';

declare module '@zerodep-dev/easy-query-ts' {
  interface InterceptorNames {
    auditLog: true;
  }
}

describe('sqlite: write events', () => {
  it('审计拦截器按 kind 拿到各自的字段', async () => {
    const env = await memoryDb();
    const log: string[] = [];
    const events: WriteEvent[] = [];
    const audit: Interceptor = {
      name: 'auditLog',
      afterWrite: (event) => {
        events.push(event);
        switch (event.kind) {
          case 'insert':
            log.push(`insert ${event.rows.map((r) => r['title']).join(',')}`);
            break;
          case 'update':
            log.push(`update ${Object.keys(event.set).sort().join(',')}`);
            break;
          case 'delete':
            log.push(`${event.soft ? 'soft' : 'hard'} delete ${event.affected}`);
            break;
        }
      },
    };
    const stamp = new Date('2026-10-29T00:00:00.000Z');
    const db = createDb({
      schema,
      adapter: env.adapter,
      interceptors: [touch('updatedAt', () => stamp), audit],
    });
    await db.insert(Doc).values({ title: 'a', createdBy: 'u1', secret: 's' }).execute();
    await db
      .update(Doc)
      .set({ title: 'b' })
      .where((d) => d.id.eq(1))
      .execute();
    await db
      .delete(Doc)
      .where((d) => d.id.eq(1))
      .execute();
    await db
      .delete(Doc)
      .hard()
      .where((d) => d.id.eq(1))
      .execute();
    assert.deepEqual(log, ['insert a', 'update title,updatedAt', 'soft delete 1', 'hard delete 1']);

    // 插入的行已补上默认值（逻辑删除列、版本、$default、touch）
    const insert = events[0]!;
    assert.equal(insert.kind, 'insert');
    if (insert.kind === 'insert') {
      assert.deepEqual(
        { ...insert.rows[0], updatedAt: undefined },
        {
          title: 'a',
          createdBy: 'u1',
          secret: 's',
          deleted: false,
          version: 0,
          token: 'tok',
          updatedAt: undefined,
        },
      );
    }
    // 执行的语句与参数（条件在里面）
    assert.match(events[1]!.statements[0]!.sql, /^UPDATE "t_doc"/);
    assert.match(events[2]!.statements[0]!.sql, /^UPDATE "t_doc" AS t0 SET "deleted" = \?/);
    assert.match(events[3]!.statements[0]!.sql, /^DELETE FROM "t_doc"/);
  });
});
