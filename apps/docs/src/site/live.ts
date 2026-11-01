/**
 * 在浏览器里真实运行示例：PGlite（WASM 版 PostgreSQL）或 SQLite WASM。点“运行”时才加载这个模块与数据库。
 * 每次运行都重建表、放回示例数据，上一次的写入不影响这一次；运行排队，同一时间只有一个
 */
import * as easyQuery from '@zerodep-dev/easy-query-ts';
import { createDb, type Adapter } from '@zerodep-dev/easy-query-ts';
import type { LiveEngine } from './dialects';
import type { ExampleBuild, RenderedStatement } from './example.ts';
import { formatParams, formatResult, formatSql, generatedStatements } from './format-sql.ts';
import * as model from './model.ts';
import { interceptors, schema, seed } from './model.ts';

/** 一次运行的结果 */
export interface LiveResult {
  readonly engine: LiveEngine;
  readonly statements: readonly RenderedStatement[];
  readonly result: string | undefined;
  /** 示例本身用了多少毫秒（不含重建表） */
  readonly ms: number;
}

async function openPglite(): Promise<Adapter> {
  const [{ PGlite }, { pglite }] = await Promise.all([
    import('@electric-sql/pglite'),
    import('@zerodep-dev/easy-query-ts-pg/pglite'),
  ]);
  return pglite(new PGlite());
}

async function openSqlite(): Promise<Adapter> {
  const [{ default: init }, { sqlite }] = await Promise.all([
    import('@sqlite.org/sqlite-wasm'),
    import('@zerodep-dev/easy-query-ts-sqlite'),
  ]);
  const wasm = await init();
  const database = new wasm.oo1.DB(':memory:');
  // SQLite WASM 的接口换成 sqlite() 要的同步形状（node:sqlite 那样的 prepare / all / run）
  const all = (sql: string, params: unknown[]) =>
    database.exec({
      sql,
      bind: params.length > 0 ? (params as never) : undefined,
      rowMode: 'object',
      returnValue: 'resultRows',
    }) as unknown[];
  return sqlite({
    exec: (sql) => database.exec(sql),
    prepare: (sql) => ({
      all: (...params: unknown[]) => all(sql, params),
      iterate: (...params: unknown[]) => all(sql, params),
      run(...params: unknown[]) {
        all(sql, params);
        return {
          changes: database.changes(),
          lastInsertRowid: Number(wasm.capi.sqlite3_last_insert_rowid(database)),
        };
      },
    }),
  });
}

const opened = new Map<LiveEngine, Promise<Adapter>>();
let queue: Promise<unknown> = Promise.resolve();

function adapterOf(engine: LiveEngine): Promise<Adapter> {
  let adapter = opened.get(engine);
  if (!adapter) {
    adapter = engine === 'pglite' ? openPglite() : openSqlite();
    // 加载失败（如断网）不缓存，下次再试
    adapter.catch(() => opened.delete(engine));
    opened.set(engine, adapter);
  }
  return adapter;
}

async function execute(build: ExampleBuild, engine: LiveEngine): Promise<LiveResult> {
  const adapter = await adapterOf(engine);
  const setup = createDb({ schema, adapter });
  await setup.dropTables().catch(() => undefined);
  await setup.createTables();
  await seed(setup);

  const statements: RenderedStatement[] = [];
  model.auditLog.length = 0;
  const db = createDb({
    schema,
    interceptors,
    adapter,
    log: ({ sql, params }) =>
      statements.push({ sql: formatSql(sql), params: formatParams(params) }),
  });
  const started = performance.now();
  const value = await build(db);
  const ms = performance.now() - started;
  const generated = generatedStatements(statements.length, value);
  if (generated) return { engine, statements: generated, result: undefined, ms };
  return { engine, statements, result: formatResult(value), ms };
}

/** 运行一段示例 */
export function runExample(build: ExampleBuild, engine: LiveEngine): Promise<LiveResult> {
  const run = queue.then(() => execute(build, engine));
  queue = run.catch(() => undefined);
  return run;
}

/** 演练场里代码能用的名字：示例从这两个模块 import 的都要有，“改一改”带过来的代码才跑得起来。模型在后，实体 Order 盖过核心的同名类 */
const SCOPE = { ...easyQuery, ...model };

/** 运行演练场里的一段代码：source 是函数体，按 JS 执行 */
export function runSource(source: string, engine: LiveEngine): Promise<LiveResult> {
  const names = Object.keys(SCOPE);
  const AsyncFunction = (async () => {}).constructor as new (
    ...args: string[]
  ) => (...values: unknown[]) => Promise<unknown>;
  const body = new AsyncFunction('db', ...names, source);
  return runExample((db) => body(db, ...Object.values(SCOPE)), engine);
}
