/**
 * 把一行的 SQL 排成读得舒服的多行：主要子句各占一行，子查询缩进。只给文档显示用，不改变语义：
 * 引号里的内容（字符串、标识符）原样保留。构建时渲染与浏览器里运行共用
 */

/** 另起一行的子句；长的写在前面，先匹配 */
const CLAUSES = [
  'INSERT INTO',
  'DELETE FROM',
  'UNION ALL',
  'LEFT JOIN',
  'RIGHT JOIN',
  'INNER JOIN',
  'CROSS JOIN',
  'FULL JOIN',
  'GROUP BY',
  'ORDER BY',
  'ON CONFLICT',
  'ON DUPLICATE KEY',
  'FOR NO KEY UPDATE',
  'FOR UPDATE',
  'FOR SHARE',
  'FETCH FIRST',
  'FETCH NEXT',
  'SELECT',
  'UPDATE',
  'VALUES',
  'WHERE',
  'HAVING',
  'FROM',
  'JOIN',
  'LIMIT',
  'OFFSET',
  'RETURNING',
  'UNION',
  'SET',
];
const CLAUSE = new RegExp(`^(?:${CLAUSES.join('|').replaceAll(' ', '\\s+')})\\b`, 'i');

/** 列表（SELECT 的列、SET 的赋值）超过这么宽才一项一行 */
const WIDE = 56;

/** 切成片段：引号里的、括号、其余文字 */
function tokenize(sql: string): string[] {
  return sql.match(/'(?:[^']|'')*'|"(?:[^"]|"")*"|`[^`]*`|\[[^\]]*\]|[(),]|[^'"`[(),]+/g) ?? [];
}

/** SELECT 的列、SET 的赋值太宽时拆成一项一行 */
function breakList(line: string, indent: string): string {
  const match = /^(\s*(?:SELECT\s+(?:DISTINCT\s+)?|SET\s+))(.*)$/is.exec(line);
  if (!match || line.length <= WIDE) return line;
  const columns: string[] = [];
  let depth = 0;
  let current = '';
  for (const token of tokenize(match[2]!)) {
    if (token === '(') depth++;
    if (token === ')') depth--;
    if (token === ',' && depth === 0) {
      columns.push(current.trim());
      current = '';
    } else current += token;
  }
  columns.push(current.trim());
  if (columns.length < 2) return line;
  return `${match[1]!.trimEnd()}\n${columns.map((column) => `${indent}  ${column}`).join(',\n')}`;
}

/** 建表语句：一列一行 */
function formatCreate(sql: string): string {
  const open = sql.indexOf('(');
  const close = sql.lastIndexOf(')');
  if (open < 0 || close < open) return sql;
  const columns: string[] = [];
  let depth = 0;
  let current = '';
  for (const token of tokenize(sql.slice(open + 1, close))) {
    if (token === '(') depth++;
    if (token === ')') depth--;
    if (token === ',' && depth === 0) {
      columns.push(current.trim());
      current = '';
    } else current += token;
  }
  columns.push(current.trim());
  const body = columns.map((column) => `  ${column}`).join(',\n');
  return `${sql.slice(0, open).trimEnd()} (\n${body}\n)${sql.slice(close + 1)}`;
}

/** MERGE 只在这几处换行：它的 UPDATE、SET、VALUES 是语句的一部分，不是新的子句 */
function formatMerge(sql: string): string {
  return sql.replace(/\s+(USING|ON \(|WHEN (?:NOT )?MATCHED)/g, '\n$1').replace(/; ?/g, ';\n');
}

/** 格式化一条语句 */
export function formatSql(sql: string): string {
  if (/^\s*CREATE TABLE\b/i.test(sql)) return formatCreate(sql);
  if (/\bMERGE INTO\b/i.test(sql)) return formatMerge(sql);
  const lines: string[] = [];
  let line = '';
  /** 每层括号：是不是子查询（括号后紧跟 SELECT） */
  const stack: boolean[] = [];
  const indentOf = () => '  '.repeat(stack.filter(Boolean).length);
  const flush = () => {
    if (line.trim()) lines.push(breakList(line.trimEnd(), indentOf()));
    line = '';
  };
  const tokens = tokenize(sql);
  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index]!;
    if (token === '(') {
      const next = tokens[index + 1]?.trimStart() ?? '';
      const subquery = /^(SELECT|WITH)\b/i.test(next);
      if (subquery) {
        line += '(';
        flush();
        stack.push(true);
        line = indentOf();
      } else {
        line += '(';
        stack.push(false);
      }
      continue;
    }
    if (token === ')') {
      const subquery = stack.pop();
      if (subquery) {
        flush();
        line = `${indentOf()})`;
      } else line += ')';
      continue;
    }
    if (token === ',' || /^['"`[]/.test(token)) {
      line += token;
      continue;
    }
    // 文字片段里可能有好几个子句：逐个切开。括号里的（函数参数、OVER 的 ORDER BY）不算，只有顶层与子查询里的才换行
    const inSubqueryOrTop = stack.length === 0 || stack[stack.length - 1] === true;
    let rest = token;
    while (rest) {
      const space = /^\s+/.exec(rest)?.[0] ?? '';
      const body = rest.slice(space.length);
      const clause = inSubqueryOrTop ? CLAUSE.exec(body) : null;
      // UPDATE 只在语句开头是子句：DO UPDATE、ON DUPLICATE KEY UPDATE 里是一个词
      const midUpdate =
        /^UPDATE$/i.test(clause?.[0] ?? '') && (lines.length > 0 || line.trim() !== '');
      if (clause && !midUpdate) {
        flush();
        line = indentOf() + clause[0].toUpperCase().replace(/\s+/g, ' ');
        rest = body.slice(clause[0].length);
        continue;
      }
      const word = /^\S+/.exec(body)?.[0] ?? '';
      line += space + word;
      rest = body.slice(word.length);
      if (!word && !body) break;
    }
  }
  flush();
  return lines.join('\n');
}

/** 把参数写成文字：bigint 不带 n，日期写成 ISO，字节写成十六进制 */
export function formatParams(params: readonly unknown[]): string {
  if (params.length === 0) return '';
  return JSON.stringify(params, (_key, value: unknown) => {
    if (typeof value === 'bigint') return value.toString();
    if (value instanceof Uint8Array)
      return `0x${Array.from(value, (byte) => byte.toString(16).padStart(2, '0')).join('')}`;
    return value;
  });
}

/**
 * 示例没发出语句、返回的是一组 SQL 文字（createTablesSql 这类只生成不执行的 API）时，这些文字就是要显示的语句，
 * 不算结果；返回 undefined 表示不是这种情况
 */
export function generatedStatements(
  executed: number,
  value: unknown,
): { sql: string; params: string }[] | undefined {
  if (executed > 0 || !Array.isArray(value) || value.length === 0) return undefined;
  if (!value.every((item) => typeof item === 'string')) return undefined;
  return value.map((sql: string) => ({ sql: formatSql(sql), params: '' }));
}

/** 把结果写成读得舒服的 JSON：bigint 写成数字的文字 */
export function formatResult(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  return JSON.stringify(
    value,
    (_key, item: unknown) => (typeof item === 'bigint' ? item.toString() : item),
    2,
  );
}
