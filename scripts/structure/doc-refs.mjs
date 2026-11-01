/**
 * 文档引用检查：搬动或删掉文档后，别处提到它的地方不会悄悄失效。两条规则：
 *
 *   1. Markdown 里的相对链接（`[README](packages/test/README.md)`）指向的文件存在（相对所在文件，去掉 #锚点）
 *   2. 任何文本文件里提到的大写文档名（`HANDOFF.md 的上手一节`、`packages/test/README.md`）找得到：
 *      带路径的按仓库根目录或所在目录解析，只写文件名的要有同名文档
 *
 * 小写的 `.md`（`docs/frontend.md`）多半是别的仓库里的文档，不查。`.claude/` 下是历史调研报告，不查。
 * 用法：node scripts/structure/doc-refs.mjs（pnpm refs:check，在 pnpm check 里）
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { root } from '../lib/repo.mjs';

/** 不在本仓库里、提到时只是说明来历的文档：名字 → 在哪 */
const EXTERNAL = {
  'CLAUDE.md': '用户级与别的仓库的 Claude 说明',
};

const files = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], {
  cwd: root,
  encoding: 'utf8',
})
  .split('\n')
  .filter((file) => /\.(md|[cm]?[jt]sx?|json|ya?ml)$/.test(file) && !file.startsWith('.claude/'))
  .filter((file) => existsSync(join(root, file)));
const docNames = new Set(
  files.filter((file) => file.endsWith('.md')).map((file) => basename(file)),
);

const LINK = /\]\(([^)\s]+)\)/g;
const MENTION = /(?<![\w./-])((?:[\w.-]+\/)*[A-Z][A-Z0-9-]*\.md)\b/g;

const problems = [];
for (const file of files) {
  const text = readFileSync(join(root, file), 'utf8');
  const lineOf = (index) => text.slice(0, index).split('\n').length;
  const from = dirname(file);

  if (file.endsWith('.md')) {
    for (const match of text.matchAll(LINK)) {
      const target = match[1].split('#')[0];
      if (!target || /^[a-z][\w+.-]*:/i.test(target) || target.startsWith('/')) continue;
      if (!existsSync(join(root, from, decodeURI(target))))
        problems.push(`${file}:${lineOf(match.index)} 链接 ${match[1]} 指向的文件不存在`);
    }
  }

  for (const match of text.matchAll(MENTION)) {
    const name = match[1];
    if (name.includes('/')) {
      if (!existsSync(join(root, name)) && !existsSync(join(root, from, name)))
        problems.push(`${file}:${lineOf(match.index)} 提到的 ${name} 不存在`);
    } else if (!docNames.has(name) && !(name in EXTERNAL)) {
      problems.push(`${file}:${lineOf(match.index)} 提到的 ${name} 在仓库里找不到`);
    }
  }
}

if (problems.length) {
  console.error(
    `文档引用检查没通过（${problems.length} 处）：\n${problems.map((p) => `  ${p}`).join('\n')}`,
  );
  process.exitCode = 1;
} else {
  console.log(`文档引用检查通过：${files.length} 个文件`);
}
