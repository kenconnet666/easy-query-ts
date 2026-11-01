/**
 * 改能力表里一项的状态与说明，再重新生成对照清单（ROADMAP 16.1）：
 *
 *   node packages/easy-query/tools/set-capability.mjs func.json done "jsonValue / jsonObject …；suite.ts json"
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { format, resolveConfig } from 'prettier';

const [key, status, ts] = process.argv.slice(2);
if (!key || !['done', 'different', 'todo', 'na'].includes(status ?? '') || !ts)
  throw new Error('usage: set-capability.mjs <key> <done|different|todo|na> <ts>');

const file = fileURLToPath(new URL('./capabilities.mjs', import.meta.url));
let source = readFileSync(file, 'utf8');
const name = /^[a-zA-Z]+$/.test(key) ? `  ${key}: {` : `  '${key}': {`;
const start = source.indexOf(name);
if (start < 0) throw new Error(`capability '${key}' not found`);
const end = findEnd(source, start);
if (end < 0) throw new Error(`capability '${key}' has no closing brace`);

/** 这一项的结束位置：与它的 `{` 配对的 `}` */
function findEnd(text, from) {
  let depth = 0;
  for (let i = text.indexOf('{', from); i < text.length; i++) {
    if (text[i] === '{') depth++;
    else if (text[i] === '}' && --depth === 0) return i + 1;
  }
  return -1;
}

const block = source.slice(start, end);
const quote = (text) => `'${text.replaceAll('\\', '\\\\').replaceAll("'", "\\'")}'`;
const next = block
  .replace(/status: '[a-z]+'/, `status: '${status}'`)
  .replace(/ts:\s*'(?:[^'\\]|\\.)*'/, `ts: ${quote(ts)}`);
source = source.slice(0, start) + next + source.slice(end);
// 按仓库的 Prettier 配置排好再写（CI 的 format:check 会检查）
writeFileSync(file, await format(source, { ...(await resolveConfig(file)), filepath: file }));
execFileSync(process.execPath, [fileURLToPath(new URL('./parity-tests.mjs', import.meta.url))], {
  stdio: 'inherit',
});
