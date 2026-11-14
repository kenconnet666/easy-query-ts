/**
 * 公开导出都有说明。各包 `src/index.ts` 导出的每个名字：
 *
 *   - 小写开头的（函数、常量——要调用的 API）：在文档站（apps/docs/src）或那个包的 README 里出现过；
 *   - 大写开头的（类、类型——写在签名、instanceof 里的）：文档站或 README 里出现过，或者声明处有文档注释，
 *     编辑器里悬停能看到说明。
 *
 * 都不满足的，登记在 export-docs.allow.json 里并写明为什么不用说明（给方言包用的内部工具……）。
 * 新加一个导出却忘了写文档时在这里拦下；清单里已经有文档、或者已经不再导出的条目也报出来，清单不会烂掉。
 * 按文字解析（TypeScript 7 没有 JS 版的编译器 API）：认 `export { a, type B, c as d } from '…'` 与顶格的带 export 的声明。
 *
 * 用法：node scripts/structure/export-docs.mjs（pnpm exports:check，在 pnpm check 里）
 */
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { root } from '../lib/repo.mjs';

/** 只给测试用的包不查 */
const SKIPPED = new Set(['test']);

const KEYWORDS =
  '(?:declare )?(?:abstract )?(?:async )?(?:function\\*?|class|const|let|interface|type|enum)';

/** 一个 index.ts 导出的名字 */
function exportedNames(file) {
  const text = readFileSync(file, 'utf8');
  if (/^export \*/m.test(text))
    throw new Error(`${file}: \`export *\` 看不出导出了什么，改成列出名字`);
  const names = new Set();
  for (const [, list] of text.matchAll(/^export (?:type )?\{([^}]*)\}/gm))
    for (const item of list.split(',')) {
      const name = item
        .trim()
        .replace(/^type /, '')
        .split(/\s+as\s+/)
        .pop();
      if (name) names.add(name);
    }
  for (const [, name] of text.matchAll(new RegExp(`^export ${KEYWORDS} ([A-Za-z_$][\\w$]*)`, 'gm')))
    names.add(name);
  return names;
}

function filesUnder(directory, pattern) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return filesUnder(path, pattern);
    return pattern.test(entry.name) ? [path] : [];
  });
}

/** 文字里出现过的标识符 */
const words = (text) => new Set(text.match(/[A-Za-z_$][\w$]*/g));
const read = (files) => files.map((file) => readFileSync(file, 'utf8')).join('\n');

/** 这个名字在源码里的声明前面是不是文档注释 */
function hasDocComment(sources, name) {
  const declaration = new RegExp(`\\*/\\n(?:export )?${KEYWORDS} ${name.replace('$', '\\$')}\\b`);
  return declaration.test(sources);
}

const site = words(read(filesUnder(join(root, 'apps/docs/src'), /\.tsx?$/)));
const allow = JSON.parse(
  readFileSync(join(root, 'scripts/structure/export-docs.allow.json'), 'utf8'),
);

const problems = [];
let total = 0;
for (const name of readdirSync(join(root, 'packages')).sort()) {
  const source = join(root, 'packages', name, 'src');
  if (SKIPPED.has(name) || !existsSync(join(source, 'index.ts'))) continue;
  const readme = join(root, 'packages', name, 'README.md');
  const local = existsSync(readme) ? words(readFileSync(readme, 'utf8')) : new Set();
  const sources = read(filesUnder(source, /\.ts$/)).replaceAll('\r\n', '\n');
  const exported = exportedNames(join(source, 'index.ts'));
  const allowed = allow[name] ?? {};
  total += exported.size;
  for (const symbol of exported) {
    const typeLike = /^[A-Z]/.test(symbol);
    const documented =
      site.has(symbol) || local.has(symbol) || (typeLike && hasDocComment(sources, symbol));
    if (symbol in allowed) {
      if (documented)
        problems.push(`${name}: ${symbol} 已经有说明了，从 export-docs.allow.json 里去掉`);
    } else if (!documented) {
      problems.push(
        typeLike
          ? `${name}: 导出的 ${symbol} 声明处没有文档注释，文档站和 README 里也没出现`
          : `${name}: 导出的 ${symbol} 在文档站和 README 里都没出现`,
      );
    }
  }
  for (const symbol of Object.keys(allowed))
    if (!exported.has(symbol))
      problems.push(`${name}: export-docs.allow.json 里的 ${symbol} 已经不再导出`);
}
for (const name of Object.keys(allow))
  if (!existsSync(join(root, 'packages', name, 'src/index.ts')))
    problems.push(`export-docs.allow.json 里的包 ${name} 不存在`);

if (problems.length > 0) {
  console.error(problems.join('\n'));
  console.error(
    `\n${problems.length} 处：补上说明（文档站的页面或示例、包的 README、类型声明处的文档注释），` +
      '或在 scripts/structure/export-docs.allow.json 里登记并写明原因',
  );
  process.exit(1);
}
console.log(`公开导出检查通过：${total} 个导出`);
