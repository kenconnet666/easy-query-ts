/**
 * 公开 API 和已发布版本比：构建出的 .d.ts 与 npm 上那个版本包里的逐包对比，去掉注释与空行后输出差异。
 * 发版前跑一遍：删掉的、签名变了的都要在发布说明里写迁移办法（RELEASE.md 的版本策略）。
 *
 * 用法：pnpm api:diff            和每个包在 npm 上的 latest 比
 *      pnpm api:diff 0.4.0      和指定版本比
 */
import { execSync, spawnSync } from 'node:child_process';
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
import { dirname, join, relative } from 'node:path';
import { root } from '../lib/repo.mjs';

const from = process.argv[2];
const work = mkdtempSync(join(tmpdir(), 'eqts-api-'));

/** 目录下所有 .d.ts，相对路径 → 文件 */
function declarations(dir, base = dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return declarations(path, base);
    return entry.name.endsWith('.d.ts') ? [[relative(base, path), path]] : [];
  });
}

/** 只留公开的声明：注释与私有成员（.d.ts 里写成 `private name;`）的改动不算 API 变化 */
function normalize(text) {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((line) => line.trimEnd())
    .filter((line) => line.trim() !== '' && !/^\s*(\/\/|private\s)/.test(line))
    .join('\n');
}

function copyNormalized(sourceDir, targetDir) {
  for (const [path, file] of declarations(sourceDir)) {
    const target = join(targetDir, path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, `${normalize(readFileSync(file, 'utf8'))}\n`);
  }
}

try {
  execSync('pnpm build', { cwd: root, stdio: 'inherit' });
  const before = join(work, 'before');
  const after = join(work, 'after');
  for (const dir of readdirSync(join(root, 'packages'))) {
    const manifest = JSON.parse(readFileSync(join(root, 'packages', dir, 'package.json'), 'utf8'));
    if (manifest.private) continue;
    const spec = `${manifest.name}@${from ?? 'latest'}`;
    const packs = join(work, 'packs', dir);
    mkdirSync(packs, { recursive: true });
    try {
      execSync(`npm pack ${spec} --pack-destination "${packs}" --silent`, { stdio: 'pipe' });
    } catch {
      console.log(`${spec} is not on npm: every declaration of ${dir} counts as new`);
    }
    const tarball = readdirSync(packs).find((file) => file.endsWith('.tgz'));
    if (tarball) {
      execSync(`tar -xzf "${tarball}"`, { cwd: packs });
      copyNormalized(join(packs, 'package', 'dist'), join(before, dir));
    }
    copyNormalized(join(root, 'packages', dir, 'dist'), join(after, dir));
  }
  mkdirSync(before, { recursive: true });
  // git diff --no-index 有差异时退出码是 1，不当成失败；关掉 autocrlf，免得 Windows 上每个文件一条换行警告
  const diff = (...options) =>
    spawnSync(
      'git',
      [
        '-c',
        'core.autocrlf=false',
        'diff',
        '--no-index',
        '--no-color',
        ...options,
        'before',
        'after',
      ],
      { cwd: work, stdio: 'inherit' },
    ).status;
  if (diff('--quiet') === 0) {
    console.log(`no public API changes since ${from ?? 'the latest release'}`);
  } else {
    diff('--stat');
    diff();
  }
} finally {
  rmSync(work, { recursive: true, force: true });
}
