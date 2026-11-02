/**
 * 在浏览器里真实运行示例：PGlite（WASM 版 PostgreSQL）或 SQLite WASM。点“运行”时才加载这个模块与数据库。
 * 卡片每次运行都重建表、放回示例数据；演练场接着上次的数据，点“重置数据”才放回。所有操作排队，同一时间只有一个
 */
import { createDb, type Adapter, type Dialect, type Entity } from '@zerodep-dev/easy-query-ts';
import type { LiveEngine } from './dialects';
import type { ExampleBuild, RenderedStatement } from './example.ts';
import { formatParams, formatResult, formatSql, generatedStatements } from './format-sql.ts';
import { auditLog, interceptors, schema, seed } from './model.ts';
import { compileSource } from './scope.ts';
import type { CellKind, RawRow, TableColumn, TableData } from './tables.ts';

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

/** 演练场的数据还留着的引擎：卡片每次都放回示例数据，运行之后就不算了 */
const kept = new Set<LiveEngine>();

/** 放回示例数据：重建表，主键又从 1 起 */
async function reseed(engine: LiveEngine): Promise<void> {
  const setup = createDb({ schema, adapter: await adapterOf(engine) });
  await setup.dropTables().catch(() => undefined);
  await setup.createTables();
  await seed(setup);
}

async function ensureKept(engine: LiveEngine): Promise<void> {
  if (kept.has(engine)) return;
  await reseed(engine);
  kept.add(engine);
}

async function execute(build: ExampleBuild, engine: LiveEngine): Promise<LiveResult> {
  const adapter = await adapterOf(engine);
  const statements: RenderedStatement[] = [];
  auditLog.length = 0;
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

function enqueue<T>(work: () => Promise<T>): Promise<T> {
  const run = queue.then(work);
  queue = run.catch(() => undefined);
  return run;
}

/** 运行卡片上的一段示例：每次都从示例数据开始 */
export function runExample(build: ExampleBuild, engine: LiveEngine): Promise<LiveResult> {
  return enqueue(async () => {
    kept.delete(engine);
    await reseed(engine);
    return execute(build, engine);
  });
}

/** 运行演练场里的一段代码：source 是函数体，按 JS 执行。接着上次的数据，不重置 */
export function runSource(source: string, engine: LiveEngine): Promise<LiveResult> {
  return enqueue(async () => {
    await ensureKept(engine);
    return execute(compileSource(source), engine);
  });
}

const CELL_KINDS: Readonly<Record<string, CellKind>> = {
  int: 'number',
  bigint: 'number',
  double: 'number',
  decimal: 'number',
  boolean: 'boolean',
  json: 'json',
};

function columnsOf(entity: Entity): TableColumn[] {
  return Object.entries(entity.columns).map(([path, column]) => ({
    name: entity.columnNames[path]!,
    property: path,
    kind: CELL_KINDS[column.codec.kind] ?? 'text',
    nullable: column.options.nullable,
    primaryKey: column.options.primaryKey,
    ...(column.options.enumValues ? { enumValues: column.options.enumValues } : {}),
  }));
}

/** 读一张表的原始行：不经过 ORM，拦截器和列的 codec 都不参与，看到的就是库里的值 */
async function readTable(adapter: Adapter, entity: Entity): Promise<TableData> {
  const { dialect, driver } = adapter;
  const columns = columnsOf(entity);
  const order = entity.primaryKey.map((path) => dialect.quote(entity.columnNames[path]!));
  try {
    const rows = await driver.query(
      `SELECT * FROM ${dialect.quote(entity.table)} ORDER BY ${order.join(', ')}`,
      [],
    );
    return { table: entity.table, columns, rows };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return { table: entity.table, columns, rows: [], error: reason };
  }
}

async function readAll(engine: LiveEngine): Promise<TableData[]> {
  const adapter = await adapterOf(engine);
  const entities = Object.values(schema.entities) as Entity[];
  const tables: TableData[] = [];
  // 只有一条连接，一张一张读
  for (const entity of entities) tables.push(await readTable(adapter, entity));
  return tables;
}

/** 演练场下方的表格：所有表现在的数据 */
export function readTables(engine: LiveEngine): Promise<TableData[]> {
  return enqueue(async () => {
    await ensureKept(engine);
    return readAll(engine);
  });
}

/** 放回示例数据 */
export function resetData(engine: LiveEngine): Promise<TableData[]> {
  return enqueue(async () => {
    await reseed(engine);
    kept.add(engine);
    return readAll(engine);
  });
}

/** WHERE 主键 = 值，占位符从 first 起 */
function whereKey(dialect: Dialect, key: RawRow, first: number) {
  const entries = Object.entries(key);
  const sql = entries
    .map(([name, value], index) => {
      return `${dialect.quote(name)} = ${dialect.placeholder(first + index, value)}`;
    })
    .join(' AND ');
  return { sql, params: entries.map(([, value]) => value) };
}

/** 改一格：直接发 UPDATE，不经过拦截器、乐观锁和自动填充 */
export function updateCell(
  engine: LiveEngine,
  table: string,
  key: RawRow,
  column: string,
  value: unknown,
): Promise<void> {
  return enqueue(async () => {
    const { dialect, driver } = await adapterOf(engine);
    const encoded = dialect.encodeParam(value);
    const where = whereKey(dialect, key, 2);
    await driver.execute(
      `UPDATE ${dialect.quote(table)} SET ${dialect.quote(column)} = ${dialect.placeholder(1, encoded)} WHERE ${where.sql}`,
      [encoded, ...where.params],
    );
  });
}

/** 删一行：真的删掉，逻辑删除的列不参与 */
export function deleteRow(engine: LiveEngine, table: string, key: RawRow): Promise<void> {
  return enqueue(async () => {
    const { dialect, driver } = await adapterOf(engine);
    const where = whereKey(dialect, key, 1);
    await driver.execute(`DELETE FROM ${dialect.quote(table)} WHERE ${where.sql}`, where.params);
  });
}
