// 可复用的通用条件（ROADMAP 18.3.1）：defineScope 只依赖几列，任何有这些列的实体都能 apply
import assert from 'node:assert/strict';
import { describe, it } from 'vitest';
import { defineScope } from '@zerodep-dev/easy-query-ts';
import { Company, Note, Post, seed, User } from '../src/fixture.ts';
import { memoryDb } from '../src/sqlite-env.ts';

/** 有 name 列的实体：名字以某个前缀开头 */
const namedLike = defineScope<{ name: string }, [prefix: string]>((row, prefix) =>
  row.name.startsWith(prefix),
);
/** 有可空 age 列的实体：成年 */
const adult = defineScope<{ age: number | null }>((row) => row.age.ge(18));
/** 有 tenantId 列的实体：属于某个租户 */
const ofTenant = defineScope<{ tenantId: number }, [tenantId: number]>((row, id) =>
  row.tenantId.eq(id),
);

describe('defineScope', async () => {
  const env = await seed(await memoryDb());

  it('同一个条件用在不同的实体上；可以连着 apply', async () => {
    assert.deepEqual(
      await env.db
        .queryable(User)
        .apply(namedLike, 'a')
        .apply(adult)
        .select((u) => u.name)
        .toList(),
      ['alice'],
    );
    assert.deepEqual(
      await env.db
        .queryable(Company)
        .apply(namedLike, 'ac')
        .select((c) => c.name)
        .toList(),
      ['acme'],
    );
    assert.equal(await env.db.queryable(Note).apply(ofTenant, 999).count(), 0);
  });

  it('实体缺列、参数不对：类型错误', () => {
    // @ts-expect-error Post 没有 name 列
    env.db.queryable(Post).apply(namedLike, 'a');
    // @ts-expect-error Company 没有 tenantId 列
    env.db.queryable(Company).apply(ofTenant, 1);
    // @ts-expect-error 参数要是数字
    env.db.queryable(Note).apply(ofTenant, 'x');
    // @ts-expect-error 少了参数
    env.db.queryable(User).apply(namedLike);
  });
});
