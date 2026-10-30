// uuid 列（ROADMAP 19.1）：读出统一成小写的标准写法，uuidv7 按时间有序、同一毫秒里也单调
import assert from 'node:assert/strict';
import { describe, it } from 'vitest';
import { col, uuidv7 } from '@zerodep-dev/easy-query-ts';
import { entitySource } from '@zerodep-dev/easy-query-ts-cli';

describe('col.uuid', () => {
  const { codec } = col.uuid();

  it('读出：文字转小写，16 个字节（MySQL 的 BINARY(16)）转成标准写法；写入时检查格式', () => {
    assert.equal(
      codec.decode('0192F3A4-1B2C-7D8E-9F01-23456789ABCD'),
      '0192f3a4-1b2c-7d8e-9f01-23456789abcd',
    );
    const bytes = Uint8Array.from(Buffer.from('0192f3a41b2c7d8e9f0123456789abcd', 'hex'));
    assert.equal(codec.decode(bytes), '0192f3a4-1b2c-7d8e-9f01-23456789abcd');
    assert.throws(() => codec.encode('not-a-uuid'), /not a uuid/);
    assert.throws(() => codec.decode(new Uint8Array(8)), /16 bytes/);
  });

  it('uuidv7：版本与变体位正确，连续生成的严格递增', () => {
    const ids = Array.from({ length: 5000 }, uuidv7);
    for (const id of ids)
      assert.match(id, /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    for (let i = 1; i < ids.length; i++)
      assert.ok(ids[i - 1]! < ids[i]!, `${ids[i - 1]} < ${ids[i]}`);
    // 前 48 位是当前毫秒
    const ms = parseInt(ids.at(-1)!.replace(/-/g, '').slice(0, 12), 16);
    assert.ok(Math.abs(ms - Date.now()) < 5000);
  });

  it('unsigned 只能用在数值列上', () => {
    assert.equal(col.int().unsigned().options.unsigned, true);
    assert.throws(() => col.string().unsigned(), /numeric columns/);
  });

  it('eqts pull：uuid、uniqueidentifier 生成 col.uuid()，带 unsigned 的整数加 .unsigned()', () => {
    const source = entitySource([
      {
        name: 't_x',
        comment: null,
        columns: [
          {
            name: 'id',
            type: 'uuid',
            nullable: false,
            default: null,
            comment: null,
            generated: false,
          },
          {
            name: 'ref',
            type: 'uniqueidentifier',
            nullable: false,
            default: null,
            comment: null,
            generated: false,
          },
          {
            name: 'hits',
            type: 'bigint unsigned',
            nullable: false,
            default: null,
            comment: null,
            generated: false,
          },
          {
            name: 'n',
            type: 'int(10) unsigned',
            nullable: false,
            default: null,
            comment: null,
            generated: false,
          },
        ],
        primaryKey: ['id'],
        indexes: [],
        foreignKeys: [],
      },
    ]);
    assert.match(source, /id: col\.uuid\(\)\.primaryKey\(\)/);
    assert.match(source, /ref: col\.uuid\(\)/);
    assert.match(source, /hits: col\.bigint\(\)\.unsigned\(\)/);
    assert.match(source, /n: col\.int\(\)\.unsigned\(\)/);
  });
});
