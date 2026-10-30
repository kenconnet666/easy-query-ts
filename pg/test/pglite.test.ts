/**
 * PGlite（WASM 版 PostgreSQL，进程内）跑共用套件：不要容器，CI 与本地都跑。
 * 只有一条连接，search_path 设一次就一直生效
 */
import assert from 'node:assert/strict';
import { afterAll, describe, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { createDb, type Statement } from '@zerodep-dev/easy-query-ts';
import { schema, seed, User, type TestEnv } from '@zerodep-dev/easy-query-ts-test/fixture';
import { liveSuite } from '@zerodep-dev/easy-query-ts-test/suite';
import { pglite } from '../src/pglite.ts';
import { arraySuite } from './arrays.ts';
import { enumSuite } from './enums.ts';
import { DDL } from './ddl.ts';

const database = new PGlite();
afterAll(() => database.close());

const open = async (listStrategy: 'queries' | 'json' = 'queries'): Promise<TestEnv> => {
  await database.exec('CREATE SCHEMA IF NOT EXISTS eqts; SET search_path TO eqts');
  for (const statement of DDL) await database.exec(statement);
  const statements: Statement[] = [];
  const adapter = pglite(database);
  return {
    db: createDb({ schema, adapter, listStrategy, log: (s) => statements.push(s) }),
    statements,
    adapter,
  };
};

// 只有一条连接：两个事务互相等锁（NOWAIT、SKIP LOCKED）的用例会卡住
liveSuite('pglite', () => open(), { extensionTypes: true, extraTables: true, rowLocks: false });
// toList() 导航一条语句的写法（listStrategy('json')）：同一套用例，结果要与两步写法一致
liveSuite('pglite json lists', () => open('json'), {
  extensionTypes: true,
  extraTables: true,
  rowLocks: false,
  listStrategy: 'json',
});

arraySuite('pglite', async () => pglite(database));

describe("pglite: prepared queries with toList() (listStrategy('json'))", () => {
  it('prepares an object tree as one statement and runs it with different parameters', async () => {
    const { db } = await seed(await open('json'));
    const byName = db.prepare((p: { name: string }) =>
      db
        .queryable(User)
        .where((u) => u.name.eq(p.name))
        .select((u) => ({
          name: u.name,
          titles: u.posts.orderBy((x) => x.id).toList((x) => x.title),
        })),
    );
    assert.deepEqual(await byName.toList({ name: 'bob' }), [
      { name: 'bob', titles: ['orm_v2', 'hello'] },
    ]);
    assert.deepEqual(await byName.toList({ name: 'carol' }), [{ name: 'carol', titles: [] }]);
  });
});
enumSuite('pglite', async () => pglite(database));
