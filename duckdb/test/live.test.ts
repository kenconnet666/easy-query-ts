/** 共用套件跑在内存里的 DuckDB 上（嵌入式，不用容器；每个用例一个新库） */
import { DuckDBInstance } from '@duckdb/node-api';
import { createDb, type Statement } from '@zerodep-dev/easy-query-ts';
import { schema, type TestEnv } from '@zerodep-dev/easy-query-ts-test/fixture';
import { liveSuite } from '@zerodep-dev/easy-query-ts-test/suite';
import { duckdb } from '../src/index.ts';

const open = async (): Promise<TestEnv> => {
  const statements: Statement[] = [];
  const adapter = duckdb(await DuckDBInstance.create(':memory:'));
  const db = createDb({ schema, adapter, log: (s) => statements.push(s) });
  await db.createTables();
  // 实体只声明了 defaulted()：库里的默认值另写（其它库的建表语句里也是手写的）
  await db.sql.execute`ALTER TABLE t_doc ALTER COLUMN status SET DEFAULT 'draft'`;
  statements.length = 0;
  return { db, statements, adapter };
};

liveSuite('duckdb', open, {
  extensionTypes: true,
  extraTables: true,
  rowLocks: false,
  readOnlyTransactions: false,
  savepoints: false,
  foreignKeyActions: false,
});
