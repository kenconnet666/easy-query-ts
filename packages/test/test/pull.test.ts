// 由表生成实体（eqts pull，对应官方 plugin/table2entity）：类型映射、列名、注释、索引、外键导航
import assert from 'node:assert/strict';
import { describe, it } from 'vitest';
import type { DbColumn, DbTable } from '@zerodep-dev/easy-query-ts';
import { entitySource } from '@zerodep-dev/easy-query-ts-cli';

const column = (name: string, type: string, extra: Partial<DbColumn> = {}): DbColumn => ({
  name,
  type,
  nullable: false,
  default: null,
  comment: null,
  generated: false,
  ...extra,
});

describe('eqts pull: entity source', () => {
  it('maps database types, nullability, names and comments to column builders', () => {
    const table: DbTable = {
      name: 't_order_item',
      comment: '订单明细',
      primaryKey: ['id'],
      columns: [
        column('id', 'bigint', { generated: true }),
        column('order_no', 'character varying(32)', { comment: '单号' }),
        column('qty', 'int(11)'),
        column('price', 'numeric(12,2)', { nullable: true }),
        column('paid', 'tinyint(1)', { default: '0' }),
        column('created_at', 'timestamp(3) without time zone'),
        column('extra', 'jsonb', { nullable: true }),
        column('ORDER_REF', 'NVARCHAR(20)'),
        column('geo', 'geometry', { nullable: true }),
      ],
      indexes: [{ name: 'uk_order_no', columns: ['order_no'], unique: true }],
      foreignKeys: [],
    };
    const source = entitySource([table]);
    for (const line of [
      "export const OrderItem = entity('t_order_item', {",
      '  id: col.bigint().primaryKey().generated(),',
      "  orderNo: col.string(32).comment('单号'),",
      '  qty: col.int(),',
      '  price: col.decimal(12, 2).nullable(),',
      '  paid: col.boolean().defaulted(), // DEFAULT 0',
      '  createdAt: col.datetime(),',
      '  extra: col.json<unknown>().nullable(), // 补上 JSON 的类型',
      "  orderRef: col.string(20).named('ORDER_REF'),",
      "  geo: col.string().dbType('geometry').nullable(), // 认不得的类型 geometry，先按字符串读写",
      "}, { comment: '订单明细', indexes: [{ columns: ['orderNo'], unique: true, name: 'uk_order_no' }] });",
      'export const schema = defineSchema({ OrderItem });',
    ])
      assert.ok(source.includes(line), `missing: ${line}\n${source}`);
  });

  it('turns foreign keys into navigations on both sides without name clashes', () => {
    const user: DbTable = {
      name: 'users',
      comment: null,
      primaryKey: ['id'],
      columns: [column('id', 'int', { generated: true })],
      indexes: [],
      foreignKeys: [],
    };
    const transfer: DbTable = {
      name: 'transfers',
      comment: null,
      primaryKey: ['id'],
      columns: [
        column('id', 'int', { generated: true }),
        column('from_id', 'int'),
        column('to_id', 'int'),
      ],
      indexes: [],
      foreignKeys: [
        { name: 'fk_from', columns: ['from_id'], references: 'users', referencedColumns: ['id'] },
        { name: 'fk_to', columns: ['to_id'], references: 'users', referencedColumns: ['id'] },
      ],
    };
    const source = entitySource([user, transfer]);
    assert.ok(
      source.includes(
        "from: r.one('Users', { from: 'fromId', to: 'id' }, { foreignKey: { name: 'fk_from' } }),",
      ),
      source,
    );
    assert.ok(source.includes("transfers: r.many('Transfers', { from: 'id', to: 'fromId' }),"));
    assert.ok(source.includes("transfers2: r.many('Transfers', { from: 'id', to: 'toId' }),"));
    // 只生成指定的表
    assert.ok(!entitySource([user, transfer], { tables: ['users'] }).includes('Transfers'));
  });
});
