/** 实体与列、列类型、多态实体三章的示例 */
import {
  col,
  entity,
  validators,
} from '@zerodep-dev/easy-query-ts';
import { example } from '../../site/example.ts';
import {
  Doc,
  Order,
  OrderItem,
  Payment,
  Shop,
  User,
} from '../../site/model.ts';

// ---- 实体与列

export const declareTable = example((db) => {
  const Gadget = entity(
    't_gadget',
    {
      id: col.bigint().primaryKey().generated(),
      sku: col.string(32).unique().comment('货号'),
      name: col.string(50).named('gadget_name'),
      qty: col.int().dbDefault('0'),
      note: col.string(200).nullable(),
    },
    {
      comment: '小商品',
      indexes: [{ columns: ['name', 'qty'] }],
    },
  );

  return db.createTablesSql(Gadget);
});

export const defaults = example((db) =>
  db
    .insert(Doc)
    .values({ title: '新文档', createdBy: '林晓' })
    .returnEntity(),
);

// ---- 值对象

export const embedRead = example((db) =>
  db
    .queryable(Shop)
    .where((s) => s.address.city.eq('杭州'))
    .toList(),
);

export const embedSelect = example((db) =>
  db
    .queryable(Shop)
    .where((s) => s.address.street.isNotNull())
    .orderBy((s) => s.address.geo.lat.desc())
    .select((s) => ({
      name: s.name,
      city: s.address.city,
      lat: s.address.geo.lat,
    }))
    .toList(),
);

export const embedGroup = example((db) =>
  db
    .queryable(Shop)
    .groupBy((s) => ({ city: s.address.city }))
    .select((g) => ({ city: g.key.city, shops: g.count() }))
    .toList(),
);

export const embedInsert = example((db) =>
  db
    .insert(Shop)
    .values({
      name: '天河店',
      address: {
        city: '广州',
        street: null,
        geo: { lat: 23.13, lng: 113.32 },
      },
    })
    .returnEntity(),
);

// ---- 列类型

export const typeMapping = example((db) => {
  const Sample = entity('t_sample', {
    id: col.bigint().primaryKey(),
    text: col.string(100),
    count: col.int(),
    ratio: col.double(),
    amount: col.decimal(12, 2),
    active: col.boolean(),
    day: col.date(),
    opensAt: col.time(),
    createdAt: col.datetime(),
    level: col.enum(['low', 'high'] as const),
    attrs: col.json<{ tags: string[] }>(),
    token: col.uuid(),
    file: col.bytes().nullable(),
  });

  return db.createTablesSql(Sample);
});

export const decimalMath = example((db) =>
  db
    .queryable(OrderItem)
    .where((i) => i.orderId.eq(3))
    .select((i) => ({
      product: i.product.name,
      subtotal: i.price.times(i.quantity),
      half: i.price.times('0.5'),
    }))
    .toList(),
);

export const decimalSum = example((db) =>
  db
    .queryable(OrderItem)
    .sum((i) => i.price.times(i.quantity)),
);

export const dateText = example((db) =>
  db
    .queryable(User)
    .where((u) => u.joinedAt.ge('2025-01-01'))
    .select((u) => ({
      name: u.name,
      joinedAt: u.joinedAt,
      year: u.joinedAt.year(),
      trial: u.joinedAt.addMonths(3),
    }))
    .toList(),
);

export const datetimeValue = example((db) =>
  db
    .queryable(Order)
    .where((o) =>
      o.createdAt.ge(new Date('2025-08-01T00:00:00Z')),
    )
    .select((o) => ({ id: o.id, createdAt: o.createdAt }))
    .toList(),
);

export const enumValue = example((db) =>
  db
    .queryable(User)
    .where((u) => u.level.in(['senior', 'lead']))
    .count(),
);

// ---- 多态实体

export const unionAll = example((db) =>
  db.queryable(Payment).toList(),
);

export const unionVariant = example((db) =>
  db.queryable(Payment).variant('card').toList(),
);

export const unionSelect = example((db) =>
  db
    .queryable(Payment)
    .variant('wechat')
    .where((p) => p.amount.ge('300'))
    .select((p) => ({
      openId: p.openId,
      amount: p.amount,
      user: p.order.user.name,
    }))
    .toList(),
);

export const unionGroup = example((db) =>
  db
    .queryable(Payment)
    .groupBy((p) => ({ kind: p.kind }))
    .select((g) => ({
      kind: g.key.kind,
      payments: g.count(),
      total: g.sum((p) => p.amount),
    }))
    .toList(),
);

export const unionInsert = example((db) =>
  db
    .insert(Payment)
    .values({
      kind: 'wechat',
      orderId: 6,
      amount: '299.00',
      openId: 'wx-hanmei',
    })
    .returnEntity(),
);

export const unionNavigation = example((db) =>
  db
    .queryable(Order)
    .where((o) => o.payments.any((p) => p.kind.eq('card')))
    .select((o) => ({
      id: o.id,
      paid: o.payments.sum((p) => p.amount),
    }))
    .toList(),
);

export const unionValidate = example(async (_db) => {
  const insert = validators(Payment).insert;

  return {
    ok: await insert['~standard'].validate({
      kind: 'wechat',
      orderId: 6,
      amount: '10.00',
      openId: 'wx-1',
    }),
    missing: await insert['~standard'].validate({
      kind: 'card',
      orderId: 6,
      amount: '10.00',
    }),
  };
});
