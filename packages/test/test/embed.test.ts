// 值对象（对应 Java 版的 @ValueObject）：几列合成实体上的一个嵌套对象
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { describe, it } from 'vitest';
import {
  col,
  createDb,
  defineSchema,
  embed,
  entity,
  parseTableRequest,
} from '@zerodep-dev/easy-query-ts';
import { sqlite } from '@zerodep-dev/easy-query-ts-sqlite';

const Shop = entity('t_shop', {
  id: col.int().primaryKey().generated(),
  name: col.string(),
  address: embed({
    province: col.string(),
    city: col.string(),
    street: col.string().nullable(),
    // 值对象里再嵌值对象；prefix 换掉默认的"属性名_"
    geo: embed({ lat: col.double(), lng: col.double() }, { prefix: 'geo_' }),
  }),
  // 子列 named() 时用它给的全名；里面全都可空，插入时整个可省
  contact: embed({ phone: col.string().named('tel').nullable() }),
});
const Order = entity('t_order', {
  id: col.int().primaryKey().generated(),
  shopId: col.int(),
});
const schema = defineSchema(
  { Shop, Order },
  {
    Order: (r) => ({ shop: r.one('Shop', { from: 'shopId', to: 'id' }) }),
    Shop: (r) => ({ orders: r.many('Order', { from: 'id', to: 'shopId' }) }),
  },
);

async function open() {
  const db = createDb({ schema, adapter: sqlite(new DatabaseSync(':memory:')) });
  await db.createTables();
  await db
    .insert(Shop)
    .values([
      {
        name: 'a',
        address: { province: 'zj', city: 'hz', street: 'x', geo: { lat: 30.2, lng: 120.1 } },
        contact: { phone: '1' },
      },
      {
        name: 'b',
        address: { province: 'js', city: 'nj', street: null, geo: { lat: 32, lng: 118.8 } },
      },
    ])
    .execute();
  await db.insert(Order).values({ shopId: 1 }).execute();
  return db;
}

describe('sqlite: embed (value objects)', () => {
  it('库里是普通的列，列名是"属性名_子属性名"', () => {
    const db = createDb({ schema, adapter: sqlite(new DatabaseSync(':memory:')) });
    assert.equal(
      db.createTableSql(Shop),
      'CREATE TABLE IF NOT EXISTS "t_shop" ("id" INTEGER PRIMARY KEY AUTOINCREMENT, "name" TEXT NOT NULL,' +
        ' "address_province" TEXT NOT NULL, "address_city" TEXT NOT NULL, "address_street" TEXT,' +
        ' "geo_lat" REAL NOT NULL, "geo_lng" REAL NOT NULL, "tel" TEXT)',
    );
  });

  it('读出来是嵌套对象；查询里 s.address.city 是一列', async () => {
    const db = await open();
    const a = await db.queryable(Shop).findOrThrow(1);
    assert.deepEqual(a, {
      id: 1,
      name: 'a',
      address: { province: 'zj', city: 'hz', street: 'x', geo: { lat: 30.2, lng: 120.1 } },
      contact: { phone: '1' },
    });
    const rows = await db
      .queryable(Shop)
      .where((s) => s.address.geo.lat.gt(31))
      .orderBy((s) => s.address.city)
      .select((s) => ({ name: s.name, where: s.address }))
      .toList();
    assert.deepEqual(rows, [
      {
        name: 'b',
        where: { province: 'js', city: 'nj', street: null, geo: { lat: 32, lng: 118.8 } },
      },
    ]);
    // 导航到的整行也是嵌套的
    const order = await db
      .queryable(Order)
      .select((o) => ({ id: o.id, city: o.shop.address.city, shop: o.shop }))
      .single();
    assert.equal(order.city, 'hz');
    assert.equal(order.shop.address.geo.lng, 120.1);
  });

  it('更新时值对象可以只给其中几项；entity(row) 整行更新', async () => {
    const db = await open();
    await db
      .update(Shop)
      .set({ address: { city: 'nb', geo: { lat: 29.9 } } })
      .where((s) => s.id.eq(1))
      .execute();
    const a = await db.queryable(Shop).findOrThrow(1);
    assert.deepEqual(a.address, {
      province: 'zj',
      city: 'nb',
      street: 'x',
      geo: { lat: 29.9, lng: 120.1 },
    });
    await db
      .update(Shop)
      .entity({ ...a, address: { ...a.address, street: null }, contact: { phone: null } })
      .execute();
    const again = await db.queryable(Shop).findOrThrow(1);
    assert.equal(again.address.street, null);
    assert.deepEqual(again.contact, { phone: null });
    // 值对象给 null：它的每一列都写 NULL
    await db
      .update(Shop)
      .set({ contact: null })
      .where((s) => s.id.eq(2))
      .execute();
    assert.deepEqual((await db.queryable(Shop).findOrThrow(2)).contact, { phone: null });
  });

  it('returning、列表请求的筛选排序认值对象的路径；save 照常', async () => {
    const db = await open();
    const [row] = await db
      .update(Shop)
      .set({ name: 'a2' })
      .where((s) => s.id.eq(1))
      .returning('name', 'address')
      .execute();
    assert.deepEqual(row, {
      name: 'a2',
      address: { province: 'zj', city: 'hz', street: 'x', geo: { lat: 30.2, lng: 120.1 } },
    });

    const page = await db
      .queryable(Shop)
      .select((s) => ({ name: s.name, address: s.address }))
      .table(parseTableRequest({ sort: '-address.city', 'filter.address.province': ['js', 'zj'] }));
    assert.deepEqual(
      page.rows.map((r) => r.address.city),
      ['nj', 'hz'],
    );

    const saved = await db.save(Shop, { id: 2, address: { city: 'sz' } });
    assert.equal(saved.address.city, 'sz');
    assert.equal(saved.address.province, 'js');
  });

  it('主键不能放进值对象；整行带值对象时不能当派生表', async () => {
    assert.throws(
      () => entity('t_x', { key: embed({ id: col.int().primaryKey() }) }),
      /primary key column cannot be inside embed/,
    );
    const db = await open();
    assert.throws(() => db.queryable(Shop).asTable(), /plain expressions/);
  });
});
