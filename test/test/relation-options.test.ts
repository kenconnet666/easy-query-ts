// 关系上的选项：required（INNER JOIN、列不可空，对应 @Navigate(required)）、对目标表的拦截器开关、关联键为空串时不查子项
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { describe, it } from 'vitest';
import { col, createDb, defineSchema, entity, type Statement } from '@zerodep-dev/easy-query-ts';
import { sqlite } from '@zerodep-dev/easy-query-ts-sqlite';

const Org = entity('t_org', {
  id: col.int().primaryKey(),
  name: col.string(),
  deleted: col.boolean().softDelete(),
});
const Staff = entity('t_staff', {
  id: col.int().primaryKey(),
  name: col.string(),
  orgId: col.int().nullable(),
  // 外部系统的编码，没填时是空串
  code: col.string(),
});
const Badge = entity('t_staff_badge', {
  id: col.int().primaryKey(),
  staffCode: col.string(),
  label: col.string(),
});

const schema = defineSchema(
  { Org, Staff, Badge },
  {
    Staff: (r) => ({
      org: r.one('Org', { from: 'orgId', to: 'id' }),
      // 一定有所属机构：内连接，列不可空
      requiredOrg: r.one('Org', { from: 'orgId', to: 'id' }, { required: true }),
      // 已删除的机构也要显示名字
      anyOrg: r.one('Org', { from: 'orgId', to: 'id' }, { interceptors: { skip: ['softDelete'] } }),
      badges: r.many('Badge', { from: 'code', to: 'staffCode' }),
    }),
  },
);

async function open() {
  const statements: Statement[] = [];
  const db = createDb({
    schema,
    adapter: sqlite(new DatabaseSync(':memory:')),
    log: (s) => statements.push(s),
  });
  await db.createTables();
  await db
    .insert(Org)
    .values([
      { id: 1, name: 'live' },
      { id: 2, name: 'gone', deleted: true },
    ])
    .execute();
  await db
    .insert(Staff)
    .values([
      { id: 1, name: 'a', orgId: 1, code: 'S1' },
      { id: 2, name: 'b', orgId: 2, code: '' },
      { id: 3, name: 'c', orgId: null, code: ' ' },
    ])
    .execute();
  await db
    .insert(Badge)
    .values([
      { id: 1, staffCode: 'S1', label: 'gold' },
      { id: 2, staffCode: '', label: 'orphan' },
    ])
    .execute();
  statements.length = 0;
  return { db, statements };
}

describe('sqlite: relation options', () => {
  it('required：INNER JOIN，没有目标的行被过滤，列的类型不可空', async () => {
    const { db } = await open();
    const query = db
      .queryable(Staff)
      .orderBy((s) => s.id)
      .select((s) => ({ name: s.name, org: s.requiredOrg.name }));
    assert.match(query.toSQL().sql, /INNER JOIN "t_org" t1 ON/);
    const rows = await query.toList();
    // b 的机构已逻辑删除、c 没有机构：都被内连接过滤掉
    assert.deepEqual(rows, [{ name: 'a', org: 'live' }]);
    const name: string = rows[0]!.org;
    void name;
  });

  it('关系上的拦截器开关：已删除的机构也能显示', async () => {
    const { db } = await open();
    const rows = await db
      .queryable(Staff)
      .orderBy((s) => s.id)
      .select((s) => ({ name: s.name, org: s.org.name, any: s.anyOrg.name }))
      .toList();
    assert.deepEqual(rows, [
      { name: 'a', org: 'live', any: 'live' },
      { name: 'b', org: null, any: 'gone' },
      { name: 'c', org: null, any: null },
    ]);
  });

  it('关联键是空串、全空白的行不去查子项', async () => {
    const { db, statements } = await open();
    const rows = await db
      .queryable(Staff)
      .orderBy((s) => s.id)
      .select((s) => ({ name: s.name, badges: s.badges.toList((b) => b.label) }))
      .toList();
    assert.deepEqual(rows, [
      { name: 'a', badges: ['gold'] },
      { name: 'b', badges: [] },
      { name: 'c', badges: [] },
    ]);
    // 第二条查询只带了 S1
    assert.deepEqual(statements[1]!.params, ['S1']);
  });
});
