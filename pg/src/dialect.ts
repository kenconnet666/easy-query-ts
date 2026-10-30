/** PostgreSQL 方言（不依赖驱动）：PG 与 PG 协议的兼容库（金仓、openGauss）共用 */
import { pgFunctions } from './functions.ts';
import {
  assembleTables,
  Dialect,
  pgJsonPath,
  sqlString,
  type ColumnOptions,
  type DbTable,
  type Entity,
  type FunctionRenderer,
  type SelectNode,
  type InsertNode,
  type Node,
  type QueryRunner,
  SqlWriter,
} from '@zerodep-dev/easy-query-ts';

/**
 * 按文字读的类型 OID：日期时间（不经过驱动按本地时区解析）、int8 与 numeric（不丢精度），以及它们的数组
 * （数组字面量由 col.array 的 codec 解析）。各个 PG 驱动（pg、PGlite）共用
 */
export const TEXT_TYPE_OIDS: readonly number[] = [
  // date、time、timetz、timestamp、timestamptz
  1082, 1083, 1266, 1114, 1184,
  // int8、numeric
  20, 1700,
  // 上面这些的数组：date[]、time[]、timetz[]、timestamp[]、timestamptz[]、int8[]、numeric[]
  1182, 1183, 1270, 1115, 1185, 1016, 1231,
  // interval、interval[]（pg 默认解析成对象，这里保留 PG 输出的文字）
  1186, 1187,
];

/**
 * 一列的值 → PG 一维数组字面量的文字（unnest 批量插入用）：NULL 不加引号，别的一律加双引号、转义 \ 与 "；
 * 二进制写成 \x 十六进制（bytea 的文字写法），布尔写成 t / f
 */
function arrayLiteral(values: readonly unknown[]): string {
  const items = values.map((v) => {
    if (v === null || v === undefined) return 'NULL';
    const text =
      v instanceof Uint8Array
        ? `\\x${Buffer.from(v).toString('hex')}`
        : typeof v === 'boolean'
          ? v
            ? 't'
            : 'f'
          : // 编码之后只剩文字、数字、bigint
            String(v as string | number | bigint);
    return `"${text.replace(/["\\]/g, (c) => `\\${c}`)}"`;
  });
  return `{${items.join(',')}}`;
}

/** 实体里用到的 PG 原生枚举：类型名 → 取值；同名的类型在不同的列上取值不一样时报错 */
function nativeEnums(entities: readonly Entity[]): Map<string, readonly string[]> {
  const enums = new Map<string, readonly string[]>();
  for (const entity of entities)
    for (const [prop, column] of Object.entries(entity.columns)) {
      const { nativeEnum, enumValues } = column.options;
      if (typeof nativeEnum !== 'string' || !enumValues) continue;
      const seen = enums.get(nativeEnum);
      if (seen && seen.join('\u0000') !== enumValues.join('\u0000'))
        throw new Error(
          `enum type '${nativeEnum}' is declared with different values (${entity.name}.${prop})`,
        );
      enums.set(nativeEnum, enumValues);
    }
  return enums;
}

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
    if (o.nativeEnum === true)
      throw new Error("a native enum on PostgreSQL needs a type name: .native('mood')");
    if (o.nativeEnum) return this.quote(o.nativeEnum);
    switch (kind) {
      case 'uuid':
        return 'UUID';
      case 'interval':
        return 'INTERVAL';
      case 'array': {
        const element = o.element!;
        return `${this.columnType(element.codec.kind, element.options)}[]`;
      }
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

  /** 原生枚举（Column.native(typeName)）：建表前 CREATE TYPE，同步时 ALTER TYPE … ADD VALUE 补上新加的值 */
  override typeStatements(
    entities: readonly Entity[],
    existing?: ReadonlyMap<string, readonly string[]>,
  ): { statements: string[]; differences: string[] } {
    const statements: string[] = [];
    const differences: string[] = [];
    for (const [name, values] of nativeEnums(entities)) {
      const type = this.quote(name);
      const list = values.map(sqlString).join(', ');
      if (!existing) {
        // 建表（createTables、createTablesSql）时不读库：类型已在就跳过
        statements.push(
          `DO $$ BEGIN CREATE TYPE ${type} AS ENUM (${list}); EXCEPTION WHEN duplicate_object THEN NULL; END $$`,
        );
        continue;
      }
      const have = existing.get(name);
      if (!have) {
        statements.push(`CREATE TYPE ${type} AS ENUM (${list})`);
        continue;
      }
      for (const v of values)
        if (!have.includes(v)) statements.push(`ALTER TYPE ${type} ADD VALUE ${sqlString(v)}`);
      const extra = have.filter((v) => !values.includes(v));
      if (extra.length > 0)
        differences.push(
          `type ${name}: the database also has ${extra.map((v) => `'${v}'`).join(', ')} (PG cannot drop enum values)`,
        );
    }
    return { statements, differences };
  }

  override async introspectTypes(run: QueryRunner): Promise<Map<string, string[]>> {
    const rows = await run(
      `SELECT t.typname AS name, e.enumlabel AS value FROM pg_type t
       JOIN pg_enum e ON e.enumtypid = t.oid JOIN pg_namespace n ON n.oid = t.typnamespace
       WHERE n.nspname = current_schema() ORDER BY t.typname, e.enumsortorder`,
    );
    const types = new Map<string, string[]>();
    for (const r of rows) {
      const name = String(r['name']);
      types.set(name, [...(types.get(name) ?? []), String(r['value'])]);
    }
    return types;
  }

  override readonly nullSafeEquals = 'IS NOT DISTINCT FROM';
  override readonly supportsReturning = true;
  override readonly conditionalUpsert: boolean = true;
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
        `SELECT t.relname AS table_name, ic.relname AS index_name, i.indisunique AS is_unique,
           coalesce(a.attname, pg_get_indexdef(i.indexrelid, k.ord::int, true)) AS column_name
         FROM (${tables}) t JOIN pg_index i ON i.indrelid = t.oid AND NOT i.indisprimary
         JOIN pg_class ic ON ic.oid = i.indexrelid
         CROSS JOIN LATERAL unnest(i.indkey) WITH ORDINALITY k(attnum, ord)
         LEFT JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = k.attnum
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
  protected override likeIgnoreCase(e: string, pattern: string, not: boolean): string {
    return `${e} ${not ? 'NOT ' : ''}ILIKE ${pattern}${this.likeEscape()}`;
  }

  protected override distinctOn(keys: readonly string[]): string {
    return `DISTINCT ON (${keys.join(', ')}) `;
  }

  protected override rowLock(mode: SelectNode['lockMode'], wait: SelectNode['lockWait']): string {
    const strength =
      mode === 'share' ? 'SHARE' : mode === 'noKeyUpdate' ? 'NO KEY UPDATE' : 'UPDATE';
    return ` FOR ${strength}${wait === 'nowait' ? ' NOWAIT' : wait === 'skip' ? ' SKIP LOCKED' : ''}`;
  }

  override readonly indexFeatures = { using: true, partial: true, expressions: true };

  override explainStatement(sql: string, analyze: boolean): string {
    return `EXPLAIN (FORMAT JSON${analyze ? ', ANALYZE' : ''}) ${sql}`;
  }

  /** 一行一列 QUERY PLAN（json）：驱动可能已经解析成对象，也可能是文字 */
  override explainResult(rows: readonly Record<string, unknown>[]): unknown {
    const plan = rows[0]?.['QUERY PLAN'];
    return typeof plan === 'string' ? JSON.parse(plan) : plan;
  }

  /** 生成列只有 STORED（VIRTUAL 要 PG 18） */
  protected override generatedColumn(computed: NonNullable<ColumnOptions['computed']>): string {
    if (!computed.stored)
      throw new Error('PostgreSQL only has stored generated columns: drop { stored: false }');
    return `GENERATED ALWAYS AS (${computed.sql}) STORED`;
  }

  /** 一次插入 100 行起、值都是参数时用 unnest：每列一个数组参数，一条语句插完 */
  override readonly arrayInsertFrom: number | undefined = 100;

  /** INSERT … SELECT * FROM unnest(CAST($1 AS 类型[]), …)：数组参数按列的建表类型加类型 */
  override insert(q: InsertNode, w: SqlWriter = new SqlWriter()): string {
    if (!q.arrayColumns || q.source) return super.insert(q, w);
    const arrays = q.arrayColumns.map((c, i) => {
      // 自己拼成数组字面量的文字：不依赖驱动怎么序列化数组（PGlite 对不认识的数组类型直接 String() 了）
      const literal = arrayLiteral(q.rows.map((row) => this.paramValue(row[i]!)));
      return `CAST(${this.bindParam(literal, w)} AS ${this.columnType(c.kind, c.options)}[])`;
    });
    const alias = q.conflict?.where ? ` AS ${q.conflict.where.alias}` : '';
    const columns = q.columns.map((c) => this.quote(c)).join(', ');
    return `INSERT INTO ${this.table(q.table)}${alias} (${columns}) SELECT * FROM unnest(${arrays.join(', ')})${q.conflict ? this.onConflict(q.conflict, w) : ''}`;
  }

  /** jsonb_to_recordset 按声明的列把数组的对象展开成行；路径是空数组时就是文档本身 */
  protected override jsonSome(n: Extract<Node, { k: 'json_some' }>, w: SqlWriter): string {
    const doc = `CAST(${this.node(n.doc, w)} AS JSONB) #> ${pgJsonPath(n.path)}`;
    const columns = n.columns
      .map((c) => `${this.quote(c.name)} ${this.columnType(c.kind, c.options)}`)
      .join(', ');
    return `EXISTS (SELECT 1 FROM jsonb_to_recordset(${doc}) AS eq_j(${columns}) WHERE ${this.condition(n.cond, w)})`;
  }

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
  override encodeParam(value: unknown, kind?: string): unknown {
    return typeof value === 'boolean' ? value : super.encodeParam(value, kind);
  }
}
