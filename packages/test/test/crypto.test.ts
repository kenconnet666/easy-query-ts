// 列加密的现成策略（对应官方 EncryptionTest、Sm4EncryptionTest）：AES / SM4、可分段搜索
import assert from 'node:assert/strict';
import { describe, it } from 'vitest';
import { col, createDb, defineSchema, entity } from '@zerodep-dev/easy-query-ts';
import { aesEncryption, segments, sm4Encryption } from '@zerodep-dev/easy-query-ts-crypto';
import { memoryDb } from '../src/sqlite-env.ts';

const key = '1234567890abcdef';
const iv = 'fedcba0987654321';

describe('crypto: AES / SM4 column encryption', () => {
  it('切成重叠的窗口：满 4 个单位，中文与 emoji 算 2 个', () => {
    assert.deepEqual(segments('abcdef'), ['abcd', 'bcde', 'cdef']);
    assert.deepEqual(segments('中文ab'), ['中文', '文ab']);
    assert.deepEqual(segments('a😀bc'), ['a😀b', '😀bc']);
    assert.deepEqual(segments('ab'), ['ab']);
    assert.deepEqual(segments(''), ['']);
  });

  it('加密后能解回原文（含中文、emoji、空串）', () => {
    for (const cipher of [
      aesEncryption({ key, iv }),
      aesEncryption({ key, iv, searchable: true }),
      aesEncryption({ key: `${key}${key}`, iv, searchable: true }),
      sm4Encryption({ key, iv }),
      sm4Encryption({ key, iv, searchable: true }),
    ])
      for (const plain of ['19876543210', '浙江省绍兴市越城区', 'hi 😀 你好', 'ab', ''])
        assert.equal(cipher.decrypt(cipher.encrypt(plain)), plain);
  });

  it('可分段时，搜索词的密文是整段密文的一部分', () => {
    const cipher = sm4Encryption({ key, iv, searchable: true });
    const whole = cipher.encrypt('19876543210');
    assert.ok(whole.includes(cipher.encrypt('8765')));
    assert.ok(whole.startsWith(cipher.encrypt('1987')));
    assert.ok(whole.endsWith(cipher.encrypt('3210')));
    assert.ok(!whole.includes(cipher.encrypt('9999')));
  });

  it('密钥、IV 长度不对时直接报错', () => {
    assert.throws(() => aesEncryption({ key: 'short', iv }), /16, 24 or 32 bytes/);
    assert.throws(() => sm4Encryption({ key: `${key}${key}`, iv }), /must be 16 bytes/);
    assert.throws(() => aesEncryption({ key, iv: 'x' }), /iv must be 16 bytes/);
  });

  it('加密列上照常 like 搜索，读出时解密', async () => {
    const User = entity('t_secret_user', {
      id: col.int().primaryKey(),
      phone: col.string().encrypted(aesEncryption({ key, iv, searchable: true })),
      idCard: col.string().encrypted(sm4Encryption({ key, iv })),
    });
    const env = await memoryDb();
    const db = createDb({ schema: defineSchema({ User }), adapter: env.adapter });
    await db.sql
      .execute`CREATE TABLE t_secret_user (id INTEGER PRIMARY KEY, phone TEXT NOT NULL, id_card TEXT NOT NULL)`;
    await db
      .insert(User)
      .values([
        { id: 1, phone: '18888888001', idCard: '330000000000000001' },
        { id: 2, phone: '13900000002', idCard: '330000000000000002' },
      ])
      .execute();
    const raw = await db.sql<{ phone: string }>`SELECT phone FROM t_secret_user WHERE id = 1`;
    assert.notEqual(raw[0]!.phone, '18888888001');
    const found = await db
      .queryable(User)
      .where((u) => u.phone.like('8888'))
      .toList();
    assert.deepEqual(found, [{ id: 1, phone: '18888888001', idCard: '330000000000000001' }]);
    const byPrefix = await db
      .queryable(User)
      .where((u) => u.phone.startsWith('1390'))
      .select((u) => u.id)
      .toList();
    assert.deepEqual(byPrefix, [2]);
  });
});
