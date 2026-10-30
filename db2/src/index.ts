/**
 * IBM Db2（LUW 11.5 / 12.1），驱动用 ibm_db（ODBC，需要 IBM CLI 驱动）。
 * ```ts
 * import ibmdb from 'ibm_db'
 * const db = createDb({ schema, adapter: db2(new ibmdb.Pool(), 'DATABASE=eqts;HOSTNAME=…;PORT=50000;PROTOCOL=TCPIP;UID=…;PWD=…') })
 * ```
 * 双引号、参数 ?、OFFSET … FETCH 分页、IDENTITY 自增（插入后在同一条连接上取 IDENTITY_VAL_LOCAL()）、upsert 写成 MERGE、
 * 字符串列按字符计长（VARCHAR(n CODEUNITS32)）、读 SYSCAT 目录。
 */
import type { Database, ODBCResult, Pool } from 'ibm_db';
import {
  assembleTables,
  bareName,
  Dialect,
  dateFormatParts,
  SqlWriter,
  sqlString,
  standardJsonPath,
  unquoteSql,
  type Adapter,
  type ConflictNode,
  type DeleteNode,
  type ColumnOptions,
  type DatePart,
  type DbTable,
  type Driver,
  type ExecuteResult,
  type FunctionRenderer,
  type InsertNode,
  type Join,
  type Node,
  type QueryRunner,
  type SelectNode,
  type Session,
  type TransactionOptions,
  type UpdateNode,
} from '@zerodep-dev/easy-query-ts';

const SECONDS: Record<string, number> = { second: 1, minute: 60, hour: 3600, day: 86400 };

/** CASE 分支里参数要转成的类型（按列的种类） */
const CASE_TYPES: Record<string, string> = {
  int: 'INTEGER',
  bigint: 'BIGINT',
  decimal: 'DECIMAL(31, 10)',
  double: 'DOUBLE',
  boolean: 'BOOLEAN',
  datetime: 'TIMESTAMP(3)',
  date: 'DATE',
  time: 'TIME',
  json: 'CLOB',
  string: 'VARCHAR(4000)',
};

export class Db2Dialect extends Dialect {
  readonly name = 'db2';
  override readonly transactionalDdl = true;
  /** CREATE INDEX 没有 IF NOT EXISTS */
  override readonly indexIfNotExists = false;
  protected override readonly recursiveKeyword = '';
  /** 子查询里不能写 WITH：提到语句开头 */
  protected override readonly ctesAtTop = true;

  override limitOffset(limit: number | undefined, offset: number | undefined): string {
    if (limit === undefined && (offset === undefined || offset === 0)) return '';
    let s = offset ? ` OFFSET ${Math.trunc(offset)} ROWS` : '';
    if (limit !== undefined) s += ` FETCH NEXT ${Math.trunc(limit)} ROWS ONLY`;
    return s;
  }

  /** 递归 CTE 的递归成员不能有显式 join（SQL0345N）：内连接改成逗号连接，ON 的条件挪进 WHERE */
  override select(q: SelectNode, w: SqlWriter = new SqlWriter()): string {
    if (!q.ctes?.some((c) => c.recursive)) return super.select(q, w);
    const ctes = q.ctes.map((c) =>
      c.recursive
        ? { ...c, q: { ...c.q, unions: c.q.unions?.map((u) => ({ ...u, q: crossJoined(u.q) })) } }
        : c,
    );
    return super.select({ ...q, ctes }, w);
  }

  /** 全是 CROSS JOIN 时写成逗号连接（递归 CTE 的递归成员里连 CROSS JOIN 也不让写） */
  protected override joinClauses(joins: readonly Join[], w: SqlWriter): string {
    if (joins.length === 0 || joins.some((j) => j.kind !== 'cross'))
      return super.joinClauses(joins, w);
    return joins
      .map((j) => `, ${j.sub ? `(${this.select(j.sub, w)})` : this.table(j.table)} ${j.alias}`)
      .join('');
  }

  /** CASE 的分支、选出的值里参数推不出类型（SQL0418N）：按列的种类转成那一列的类型 */
  protected override caseValue(n: Node, w: SqlWriter): string {
    const sql = super.caseValue(n, w);
    if (n.k !== 'param') return sql;
    const type = n.codec
      ? CASE_TYPES[n.codec.kind]
      : typeof n.value === 'number'
        ? 'DOUBLE'
        : typeof n.value === 'string'
          ? 'VARCHAR(4000)'
          : undefined;
    return type ? `CAST(${sql} AS ${type})` : sql;
  }

  /** 没有条件的更新、删除会带一个"改动整张表"的警告（SQL0513W）：补上恒真的条件 */
  override update(q: UpdateNode, w: SqlWriter = new SqlWriter()): string {
    const sql = super.update(q, w);
    return q.where.length > 0 || q.joins?.length ? sql : `${sql} WHERE 1 = 1`;
  }

  override delete(q: DeleteNode, w: SqlWriter = new SqlWriter()): string {
    const sql = super.delete(q, w);
    return q.where.length > 0 || q.joins?.length ? sql : `${sql} WHERE 1 = 1`;
  }

  /** varchar(50 codeunits32) 与 VARCHAR(50 CODEUNITS32) 不算差异；字符单位不参与比较 */
  protected override normalizeType(type: string): string {
    return super.normalizeType(type.replace(/\s+codeunits32\)/i, ')'));
  }

  override forUpdate(wait?: 'nowait' | 'skip'): string {
    if (wait === 'nowait') throw new Error('FOR UPDATE NOWAIT is not supported by the db2 dialect');
    return wait === 'skip' ? ' FOR UPDATE SKIP LOCKED DATA' : ' FOR UPDATE WITH RS';
  }

  override releaseSavepoint(name: string): string {
    return `RELEASE SAVEPOINT ${name}`;
  }

  override savepoint(name: string): string {
    return `SAVEPOINT ${name} ON ROLLBACK RETAIN CURSORS`;
  }

  // ---- 写入 ----

  /** upsert 写成 MERGE … USING (VALUES …) */
  override insert(q: InsertNode, w: SqlWriter = new SqlWriter()): string {
    if (!q.conflict) return super.insert(q, w);
    return this.merge(q, q.conflict, w);
  }

  private merge(q: InsertNode, conflict: ConflictNode, w: SqlWriter): string {
    const cols = q.columns.map((c) => this.quote(c));
    const rows = q.rows.map((r) => `(${r.map((n) => this.node(n, w)).join(', ')})`).join(', ');
    const on = conflict.target
      .map((t) => `eq_t.${this.quote(t)} = eq_s.${this.quote(t)}`)
      .join(' AND ');
    let s = `MERGE INTO ${this.table(q.table)} AS eq_t USING (VALUES ${rows}) AS eq_s (${cols.join(', ')}) ON ${on}`;
    if (conflict.update.length > 0)
      s += ` WHEN MATCHED THEN UPDATE SET ${conflict.update.map((u) => `${this.quote(u)} = eq_s.${this.quote(u)}`).join(', ')}`;
    return `${s} WHEN NOT MATCHED THEN INSERT (${cols.join(', ')}) VALUES (${cols.map((c) => `eq_s.${c}`).join(', ')})`;
  }

  // ---- 函数 ----

  protected override functions(): Record<string, FunctionRenderer> {
    return {
      ...super.functions(),
      length: (a) => `CHARACTER_LENGTH(${a[0]}, CODEUNITS32)`,
      substring: (a) =>
        a[2] === undefined
          ? `SUBSTRING(${a[0]}, ${a[1]}, CODEUNITS32)`
          : `SUBSTRING(${a[0]}, ${a[1]}, ${a[2]}, CODEUNITS32)`,
      index_of: (a) => `(LOCATE(${a[1]}, ${a[0]}) - 1)`,
      // RIGHT 在 n 超过长度时补空格：按位置截取
      right: (a) =>
        `SUBSTRING(${a[0]}, GREATEST(CHARACTER_LENGTH(${a[0]}, CODEUNITS32) - ${a[1]} + 1, 1), CODEUNITS32)`,
      concat: (a) => `(${a.join(' || ')})`,
      ceil: (a) => `CEILING(${a[0]})`,
      log: (a) => `(LN(${a[0]}) / LN(${a[1]}))`,
      truncate: (a) => `TRUNCATE(${a[0]}, ${a[1]})`,
      add_days: (a) => `(${a[0]} + ${a[1]} DAYS)`,
      add_months: (a) => `(${a[0]} + ${a[1]} MONTHS)`,
      add_time: (a) => `(${a[0]} + ${a[1]} ${unquoteSql(a[2]!).toUpperCase()}S)`,
      diff_days: (a) => `(DAYS(CAST(${a[0]} AS TIMESTAMP)) - DAYS(CAST(${a[1]} AS TIMESTAMP)))`,
      // 按经过的秒数整除（向零截断），与其它库一致
      diff_time: (a) =>
        `((DAYS(${a[0]}) - DAYS(${a[1]})) * 86400 + MIDNIGHT_SECONDS(${a[0]}) - MIDNIGHT_SECONDS(${a[1]})) / ${SECONDS[unquoteSql(a[2]!)]}`,
      day_of_year: (a) => `DAYOFYEAR(${a[0]})`,
      day_of_week: (a) => `(DAYOFWEEK(${a[0]}) - 1)`,
      iso_day_of_week: (a) => `DAYOFWEEK_ISO(${a[0]})`,
      date_format: (a) => this.formatDate(a[0]!, dateFormatParts(unquoteSql(a[1]!))),
      date_trunc: (a) =>
        `CAST(TRUNC_TIMESTAMP(${a[0]}, ${sqlString({ year: 'YYYY', quarter: 'Q', month: 'MM', week: 'IW', day: 'DD', hour: 'HH', minute: 'MI', second: 'SS' }[unquoteSql(a[1]!)] ?? 'DD')}) AS TIMESTAMP(3))`,
      now: () => `CAST(CURRENT_TIMESTAMP - CURRENT_TIMEZONE AS TIMESTAMP(3))`,
      in_csv: (a) => `(',' || ${a[1]} || ',' LIKE '%,' || ${a[0]} || ',%')`,
      json_value: (a) => `JSON_QUERY(${a[0]}, ${db2JsonPath(a[1]!)} WITH CONDITIONAL WRAPPER)`,
      json_text: (a) => `JSON_VALUE(${a[0]}, ${db2JsonPath(a[1]!)})`,
      json_number: (a) => `JSON_VALUE(${a[0]}, ${db2JsonPath(a[1]!)} RETURNING DOUBLE)`,
      json_boolean: (a) =>
        `(CASE JSON_VALUE(${a[0]}, ${db2JsonPath(a[1]!)}) WHEN 'true' THEN 1 WHEN 'false' THEN 0 END)`,
      json_has: (a) => `JSON_EXISTS(${a[0]}, ${db2JsonPath(a[1]!)})`,
      // JSON_TABLE 的行路径只能是 'strict $'（不能从数组展开，也没有 NESTED）：数不了数组长度
      json_length: () => {
        throw new Error(
          'jsonLength is not supported by the db2 dialect (JSON_TABLE can only expand the root)',
        );
      },
      cast_string: (a) => `CAST(${a[0]} AS VARCHAR(4000))`,
      cast_double: (a) => `CAST(${a[0]} AS DOUBLE)`,
      cast_datetime: (a) => `CAST(${a[0]} AS TIMESTAMP(3))`,
    };
  }

  /** VARCHAR_FORMAT(值, 'YYYY') 等各部分拼起来 */
  protected override formatDate(value: string, parts: readonly DatePart[]): string {
    const tokens = { yyyy: 'YYYY', yy: 'YY', MM: 'MM', dd: 'DD', HH: 'HH24', mm: 'MI', ss: 'SS' };
    // VARCHAR_FORMAT 的格式里不能有其它文字：日期部分与文字分开写，再拼起来
    const pieces = parts.map((p) =>
      'token' in p ? `VARCHAR_FORMAT(${value}, ${sqlString(tokens[p.token])})` : sqlString(p.text),
    );
    return pieces.length === 1 ? pieces[0]! : `(${pieces.join(' || ')})`;
  }

  /** LISTAGG(e, 分隔符) WITHIN GROUP (ORDER BY …) */
  protected override stringAgg(n: Extract<Node, { k: 'string_agg' }>, w: SqlWriter): string {
    const order = this.aggOrder(n.order, w).trim();
    return `LISTAGG(${n.distinct ? 'DISTINCT ' : ''}${this.node(n.e, w)}, ${sqlString(n.separator)})${order ? ` WITHIN GROUP (${order})` : ''}`;
  }

  // ---- 建表 ----

  override columnType(kind: string, o: ColumnOptions): string {
    if (o.dbType) return o.dbType;
    switch (kind) {
      // 长度按字符算（默认按字节，中文一个字占 3 个字节）
      case 'string':
        return `VARCHAR(${o.length ?? 255} CODEUNITS32)`;
      case 'int':
        return 'INTEGER';
      case 'double':
        return 'DOUBLE';
      case 'time':
        return 'TIME';
      case 'json':
        return 'CLOB';
      case 'bytes':
        return 'BLOB';
      default:
        return super.columnType(kind, o);
    }
  }

  override createTableStart(ifNotExists: boolean): string {
    return ifNotExists ? 'CREATE TABLE IF NOT EXISTS' : 'CREATE TABLE';
  }

  override renameTable(from: string, to: string): string {
    return `RENAME TABLE ${this.table(from)} TO ${this.quote(bareName(to))}`;
  }

  /** SYSCAT 目录（当前模式） */
  override async introspect(run: QueryRunner): Promise<DbTable[]> {
    const schema = 'TABSCHEMA = CURRENT SCHEMA';
    return assembleTables({
      tables: await run(
        `SELECT TABNAME AS "table_name", REMARKS AS "comment" FROM SYSCAT.TABLES WHERE ${schema} AND TYPE = 'T' ORDER BY TABNAME`,
      ),
      columns: await run(
        `SELECT c.TABNAME AS "table_name", c.COLNAME AS "column_name",
           LOWER(c.TYPENAME) || CASE
             WHEN c.TYPENAME IN ('VARCHAR', 'CHARACTER') AND c.TYPESTRINGUNITS = 'CODEUNITS32' THEN '(' || c.STRINGUNITSLENGTH || ' codeunits32)'
             WHEN c.TYPENAME IN ('VARCHAR', 'CHARACTER') THEN '(' || c.LENGTH || ')'
             WHEN c.TYPENAME = 'DECIMAL' THEN '(' || c.LENGTH || ', ' || c.SCALE || ')'
             WHEN c.TYPENAME = 'TIMESTAMP' THEN '(' || c.SCALE || ')'
             ELSE '' END AS "column_type",
           CASE c.NULLS WHEN 'Y' THEN 1 ELSE 0 END AS "is_nullable", c."DEFAULT" AS "column_default", c.REMARKS AS "comment",
           CASE c.IDENTITY WHEN 'Y' THEN 1 ELSE 0 END AS "is_generated", CASE WHEN c.KEYSEQ IS NULL THEN 0 ELSE 1 END AS "primary_key"
         FROM SYSCAT.COLUMNS c WHERE c.${schema} ORDER BY c.TABNAME, c.COLNO`,
      ),
      indexes: await run(
        `SELECT i.TABNAME AS "table_name", i.INDNAME AS "index_name", CASE i.UNIQUERULE WHEN 'D' THEN 0 ELSE 1 END AS "is_unique",
           ic.COLNAME AS "column_name"
         FROM SYSCAT.INDEXES i JOIN SYSCAT.INDEXCOLUSE ic ON ic.INDSCHEMA = i.INDSCHEMA AND ic.INDNAME = i.INDNAME
         WHERE i.${schema} AND i.UNIQUERULE <> 'P' AND i.INDNAME NOT LIKE 'SQL%'
         ORDER BY i.TABNAME, i.INDNAME, ic.COLSEQ`,
      ),
      foreignKeys: await run(
        `SELECT r.TABNAME AS "table_name", r.CONSTNAME AS "constraint_name", k.COLNAME AS "column_name",
           r.REFTABNAME AS "referenced_table", rk.COLNAME AS "referenced_column"
         FROM SYSCAT.REFERENCES r
         JOIN SYSCAT.KEYCOLUSE k ON k.TABSCHEMA = r.TABSCHEMA AND k.CONSTNAME = r.CONSTNAME
         JOIN SYSCAT.KEYCOLUSE rk ON rk.TABSCHEMA = r.REFTABSCHEMA AND rk.CONSTNAME = r.REFKEYNAME AND rk.COLSEQ = k.COLSEQ
         WHERE r.${schema} ORDER BY r.TABNAME, r.CONSTNAME, k.COLSEQ`,
      ),
    });
  }
}

function crossJoined(q: SelectNode): SelectNode {
  if (!q.joins.every((j) => j.kind === 'inner' || j.kind === 'cross')) return q;
  return {
    ...q,
    joins: q.joins.map((j) => ({ ...j, kind: 'cross' as const, on: undefined })),
    where: [...q.joins.flatMap((j) => (j.on ? [j.on] : [])), ...q.where],
  };
}

/** JSON 路径：简单的键不加引号 */
function db2JsonPath(literal: string): string {
  return standardJsonPath(literal).replace(/\."([A-Za-z_][A-Za-z0-9_]*)"/g, '.$1');
}

// ---- 驱动 ----

/** JS 值 → 绑定值：bigint 写成文字，二进制标明 BLOB */
function bindValue(value: unknown): unknown {
  if (typeof value === 'bigint') return value.toString();
  // 二进制要标明 BLOB，否则 CLI 按字符串绑定（SQL0301N）
  if (value instanceof Uint8Array)
    return { ParamType: 'INPUT', DataType: 'BLOB', Data: Buffer.from(value) };
  return value;
}

/** SQLSTATE 01xxx 是警告（如递归 CTE 可能死循环的 SQL0347W）：驱动报成错误，但结果照常 */
function isWarning(error: unknown): boolean {
  const state = (error as { sqlstate?: unknown }).sqlstate;
  return typeof state === 'string' && state.startsWith('01');
}

class Db2Session implements Session {
  protected readonly connection: () => Promise<{ conn: Database; release: () => Promise<unknown> }>;

  constructor(connection: () => Promise<{ conn: Database; release: () => Promise<unknown> }>) {
    this.connection = connection;
  }

  async query(sql: string, params: readonly unknown[]): Promise<Record<string, unknown>[]> {
    const { conn, release } = await this.connection();
    try {
      // 预处理后执行再取全部行：带警告的执行照样拿到结果集（query() 遇到警告时结果是空的）
      const statement = await conn.prepare(sql);
      try {
        const result = await new Promise<ODBCResult>((resolve, reject) => {
          statement.execute(params.map(bindValue) as never, (error, res) => {
            if (error && !isWarning(error)) reject(error);
            else resolve(res!);
          });
        });
        try {
          return (await result.fetchAll()) as unknown as Record<string, unknown>[];
        } finally {
          result.closeSync();
        }
      } finally {
        await statement.close();
      }
    } finally {
      await release();
    }
  }

  /** 写入走预处理语句：executeNonQuery 报出影响的行数 */
  async execute(sql: string, params: readonly unknown[]): Promise<ExecuteResult> {
    const { conn, release } = await this.connection();
    try {
      const statement = await conn.prepare(sql);
      let affected: number;
      try {
        const run = statement.executeNonQuery.bind(statement) as (
          values: unknown[],
        ) => Promise<number>;
        affected = await run(params.map(bindValue)).catch((error: unknown) => {
          if (isWarning(error)) return 0;
          throw error;
        });
      } finally {
        await statement.close();
      }
      // 单行插入后取自增主键：同一条连接上的 IDENTITY_VAL_LOCAL()
      let insertId: number | undefined;
      if (/^INSERT INTO /.test(sql)) {
        const [row] = (await conn.query(
          'SELECT IDENTITY_VAL_LOCAL() AS "id" FROM SYSIBM.SYSDUMMY1',
        )) as { id: unknown }[];
        insertId = row?.id == null ? undefined : Number(row.id);
      }
      return { affected: Math.max(affected, 0), insertId };
    } finally {
      await release();
    }
  }
}

const ISOLATION = {
  'read uncommitted': 'UR',
  'read committed': 'CS',
  'repeatable read': 'RS',
  serializable: 'RR',
} as const;

class Db2Driver extends Db2Session implements Driver {
  private readonly pool: Pool;
  private readonly connectionString: string;

  constructor(pool: Pool, connectionString: string) {
    super(async () => {
      const conn = await pool.open(connectionString);
      return { conn, release: () => conn.close() };
    });
    this.pool = pool;
    this.connectionString = connectionString;
  }

  async transaction<T>(
    work: (session: Session) => Promise<T>,
    options?: TransactionOptions,
  ): Promise<T> {
    const conn = await this.pool.open(this.connectionString);
    try {
      if (options?.isolation)
        await conn.query(`SET CURRENT ISOLATION = ${ISOLATION[options.isolation]}`);
      await conn.beginTransaction();
      try {
        const result = await work(
          new Db2Session(async () => ({ conn, release: async () => undefined })),
        );
        await conn.commitTransaction();
        return result;
      } catch (error) {
        await conn.rollbackTransaction();
        throw error;
      }
    } finally {
      if (options?.isolation)
        await conn.query('SET CURRENT ISOLATION = RESET').catch(() => undefined);
      await conn.close();
    }
  }
}

/** pool 是 ibm_db 的 Pool；connectionString 是 CLI 连接串（DATABASE=…;HOSTNAME=…;PORT=…;UID=…;PWD=…） */
export function db2(pool: Pool, connectionString: string): Adapter {
  return { dialect: new Db2Dialect(), driver: new Db2Driver(pool, connectionString) };
}
