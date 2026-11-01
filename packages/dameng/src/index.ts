/**
 * 达梦 DM8，驱动用官方的 dmdb。达梦兼容 Oracle 的大部分写法，方言继承 Oracle 方言后覆盖差异：
 * ```ts
 * import dmdb from 'dmdb'
 * const pool = await dmdb.createPool({ connectString: 'dm://SYSDBA:密码@host:5236?loginEncrypt=false' })
 * const db = createDb({ schema, adapter: dameng(pool) })
 * ```
 * 与 Oracle 相同：双引号、参数 :1、表别名不写 AS、MERGE、LISTAGG、USER_* 数据字典、匿名块、递归 CTE 不写 RECURSIVE。
 * 与 Oracle 不同：没有 SQL 的 BOOLEAN 与 JSON 类型（BIT、CLOB）、自增列是 IDENTITY(1, 1) 且写值要 SET IDENTITY_INSERT、
 * 多行 VALUES、有 TIME 类型、空字符串不是 NULL、没有 JSON_EXISTS / JSON_LENGTH / SYS_EXTRACT_UTC。
 * 只有 DM8 一个基线，不按版本分支。
 */
import dmdb from 'dmdb';
import {
  SqlWriter,
  standardJsonPath,
  unquoteSql,
  type Adapter,
  type Without,
  type ColumnOptions,
  type Driver,
  type ExecuteResult,
  type FunctionRenderer,
  type InsertNode,
  type Session,
  type TransactionOptions,
} from '@zerodep-dev/easy-query-ts';
import { OracleDialect } from '@zerodep-dev/easy-query-ts-oracle/dialect';

/** CASE 分支里参数要转成的类型（达梦的类型名） */
const CASE_TYPES: Record<string, string> = {
  int: 'INT',
  bigint: 'BIGINT',
  decimal: 'DECIMAL(38, 10)',
  double: 'DOUBLE',
  datetime: 'TIMESTAMP(3)',
  date: 'DATE',
  time: 'TIME(3)',
  json: 'CLOB',
  string: 'VARCHAR(4000)',
};

export class DamengDialect extends OracleDialect {
  override readonly name: string = 'dameng';
  protected override readonly caseTypes = CASE_TYPES;
  override readonly indexIfNotExists = true;
  override readonly dropIfExists = true;
  protected override readonly booleanValues = false;
  /** 多行 VALUES (…), (…)：一条语句，不用 Oracle 的匿名块 */
  override readonly maxInsertRows = 1000;

  constructor() {
    super();
  }

  /** 时间参数写成 CAST(:n AS TIME(3))（没有 TO_TIME） */
  override bindParam(value: unknown, w: SqlWriter): string {
    if (typeof value === 'string' && /^\d{2}:\d{2}:\d{2}\.\d{3}$/.test(value))
      return `CAST(${w.bind(this, value)} AS TIME(3))`;
    return super.bindParam(value, w);
  }

  // ---- 写入 ----

  /** 多行插入用标准的多行 VALUES；给自增列写了值时在同一个块里打开再关上 IDENTITY_INSERT */
  override insert(q: InsertNode, w: SqlWriter = new SqlWriter()): string {
    const sql =
      q.conflict || q.source || q.rows.length === 1
        ? super.insert(q, w)
        : `INSERT INTO ${this.table(q.table)} (${q.columns.map((c) => this.quote(c)).join(', ')}) VALUES ${q.rows
            .map((r) => `(${r.map((n) => this.node(n, w)).join(', ')})`)
            .join(', ')}`;
    if (!q.identityInsert) return sql;
    const table = this.table(q.table);
    return `BEGIN SET IDENTITY_INSERT ${table} ON; ${sql}; SET IDENTITY_INSERT ${table} OFF; END;`;
  }

  // ---- 函数 ----

  protected override functions(): Record<string, FunctionRenderer> {
    const base = super.functions();
    const seconds: Record<string, number> = { second: 1, minute: 60, hour: 3600, day: 86400 };
    return {
      ...base,
      // DATE 只有日期（不像 Oracle 带时分秒），日期运算不经过 CAST(… AS DATE)：用 DATEADD / DATEDIFF
      add_days: (a) => `DATEADD(DAY, ${a[1]}, ${a[0]})`,
      add_time: (a) => `DATEADD(${unquoteSql(a[2]!).toUpperCase()}, ${a[1]}, ${a[0]})`,
      diff_days: (a) => `DATEDIFF(DAY, ${a[1]}, ${a[0]})`,
      // 按经过的秒数整除（向零截断），与其它库一致
      diff_time: (a) => `TRUNC(DATEDIFF(SECOND, ${a[1]}, ${a[0]}) / ${seconds[unquoteSql(a[2]!)]})`,
      date_trunc: (a) =>
        unquoteSql(a[1]!) === 'second'
          ? `TO_TIMESTAMP(TO_CHAR(${a[0]}, 'YYYY-MM-DD HH24:MI:SS'), 'YYYY-MM-DD HH24:MI:SS')`
          : base['date_trunc']!(a),
      now: () => 'CAST(GETUTCDATE() AS TIMESTAMP(3))',
      json_number: (a) => `CAST(JSON_VALUE(${a[0]}, ${standardJsonPath(a[1]!)}) AS DOUBLE)`,
      // 没有 JSON_EXISTS：取得到对象、数组或标量就算有（值是 JSON 的 null 时与缺失一样）
      json_has: (a) =>
        `(JSON_QUERY(${a[0]}, ${standardJsonPath(a[1]!)} WITH CONDITIONAL WRAPPER) IS NOT NULL)`,
      // 没有 JSON_LENGTH：数组按 JSON_TABLE 展开后计数（FOR ORDINALITY、FORMAT JSON 的列放进子查询会报"不支持的语句类型"，取一个不存在的键当列）
      json_length: (a) =>
        `(SELECT COUNT(*) FROM JSON_TABLE(${a[0]}, ${standardJsonPath(a[1]!).replace(/'$/, "[*]'")} COLUMNS (eq_n VARCHAR(1) PATH '$.eq_none')))`,
      cast_string: (a) => `CAST(${a[0]} AS VARCHAR(4000))`,
      cast_int: (a) => `CAST(${a[0]} AS INT)`,
      cast_bigint: (a) => `CAST(${a[0]} AS BIGINT)`,
      cast_double: (a) => `CAST(${a[0]} AS DOUBLE)`,
    };
  }

  // ---- 建表 ----

  override columnType(kind: string, o: ColumnOptions): string {
    if (o.dbType) return o.dbType;
    switch (kind) {
      case 'string':
        return `VARCHAR(${o.length ?? 255})`;
      case 'int':
        return 'INT';
      case 'bigint':
        return 'BIGINT';
      case 'decimal':
        return `DECIMAL(${o.precision ?? 38}, ${o.scale ?? 10})`;
      case 'double':
        return 'DOUBLE';
      case 'boolean':
        return 'BIT';
      case 'time':
        return 'TIME(3)';
      case 'json':
        return 'CLOB';
      default:
        return super.columnType(kind, o);
    }
  }

  override createTableStart(ifNotExists: boolean): string {
    return ifNotExists ? 'CREATE TABLE IF NOT EXISTS' : 'CREATE TABLE';
  }

  override identity(): string {
    return 'IDENTITY(1, 1)';
  }

  protected override readonly introspectedType = `LOWER(c.data_type) || CASE
             WHEN c.data_type IN ('VARCHAR', 'VARCHAR2', 'CHAR', 'NVARCHAR') THEN '(' || c.char_length || ')'
             WHEN c.data_type IN ('DECIMAL', 'NUMBER', 'NUMERIC') AND c.data_precision IS NOT NULL THEN '(' || c.data_precision || ', ' || c.data_scale || ')'
             WHEN c.data_type IN ('TIMESTAMP', 'TIME') THEN '(' || c.data_scale || ')'
             ELSE '' END`;

  /** 自增列记在 SYSCOLUMNS.INFO2 的最低位 */
  protected override readonly introspectedIdentity = `(SELECT BITAND(sc.info2, 1) FROM syscolumns sc
             JOIN sysobjects so ON so.id = sc.id AND so.subtype$ = 'UTAB' AND so.schid = CURRENT_SCHID()
             WHERE so.name = c.table_name AND sc.name = c.column_name)`;
}

// ---- 驱动 ----

class DamengSession implements Session {
  protected readonly connection: () => Promise<{
    conn: dmdb.Connection;
    release: () => Promise<void>;
  }>;
  private readonly autoCommit: boolean;

  constructor(
    connection: () => Promise<{ conn: dmdb.Connection; release: () => Promise<void> }>,
    autoCommit: boolean,
  ) {
    this.connection = connection;
    this.autoCommit = autoCommit;
  }

  async query(sql: string, params: readonly unknown[]): Promise<Record<string, unknown>[]> {
    const { conn, release } = await this.connection();
    try {
      // INSERT … RETURNING 主键 INTO :eq_id：取输出变量当成一行返回
      if (/\bINTO :eq_id$/.test(sql)) {
        const result = await conn.execute(
          sql,
          [...params.map(bindValue), { dir: dmdb.BIND_OUT, type: dmdb.STRING }],
          { autoCommit: this.autoCommit },
        );
        const out = result.outBinds as unknown[];
        return [{ eq_id: out[out.length - 1] }];
      }
      const result = await conn.execute<Record<string, unknown>>(sql, params.map(bindValue), {
        outFormat: dmdb.OUT_FORMAT_OBJECT,
        autoCommit: this.autoCommit,
      });
      return result.rows ?? [];
    } finally {
      await release();
    }
  }

  async execute(sql: string, params: readonly unknown[]): Promise<ExecuteResult> {
    const { conn, release } = await this.connection();
    try {
      const result = await conn.execute(sql, params.map(bindValue), {
        autoCommit: this.autoCommit,
      });
      // 打开 IDENTITY_INSERT 的块：块不报告行数，成功就是插入的行数
      if (/^BEGIN SET IDENTITY_INSERT /.test(sql))
        return { affected: (sql.match(/\), \(/g)?.length ?? 0) + 1, insertId: undefined };
      return { affected: result.rowsAffected ?? 0, insertId: undefined };
    } finally {
      await release();
    }
  }
}

/** JS 值 → 绑定值：bigint 写成文字，Uint8Array 写成 Buffer */
function bindValue(value: unknown): unknown {
  if (typeof value === 'bigint') return value.toString();
  if (value instanceof Uint8Array && !Buffer.isBuffer(value)) return Buffer.from(value);
  return value;
}

const ISOLATION = {
  'read uncommitted': 'READ UNCOMMITTED',
  'read committed': 'READ COMMITTED',
  'repeatable read': 'SERIALIZABLE',
  serializable: 'SERIALIZABLE',
} as const;

class DamengDriver extends DamengSession implements Driver {
  private readonly pool: dmdb.Pool;

  constructor(pool: dmdb.Pool) {
    super(async () => {
      const conn = await pool.getConnection();
      return { conn, release: () => conn.close() };
    }, true);
    this.pool = pool;
  }

  async transaction<T>(
    work: (session: Session) => Promise<T>,
    options?: TransactionOptions,
  ): Promise<T> {
    const conn = await this.pool.getConnection();
    try {
      if (options?.readOnly) await conn.execute('SET TRANSACTION READ ONLY');
      else if (options?.isolation)
        await conn.execute(`SET TRANSACTION ISOLATION LEVEL ${ISOLATION[options.isolation]}`);
      try {
        const result = await work(
          new DamengSession(async () => ({ conn, release: async () => undefined }), false),
        );
        await conn.commit();
        return result;
      } catch (error) {
        await conn.rollback();
        throw error;
      }
    } finally {
      await conn.close();
    }
  }
}

/**
 * 连接池用 dmdb.createPool 建。会把 dmdb 的全局读取设置改成：日期时间、数字、CLOB 按文字读（时区、精度都不经过 JS 的转换，
 * 由列的 codec 解码），BLOB 按 Buffer 读
 */
export function dameng(pool: dmdb.Pool): Adapter<Without<'returning'>> {
  dmdb.fetchAsString = [dmdb.DATE, dmdb.NUMBER, dmdb.CLOB];
  dmdb.fetchAsBuffer = [dmdb.BLOB];
  return { dialect: new DamengDialect(), driver: new DamengDriver(pool) };
}
