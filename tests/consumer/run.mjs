/**
 * 发布产物的检查：真正装到使用方手里的是 pnpm pack 的包，仓库里的测试直接跑源码，发现不了打包的问题。
 *
 *   1. 每个要发布的包：依赖里没有 workspace:、catalog:，exports 指向的文件都在包里
 *   2. 不要外部驱动的几个包装进仓库之外的项目：用仓库的与支持的最低 TypeScript 各类型检查一遍、运行一遍，
 *      核心包只有一份（表达式靠 instanceof 识别，两份就失灵）
 *   3. 每个包声明同一个 engines.node，并且在声明的最低版本与最新的正式版上各运行一遍（npx 取那个版本的 node）
 *   4. 同一个项目在 Bun、Deno 上各运行一遍（冒烟，不在 engines 里）
 *
 * 用法：pnpm test:consumer
 */
import { execSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { root } from '../../scripts/lib/repo.mjs';

const work = mkdtempSync(join(tmpdir(), 'eqts-consumer-'));
// pnpm 经 NODE_OPTIONS 打开仓库内的源码条件：临时项目要和真实的使用方一样，走 dist
const { NODE_OPTIONS: _sourceCondition, ...env } = process.env;
const run = (command, cwd) => execSync(command, { cwd, env, stdio: 'inherit' });

/** catalog 里的精确版本：临时项目用和仓库一样的 */
function catalogVersion(name) {
  const text = readFileSync(join(root, 'pnpm-workspace.yaml'), 'utf8');
  const match = text.match(new RegExp(`^\\s+'?${name}'?: (.+)$`, 'm'));
  if (!match) throw new Error(`${name} is not in the catalog`);
  return match[1].trim();
}

/** 打包所有要发布的包，返回 包名 → 解开后的目录、压缩包 */
function packAll() {
  const packed = new Map();
  for (const dir of readdirSync(join(root, 'packages'))) {
    const cwd = join(root, 'packages', dir);
    const manifest = JSON.parse(readFileSync(join(cwd, 'package.json'), 'utf8'));
    if (manifest.private) continue;
    const destination = join(work, 'packs', dir);
    mkdirSync(destination, { recursive: true });
    run(`pnpm pack --pack-destination "${destination}"`, cwd);
    const tarball = readdirSync(destination).find((file) => file.endsWith('.tgz'));
    run(`tar -xzf "${tarball}"`, destination);
    packed.set(manifest.name, {
      tarball: join(destination, tarball),
      unpacked: join(destination, 'package'),
    });
  }
  return packed;
}

/** exports 里所有文件路径（源码条件指向的也算：src 随包发布） */
function exportTargets(value) {
  if (typeof value === 'string') return [value];
  return Object.values(value ?? {}).flatMap(exportTargets);
}

function checkManifests(packed) {
  const problems = [];
  for (const [name, { unpacked }] of packed) {
    const manifest = JSON.parse(readFileSync(join(unpacked, 'package.json'), 'utf8'));
    for (const field of ['dependencies', 'peerDependencies', 'optionalDependencies']) {
      for (const [dep, range] of Object.entries(manifest[field] ?? {})) {
        if (/^(workspace|catalog):/.test(range)) problems.push(`${name}: ${dep}@${range}`);
      }
    }
    for (const target of exportTargets(manifest.exports)) {
      if (!existsSync(join(unpacked, target))) problems.push(`${name}: ${target} is missing`);
    }
    if (!existsSync(join(unpacked, 'LICENSE'))) problems.push(`${name}: LICENSE is missing`);
    if (manifest.engines?.node !== NODE_RANGE)
      problems.push(`${name}: engines.node is ${manifest.engines?.node}, expected ${NODE_RANGE}`);
  }
  if (problems.length) throw new Error(`packed manifests are wrong:\n  ${problems.join('\n  ')}`);
  console.log(`${packed.size} packages: manifests and exports are fine`);
}

/** 各包声明的 Node 版本范围（取核心包的，checkManifests 核对其余的与它一致）与其中的最低版本 */
const NODE_RANGE = JSON.parse(readFileSync(join(root, 'packages/core/package.json'), 'utf8'))
  .engines.node;
const MINIMUM_NODE = /^>=(\d+\.\d+)(\.\d+)?$/.exec(NODE_RANGE);
if (!MINIMUM_NODE) throw new Error(`engines.node '${NODE_RANGE}' is not of the form >=x.y`);

/** 使用方能用的最低 TypeScript：声明里用到 Uint8Array<…> 这类 5.7 才有的写法 */
const MINIMUM_TYPESCRIPT = '5.7';

/** npm 上 node 包最高的正式版（它的 latest 标签会指向预发布版） */
function latestNode() {
  const versions = JSON.parse(execSync('npm view node versions --json', { env, encoding: 'utf8' }));
  const released = versions
    .filter((version) => /^\d+\.\d+\.\d+$/.test(version))
    .map((version) => version.split('.').map(Number));
  released.sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2]);
  return released.at(-1).join('.');
}

// 同一个 app.ts 在 Node、Bun、Deno 上都跑：SQLite 用各自自带的同步驱动，Bun 是 bun:sqlite，Node 与 Deno 是 node:sqlite
const APP = `
import assert from 'node:assert/strict';
import { CalendarDate } from '@internationalized/date';
import { col, createDb, defineSchema, entity } from '@zerodep-dev/easy-query-ts';
import { createCache } from '@zerodep-dev/easy-query-ts-cache';
import { calendarDate } from '@zerodep-dev/easy-query-ts-date';
import { sqlite } from '@zerodep-dev/easy-query-ts-sqlite';

const runtime = globalThis as { Bun?: { version: string }; Deno?: { version: { deno: string } } };
async function openDatabase() {
  if (runtime.Bun) {
    const { Database } = await import('bun:sqlite' as string);
    return new Database(':memory:', { safeIntegers: true });
  }
  const { DatabaseSync } = await import('node:sqlite');
  return new DatabaseSync(':memory:');
}

const User = entity('t_user', {
  id: col.int().primaryKey().generated(),
  name: col.string(),
  born: calendarDate(),
});
const schema = defineSchema({ User });
const cache = createCache({ entities: [User] });
const db = createDb({
  schema,
  adapter: sqlite(await openDatabase()),
  interceptors: [cache.interceptor],
});
await db.createTables();
await db.insert(User).values({ name: 'alice', born: new CalendarDate(2000, 1, 2) }).execute();

const rows = await db
  .queryable(User)
  .where((u) => u.name.startsWith('a'))
  .select((u) => ({ name: u.name, born: u.born }))
  .toList();
const name: string = rows[0]!.name;
assert.equal(name, 'alice');
assert.ok(rows[0]!.born instanceof CalendarDate);

const cached = cache.of(db).kv(User);
assert.equal((await cached.find(1))!.name, 'alice');
await db.update(User).set({ name: 'bob' }).where((u) => u.id.eq(1)).execute();
assert.equal((await cached.find(1))!.name, 'bob');
const on = runtime.Bun
  ? \`Bun \${runtime.Bun.version}\`
  : runtime.Deno
    ? \`Deno \${runtime.Deno.version.deno}\`
    : \`Node \${process.version}\`;
console.log(\`consumer app ran on \${on}\`);
`;

function checkInstall(packed) {
  const app = join(work, 'app');
  mkdirSync(app);
  const installed = [
    '@zerodep-dev/easy-query-ts',
    '@zerodep-dev/easy-query-ts-sqlite',
    '@zerodep-dev/easy-query-ts-cache',
    '@zerodep-dev/easy-query-ts-date',
  ];
  writeFileSync(
    join(app, 'package.json'),
    JSON.stringify({
      name: 'eqts-consumer',
      private: true,
      type: 'module',
      dependencies: {
        ...Object.fromEntries(installed.map((name) => [name, `file:${packed.get(name).tarball}`])),
        '@internationalized/date': catalogVersion('@internationalized/date'),
        typescript: catalogVersion('typescript'),
        '@types/node': catalogVersion('@types/node'),
      },
    }),
  );
  writeFileSync(join(app, 'app.ts'), APP);
  writeFileSync(
    join(app, 'tsconfig.json'),
    JSON.stringify({
      compilerOptions: {
        target: 'ES2023',
        module: 'NodeNext',
        moduleResolution: 'NodeNext',
        strict: true,
        noEmit: true,
        types: ['node'],
      },
      include: ['app.ts'],
    }),
  );
  run('npm install --no-audit --no-fund', app);
  run('npx tsc -p .', app);
  // 支持的最低 TypeScript 上也要通过（RELEASE.md 的版本策略）
  run(`npx --yes -p typescript@${MINIMUM_TYPESCRIPT} tsc -p .`, app);
  run('node app.ts', app);
  // 声明的最低版本与最新的正式版上也要能跑：npm 的 node 包提供各版本的二进制
  run(`npx --yes node@${MINIMUM_NODE[1]}${MINIMUM_NODE[2] ?? '.0'} app.ts`, app);
  run(`npx --yes node@${latestNode()} app.ts`, app);
  // Bun、Deno 不在 engines 里，只做冒烟：取最新版，上游的新版本弄坏了什么，发布前就知道
  run('npx --yes bun@latest app.ts', app);
  run('npx --yes deno@latest run --allow-all app.ts', app);
  const copies = installed
    .slice(1)
    .filter((name) =>
      existsSync(join(app, 'node_modules', name, 'node_modules', '@zerodep-dev/easy-query-ts')),
    );
  if (copies.length) throw new Error(`more than one copy of core: under ${copies.join(', ')}`);
}

try {
  const packed = packAll();
  checkManifests(packed);
  checkInstall(packed);
  console.log('consumer check passed');
} finally {
  rmSync(work, { recursive: true, force: true });
}
