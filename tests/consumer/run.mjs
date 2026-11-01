/**
 * 发布产物的检查：真正装到使用方手里的是 pnpm pack 的包，仓库里的测试直接跑源码，发现不了打包的问题。
 *
 *   1. 每个要发布的包：依赖里没有 workspace:、catalog:，exports 指向的文件都在包里
 *   2. 不要外部驱动的几个包装进仓库之外的项目：类型检查、运行一遍，核心包只有一份（表达式靠 instanceof 识别，两份就失灵）
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
  }
  if (problems.length) throw new Error(`packed manifests are wrong:\n  ${problems.join('\n  ')}`);
  console.log(`${packed.size} packages: manifests and exports are fine`);
}

const APP = `
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { CalendarDate } from '@internationalized/date';
import { col, createDb, defineSchema, entity } from '@zerodep-dev/easy-query-ts';
import { createCache } from '@zerodep-dev/easy-query-ts-cache';
import { calendarDate } from '@zerodep-dev/easy-query-ts-date';
import { sqlite } from '@zerodep-dev/easy-query-ts-sqlite';

const User = entity('t_user', {
  id: col.int().primaryKey().generated(),
  name: col.string(),
  born: calendarDate(),
});
const schema = defineSchema({ User });
const cache = createCache({ entities: [User] });
const db = createDb({
  schema,
  adapter: sqlite(new DatabaseSync(':memory:')),
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
console.log('consumer app ran');
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
  run('node app.ts', app);
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
