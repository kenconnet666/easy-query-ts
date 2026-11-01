/** 函数几章新增的示例 */
import {
  caseWhen,
  greatest,
  least,
  now,
  text,
} from '@zerodep-dev/easy-query-ts';
import { example } from '../../site/example.ts';
import {
  Comment,
  Order,
  OrderItem,
  Post,
  Product,
  User,
} from '../../site/model.ts';

// ---- 字符串

export const caseAndTrim = example((db) =>
  db
    .queryable(Post)
    .where((p) => p.id.in([1, 4]))
    .select((p) => ({
      upper: p.title.upper(),
      lower: p.title.lower(),
      trimmed: p.title.concat('  ').trim(),
    }))
    .toList(),
);

export const concatValues = example((db) =>
  db
    .queryable(User)
    .where((u) => u.companyId.isNotNull())
    .select((u) => ({
      concat: u.name.concat('（', u.level, '）'),
      template: text`${u.name} @ ${u.company.name}`,
    }))
    .limit(3)
    .toList(),
);

export const leftRight = example((db) =>
  db
    .queryable(Post)
    .limit(3)
    .select((p) => ({
      title: p.title,
      head: p.title.left(2),
      tail: p.title.right(2),
      preview: p.title.substring(0, 5),
    }))
    .toList(),
);

export const searchInText = example((db) =>
  db
    .queryable(Post)
    .where((p) => p.title.indexOf('的').ge(0))
    .select((p) => ({
      title: p.title,
      position: p.title.indexOf('的'),
    }))
    .toList(),
);

export const padAndReplace = example((db) =>
  db
    .queryable(Order)
    .limit(3)
    .select((o) => ({
      no: o.id.cast('string').padStart(6, '0'),
      user: o.user.name.replace('林', 'Lin'),
    }))
    .toList(),
);

export const lengthFilter = example((db) =>
  db
    .queryable(Comment)
    .where((c) => c.body.length().ge(8))
    .orderBy((c) => c.body.length().desc())
    .select((c) => ({
      body: c.body,
      length: c.body.length(),
    }))
    .toList(),
);

// ---- 日期

export const dateParts = example((db) =>
  db
    .queryable(Order)
    .limit(3)
    .select((o) => ({
      year: o.createdAt.year(),
      month: o.createdAt.month(),
      day: o.createdAt.day(),
      hour: o.createdAt.hour(),
      minute: o.createdAt.minute(),
      weekday: o.createdAt.dayOfWeek(),
      dayOfYear: o.createdAt.dayOfYear(),
    }))
    .toList(),
);

export const dateFormat = example((db) =>
  db
    .queryable(Order)
    .limit(2)
    .select((o) => ({
      date: o.createdAt.format('yyyy-MM-dd'),
      time: o.createdAt.format('HH:mm:ss'),
      slash: o.createdAt.format('yyyy/MM/dd HH:mm'),
    }))
    .toList(),
);

export const dateAdd = example((db) =>
  db
    .queryable(Order)
    .where((o) => o.id.eq(1))
    .select((o) => ({
      createdAt: o.createdAt,
      tomorrow: o.createdAt.addDays(1),
      nextHour: o.createdAt.addHours(1),
      nextMonth: o.createdAt.addMonths(1),
      nextYear: o.createdAt.addYears(1),
      generic: o.createdAt.add(30, 'minute'),
    }))
    .first(),
);

export const dateDiff = example((db) =>
  db
    .queryable(User)
    .where((u) => u.id.le(3))
    .select((u) => ({
      name: u.name,
      days: u.joinedAt.diff('2026-01-01', 'day'),
      hours: u.joinedAt.diff('2026-01-01', 'hour'),
    }))
    .toList(),
);

export const dateCompare = example((db) =>
  db
    .queryable(Order)
    .where((o) => [
      o.createdAt.ge(new Date('2025-04-01T00:00:00Z')),
      o.createdAt.lt(new Date('2025-07-01T00:00:00Z')),
    ])
    .select((o) => o.id)
    .toList(),
);

export const dateBetweenColumns = example((db) =>
  db
    .queryable(Post)
    .where((p) =>
      p.publishedAt.ge(p.author.joinedAt.addYears(2)),
    )
    .select((p) => ({
      title: p.title,
      author: p.author.name,
    }))
    .toList(),
);

export const dateTruncate = example((db) =>
  db
    .queryable(Order)
    .limit(2)
    .select((o) => ({
      createdAt: o.createdAt,
      month: o.createdAt.dateTrunc('month'),
      day: o.createdAt.dateTrunc('day'),
      hour: o.createdAt.dateTrunc('hour'),
    }))
    .toList(),
);

export const pastOrders = example((db) =>
  db
    .queryable(Order)
    .where((o) => o.createdAt.lt(now()))
    .count(),
);

// ---- 数字

export const rounding = example((db) =>
  db
    .queryable(Product)
    .where((p) => p.id.in([1, 6]))
    .select((p) => ({
      price: p.price,
      round: p.price.round(),
      oneDigit: p.price.round(1),
      floor: p.price.floor(),
      ceil: p.price.ceil(),
    }))
    .toList(),
);

export const arithmetic = example((db) =>
  db
    .queryable(OrderItem)
    .where((i) => i.orderId.eq(1))
    .select((i) => ({
      product: i.product.name,
      plus: i.quantity.plus(1),
      minus: i.quantity.minus(1),
      times: i.price.times(i.quantity),
      div: i.price.div(2),
    }))
    .toList(),
);

export const mathFunctions = example((db) =>
  db
    .queryable(Post)
    .where((p) => p.id.eq(1))
    .select((p) => ({
      views: p.views,
      abs: p.views.minus(2000).abs(),
      sign: p.views.minus(2000).sign(),
      mod: p.views.mod(7),
      power: p.views.power(2),
      sqrt: p.views.sqrt().round(2),
    }))
    .first(),
);

export const minMaxColumns = example((db) =>
  db
    .queryable(Post)
    .limit(3)
    .select((p) => ({
      views: p.views,
      atLeast: greatest(p.views, 1000),
      atMost: least(p.views, 1000),
    }))
    .toList(),
);

export const percentage = example((db) =>
  db
    .queryable(User)
    .where((u) => u.posts.any())
    .select((u) => ({
      name: u.name,
      publishedRate: u.posts
        .count((p) => p.status.eq('published'))
        .times(100)
        .div(u.posts.count()),
    }))
    .toList(),
);

// ---- 空值与条件

export const orElseChain = example((db) =>
  db
    .queryable(User)
    .where((u) => u.id.in([1, 5, 6]))
    .select((u) => ({
      name: u.name,
      age: u.age.orElse(0),
      company: u.company.name
        .orElse(u.department.name)
        .orElse('无'),
    }))
    .toList(),
);

export const nullIfValue = example((db) =>
  db
    .queryable(Post)
    .limit(5)
    .select((p) => ({
      title: p.title,
      // 0 当成没有数据
      views: p.views.nullIf(0),
    }))
    .toList(),
);

export const caseInWhere = example((db) =>
  db
    .queryable(Comment)
    .where((c) =>
      caseWhen(c.parentId.isNull(), c.likes.ge(10))
        .else(c.likes.ge(4))
        .eq(true),
    )
    .select((c) => ({ body: c.body, likes: c.likes }))
    .toList(),
);

export const caseInOrder = example((db) =>
  db
    .queryable(User)
    .orderBy((u) => [
      caseWhen(u.level.eq('lead'), 1)
        .when(u.level.eq('senior'), 2)
        .else(3),
      u.id,
    ])
    .select((u) => ({ name: u.name, level: u.level }))
    .limit(4)
    .toList(),
);

export const caseInAggregate = example((db) =>
  db
    .queryable(Comment)
    .groupBy((c) => ({
      heat: caseWhen(c.likes.ge(10), '热评').else('普通'),
    }))
    .select((g) => ({
      heat: g.key.heat,
      comments: g.count(),
      likes: g.sum((c) => c.likes),
    }))
    .toList(),
);

export const castValues = example((db) =>
  db
    .queryable(Order)
    .limit(2)
    .select((o) => ({
      text: o.id.cast('string'),
      day: o.createdAt.cast('date'),
    }))
    .toList(),
);

export const compareValues = example((db) =>
  db
    .queryable(Post)
    .limit(4)
    .select((p) => ({
      title: p.title,
      against: p.views.compare(1000),
    }))
    .toList(),
);

export const booleanValue = example((db) =>
  db
    .queryable(Post)
    .limit(3)
    .select((p) => ({
      title: p.title,
      hot: p.views.ge(1000),
      draft: p.status.eq('draft'),
    }))
    .toList(),
);
