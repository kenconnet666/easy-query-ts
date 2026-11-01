/**
 * 源码文字检查：
 * - 源码里不直接写不可见字符、控制字符、双向控制符与从右往左的文字，要写就用 \uXXXX 转义。
 *   它们在编辑器里看不见或会改变显示顺序（“Trojan Source”），代码看起来和实际执行的不一样，审代码时发现不了；
 *   IDEA 也会对这类文件提示“双向文本”。
 * - TSX 里的中文文本不跨行、中文标点后不加空格：JSX 把文本中间的换行渲染成一个空格，中文之间就多出空格。
 *   接成一行即可，Prettier 不会在没有空格的中文里断行；紧挨标签的换行会被 JSX 去掉，不受影响。
 *
 * 用法：pnpm text:check。检查 git 跟踪的文件，本地加上还没提交的新文件。
 * pnpm text:check --fix 自动修正 TSX 里中文跨行与标点后的空格（改完再跑一遍 Prettier）。
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { root } from '../lib/repo.mjs';

const INCLUDE = [
  '*.ts',
  '*.tsx',
  '*.mts',
  '*.mjs',
  '*.js',
  '*.vue',
  '*.json',
  '*.md',
  '*.css',
  '*.yml',
];

/** 字符 → 说明；从右往左的文字（希伯来文、阿拉伯文，含阿拉伯-印度数字）按区段判断 */
const NAMED = new Map([
  [0x061c, '阿拉伯字母标记'],
  [0x200b, '零宽空格'],
  [0x200c, '零宽不连字'],
  [0x200d, '零宽连字'],
  [0x200e, '从左往右标记'],
  [0x200f, '从右往左标记'],
  [0x202a, '从左往右嵌入'],
  [0x202b, '从右往左嵌入'],
  [0x202c, '方向格式结束'],
  [0x202d, '从左往右覆盖'],
  [0x202e, '从右往左覆盖'],
  [0x2066, '从左往右隔离'],
  [0x2067, '从右往左隔离'],
  [0x2068, '首字方向隔离'],
  [0x2069, '方向隔离结束'],
  [0xfeff, '字节顺序标记（BOM）'],
]);
/** 控制字符（制表、换行、回车除外）：多半是脚本写文件时转义丢了，如正则里的 \b 成了退格符，代码看着对、实际不匹配 */
const isControl = (code) =>
  (code < 0x20 && code !== 0x09 && code !== 0x0a && code !== 0x0d) || code === 0x7f;
const isRtl = (code) =>
  (code >= 0x0590 && code <= 0x08ff) ||
  (code >= 0xfb1d && code <= 0xfdff) ||
  (code >= 0xfe70 && code <= 0xfefc);

const files = execFileSync(
  'git',
  ['ls-files', '--cached', '--others', '--exclude-standard', ...INCLUDE],
  { cwd: root, encoding: 'utf8' },
)
  .split('\n')
  .filter(Boolean);

/** 中文字符与全角标点 */
const CJK = /[　-〿一-鿿＀-￯“”]/;

/** 中文标点：其后换行接着文字（“date、↵dateTime”）也会渲染出空格 */
const CJK_PUNCTUATION = /[、。，；：！？）]/;

/**
 * TSX 里跨行的中文文本：上一行以中文结尾、下一行以中文开头，或上一行以中文标点结尾、下一行接着文字
 * （不是标签与表达式：JSX 去掉文字与标签之间带换行的空白），且上一行不是注释。
 * 只是启发式：多行字符串、模板里也可能命中，那里同样会多出换行，一并改成一行
 */
function cjkLineBreaks(lines) {
  const found = [];
  for (let index = 1; index < lines.length; index++) {
    const before = lines[index - 1].trimEnd();
    const after = lines[index].trimStart();
    if (!before || !after || /^\s*(\/\/|\/?\*)/.test(lines[index - 1])) continue;
    const last = before.at(-1);
    const textAfterPunctuation = CJK_PUNCTUATION.test(last) && /^[^<{}()/*]/.test(after);
    if (!(CJK.test(last) && CJK.test(after[0])) && !textAfterPunctuation) continue;
    found.push(index + 1);
  }
  return found;
}

/** 中文标点后多出的空格（“放。 读屏”）：多半是跨行的文本被接成一行时留下的 */
const SPACE_AFTER_CJK_PUNCTUATION = /[、。，；：！？）] +[一-鿿（“]/;
/** --fix 用：留下标点，去掉空格 */
const SPACE_AFTER_CJK_PUNCTUATION_GLOBAL = /([、。，；：！？）]) +(?=[一-鿿（“])/g;
const FIX = process.argv.includes('--fix');

const problems = [];
const breaks = [];
for (const file of files) {
  let text;
  try {
    text = readFileSync(join(root, file), 'utf8');
  } catch {
    continue; // 已删除但还在索引里
  }
  const lines = text.split('\n');
  lines.forEach((line, index) => {
    for (const char of line) {
      const code = char.codePointAt(0);
      const name =
        NAMED.get(code) ??
        (isControl(code) ? '控制字符' : isRtl(code) ? '从右往左的文字' : undefined);
      if (!name) continue;
      // 文件开头的 BOM 是编码标记，不在代码里
      if (code === 0xfeff && index === 0 && line.startsWith(char)) continue;
      const escaped = `\\u${code.toString(16).toUpperCase().padStart(4, '0')}`;
      problems.push(`${file}:${index + 1}  ${name}，改写成 ${escaped}`);
    }
  });
  if (file.endsWith('.tsx') && FIX) {
    // 从后往前接行（行号不会错位），再去掉标点后的空格
    for (const line of cjkLineBreaks(lines).reverse()) {
      lines[line - 2] = lines[line - 2].trimEnd() + lines[line - 1].trimStart();
      lines.splice(line - 1, 1);
    }
    const fixed = lines
      .map((line) => line.replace(SPACE_AFTER_CJK_PUNCTUATION_GLOBAL, '$1'))
      .join('\n');
    if (fixed !== text) {
      writeFileSync(join(root, file), fixed);
      console.log(`已修正：${file}`);
    }
    lines.splice(0, lines.length, ...fixed.split('\n'));
  }
  if (file.endsWith('.tsx')) {
    for (const line of cjkLineBreaks(lines)) breaks.push(`${file}:${line}`);
    lines.forEach((line, index) => {
      if (SPACE_AFTER_CJK_PUNCTUATION.test(line)) breaks.push(`${file}:${index + 1}`);
    });
  }
}

if (problems.length) {
  console.error(
    `源码里有不可见、控制或双向字符（共 ${problems.length} 处），请改用 \\uXXXX 转义：`,
  );
  console.error(problems.join('\n'));
  process.exitCode = 1;
}
if (breaks.length) {
  console.error(
    `TSX 里的中文文本跨行或标点后有空格（共 ${breaks.length} 处），渲染时中文之间会多出空格：`,
  );
  console.error(breaks.join('\n'));
  process.exitCode = 1;
}
if (!process.exitCode) console.log(`文字检查通过：${files.length} 个文件`);
