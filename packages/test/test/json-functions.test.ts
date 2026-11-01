// JSON 函数（对应官方 func/json 的 JSONObject / JSONArray）：路径按列的类型补全、检查，取出的值带类型
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { describe, it } from 'vitest';
import { col, createDb, defineSchema, entity } from '@zerodep-dev/easy-query-ts';
import { sqlite } from '@zerodep-dev/easy-query-ts-sqlite';

interface Extra {
  code: string;
  success: boolean;
  profile: { age: number; tags: string[] };
  items: { name: string; qty: number }[];
}

const Topic = entity('t_topic_json', {
  id: col.int().primaryKey().generated(),
  extra: col.json<Extra>(),
});
const schema = defineSchema({ Topic });

async function open() {
  const db = createDb({ schema, adapter: sqlite(new DatabaseSync(':memory:')) });
  await db.createTables();
  await db
    .insert(Topic)
    .values([
      {
        extra: {
          code: '200',
          success: true,
          profile: { age: 18, tags: ['a', 'b'] },
          items: [
            { name: 'Jack', qty: 2 },
            { name: 'Rose', qty: 1 },
          ],
        },
      },
      {
        extra: { code: '500', success: false, profile: { age: 30, tags: [] }, items: [] },
      },
    ])
    .execute();
  return db;
}

describe('sqlite: json functions', () => {
  it('按字段、数组下标取值；数字、布尔有类型；元素解析成对象', async () => {
    const db = await open();
    const rows = await db
      .queryable(Topic)
      .orderBy((t) => t.id)
      .select((t) => ({
        code: t.extra.jsonText('code'),
        ok: t.extra.jsonBoolean('success'),
        age: t.extra.jsonNumber('profile', 'age'),
        firstItem: t.extra.json('items', 0),
        firstName: t.extra.jsonText('items', 0, 'name'),
        items: t.extra.jsonLength('items'),
        profile: t.extra.json('profile'),
      }))
      .toList();
    assert.deepEqual(rows[0], {
      code: '200',
      ok: true,
      age: 18,
      firstItem: { name: 'Jack', qty: 2 },
      firstName: 'Jack',
      items: 2,
      profile: { age: 18, tags: ['a', 'b'] },
    });
    assert.deepEqual(rows[1]!.firstItem, null);
    assert.equal(rows[1]!.ok, false);
  });

  it('条件里用：字段等于、数字比较、数组里的对象', async () => {
    const db = await open();
    const ids = (await db
      .queryable(Topic)
      .where((t) => [
        t.extra.jsonText('code').eq('200'),
        t.extra.jsonNumber('profile', 'age').lt(20),
        t.extra.jsonText('items', 0, 'name').eq('Jack'),
        t.extra.jsonHas('profile', 'tags', 1),
      ])
      .select((t) => t.id)
      .toList()) as number[];
    assert.deepEqual(ids, [1]);
  });

  it('路径与终点类型在编译期检查', () => {
    const db = createDb({ schema, adapter: sqlite(new DatabaseSync(':memory:')) });
    db.queryable(Topic).select((t) => ({
      // @ts-expect-error 没有这个字段
      wrong: t.extra.jsonText('nope'),
      // @ts-expect-error code 是字符串，不能当数字取
      notNumber: t.extra.jsonNumber('code'),
      // @ts-expect-error 数组下标要写数字
      badIndex: t.extra.json('items', 'name'),
    }));
  });
});
