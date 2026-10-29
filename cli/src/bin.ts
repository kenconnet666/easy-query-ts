#!/usr/bin/env node
/**
 * eqts 命令行。
 *
 *   eqts pull --adapter ./db-adapter.ts [--out src/schema.ts] [--tables t_a,t_b] [--strip-prefix t_]
 *
 * --adapter 指向一个模块，默认导出（或导出名为 adapter）一个 easy-query 的 Adapter，例如：
 *   export default mysql(createPool(process.env.DATABASE_URL!))
 * 读当前 schema 的表结构，生成实体与 defineSchema 的源码；不给 --out 时打印到标准输出。
 */
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { createDb, defineSchema, type Adapter } from '@zerodep-dev/easy-query-ts';
import { entitySource } from './index.ts';

const USAGE =
  'usage: eqts pull --adapter <module> [--out <file>] [--tables <a,b>] [--strip-prefix <prefix>]';

async function main(argv: readonly string[]): Promise<void> {
  const [command, ...rest] = argv;
  if (command !== 'pull') throw new Error(USAGE);
  const { values } = parseArgs({
    args: [...rest],
    options: {
      adapter: { type: 'string' },
      out: { type: 'string' },
      tables: { type: 'string' },
      'strip-prefix': { type: 'string' },
    },
  });
  if (!values.adapter) throw new Error(`--adapter is required\n${USAGE}`);
  const loaded = (await import(pathToFileURL(resolve(values.adapter)).href)) as {
    default?: Adapter;
    adapter?: Adapter;
  };
  const adapter = loaded.default ?? loaded.adapter;
  if (!adapter) throw new Error(`${values.adapter} exports no adapter (default or "adapter")`);
  const db = createDb({ schema: defineSchema({}), adapter });
  const source = entitySource(await db.introspect(), {
    ...(values.tables ? { tables: values.tables.split(',').map((t) => t.trim()) } : {}),
    ...(values['strip-prefix'] !== undefined ? { stripPrefix: values['strip-prefix'] } : {}),
  });
  if (values.out) {
    await writeFile(values.out, source);
    console.error(`wrote ${values.out}`);
  } else process.stdout.write(source);
}

main(process.argv.slice(2)).then(
  // 连接池会让进程挂着：生成完就退出
  () => process.exit(0),
  (error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  },
);
