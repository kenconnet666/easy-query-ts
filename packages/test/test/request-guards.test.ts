// 外面来的东西不能信：校验器、列表请求、读库结构生成的源码、同步计划的顺序。每条都是审查里实际跑出来的问题
import assert from 'node:assert/strict';
import { describe, it } from 'vitest';
import {
  col,
  conditionOf,
  createDb,
  defineSchema,
  Dialect,
  embed,
  entity,
  InvalidRequestError,
  migrationSource,
  parseSearchRequest,
  parseTableRequest,
  rangeOf,
  validators,
  type ConditionTree,
  type DbColumn,
  type DbTable,
  type StandardSchema,
} from '@zerodep-dev/easy-query-ts';
import { entitySource } from '@zerodep-dev/easy-query-ts-cli';
import { Post, seed, User } from '../src/fixture.ts';
import { memoryDb } from '../src/sqlite-env.ts';

function issues(schema: StandardSchema<unknown>, value: unknown): string[] {
  const result = schema['~standard'].validate(value) as {
    issues?: readonly { message: string; path?: readonly unknown[] }[];
  };
  return (result.issues ?? []).map((i) => `${(i.path ?? []).join('.')}: ${i.message}`);
}

describe('validators: values a client can send', () => {
  const Shop = entity('t_shop', {
    id: col.bigint().primaryKey().generated(),
    qty: col.int(),
    price: col.decimal(8, 2),
    day: col.date(),
    at: col.datetime(),
    address: embed({ city: col.string(), street: col.string().nullable() }),
  });
  const row = {
    qty: 1,
    price: '1.00',
    day: '2026-02-28',
    at: new Date(),
    address: { city: 'x' },
  };
  const { insert } = validators(Shop);

  it('继承来的属性名不算认识的字段', () => {
    const extra = JSON.parse('{"constructor":1,"toString":2}') as Record<string, unknown>;
    const input = { ...row, ...extra };
    assert.deepEqual(issues(insert, input), [
      'constructor: unknown field',
      'toString: unknown field',
    ]);
  });

  it('插入时省掉整个值对象：里面必填的列报出来', () => {
    const { address: _, ...rest } = row;
    assert.deepEqual(issues(insert, rest), ['address.city: required']);
  });

  it('不存在的日期、普通对象冒充扩展类型、超出 32 位的整数', () => {
    assert.deepEqual(issues(insert, { ...row, day: '2026-02-30' }), [
      'day: expected a date (YYYY-MM-DD)',
    ]);
    assert.deepEqual(issues(insert, { ...row, price: {}, day: {}, at: {} }), [
      'price: expected a decimal',
      'day: expected a date (YYYY-MM-DD)',
      'at: expected a Date',
    ]);
    assert.deepEqual(issues(insert, { ...row, qty: 2 ** 40 }), [
      'qty: must be between -2147483648 and 2147483647',
    ]);
  });
});

describe('list requests: malformed input is an InvalidRequestError', async () => {
  const { db } = await seed(await memoryDb());
  const posts = db.queryable(Post).select((p) => ({ id: p.id, amount: p.amount }));
  const ages = async (query: Record<string, string>) =>
    (
      await db
        .queryable(User)
        .select((u) => ({ id: u.id, name: u.name, age: u.age }))
        .table(parseSearchRequest({ sort: 'id:asc', ...query }))
    ).rows.map((u) => u.name);

  it('只给了区间的上限：没有下限，不是"等于上限"', async () => {
    assert.deepEqual(await ages({ 'age-2': '20', 'age-op': 'rc' }), ['carol']);
    assert.deepEqual(await ages({ 'age-1': '20', 'age-op': 'rc' }), ['alice']);
  });

  it('每页条数有上限；页码、排序方向不对都是请求不合法', () => {
    assert.throws(() => parseSearchRequest({ pageSize: '100000000' }), InvalidRequestError);
    assert.throws(() => parseSearchRequest({ current: '0' }), InvalidRequestError);
    assert.throws(() => parseSearchRequest({ sort: 'id:sideways' }), InvalidRequestError);
    assert.throws(() => parseTableRequest({ pageSize: '2001' }), InvalidRequestError);
    assert.throws(() => parseTableRequest({ condition: '{not json' }), InvalidRequestError);
  });

  it('条件树的形状、取值不对时说清楚，不炸出 TypeError', async () => {
    const run = (condition: unknown) =>
      posts.table({ ...parseTableRequest({}), condition: condition as ConditionTree });
    for (const bad of [
      1,
      { all: 'x' },
      { field: 'amount' },
      { field: 'amount', op: 'eq', value: null },
      { field: 'amount', op: 'eq', value: { a: 1 } },
      // 不是一对值：以前悄悄变成不筛选，返回所有行
      { field: 'amount', op: 'between', value: '5' },
      { field: 'nope', op: 'eq', value: 1 },
    ])
      await assert.rejects(run(bad), InvalidRequestError, JSON.stringify(bad));
    assert.throws(() => conditionOf({ any: 1 } as never, {}), InvalidRequestError);
    // 白名单之外的列
    await assert.rejects(
      posts.table(parseTableRequest({ 'filter.amount': '1' }), { filterable: ['id'] }),
      InvalidRequestError,
    );
  });

  it('零点被夏令时跳过的时区：这一天从 01:00 开始，不带上前一天的 23:00', async () => {
    // 圣保罗 2018-11-04 00:00 拨到 01:00（UTC-3 → UTC-2）：这一天是 03:00Z 起
    const { sql, params } = db
      .queryable(User)
      .where((u) =>
        rangeOf(u.createdAt, 'created', '2018-11-04', '', { timeZone: 'America/Sao_Paulo' }),
      )
      .toSQL();
    assert.match(sql, /"created_at" >= \?/);
    assert.deepEqual(params, ['2018-11-04 03:00:00.000']);
    // 平常的日子不变
    assert.deepEqual(
      db
        .queryable(User)
        .where((u) =>
          rangeOf(u.createdAt, 'created', '2018-11-05', '', { timeZone: 'America/Sao_Paulo' }),
        )
        .toSQL().params,
      ['2018-11-05 02:00:00.000'],
    );
  });
});

describe('generated source: database metadata is data, not code', () => {
  const column = (name: string, type: string, extra: Partial<DbColumn> = {}): DbColumn => ({
    name,
    type,
    nullable: false,
    default: null,
    comment: null,
    generated: false,
    ...extra,
  });
  const table = (name: string, extra: Partial<DbTable> = {}): DbTable => ({
    name,
    comment: null,
    primaryKey: ['id'],
    columns: [column('id', 'bigint')],
    indexes: [],
    foreignKeys: [],
    ...extra,
  });

  it('注释、默认值里的换行与注释结束记号不会变成代码', () => {
    const source = entitySource([
      table('t_note', {
        comment: 'a */ export const pwned = 1; /*',
        columns: [
          column('id', 'bigint'),
          column('body', 'text', { default: "'a\nprocess.exit(1)'::text", comment: "it's\nfine" }),
        ],
      }),
    ]);
    assert.ok(!/^export const pwned/m.test(source));
    assert.ok(!/^process\.exit/m.test(source));
    assert.ok(source.includes("comment('it\\'s\\u000afine')"));
  });

  it('实体名能当变量名，重名的加序号', () => {
    const source = entitySource([table('2024_orders'), table('t_user'), table('user')]);
    assert.ok(source.includes("export const T2024Orders = entity('2024_orders'"));
    assert.ok(source.includes("export const User = entity('t_user'"));
    assert.ok(source.includes("export const User2 = entity('user'"));
    assert.ok(source.includes('defineSchema({ T2024Orders, User, User2 })'));
  });

  it('PG 的 timestamp with time zone 是带时区的时刻，带不带精度都认', () => {
    const source = entitySource([
      table('t_event', {
        columns: [
          column('id', 'bigint'),
          column('at', 'timestamp with time zone'),
          column('seen', 'timestamp(3) with time zone'),
          column('local', 'timestamp without time zone'),
        ],
      }),
    ]);
    assert.ok(source.includes('at: col.datetime({ timeZone: true }),'));
    assert.ok(source.includes('seen: col.datetime({ timeZone: true }),'));
    assert.ok(source.includes('local: col.datetime(),'));
  });

  it('迁移文件里的差异说明：名字带换行也还是注释', () => {
    const source = migrationSource('001', {
      statements: [],
      differences: ['column a\nprocess.exit(1) differs'],
    });
    assert.ok(source.includes('// - column a process.exit(1) differs'));
  });
});

describe('sync plan: renames come before tables that refer to them', () => {
  it('新表的外键引用改了名的表', async () => {
    const Order = entity(
      't_order',
      { id: col.bigint().primaryKey() },
      { renamedFrom: 'orders_old' },
    );
    const Line = entity('t_line', { id: col.bigint().primaryKey(), orderId: col.bigint() });
    const schema = defineSchema(
      { Order, Line },
      {
        Line: (r) => ({
          order: r.one('Order', { from: 'orderId', to: 'id' }, { foreignKey: true }),
        }),
      },
    );
    const existing: DbTable = {
      name: 'orders_old',
      comment: null,
      primaryKey: ['id'],
      columns: [
        {
          name: 'id',
          type: 'bigint',
          nullable: false,
          default: null,
          comment: null,
          generated: false,
        },
      ],
      indexes: [],
      foreignKeys: [],
    };
    // 库里只有旧名字的那张表
    const dialect = new (class extends Dialect {
      readonly name = 'generic';
      override introspect() {
        return Promise.resolve([existing]);
      }
      override introspectTypes() {
        return Promise.resolve(new Map<string, string[]>());
      }
    })();
    const driver = {
      query: () => Promise.resolve([]),
      execute: () => Promise.resolve({ affected: 0 }),
      transaction: <T>(work: (session: never) => Promise<T>) => work(undefined as never),
    };
    const db = createDb({ schema, adapter: { dialect, driver } as never });
    const { statements } = await db.planSync();
    const rename = statements.findIndex((s) => /RENAME TO "t_order"/.test(s));
    const reference = statements.findIndex((s) => /REFERENCES "t_order"/.test(s));
    assert.ok(rename >= 0 && reference >= 0, statements.join('\n'));
    assert.ok(rename < reference, statements.join('\n'));
  });
});
