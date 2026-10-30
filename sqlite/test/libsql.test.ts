/**
 * libSQL（@libsql/client 的本地文件库）跑 SQLite 的共用套件：与远端 Turso 是同一个 Client 接口。
 * 用临时文件而不是 :memory:——libSQL 的内存库在 transaction() 里会换一条连接，看不到原来的表
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll } from 'vitest';
import { createClient, type Client } from '@libsql/client';
import { createDb, type Statement } from '@zerodep-dev/easy-query-ts';
import { schema, type TestEnv } from '@zerodep-dev/easy-query-ts-test/fixture';
import { SQLITE_DDL } from '@zerodep-dev/easy-query-ts-test/sqlite-env';
import { liveSuite } from '@zerodep-dev/easy-query-ts-test/suite';
import { libsql } from '../src/index.ts';

const dir = mkdtempSync(join(tmpdir(), 'eqts-libsql-'));
const clients: Client[] = [];
afterAll(() => {
  for (const client of clients) client.close();
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    // Windows 上 libSQL 的原生句柄到进程退出才释放，删不掉就留给系统清理临时目录
  }
});

const open = async (): Promise<TestEnv> => {
  // intMode 'bigint'：64 位整数不丢精度（同 node:sqlite 的 bigInts）
  const client = createClient({
    url: `file:${join(dir, `${clients.length}.db`)}`,
    intMode: 'bigint',
  });
  clients.push(client);
  await client.executeMultiple(SQLITE_DDL);
  const statements: Statement[] = [];
  const adapter = libsql(client);
  return { db: createDb({ schema, adapter, log: (s) => statements.push(s) }), statements, adapter };
};

// 名字以 sqlite 开头：套件按名字认出 SQLite（没有注释）
liveSuite('sqlite (libsql)', open, {
  extensionTypes: true,
  extraTables: true,
  rollup: false,
  cube: false,
  rowLocks: false,
  returning: true,
});
