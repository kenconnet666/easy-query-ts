// 多态实体（ROADMAP 18.2.1）：一张表存几种子类型，行与插入是判别联合，variant() 过滤并收窄
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { describe, it } from 'vitest';
import {
  col,
  createDb,
  defineSchema,
  entity,
  validators,
  type Insert,
  type Row,
} from '@zerodep-dev/easy-query-ts';
import { sqlite } from '@zerodep-dev/easy-query-ts-sqlite';

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
function expect<T extends true>(): T | void {}

const Payment = entity.union('t_payment', 'kind', {
  base: { id: col.int().primaryKey().generated(), amount: col.decimal(12, 2) },
  variants: {
    card: { cardNo: col.string(19), holder: col.string().nullable() },
    wechat: { openId: col.string() },
  },
});

type PaymentRow = Row<typeof Payment>;
expect<
  Equal<
    PaymentRow,
    | {
        id: number;
        amount: `${number}`;
        kind: 'card';
        cardNo: string;
        holder: string | null;
        openId: null;
      }
    | {
        id: number;
        amount: `${number}`;
        kind: 'wechat';
        openId: string;
        cardNo: null;
        holder: null;
      }
  >
>();

describe('多态实体', async () => {
  const database = new DatabaseSync(':memory:');
  const db = createDb({ schema: defineSchema({ Payment }), adapter: sqlite(database) });
  await db.createTables();

  it('建表：判别列与各子类型的列（表里都可空）', () => {
    assert.match(
      db.createTableSql(Payment),
      /"kind" TEXT NOT NULL, "card_no" TEXT, "holder" TEXT, "open_id" TEXT\)$/,
    );
  });

  it('插入先选子类型；读出的行按判别列收窄', async () => {
    const rows: Insert<typeof Payment>[] = [
      { kind: 'card', amount: '10.00', cardNo: '4111', holder: null },
      { kind: 'wechat', amount: '2.50', openId: 'o-1' },
    ];
    await db.insert(Payment).values(rows).execute();
    // @ts-expect-error wechat 没有 cardNo
    const wrong: Insert<typeof Payment> = { kind: 'wechat', amount: '1', openId: 'x', cardNo: '1' };
    void wrong;

    const all = await db
      .queryable(Payment)
      .orderBy((p) => p.id)
      .toList();
    const [first] = all;
    if (first?.kind === 'card') expect<Equal<typeof first.cardNo, string>>();
    assert.deepEqual(
      all.map((p) => (p.kind === 'card' ? `card ${p.cardNo}` : `wechat ${p.openId}`)),
      ['card 4111', 'wechat o-1'],
    );

    const cards = await db.queryable(Payment).variant('card').toList();
    expect<Equal<(typeof cards)[number]['kind'], 'card'>>();
    expect<Equal<(typeof cards)[number]['cardNo'], string>>();
    assert.deepEqual(
      cards.map((c) => c.cardNo),
      ['4111'],
    );
    // @ts-expect-error 没有这个子类型
    assert.throws(() => db.queryable(Payment).variant('cash'), /has no variant 'cash'/);
  });

  it('校验器按子类型检查', () => {
    const insert = validators(Payment).insert;
    const issues = (value: unknown) =>
      (
        (
          insert['~standard'].validate(value) as {
            issues?: { message: string; path?: unknown[] }[];
          }
        ).issues ?? []
      ).map((i) => `${(i.path ?? []).join('.')}: ${i.message}`);
    assert.deepEqual(issues({ kind: 'card', amount: '1', cardNo: '1' }), []);
    assert.deepEqual(issues({ kind: 'wechat', amount: '1', cardNo: '1' }), [
      "cardNo: only for variants other than 'wechat'",
      'openId: required',
    ]);
    assert.deepEqual(issues({ kind: 'cash', amount: '1' }), [
      "kind: must be one of 'card', 'wechat'",
    ]);
  });
});
