/** 函数一章的示例 */
import {
  caseWhen,
  greatest,
  least,
  text,
} from '@zerodep-dev/easy-query-ts';
import { example } from '../../site/example.ts';
import {
  Comment,
  Order,
  OrderItem,
  Post,
  User,
} from '../../site/model.ts';

export const upperLength = example((db) =>
  db
    .queryable(User)
    .select((u) => ({
      name: u.name,
      length: u.name.length(),
    }))
    .toList(),
);

export const strings = example((db) =>
  db
    .queryable(User)
    .select((u) => ({
      first: u.name.left(1),
      label: text`${u.name}（${u.company.name}）`,
      replaced: u.name.replace('林', 'Lin'),
    }))
    .toList(),
);

export const substring = example((db) =>
  db
    .queryable(Post)
    .select((p) => ({
      head: p.title.substring(0, 4),
      where: p.title.indexOf('的'),
      padded: p.views.cast('string').padStart(6, '0'),
    }))
    .toList(),
);

export const dates = example((db) =>
  db
    .queryable(User)
    .select((u) => ({
      year: u.joinedAt.year(),
      month: u.joinedAt.month(),
      text: u.joinedAt.format('yyyy/MM/dd'),
    }))
    .toList(),
);

export const dateMath = example((db) =>
  db
    .queryable(User)
    .where((u) => u.joinedAt.ge('2024-01-01'))
    .select((u) => ({
      name: u.name,
      days: u.joinedAt.diff('2026-01-01', 'day'),
      probationEnds: u.joinedAt.addMonths(3),
    }))
    .toList(),
);

export const groupByMonth = example((db) =>
  db
    .queryable(Order)
    .groupBy((o) => ({ month: o.createdAt.month() }))
    .select((g) => ({
      month: g.key.month,
      orders: g.count(),
    }))
    .toList(),
);

export const numbers = example((db) =>
  db
    .queryable(Post)
    .select((p) => ({
      title: p.title,
      thousand: p.views.div(1000).round(1),
      capped: least(p.views, 2000),
      floored: greatest(p.views, 100),
    }))
    .toList(),
);

export const money = example((db) =>
  db
    .queryable(OrderItem)
    .where((i) => i.orderId.eq(3))
    .select((i) => ({
      product: i.product.name,
      subtotal: i.price.times(i.quantity),
      discounted: i.price
        .times(i.quantity)
        .times(0.9)
        .round(2),
    }))
    .toList(),
);

export const nullable = example((db) =>
  db
    .queryable(User)
    .select((u) => ({
      name: u.name,
      age: u.age.orElse(0),
      company: u.company.name.orElse('自由职业'),
      emptyLevel: u.level.nullIf('junior'),
    }))
    .toList(),
);

export const conditions = example((db) =>
  db
    .queryable(Comment)
    .select((c) => ({
      body: c.body,
      heat: caseWhen(c.likes.ge(15), '热评')
        .when(c.likes.ge(5), '不错')
        .else('一般'),
      isReply: caseWhen(c.parentId.isNotNull(), true).else(
        false,
      ),
    }))
    .toList(),
);
