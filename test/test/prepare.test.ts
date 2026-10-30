// 预编译查询（ROADMAP 18.3.2）：SQL 只渲染一次，每次执行只换参数，参数照常经过列的编码
import assert from 'node:assert/strict';
import { describe, it } from 'vitest';
import { Doc, seed, User } from '../src/fixture.ts';
import { memoryDb } from '../src/sqlite-env.ts';

describe('db.prepare', async () => {
  const env = await seed(await memoryDb());
  const { db, statements } = env;

  it('渲染一次，按不同的参数执行；结果类型与查询一样', async () => {
    const byAge = db.prepare((p: { min: number; prefix: string }) =>
      db
        .queryable(User)
        .where((u) => [u.age.ge(p.min), u.name.startsWith(p.prefix)])
        .orderBy((u) => u.id)
        .select((u) => ({ name: u.name })),
    );
    statements.length = 0;
    const rows: { name: string }[] = await byAge.toList({ min: 18, prefix: 'a' });
    assert.deepEqual(rows, [{ name: 'alice' }]);
    assert.deepEqual(await byAge.toList({ min: 0, prefix: 'c' }), [{ name: 'carol' }]);
    // 两次执行是同一段 SQL
    assert.equal(statements[0]!.sql, statements[1]!.sql);
    // startsWith 的转义与 % 后缀在执行时加上
    assert.deepEqual(
      statements.map((s) => s.params),
      [
        [18, 'a%'],
        [0, 'c%'],
      ],
    );
  });

  it('参数经过列的编码：日期、加密列', async () => {
    await db.insert(Doc).values({ title: 'p', createdBy: 'u', secret: 'hush' }).execute();
    const bySecret = db.prepare((p: { secret: string }) =>
      db
        .queryable(Doc)
        .where((d) => d.secret.eq(p.secret))
        .select((d) => d.title),
    );
    assert.deepEqual(await bySecret.toList({ secret: 'hush' }), ['p']);
    assert.deepEqual(await bySecret.toList({ secret: 'nope' }), []);
  });

  it('缺参数、带 toList 导航：报错', async () => {
    const one = db.prepare((p: { id: number }) => db.queryable(User).where((u) => u.id.eq(p.id)));
    await assert.rejects(one.toList({} as never), /no value for 'id'/);
    // @ts-expect-error 参数类型不对
    void one.toList({ id: 'x' }).catch(() => {});
    assert.throws(
      () =>
        db.prepare((p: { id: number }) =>
          db
            .queryable(User)
            .where((u) => u.id.eq(p.id))
            .select((u) => ({ posts: u.posts.toList((x) => x.title) })),
        ),
      /cannot be used with fills or toList\(\) navigations/,
    );
  });
});
