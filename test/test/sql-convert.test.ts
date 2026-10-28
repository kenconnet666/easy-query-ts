// 列值在 SQL 里转换（对应 Java 版的 ColumnValueSQLConverter）：读写都由库里的函数完成
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { describe, it } from 'vitest';
import { col, createDb, defineSchema, entity, sql } from '@zerodep-dev/easy-query-ts';
import { sqlite } from '@zerodep-dev/easy-query-ts-sqlite';

// 库里存成十六进制、读出来是原文：只有库能解，应用拿到的是转换后的值
const Contact = entity('t_contact', {
  id: col.int().primaryKey().generated(),
  name: col.string(),
  phone: col.string().sqlConvert({
    read: (c) => sql<string>`unhex_text(${c})`,
    write: (v) => sql<string>`hex(${v})`,
  }),
});
const schema = defineSchema({ Contact });

function open() {
  const database = new DatabaseSync(':memory:');
  database.function('unhex_text', (hex) => Buffer.from(String(hex), 'hex').toString('utf8'));
  database.exec(
    'CREATE TABLE t_contact (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE, phone TEXT NOT NULL)',
  );
  return { database, db: createDb({ schema, adapter: sqlite(database) }) };
}

describe('sqlite: sqlConvert', () => {
  it('写入经 write 转换，读出、条件、排序都用 read 转换后的值', async () => {
    const { database, db } = open();
    await db
      .insert(Contact)
      .values([
        { name: 'a', phone: '138-0000' },
        { name: 'b', phone: '139-1111' },
      ])
      .execute();
    const stored = database.prepare('SELECT phone FROM t_contact ORDER BY id').all();
    assert.deepEqual(
      stored.map((r) => r['phone']),
      ['3133382D30303030', '3133392D31313131'],
    );
    const rows = await db
      .queryable(Contact)
      .where((c) => c.phone.startsWith('139'))
      .select((c) => ({ name: c.name, phone: c.phone }))
      .toList();
    assert.deepEqual(rows, [{ name: 'b', phone: '139-1111' }]);
    assert.equal((await db.queryable(Contact).findOrThrow(1)).phone, '138-0000');

    await db
      .update(Contact)
      .set({ phone: '137-2222' })
      .where((c) => c.phone.eq('138-0000'))
      .execute();
    assert.equal((await db.queryable(Contact).findOrThrow(1)).phone, '137-2222');
  });

  it('upsert 认得转换过的列；RETURNING 拿不到转换后的值，returnEntity 改为插入后查回', async () => {
    const { db } = open();
    await db.insert(Contact).values({ name: 'a', phone: '1' }).execute();
    await db
      .insert(Contact)
      .values({ name: 'a', phone: '2' })
      .onConflict((c) => c.name)
      .merge((c) => c.phone)
      .execute();
    assert.equal((await db.queryable(Contact).findOrThrow(1)).phone, '2');

    assert.throws(
      () => db.insert(Contact).values({ name: 'b', phone: '3' }).returning('phone'),
      /returning\(\) cannot read phone/,
    );
    const inserted = await db.insert(Contact).values({ name: 'c', phone: '4' }).returnEntity();
    // 上面那次 upsert 已经用掉一个自增值
    assert.deepEqual(inserted, { id: 3, name: 'c', phone: '4' });
  });
});
