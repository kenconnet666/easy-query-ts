// 计算属性（对应官方 prop/*：组合、状态、跨表）：defineComputed 之后像一列一样用
import assert from 'node:assert/strict';
import { describe, it } from 'vitest';
import {
  caseWhen,
  createDb,
  defineComputed,
  parseTableRequest,
  text,
} from '@zerodep-dev/easy-query-ts';
import { schema as base, seed, User } from '../src/fixture.ts';
import { memoryDb } from '../src/sqlite-env.ts';

const schema = defineComputed(base, 'User', {
  label: (u) => text`${u.name}#${u.id}`,
  stage: (u) => caseWhen(u.age.ge(18), '成年').when(u.age.isNull(), '未知').else('未成年'),
  postCount: (u) => u.posts.count(),
  companyName: (u) => u.company.name,
});

describe('sqlite: computed properties', () => {
  it('where、orderBy、select、include、table() 里都能用，类型自动推出', async () => {
    const env = await seed(await memoryDb());
    const db = createDb({ schema, adapter: env.adapter });
    const rows = await db
      .queryable(User)
      .where((u) => u.postCount.ge(1))
      .orderBy((u) => u.label)
      .select((u) => ({
        label: u.label,
        stage: u.stage,
        posts: u.postCount,
        company: u.companyName,
      }))
      .toList();
    assert.deepEqual(rows, [
      { label: 'alice#1', stage: '成年', posts: 2, company: 'acme' },
      { label: 'bob#2', stage: '未知', posts: 2, company: 'acme' },
    ]);
    const label: string = rows[0]!.label;
    const company: string | null = rows[0]!.company;
    void label;
    void company;

    const withStage = await db
      .queryable(User)
      .where((u) => u.name.eq('carol'))
      .include((u) => ({ stage: u.stage }))
      .single();
    assert.equal(withStage.stage, '未成年');
    assert.equal(withStage.name, 'carol');

    const page = await db
      .queryable(User)
      .select((u) => ({ name: u.name, stage: u.stage }))
      .table(parseTableRequest({ 'filter.stage': '成年' }));
    assert.deepEqual(page.rows, [{ name: 'alice', stage: '成年' }]);
  });

  it('名字不能与列、导航重名', () => {
    assert.throws(() => defineComputed(base, 'User', { name: (u) => u.name }), /same name/);
    assert.throws(
      () => defineComputed(base, 'User', { posts: (u) => u.posts.count() }),
      /same name/,
    );
  });
});
