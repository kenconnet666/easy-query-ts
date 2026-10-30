// 数组列（ROADMAP 19.1）：PG 的数组字面量与驱动给的 JS 数组都能解码；别的方言建表时报不支持
import assert from 'node:assert/strict';
import { describe, it } from 'vitest';
import { col, entity } from '@zerodep-dev/easy-query-ts';
import { memoryDb } from '../src/sqlite-env.ts';

describe('col.array', () => {
  it('解码数组字面量：引号、反斜杠、逗号、NULL 与 "NULL" 文字', () => {
    const { codec } = col.array(col.string().nullable());
    assert.deepEqual(codec.decode('{a,"b,c","x\\"y","back\\slash",NULL,"NULL"}'), [
      'a',
      'b,c',
      'x"y',
      'back\slash',
      null,
      'NULL',
    ]);
    assert.deepEqual(codec.decode('{}'), []);
    assert.throws(() => codec.decode('{{1,2},{3,4}}'), /multi-dimensional/);
  });

  it('元素经过元素列的 codec：读出的日期时间文字、写入的 Date', () => {
    const { codec } = col.array(col.datetime());
    const [d] = codec.decode('{"2026-03-04 05:06:07.008"}');
    assert.equal(d!.toISOString(), '2026-03-04T05:06:07.008Z');
    assert.deepEqual(codec.encode([new Date('2026-03-04T05:06:07.008Z')]), [
      '2026-03-04 05:06:07.008',
    ]);
    assert.deepEqual(col.array(col.int()).codec.decode([1, 2]), [1, 2]);
  });

  it('不是 PG 的方言建表时报不支持', async () => {
    const { db } = await memoryDb();
    const Tagged = entity('t_tagged', {
      id: col.int().primaryKey(),
      tags: col.array(col.string()),
    });
    assert.throws(
      () => db.createTableSql(Tagged),
      /array columns are only supported on PostgreSQL/,
    );
    assert.throws(
      () =>
        db
          .queryable(Tagged)
          .where((t) => t.tags.has('x'))
          .toSQL(),
      /function 'array_has' is not supported by the sqlite dialect/,
    );
  });
});
