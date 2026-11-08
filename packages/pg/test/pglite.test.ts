/**
 * PGlite（WASM 版 PostgreSQL，进程内）跑共用套件：不要容器，CI 与本地都跑。
 * 只有一条连接，search_path 设一次就一直生效
 */
import { afterAll, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { createDb, type Statement } from '@zerodep-dev/easy-query-ts';
import { schema, type TestEnv } from '@zerodep-dev/easy-query-ts-test/fixture';
import { liveSuite } from '@zerodep-dev/easy-query-ts-test/suite';
import { listen, pglite } from '../src/pglite.ts';
import { arraySuite } from './arrays.ts';
import { bulkSuite } from './bulk.ts';
import { enumSuite } from './enums.ts';
import { DDL } from './ddl.ts';

const database = new PGlite();
afterAll(() => database.close());

const open = async (): Promise<TestEnv> => {
  await database.exec('CREATE SCHEMA IF NOT EXISTS eqts; SET search_path TO eqts');
  for (const statement of DDL) await database.exec(statement);
  const statements: Statement[] = [];
  const adapter = pglite(database);
  return { db: createDb({ schema, adapter, log: (s) => statements.push(s) }), statements, adapter };
};

// 只有一条连接：两个事务互相等锁（NOWAIT、SKIP LOCKED）的用例会卡住
liveSuite('pglite', open, {
  extensionTypes: true,
  extraTables: true,
  rowLocks: false,
  jsonEdits: true,
});

arraySuite('pglite', async () => pglite(database));
bulkSuite('pglite', async () => pglite(database));
enumSuite('pglite', async () => pglite(database));

it('listen：notify 在事务里随提交发出，回滚的不发；取消后收不到', async () => {
  const db = createDb({ schema, adapter: pglite(database) });
  const received: string[] = [];
  const stop = await listen(database, 'eqts_todo', (payload) => received.push(payload));
  await db.transaction(async (tx) => {
    await tx.notify('eqts_todo', 'u1');
    expect(received).toEqual([]);
  });
  await db
    .transaction(async (tx) => {
      await tx.notify('eqts_todo', 'u2');
      throw new Error('回滚');
    })
    .catch(() => undefined);
  await db.notify('eqts_todo', 'u3');
  await expect.poll(() => received).toEqual(['u1', 'u3']);
  await stop();
  await db.notify('eqts_todo', 'u4');
  await new Promise((resolve) => setTimeout(resolve, 50));
  expect(received).toEqual(['u1', 'u3']);
});
