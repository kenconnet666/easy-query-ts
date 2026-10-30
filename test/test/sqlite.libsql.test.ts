/**
 * libSQL（@libsql/client 的本地文件库）跑 SQLite 的共用套件：与远端 Turso 是同一个 Client 接口。
 * 用临时文件而不是 :memory:——libSQL 的内存库在 transaction() 里会换一条连接，看不到原来的表
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, vi } from 'vitest';
import { createClient, type Client } from '@libsql/client';
import { createDb, type Statement } from '@zerodep-dev/easy-query-ts';
import { schema, type TestEnv } from '../src/fixture.ts';
import { SQLITE_DDL } from '../src/sqlite-env.ts';
import { liveSuite } from '../src/suite.ts';
import { libsql } from '@zerodep-dev/easy-query-ts-sqlite';

// 每个用例一个新的文件库：Windows 的 CI 上文件读写慢，单个用例会超过默认的 5 秒
vi.setConfig({ testTimeout: 30_000 });

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
  jsonEdits: true,
  extensionTypes: true,
  extraTables: true,
  rollup: false,
  cube: false,
  rowLocks: false,
  returning: true,
});
