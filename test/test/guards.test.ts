// 列修饰与全局护栏：$onDelete、加密列的 like、库里生成的插入值、hardDelete: 'forbid'、maxRows
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { describe, it } from 'vitest';
import { col, createDb, defineSchema, entity, sql } from '@zerodep-dev/easy-query-ts';
import { sqlite } from '@zerodep-dev/easy-query-ts-sqlite';
import { Company, Doc, rot13, seed, User } from '../src/fixture.ts';
import { memoryDb } from '../src/sqlite-env.ts';

let user = 'u1';
const Ticket = entity('t_ticket', {
  id: col.int().primaryKey().generated(),
  // 库里生成：插入时没给就用库函数
  code: col.string().$default(() => sql<string>`'T-' || abs(random() % 1000)`),
  title: col.string(),
  // 逐字符的位移：一段明文的密文就是整段密文的一部分，可以加密后搜索
  note: col.string().encrypted({ ...rot13, searchable: true }),
  deleted: col.boolean().softDelete(),
  deletedBy: col
    .string()
    .nullable()
    .$onDelete(() => user),
});
const Tag = entity('t_tag', { id: col.int().primaryKey().generated(), name: col.string() });
const schema = defineSchema({ Ticket, Tag });

async function open(options: { hardDelete?: 'forbid'; maxRows?: number } = {}) {
  const db = createDb({ schema, adapter: sqlite(new DatabaseSync(':memory:')), ...options });
  await db.createTables();
  return db;
}

describe('sqlite: column guards', () => {
  it('$onDelete：逻辑删除时一并写入删除人', async () => {
    const db = await open();
    await db.insert(Ticket).values({ title: 'a', note: 'hello world' }).execute();
    user = 'u2';
    await db
      .delete(Ticket)
      .where((t) => t.id.eq(1))
      .execute();
    const row = await db.queryable(Ticket).noInterceptor('softDelete').findOrThrow(1);
    assert.equal(row.deleted, true);
    assert.equal(row.deletedBy, 'u2');
  });

  it('插入值与 $default 可以是库里生成的 sql 片段', async () => {
    const db = await open();
    await db
      .insert(Ticket)
      .values([
        { title: 'a', note: 'x' },
        { title: 'b', note: 'y', code: sql<string>`upper('given')` },
      ])
      .execute();
    const codes = await db
      .queryable(Ticket)
      .orderBy((t) => t.id)
      .select((t) => t.code)
      .toList();
    assert.match(codes[0]!, /^T-\d+$/);
    assert.equal(codes[1], 'GIVEN');
  });

  it('加密列上的 like：可分段的策略加密后匹配，不可分段的报错', async () => {
    const db = await open();
    await db.insert(Ticket).values({ title: 'a', note: 'hello world' }).execute();
    const found = await db
      .queryable(Ticket)
      .where((t) => t.note.like('lo wo'))
      .select((t) => t.note)
      .toList();
    assert.deepEqual(found, ['hello world']);
    const env = await memoryDb();
    assert.throws(
      () =>
        env.db
          .queryable(Doc)
          .where((d) => d.secret.like('x'))
          .toSQL(),
      /searchable encryption strategy/,
    );
  });

  it("hardDelete: 'forbid'：没有逻辑删除的实体要显式 hard()", async () => {
    const db = await open({ hardDelete: 'forbid' });
    await db
      .insert(Tag)
      .values([{ name: 'a' }, { name: 'b' }])
      .execute();
    assert.throws(
      () =>
        db
          .delete(Tag)
          .where((t) => t.id.eq(1))
          .toSQL(),
      /physical delete of t_tag is forbidden/,
    );
    assert.equal(
      await db
        .delete(Tag)
        .hard()
        .where((t) => t.id.eq(1))
        .execute(),
      1,
    );
    // 有逻辑删除的照常
    await db.insert(Ticket).values({ title: 'a', note: 'x' }).execute();
    assert.equal(
      await db
        .delete(Ticket)
        .where((t) => t.id.eq(1))
        .execute(),
      1,
    );
  });

  it('maxRows：没写 limit 的 toList 超了就报错；limit、toPage 不受限', async () => {
    const env = await seed(await memoryDb());
    const db = createDb({
      schema: (await import('../src/fixture.ts')).schema,
      adapter: env.adapter,
      maxRows: 2,
    });
    await assert.rejects(db.queryable(User).toList(), /more than 2 rows \(maxRows\)/);
    assert.equal((await db.queryable(Company).toList()).length, 2);
    assert.equal((await db.queryable(User).limit(3).toList()).length, 3);
    assert.equal((await db.queryable(User).toPage(1, 10)).rows.length, 3);
  });
});
