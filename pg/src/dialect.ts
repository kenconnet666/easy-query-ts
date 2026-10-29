/** PostgreSQL 方言（不依赖驱动）：PG 与 PG 协议的兼容库（金仓、openGauss）共用 */
import { pgFunctions } from './functions.ts';
import {
  assembleTables,
  Dialect,
  type ColumnOptions,
  type DbTable,
  type FunctionRenderer,
  type Node,
  type QueryRunner,
  type SqlWriter,
} from '@zerodep-dev/easy-query-ts';

export class PostgresDialect extends Dialect {
  readonly name: string = 'postgres';
  /** PG 协议里参数个数是 16 位整数，最多 65535 */
  override readonly maxBindParams = 65535;
  override readonly generatedKeys = 'returning' as const;

  override placeholder(index: number): string {
    return `$${index}`;
  }

  /** CONCAT 是可变参数函数，推不出参数的类型：每项都转成 text */
  protected override functions(): Record<string, FunctionRenderer> {
    return {
      ...super.functions(),
      ...pgFunctions,
      concat: (a) => `CONCAT(${a.map((x) => `CAST(${x} AS text)`).join(', ')})`,
      // PG 的两参数 ROUND 只接受 numeric，double 列要先转
      round: (a) => `ROUND(CAST(${a[0]} AS NUMERIC), ${a[1]})`,
      date_trunc: (a) => `DATE_TRUNC(${a[1]}, ${a[0]})`,
      truncate: (a) => `TRUNC(CAST(${a[0]} AS NUMERIC), ${a[1]})`,
      log: (a) => `LOG(CAST(${a[1]} AS NUMERIC), CAST(${a[0]} AS NUMERIC))`,
      // 单参数 LOG 就是以 10 为底（LOG10 要 PG 12，openGauss 没有）
      log10: (a) => `LOG(${a[0]})`,
      cast_string: (a) => `CAST(${a[0]} AS TEXT)`,
      // PG 的 GREATEST / LEAST 本来就忽略 NULL，参数原样
      greatest: (a) => `GREATEST(${a.join(', ')})`,
      least: (a) => `LEAST(${a.join(', ')})`,
    };
  }

  /** PG 的 STRING_AGG 只接受文字 */
  protected override stringAgg(n: Extract<Node, { k: 'string_agg' }>, w: SqlWriter): string {
    return super.stringAgg(
      { ...n, e: { k: 'raw', parts: ['CAST(', ' AS TEXT)'], args: [n.e] } },
      w,
    );
  }

  override columnType(kind: string, o: ColumnOptions): string {
    if (o.dbType) return o.dbType;
    switch (kind) {
      case 'decimal':
        return `NUMERIC(${o.precision ?? 38}, ${o.scale ?? 10})`;
      case 'json':
        return 'JSONB';
      case 'bytes':
        return 'BYTEA';
      default:
        return super.columnType(kind, o);
    }
  }

  override readonly nullSafeEquals = 'IS NOT DISTINCT FROM';
  override readonly supportsReturning = true;
  override readonly transactionalDdl = true;

  /** 读库结构时判断自增列（pg_attribute 别名 a、pg_attrdef 别名 d）：IDENTITY 列或默认值取序列 */
  protected readonly introspectedIdentity: string = `a.attidentity <> '' OR coalesce(pg_get_expr(d.adbin, d.adrelid), '') LIKE 'nextval(%'`;

  /** 读系统目录（current_schema() 里的普通表与分区表） */
  override async introspect(run: QueryRunner): Promise<DbTable[]> {
    const tables = `SELECT c.oid, c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = current_schema() AND c.relkind IN ('r', 'p')`;
    return assembleTables({
      tables: await run(
        `SELECT t.relname AS table_name, obj_description(t.oid, 'pg_class') AS comment
         FROM (${tables}) t ORDER BY t.relname`,
      ),
      columns: await run(
        `SELECT t.relname AS table_name, a.attname AS column_name,
           format_type(a.atttypid, a.atttypmod) AS column_type, NOT a.attnotnull AS is_nullable,
           pg_get_expr(d.adbin, d.adrelid) AS column_default, col_description(t.oid, a.attnum) AS comment,
           ${this.introspectedIdentity} AS is_generated,
           EXISTS (SELECT 1 FROM pg_index i WHERE i.indrelid = t.oid AND i.indisprimary AND a.attnum = ANY (i.indkey)) AS primary_key
         FROM (${tables}) t JOIN pg_attribute a ON a.attrelid = t.oid
         LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
         WHERE a.attnum > 0 AND NOT a.attisdropped ORDER BY t.relname, a.attnum`,
      ),
      indexes: await run(
        `SELECT t.relname AS table_name, ic.relname AS index_name, i.indisunique AS is_unique, a.attname AS column_name
         FROM (${tables}) t JOIN pg_index i ON i.indrelid = t.oid AND NOT i.indisprimary
         JOIN pg_class ic ON ic.oid = i.indexrelid
         CROSS JOIN LATERAL unnest(i.indkey) WITH ORDINALITY k(attnum, ord)
         JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = k.attnum
         ORDER BY t.relname, ic.relname, k.ord`,
      ),
      foreignKeys: await run(
        `SELECT t.relname AS table_name, c.conname AS constraint_name, a.attname AS column_name,
           r.relname AS referenced_table, ra.attname AS referenced_column
         FROM (${tables}) t JOIN pg_constraint c ON c.conrelid = t.oid AND c.contype = 'f'
         JOIN pg_class r ON r.oid = c.confrelid
         CROSS JOIN generate_series(1, array_length(c.conkey, 1)) k(ord)
         JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = c.conkey[k.ord]
         JOIN pg_attribute ra ON ra.attrelid = r.oid AND ra.attnum = c.confkey[k.ord]
         ORDER BY t.relname, c.conname, k.ord`,
      ),
    });
  }

  /** CASE 分支里的字符串 / 数字 / 布尔参数 PG 推断不出类型（"could not determine data type of parameter"），加显式转换 */
  protected override caseValue(n: Node, w: SqlWriter): string {
    const sql = this.node(n, w);
    if (n.k !== 'param') return sql;
    const type =
      typeof n.value === 'string'
        ? 'TEXT'
        : typeof n.value === 'number'
          ? 'NUMERIC'
          : typeof n.value === 'boolean'
            ? 'BOOLEAN'
            : undefined;
    return type ? `CAST(${sql} AS ${type})` : sql;
  }

  /** PG 有布尔类型，不转 1 / 0 */
  override encodeParam(value: unknown): unknown {
    return typeof value === 'boolean' ? value : super.encodeParam(value);
  }
}
