// 由实体生成 Standard Schema 校验器（ROADMAP 18.2.2）：插入、更新、整行
import assert from 'node:assert/strict';
import { describe, it } from 'vitest';
import { col, embed, entity, validators, type StandardSchema } from '@zerodep-dev/easy-query-ts';
import { z } from 'zod';
import { Doc, User } from '../src/fixture.ts';

/** 同步校验，返回问题（字段路径: 原因） */
function issues(schema: StandardSchema<unknown>, value: unknown): string[] {
  const result = schema['~standard'].validate(value) as {
    issues?: readonly { message: string; path?: readonly unknown[] }[];
  };
  return (result.issues ?? []).map((i) => `${(i.path ?? []).join('.')}: ${i.message}`);
}

const Shop = entity('t_shop', {
  id: col.bigint().primaryKey().generated(),
  name: col.string(20),
  price: col.decimal(8, 2),
  tags: col.json(z.array(z.string())),
  opened: col.date().nullable(),
  address: embed({ city: col.string(), street: col.string().nullable() }),
});

describe('validators', () => {
  it('插入：必填、可省（自增、默认值、可空）、多余字段', () => {
    const v = validators(User);
    assert.deepEqual(issues(v.insert, { name: 'alice', createdAt: new Date() }), []);
    assert.deepEqual(issues(v.insert, { age: 3, extra: 1 }), [
      'extra: unknown field',
      'name: required',
      'createdAt: required',
    ]);
    assert.deepEqual(issues(v.insert, { name: null, createdAt: new Date('x') }), [
      'name: cannot be null',
      'createdAt: invalid date',
    ]);
  });

  it('更新都可省；整行每列都要有', () => {
    const v = validators(User);
    assert.deepEqual(issues(v.update, { age: null }), []);
    assert.deepEqual(issues(v.update, { age: 1.5 }), ['age: expected an integer']);
    assert.deepEqual(issues(v.row, { id: 1, name: 'a' }), [
      'age: required',
      'companyId: required',
      'attrs: required',
      'createdAt: required',
    ]);
  });

  it('长度、小数位、枚举、JSON 列的校验器、值对象', () => {
    const v = validators(Shop);
    assert.deepEqual(
      issues(v.insert, {
        name: '一二三四五六七八九十一二三四五六七八九十',
        price: '123456.789',
        tags: ['a'],
        address: { city: 'hz' },
      }),
      ['price: must have at most 2 decimal places'],
    );
    assert.deepEqual(
      issues(v.insert, {
        name: 'x'.repeat(21),
        price: '1234567',
        tags: [1],
        opened: '2026-13-40',
        address: { street: 's' },
      }),
      [
        'name: must be at most 20 characters',
        'price: must have at most 6 integer digits',
        'tags: write: invalid JSON value: 0: Invalid input: expected string, received number',
        'opened: expected a date (YYYY-MM-DD)',
        'address.city: required',
      ],
    );
    assert.deepEqual(
      issues(validators(Doc).insert, { title: 't', status: 'gone', createdBy: 'u', secret: 's' }),
      ["status: 'gone' is not one of 'draft', 'published'"],
    );
  });

  it('实现 Standard Schema：通过时 value 就是输入', () => {
    const input = { name: 'bob', createdAt: new Date() };
    const result = validators(User).insert['~standard'].validate(input) as { value: unknown };
    assert.equal(result.value, input);
    assert.equal(validators(User).insert['~standard'].vendor, 'easy-query');
  });
});
