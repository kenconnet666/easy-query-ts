import type { RenderedStatement } from './example';

/** 语句写成一段 SQL：几条之间空一行，参数写成注释 */
export function sqlText(statements: readonly RenderedStatement[]): string {
  return statements
    .map(({ sql, params }) => `${sql};${params ? `\n-- 参数：${params}` : ''}`)
    .join('\n\n');
}
