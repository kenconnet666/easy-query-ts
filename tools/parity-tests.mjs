/**
 * 官方 easy-query 单元测试的对照清单（ROADMAP 16.1）：扫描官方仓库 sql-test 里每个 @Test 用例，按方法体里用到的 API 归到一种能力，
 * 能力表（capabilities.mjs）记着 TS 侧的状态与对应的测试，生成 docs/parity-tests.md。
 *
 *   node packages/easy-query/tools/parity-tests.mjs [官方仓库路径]
 *
 * 官方仓库默认在仓库旁边的 orm-references/easy-query（本地克隆，不进 CI）；清单生成后提交，CI 不重新生成。
 */
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { format, resolveConfig } from 'prettier';
import { capabilities, fileRules, rules } from './capabilities.mjs';

const here = fileURLToPath(new URL('.', import.meta.url));
const repo = join(here, '../../..');
const official = process.argv[2] ?? join(repo, '../orm-references/easy-query');
const testRoot = join(official, 'sql-test/src');

/** 目录下所有 .java 文件 */
function javaFiles(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return javaFiles(path);
    return name.endsWith('.java') ? [path] : [];
  });
}

/** 去掉注释，免得注释掉的旧写法被当成用到的 API */
function stripComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:"])\/\/.*$/gm, '$1');
}

/** 一个文件里的 @Test 用例：方法名与方法体（按花括号配对） */
function tests(source) {
  const found = [];
  const marker = /@Test\b[\s\S]*?(?:public\s+)?void\s+(\w+)\s*\([^)]*\)[^{]*\{/g;
  let match;
  while ((match = marker.exec(source))) {
    let depth = 1;
    let i = marker.lastIndex;
    for (; i < source.length && depth > 0; i++) {
      const c = source[i];
      if (c === '"') {
        // 跳过字符串里的花括号
        for (i++; i < source.length && source[i] !== '"'; i++) if (source[i] === '\\') i++;
      } else if (c === '{') depth++;
      else if (c === '}') depth--;
    }
    found.push({ name: match[1], body: source.slice(marker.lastIndex, i) });
    marker.lastIndex = i;
  }
  return found;
}

/** 方法体里第一条断言的 SQL（摘要） */
function firstSql(body) {
  const sql = /"((?:SELECT|INSERT|UPDATE|DELETE|WITH|MERGE|CREATE|ALTER)\b[^"]*)"/.exec(body);
  if (!sql) return '';
  const text = sql[1].replace(/\s+/g, ' ');
  return text.length > 90 ? `${text.slice(0, 90)}…` : text;
}

/** 用例归到哪种能力：先看文件（方言目录、分片），再按规则的先后看方法体 */
function classify(file, body) {
  for (const [pattern, key] of fileRules) if (pattern.test(file)) return key;
  for (const [pattern, key] of rules) if (pattern.test(body)) return key;
  return 'query.basic';
}

const rows = [];
for (const path of javaFiles(testRoot)) {
  const source = stripComments(readFileSync(path, 'utf8'));
  if (!source.includes('@Test')) continue;
  const file = relative(testRoot, path)
    .replaceAll('\\', '/')
    .replace(/^(main|test)\/java\/com\/easy\/query\/test\//, '');
  for (const test of tests(source)) {
    rows.push({ file, name: test.name, key: classify(file, test.body), sql: firstSql(test.body) });
  }
}

const byKey = new Map();
for (const row of rows) byKey.set(row.key, [...(byKey.get(row.key) ?? []), row]);
for (const key of byKey.keys())
  if (!capabilities[key])
    throw new Error(`capability '${key}' is not described in capabilities.mjs`);

const statusText = { done: '已对应', different: '写法不同', todo: '待做', na: '不适用' };
const count = (status) => rows.filter((row) => capabilities[row.key].status === status).length;
const cell = (text) => text.replaceAll('|', '\\|');

const lines = [
  '# 官方 easy-query 单元测试的逐条对照',
  '',
  '由 `packages/easy-query/tools/parity-tests.mjs` 生成，不要手改：改能力的状态在 `tools/capabilities.mjs` 里改，再重新生成。',
  `对照的是官方 \`dromara/easy-query\` 的 sql-test（${rows.length} 个用例）。每个用例按方法体里用到的 API 归到一种能力，状态取能力的状态。`,
  '',
  `合计：已对应 ${count('done')}、写法不同 ${count('different')}、待做 ${count('todo')}、不适用 ${count('na')}。`,
  '',
  '## 按能力',
  '',
  '| 能力 | 用例数 | 状态 | TS 侧（实现与测试） |',
  '| --- | --- | --- | --- |',
  ...[...byKey]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, list]) => {
      const c = capabilities[key];
      return `| ${c.title}（\`${key}\`） | ${list.length} | ${statusText[c.status]} | ${cell(c.ts)} |`;
    }),
  '',
  '## 逐条',
  '',
];
for (const [key, list] of [...byKey].sort(([a], [b]) => a.localeCompare(b))) {
  const c = capabilities[key];
  lines.push(`### ${c.title}（\`${key}\`，${statusText[c.status]}）`, '');
  lines.push('| 用例 | 断言的 SQL（摘要） |', '| --- | --- |');
  for (const row of list.sort((a, b) => (a.file + a.name).localeCompare(b.file + b.name)))
    lines.push(`| ${row.file}#${row.name} | ${row.sql ? `\`${cell(row.sql)}\`` : ''} |`);
  lines.push('');
}
// 按仓库的 Prettier 配置排好再写（CI 的 pnpm check 会检查）
const output = join(here, '../docs/parity-tests.md');
const options = { ...(await resolveConfig(output)), filepath: output };
writeFileSync(output, await format(lines.join('\n'), options));
console.log(
  `${rows.length} tests: done ${count('done')}, different ${count('different')}, todo ${count('todo')}, na ${count('na')}`,
);
