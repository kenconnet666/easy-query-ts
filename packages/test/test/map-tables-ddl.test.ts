// mapTables 之后的 DDL：传原实体也要落在映射后的表上，否则 dropTables 会删掉原表
import assert from 'node:assert/strict';
import { describe, it } from 'vitest';
import { Post, seed } from '../src/fixture.ts';
import { memoryDb } from '../src/sqlite-env.ts';

describe('sqlite: DDL on a Db with mapped tables', () => {
  it('createTables、dropTables 传原实体时只动映射后的表', async () => {
    const { db } = await seed(await memoryDb());
    const archive = db.mapTables({ Post: 't_post_archive' });
    const before = await db.queryable(Post).count();

    await archive.createTables(Post);
    assert.equal(await archive.tableExists(Post), true);
    assert.equal(await archive.queryable(Post).count(), 0);

    await archive.dropTables(Post);
    assert.equal(await archive.tableExists(Post), false);
    assert.equal(await db.queryable(Post).count(), before);
  });

  it('createTablesSql 渲染映射后的表名', async () => {
    const { db } = await seed(await memoryDb());
    const [statement] = db.mapTables({ Post: 't_post_archive' }).createTablesSql(Post);
    assert.match(statement!, /t_post_archive/);
  });
});
