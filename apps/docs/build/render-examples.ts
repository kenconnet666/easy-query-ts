/**
 * 算出所有示例的 SQL 与结果，JSON 写到标准输出（build/examples.ts 调用）。在 Node 里跑，才能加载各方言包。
 *
 * 每段示例先在 SQLite 上真的执行，记下驱动返回的每个结果；别的方言不连库，用“回放驱动”把这些结果按顺序还给它：
 * 代码照常走完，toList 带出的第二条查询、事务里的几条写入都发得出来，记下的就是这种方言实际会发的语句
 *
 * 用法：node --conditions=@easy-query-ts/source build/render-examples.ts
 */
import { globSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  createDb,
  type Dialect,
  type Driver,
  type ExecuteResult,
  type Session,
} from '@zerodep-dev/easy-query-ts';
import { ClickHouseDialect } from '@zerodep-dev/easy-query-ts-clickhouse';
import { DamengDialect } from '@zerodep-dev/easy-query-ts-dameng';
import { Db2Dialect } from '@zerodep-dev/easy-query-ts-db2';
import { DuckDbDialect } from '@zerodep-dev/easy-query-ts-duckdb';
import { HanaDialect } from '@zerodep-dev/easy-query-ts-hana';
import { MsSqlDialect } from '@zerodep-dev/easy-query-ts-mssql';
import { MariaDbDialect, MySqlDialect } from '@zerodep-dev/easy-query-ts-mysql';
import { OracleDialect } from '@zerodep-dev/easy-query-ts-oracle';
import { PostgresDialect } from '@zerodep-dev/easy-query-ts-pg';
import { sqlite, SqliteDialect } from '@zerodep-dev/easy-query-ts-sqlite';
import type { DialectRendering, ExampleBuild, RenderedStatement } from '../src/site/example.ts';
import {
  formatParams,
  formatResult,
  formatSql,
  generatedStatements,
} from '../src/site/format-sql.ts';
import { schema, seed } from '../src/site/model.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

/** 标签与 src/site/dialects.ts 一致 */
const DIALECTS: Record<string, Dialect> = {
  pg: new PostgresDialect(),
  mysql: new MySqlDialect({ version: '8.4' }),
  sqlite: new SqliteDialect(),
  mariadb: new MariaDbDialect(),
  mssql: new MsSqlDialect(),
  oracle: new OracleDialect(),
  dameng: new DamengDialect(),
  db2: new Db2Dialect(),
  hana: new HanaDialect(),
  clickhouse: new ClickHouseDialect(),
  duckdb: new DuckDbDialect(),
};

interface Recording {
  readonly queries: Record<string, unknown>[][];
  readonly executes: ExecuteResult[];
}

/** 记下真实驱动返回的结果 */
function recording(driver: Driver, log: Recording): Driver {
  const session = (target: Session): Session => ({
    async query(sql, params, signal) {
      const rows = await target.query(sql, params, signal);
      log.queries.push(rows);
      return rows;
    },
    async execute(sql, params, signal) {
      const result = await target.execute(sql, params, signal);
      log.executes.push(result);
      return result;
    },
  });
  return {
    ...session(driver),
    transaction: (work, options) => driver.transaction((tx) => work(session(tx)), options),
  };
}

/** 回放：记下发出的语句，按顺序还结果；还完了给空结果（方言多发了语句时不至于出错） */
function replaying(log: Recording, statements: RenderedStatement[]): Driver {
  let query = 0;
  let execute = 0;
  const note = (sql: string, params: readonly unknown[]) =>
    statements.push({ sql: formatSql(sql), params: formatParams(params) });
  const session: Session = {
    query(sql, params) {
      note(sql, params);
      return Promise.resolve(log.queries[query++] ?? []);
    },
    execute(sql, params) {
      note(sql, params);
      return Promise.resolve(log.executes[execute++] ?? { affected: 1, insertId: 1 });
    },
  };
  return { ...session, transaction: (work) => work(session) };
}

async function render(build: ExampleBuild) {
  const database = new DatabaseSync(':memory:');
  const real = sqlite(database);
  const setup = createDb({ schema, adapter: real });
  await setup.createTables();
  await seed(setup);
  const log: Recording = { queries: [], executes: [] };
  const value = await build(
    createDb({ schema, adapter: { ...real, driver: recording(real.driver, log) } }),
  );
  database.close();

  const dialects: Record<string, DialectRendering> = {};
  for (const [label, dialect] of Object.entries(DIALECTS)) {
    const statements: RenderedStatement[] = [];
    try {
      const returned = await build(
        createDb({ schema, adapter: { dialect, driver: replaying(log, statements) } }),
      );
      dialects[label] = {
        statements: generatedStatements(statements.length, returned) ?? statements,
      };
    } catch (error) {
      // 回放的结果对不上这个方言时（已经发出了语句）照样显示；一条都没发出，才是这个方言不支持这种写法
      const message = error instanceof Error ? error.message : String(error);
      dialects[label] = statements.length ? { statements } : { statements, error: message };
    }
  }
  const generated = generatedStatements(log.queries.length + log.executes.length, value);
  return { dialects, result: generated ? undefined : formatResult(value) };
}

/** 从源码里取出每段示例的函数体：卡片上显示的代码 */
function bodies(source: string): Map<string, string> {
  const result = new Map<string, string>();
  const parts = source.split(/^(?=export const \w+ = example\()/m);
  for (const part of parts) {
    const head = /^export const (\w+) = example\(\s*(async\s*)?\(db\)\s*=>\s*/.exec(part);
    if (!head) continue;
    let body = part.slice(head[0].length, part.lastIndexOf(');')).replace(/,\s*$/, '');
    if (body.startsWith('{')) {
      // 语句体：去掉外层大括号，整体少缩进一层
      body = body
        .slice(1, body.lastIndexOf('}'))
        .replace(/^\n/, '')
        .replace(/\s+$/, '')
        .replace(/^ {2}/gm, '');
    } else {
      // 表达式体：调用方写的是 await db…
      body = `await ${body.trim().replace(/^ {2}/gm, '')}`;
    }
    result.set(head[1]!, `${body.trim()};`.replace(/;;$/, ';').replace(/\}\s*;$/, '}'));
  }
  return result;
}

const output: Record<string, Record<string, unknown>> = {};
for (const path of globSync('src/**/*.examples.ts', { cwd: root })) {
  const file = join(root, path);
  const key = path.split('\\').join('/');
  const module = (await import(pathToFileURL(file).href)) as Record<
    string,
    { build: ExampleBuild }
  >;
  const code = bodies(readFileSync(file, 'utf8'));
  output[key] = {};
  for (const [name, value] of Object.entries(module)) {
    if (!value?.build) continue;
    const text = code.get(name);
    if (!text)
      throw new Error(
        `${key}：没有从源码里找到示例 ${name}（要写成 export const ${name} = example((db) => …)）`,
      );
    try {
      output[key][name] = { code: text, ...(await render(value.build)) };
    } catch (error) {
      throw new Error(`${key} 的示例 ${name} 在 SQLite 上执行失败：${String(error)}`, {
        cause: error,
      });
    }
  }
}
// 方言包的驱动可能留着定时器，要主动退出。等写完再退：管道在 Linux 上是异步的，马上退出输出会被截断
process.stdout.write(JSON.stringify(output), () => process.exit(0));
