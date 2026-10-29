/**
 * SQL Server 专属函数：生成带 {@code sqlserver.} 前缀的函数节点，只有 SQL Server 方言的函数表认得；
 * 用在别的方言上 toSQL 时报 "function 'sqlserver.contains' is not supported by the postgres dialect"。
 * ```ts
 * db.queryable(Post).where(p => MsSql.contains(p.title, '"orm*"'))   // 要有全文索引
 * ```
 */
import {
  codecs,
  dialectFn,
  type Expr,
  type FunctionRenderer,
  type Pred,
} from '@zerodep-dev/easy-query-ts';

const fn = (name: string, args: unknown[]): Pred => dialectFn<boolean>(name, args, codecs.boolean);

export const MsSql = {
  /** 全文检索的谓词：{@code CONTAINS(col, ?)}，query 是全文检索的语法（"orm*"、NEAR …），要有全文索引 */
  contains: (column: Expr<string | null>, query: string) =>
    fn('sqlserver.contains', [column, query]),
  /** 按意思匹配：{@code FREETEXT(col, ?)}，要有全文索引 */
  freetext: (column: Expr<string | null>, text: string) => fn('sqlserver.freetext', [column, text]),
  /** 字符串的字节数（含尾部空格，LEN 不含）：{@code DATALENGTH(col)} */
  dataLength: (column: Expr<unknown>) =>
    dialectFn<number>('sqlserver.datalength', [column], codecs.int),
};

export const msSqlFunctions: Record<string, FunctionRenderer> = {
  'sqlserver.contains': (a) => `CONTAINS(${a[0]}, ${a[1]})`,
  'sqlserver.freetext': (a) => `FREETEXT(${a[0]}, ${a[1]})`,
  'sqlserver.datalength': (a) => `DATALENGTH(${a[0]})`,
};
