#!/usr/bin/env node
/**
 * eqts 命令行。
 *
 *   eqts pull --adapter ./db-adapter.ts [--out src/schema.ts] [--tables t_a,t_b] [--strip-prefix t_]
 *   eqts migrate generate --adapter ./db-adapter.ts --schema ./src/schema.ts --name add_orders [--dir migrations]
 *   eqts migrate up --adapter ./db-adapter.ts [--dir migrations] [--table eqts_migrations]
 *   eqts snapshot src/queries.snap.ts [more.snap.ts …] [--out sql-snapshots] [--check]
 *
 * --adapter 指向一个模块，默认导出（或导出名为 adapter）一个 easy-query 的 Adapter，例如：
 *   export default mysql(createPool(process.env.DATABASE_URL!))
 * --schema 指向导出 schema（默认导出或名为 schema）的模块。
 * pull：读当前 schema 的表结构，生成实体与 defineSchema 的源码；不给 --out 时打印到标准输出。
 * migrate generate：对开发库算 planSync，写成 <时间戳>_<name>.ts 迁移文件（没有要改的就不写）。
 * migrate up：按文件名的顺序执行目录里还没执行过的迁移（db.migrate），记进历史表。
 * snapshot：模块默认导出 defineSnapshots(...)，按每个方言渲染成 <out>/<模块名>.<方言标签>.sql（不连库）；
 *   --check 只比较不写，有没更新的快照时失败（CI 里用）。
 */
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import {
  createDb,
  defineSchema,
  migrationSource,
  renderSnapshots,
  type Adapter,
  type AnySchema,
  type Migration,
  type SnapshotDefinition,
} from '@zerodep-dev/easy-query-ts';
import { entitySource } from './index.ts';

const USAGE = `usage:
  eqts pull --adapter <module> [--out <file>] [--tables <a,b>] [--strip-prefix <prefix>]
  eqts migrate generate --adapter <module> --schema <module> --name <name> [--dir <dir>]
  eqts migrate up --adapter <module> [--dir <dir>] [--table <history table>]
  eqts snapshot <module> [<module> …] [--out <dir>] [--check]`;

async function load<T>(path: string, names: readonly string[], what: string): Promise<T> {
  const loaded = (await import(pathToFileURL(resolve(path)).href)) as Record<string, unknown>;
  for (const name of names) if (loaded[name] !== undefined) return loaded[name] as T;
  throw new Error(`${path} exports no ${what} (${names.join(' or ')})`);
}

/** 迁移文件名的时间戳：UTC 的 yyyyMMddHHmmss */
function stamp(date: Date): string {
  return date.toISOString().replace(/\D/g, '').slice(0, 14);
}

async function pull(args: readonly string[]): Promise<void> {
  const { values } = parseArgs({
    args: [...args],
    options: {
      adapter: { type: 'string' },
      out: { type: 'string' },
      tables: { type: 'string' },
      'strip-prefix': { type: 'string' },
    },
  });
  if (!values.adapter) throw new Error(`--adapter is required\n${USAGE}`);
  const adapter = await load<Adapter>(values.adapter, ['default', 'adapter'], 'adapter');
  const db = createDb({ schema: defineSchema({}), adapter });
  // 迁移的历史表不是业务表
  const tables = (await db.introspect()).filter((t) => t.name.toLowerCase() !== 'eqts_migrations');
  const source = entitySource(tables, {
    ...(values.tables ? { tables: values.tables.split(',').map((t) => t.trim()) } : {}),
    ...(values['strip-prefix'] !== undefined ? { stripPrefix: values['strip-prefix'] } : {}),
  });
  if (values.out) {
    await writeFile(values.out, source);
    console.error(`wrote ${values.out}`);
  } else process.stdout.write(source);
}

async function migrate(args: readonly string[]): Promise<void> {
  const [action, ...rest] = args;
  const { values } = parseArgs({
    args: [...rest],
    options: {
      adapter: { type: 'string' },
      schema: { type: 'string' },
      name: { type: 'string' },
      dir: { type: 'string', default: 'migrations' },
      table: { type: 'string' },
    },
  });
  if (!values.adapter) throw new Error(`--adapter is required\n${USAGE}`);
  const adapter = await load<Adapter>(values.adapter, ['default', 'adapter'], 'adapter');
  const dir = values.dir!;
  if (action === 'generate') {
    if (!values.schema || !values.name)
      throw new Error(`--schema and --name are required\n${USAGE}`);
    if (!/^\w+$/.test(values.name))
      throw new Error('--name may only contain letters, digits and _');
    const schema = await load<AnySchema>(values.schema, ['default', 'schema'], 'schema');
    const plan = await createDb({ schema, adapter }).planSync();
    if (plan.statements.length === 0 && plan.differences.length === 0) {
      console.error('nothing to migrate: the database matches the schema');
      return;
    }
    const id = `${stamp(new Date())}_${values.name}`;
    await mkdir(dir, { recursive: true });
    const file = join(dir, `${id}.ts`);
    await writeFile(file, migrationSource(id, plan));
    console.error(
      `wrote ${file} (${plan.statements.length} statements, ${plan.differences.length} differences to review)`,
    );
    return;
  }
  if (action === 'up') {
    const files = (await readdir(dir)).filter((f) => /\.(ts|js|mjs)$/.test(f)).sort();
    const migrations = await Promise.all(
      files.map((f) => load<Migration>(join(dir, f), ['default', 'migration'], 'migration')),
    );
    const db = createDb({ schema: defineSchema({}), adapter });
    const applied = await db.migrate(migrations, values.table ? { table: values.table } : {});
    console.error(applied.length > 0 ? `applied ${applied.join(', ')}` : 'up to date');
    return;
  }
  throw new Error(USAGE);
}

async function snapshot(args: readonly string[]): Promise<void> {
  const { values, positionals } = parseArgs({
    args: [...args],
    allowPositionals: true,
    options: {
      out: { type: 'string', default: 'sql-snapshots' },
      check: { type: 'boolean', default: false },
    },
  });
  if (positionals.length === 0) throw new Error(`give at least one snapshot module\n${USAGE}`);
  const out = values.out!;
  const stale: string[] = [];
  for (const module of positionals) {
    const definition = await load<SnapshotDefinition<AnySchema>>(
      module,
      ['default', 'snapshots'],
      'snapshot definition',
    );
    const stem = basename(module).replace(/\.[cm]?[jt]s$/, '');
    for (const [label, text] of Object.entries(renderSnapshots(definition))) {
      const file = join(out, `${stem}.${label}.sql`);
      if (values.check) {
        const current = await readFile(file, 'utf8').catch(() => undefined);
        if (current !== text) stale.push(file);
        continue;
      }
      await mkdir(out, { recursive: true });
      await writeFile(file, text);
      console.error(`wrote ${file}`);
    }
  }
  if (stale.length > 0)
    throw new Error(
      `SQL snapshots are out of date (run eqts snapshot without --check and review the diff):\n  ${stale.join('\n  ')}`,
    );
}

async function main(argv: readonly string[]): Promise<void> {
  const [command, ...rest] = argv;
  if (command === 'pull') return pull(rest);
  if (command === 'migrate') return migrate(rest);
  if (command === 'snapshot') return snapshot(rest);
  throw new Error(USAGE);
}

main(process.argv.slice(2)).then(
  // 连接池会让进程挂着：做完就退出
  () => process.exit(0),
  (error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  },
);
