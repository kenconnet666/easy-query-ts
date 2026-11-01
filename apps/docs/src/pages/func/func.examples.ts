/** 函数一章的示例 */
import { greatest, text } from '@zerodep-dev/easy-query-ts';
import { example } from '../../site/example.ts';
import { Post, User } from '../../site/model.ts';

export const strings = example((db) =>
  db
    .queryable(User)
    .select((u) => ({
      upper: u.name.upper(),
      first: u.name.left(1),
      length: u.name.length(),
      label: text`${u.name}（${u.company.name}）`,
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
      days: u.joinedAt.diff('2026-01-01', 'day'),
    }))
    .toList(),
);

export const numbers = example((db) =>
  db
    .queryable(Post)
    .select((p) => ({
      title: p.title,
      thousand: p.views.div(1000).round(1),
      capped: greatest(p.views, 100),
    }))
    .toList(),
);

export const nullable = example((db) =>
  db
    .queryable(User)
    .select((u) => ({ name: u.name, age: u.age.orElse(0) }))
    .toList(),
);
