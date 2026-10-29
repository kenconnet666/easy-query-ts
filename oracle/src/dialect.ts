/** Oracle 方言（不依赖驱动）：Oracle 包与 Oracle 兼容的库（达梦）共用 */
import {
  assembleTables,
  bareName,
  dateFormatParts,
  Dialect,
  SqlWriter,
  standardJsonPath,
  unquoteSql,
  type ColumnOptions,
  type ConflictNode,
  type DbTable,
  type DeleteNode,
  type DialectOptions,
  type FunctionRenderer,
  type InsertNode,
  type Node,
  type QueryRunner,
  type SelectNode,
  type UpdateNode,
} from '@zerodep-dev/easy-query-ts';

/** 支持的服务器版本 */
export type OracleVersion = '11.2' | '12.1' | '12.2' | '18' | '19' | '21' | '23';

/** CASE 分支里参数要转成的类型（按列的种类） */
const CASE_TYPES: Record<string, string> = {
  int: 'NUMBER',
  bigint: 'NUMBER',
  decimal: 'NUMBER',
  double: 'BINARY_DOUBLE',
  datetime: 'TIMESTAMP(3)',
  date: 'DATE',
  json: 'JSON',
  string: 'VARCHAR2(4000)',
};

const SECONDS: Record<string, number> = { second: 1, minute: 60, hour: 3600, day: 86400 };

export class OracleDialect extends Dialect {
  readonly name: string = 'oracle';
  /** CASE 分支里参数要转成的类型（Oracle 兼容的库按自己的类型名覆盖） */
  protected readonly caseTypes: Record<string, string> = CASE_TYPES;
  /** Oracle 一条语句最多 65535 个绑定变量；IN 列表最多 1000 项另由核心切分 */
  override readonly maxBindParams = 65535;
  override readonly indexIfNotExists: boolean;
  override readonly dropIfExists: boolean;
  /** Oracle 的 DDL 会隐式提交 */
  override readonly transactionalDdl = false;
  protected override readonly recursiveKeyword = '';
  protected override readonly ctesAtTop = true;
  /** 23ai 起有 SQL 的 BOOLEAN：条件能当值、布尔列能当条件 */
  protected override readonly booleanValues: boolean;

  constructor(options: DialectOptions = {}) {
    super(options);
    // 23ai 起有 IF [NOT] EXISTS
    this.indexIfNotExists = this.atLeast('23');
    this.dropIfExists = this.atLeast('23');
    this.booleanValues = this.atLeast('23');
  }

  override placeholder(index: number): string {
    return `:${index}`;
  }

  override likeEscape(): string {
    return " ESCAPE '\\'";
  }

  /**
   * 带毫秒的日期时间文字（核心按 UTC 编码的写法）写成 TO_TIMESTAMP(:n, …)：NLS_DATE_FORMAT 认不得小数秒，
   * 放进 DATE 的上下文、CASE 的分支时隐式转换会失败
   */
  override bindParam(value: unknown, w: SqlWriter): string {
    if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3}$/.test(value))
      return `TO_TIMESTAMP(${w.bind(this, value)}, 'YYYY-MM-DD HH24:MI:SS.FF3')`;
    return super.bindParam(value, w);
  }

  /** CASE 的各分支要同一个类型（NULL 的绑定变量默认是 CHAR）：参数按列的种类转成那一列的类型 */
  protected override caseValue(n: Node, w: SqlWriter): string {
    const sql = super.caseValue(n, w);
    if (n.k !== 'param' || !n.codec) return sql;
    const type = this.caseTypes[n.codec.kind];
    return type ? `CAST(${sql} AS ${type})` : sql;
  }

  /** 没有 SQL 的 BOOLEAN 时（23ai 之前）布尔写成 1 / 0 */
  override encodeParam(value: unknown): unknown {
    if (typeof value === 'boolean') return this.booleanValues ? value : value ? 1 : 0;
    return super.encodeParam(value);
  }

  // ---- 查询 ----

  /** 12c 起 OFFSET … FETCH */
  override limitOffset(limit: number | undefined, offset: number | undefined): string {
    if (limit === undefined && (offset === undefined || offset === 0)) return '';
    let s = offset ? ` OFFSET ${Math.trunc(offset)} ROWS` : '';
    if (limit !== undefined) s += ` FETCH NEXT ${Math.trunc(limit)} ROWS ONLY`;
    return s;
  }

  override select(q: SelectNode, w: SqlWriter = new SqlWriter()): string {
    if (!this.atLeast('12.1') && (q.limit !== undefined || (q.offset ?? 0) > 0))
      return this.rownumPage(q, w);
    return super.select(q, w);
  }

  /** 12c 之前：SELECT 列 FROM (SELECT eq_a.*, ROWNUM eq_rn FROM (原查询) eq_a WHERE ROWNUM <= 上界) WHERE eq_rn > 偏移 */
  private rownumPage(q: SelectNode, w: SqlWriter): string {
    const offset = Math.trunc(q.offset ?? 0);
    const inner = super.select({ ...q, limit: undefined, offset: undefined }, w);
    const bound = q.limit === undefined ? '' : ` WHERE ROWNUM <= ${offset + Math.trunc(q.limit)}`;
    const columns = q.columns.map((c) => this.quote(c.as)).join(', ') || '*';
    return `SELECT ${columns} FROM (SELECT eq_a.*, ROWNUM eq_rn FROM (${inner}) eq_a${bound}) WHERE eq_rn > ${offset} ORDER BY eq_rn`;
  }

  // ---- 写入 ----

  /** 表别名不写 AS；带导航的 join 用核心的"按主键自连接"写法（UPDATE … WHERE EXISTS 由子类改写） */
  override update(q: UpdateNode, w: SqlWriter = new SqlWriter()): string {
    const joins = q.joins ?? [];
    if (joins.length === 0) {
      const set = q.set.map((s) => `${this.quote(s.column)} = ${this.value(s.e, w)}`).join(', ');
      let s = `UPDATE ${this.table(q.from.table)} ${q.from.alias} SET ${set}`;
      if (q.where.length > 0) s += ` WHERE ${this.conjunction(q.where, w)}`;
      return s;
    }
    // 没有 UPDATE … FROM：按主键自连接，新值写成多列子查询，范围写成 EXISTS（join 的条件、参数在两处各渲染一次，顺序与文字一致）
    const self = `${q.from.alias}_w`;
    const same = (q.key ?? [])
      .map((k) => `${self}.${this.quote(k)} = ${q.from.alias}.${this.quote(k)}`)
      .join(' AND ');
    if (!same)
      throw new Error(`update through a navigation needs a primary key on ${q.from.table}`);
    const from = () => `${this.table(q.from.table)} ${q.from.alias}${this.joinClauses(joins, w)}`;
    const columns = q.set.map((c) => this.quote(c.column)).join(', ');
    const values = q.set.map((c) => this.value(c.e, w)).join(', ');
    const source = from();
    const scope = from();
    const where = q.where.length > 0 ? ` AND ${this.conjunction(q.where, w)}` : '';
    return `UPDATE ${this.table(q.from.table)} ${self} SET (${columns}) = (SELECT ${values} FROM ${source} WHERE ${same}) WHERE EXISTS (SELECT 1 FROM ${scope} WHERE ${same}${where})`;
  }

  override delete(q: DeleteNode, w: SqlWriter = new SqlWriter()): string {
    if (!q.joins?.length) {
      let s = `DELETE FROM ${this.table(q.from.table)} ${q.from.alias}`;
      if (q.where.length > 0) s += ` WHERE ${this.conjunction(q.where, w)}`;
      return s;
    }
    const self = `${q.from.alias}_w`;
    const from = `${this.table(q.from.table)} ${q.from.alias}${this.joinClauses(q.joins, w)}`;
    const keys = (q.key ?? []).map(
      (k) => `${self}.${this.quote(k)} = ${q.from.alias}.${this.quote(k)}`,
    );
    const where = [...keys, ...(q.where.length > 0 ? [this.conjunction(q.where, w)] : [])].join(
      ' AND ',
    );
    return `DELETE FROM ${this.table(q.from.table)} ${self} WHERE EXISTS (SELECT 1 FROM ${from} WHERE ${where})`;
  }

  /**
   * 多行插入写成一个匿名块里的逐行 INSERT（一次往返）：INSERT ALL 对自增列只生成一次值，23ai 的多行 VALUES
   * 按第一行推断绑定变量的类型（数字文字进 NUMBER 列会失败）。一块最多 500 行，免得块太大编译慢
   */
  override readonly maxInsertRows: number = 500;

  /** upsert 写成 MERGE … USING (SELECT … FROM DUAL) */
  override insert(q: InsertNode, w: SqlWriter = new SqlWriter()): string {
    if (q.conflict) return this.merge(q, q.conflict, w);
    if (q.source || q.rows.length === 1) return super.insert(q, w);
    const rows = q.rows.map((r) => super.insert({ ...q, rows: [r] }, w));
    return `BEGIN ${rows.join('; ')}; END;`;
  }

  private merge(q: InsertNode, conflict: ConflictNode, w: SqlWriter): string {
    const cols = q.columns.map((c) => this.quote(c));
    const source = q.rows
      .map(
        (r) => `SELECT ${r.map((n, i) => `${this.node(n, w)} AS ${cols[i]}`).join(', ')} FROM DUAL`,
      )
      .join(' UNION ALL ');
    const on = conflict.target
      .map((t) => `eq_t.${this.quote(t)} = eq_s.${this.quote(t)}`)
      .join(' AND ');
    let s = `MERGE INTO ${this.table(q.table)} eq_t USING (${source}) eq_s ON (${on})`;
    if (conflict.update.length > 0)
      s += ` WHEN MATCHED THEN UPDATE SET ${conflict.update.map((u) => `eq_t.${this.quote(u)} = eq_s.${this.quote(u)}`).join(', ')}`;
    return `${s} WHEN NOT MATCHED THEN INSERT (${cols.join(', ')}) VALUES (${cols.map((c) => `eq_s.${c}`).join(', ')})`;
  }

  /** 单行插入取自增主键：RETURNING 主键 INTO 输出变量（驱动认 :eq_id） */
  override readonly generatedKeys = 'returning';

  override returning(column: string): string {
    return ` RETURNING ${this.quote(column)} INTO :eq_id`;
  }

  override releaseSavepoint(): string | undefined {
    return undefined;
  }

  // ---- 函数 ----

  protected override functions(): Record<string, FunctionRenderer> {
    return {
      ...super.functions(),
      length: (a) => `LENGTH(${a[0]})`,
      concat: (a) => `(${a.map((x) => `${x}`).join(' || ')})`,
      substring: (a) => `SUBSTR(${a.join(', ')})`,
      index_of: (a) => `(INSTR(${a[0]}, ${a[1]}) - 1)`,
      left: (a) => `SUBSTR(${a[0]}, 1, ${a[1]})`,
      right: (a) => `SUBSTR(${a[0]}, -LEAST(${a[1]}, LENGTH(${a[0]})))`,
      ceil: (a) => `CEIL(${a[0]})`,
      log10: (a) => `LOG(10, ${a[0]})`,
      log: (a) => `LOG(${a[1]}, ${a[0]})`,
      atan2: (a) => `ATAN2(${a[0]}, ${a[1]})`,
      add_days: (a) => `(${a[0]} + NUMTODSINTERVAL(${a[1]}, 'DAY'))`,
      add_months: (a) => `ADD_MONTHS(${a[0]}, ${a[1]})`,
      diff_days: (a) => `(TRUNC(CAST(${a[0]} AS DATE)) - TRUNC(CAST(${a[1]} AS DATE)))`,
      // 年、月是 YEAR TO MONTH 的区间，其余是 DAY TO SECOND
      add_time: (a) => {
        const unit = unquoteSql(a[2]!).toUpperCase();
        const fn = unit === 'YEAR' || unit === 'MONTH' ? 'NUMTOYMINTERVAL' : 'NUMTODSINTERVAL';
        return `(${a[0]} + ${fn}(${a[1]}, '${unit}'))`;
      },
      diff_time: (a) =>
        `TRUNC((CAST(${a[0]} AS DATE) - CAST(${a[1]} AS DATE)) * 86400 / ${SECONDS[unquoteSql(a[2]!)]})`,
      hour: (a) => `EXTRACT(HOUR FROM CAST(${a[0]} AS TIMESTAMP))`,
      minute: (a) => `EXTRACT(MINUTE FROM CAST(${a[0]} AS TIMESTAMP))`,
      second: (a) => `TRUNC(EXTRACT(SECOND FROM CAST(${a[0]} AS TIMESTAMP)))`,
      day_of_year: (a) => `TO_NUMBER(TO_CHAR(${a[0]}, 'DDD'))`,
      // 与 NLS_TERRITORY 无关的星期：相对一个已知的星期日算
      day_of_week: (a) => `MOD(TRUNC(${a[0]}) - DATE '1970-01-04', 7)`,
      iso_day_of_week: (a) => `(MOD(TRUNC(${a[0]}) - DATE '1970-01-05', 7) + 1)`,
      date_format: (a) => this.formatDate(a[0]!, dateFormatParts(unquoteSql(a[1]!))),
      date_trunc: (a) => this.dateTrunc(a[0]!, unquoteSql(a[1]!)),
      now: () => `SYS_EXTRACT_UTC(SYSTIMESTAMP)`,
      in_csv: (a) => `(',' || ${a[1]} || ',' LIKE '%,' || ${a[0]} || ',%')`,
      truncate: (a) => `TRUNC(${a[0]}, ${a[1]})`,
      json_value: (a) => `JSON_QUERY(${a[0]}, ${standardJsonPath(a[1]!)} WITH CONDITIONAL WRAPPER)`,
      json_text: (a) => `JSON_VALUE(${a[0]}, ${standardJsonPath(a[1]!)})`,
      json_number: (a) => `JSON_VALUE(${a[0]}, ${standardJsonPath(a[1]!)} RETURNING BINARY_DOUBLE)`,
      json_boolean: (a) =>
        `(CASE JSON_VALUE(${a[0]}, ${standardJsonPath(a[1]!)}) WHEN 'true' THEN 1 WHEN 'false' THEN 0 END)`,
      json_has: (a) => `JSON_EXISTS(${a[0]}, ${standardJsonPath(a[1]!)})`,
      json_length: (a) =>
        `JSON_VALUE(${a[0]}, ${standardJsonPath(a[1]!).replace(/'$/, ".size()'")})`,
      cast_string: (a) => `CAST(${a[0]} AS VARCHAR2(4000))`,
      cast_int: (a) => `CAST(${a[0]} AS NUMBER(10))`,
      cast_bigint: (a) => `CAST(${a[0]} AS NUMBER(19))`,
      cast_double: (a) => `CAST(${a[0]} AS BINARY_DOUBLE)`,
      cast_datetime: (a) => `CAST(${a[0]} AS TIMESTAMP(3))`,
    };
  }

  private dateTrunc(x: string, unit: string): string {
    const format = {
      year: 'YYYY',
      quarter: 'Q',
      month: 'MM',
      week: 'IW',
      day: 'DD',
      hour: 'HH24',
      minute: 'MI',
    }[unit];
    if (!format) return `CAST(CAST(${x} AS DATE) AS TIMESTAMP(3))`;
    return `CAST(TRUNC(${x}, '${format}') AS TIMESTAMP(3))`;
  }

  /** LISTAGG(e, 分隔符) WITHIN GROUP (ORDER BY …)；DISTINCT 要 19c */
  protected override stringAgg(n: Extract<Node, { k: 'string_agg' }>, w: SqlWriter): string {
    if (n.distinct) this.requires('LISTAGG(DISTINCT …)', '19');
    const order = this.aggOrder(n.order, w).trim() || 'ORDER BY NULL';
    return `LISTAGG(${n.distinct ? 'DISTINCT ' : ''}${this.node(n.e, w)}, '${n.separator.replaceAll("'", "''")}') WITHIN GROUP (${order})`;
  }

  // ---- 建表 ----

  override columnType(kind: string, o: ColumnOptions): string {
    if (o.dbType) return o.dbType;
    switch (kind) {
      case 'string':
        return `VARCHAR2(${o.length ?? 255} CHAR)`;
      case 'int':
        return 'NUMBER(10)';
      case 'bigint':
        return 'NUMBER(19)';
      case 'decimal':
        return `NUMBER(${o.precision ?? 38}, ${o.scale ?? 10})`;
      case 'double':
        return 'BINARY_DOUBLE';
      case 'boolean':
        return this.atLeast('23') ? 'BOOLEAN' : 'NUMBER(1)';
      case 'time':
        return 'VARCHAR2(12)';
      case 'datetime':
        return 'TIMESTAMP(3)';
      case 'json':
        return this.atLeast('21') ? 'JSON' : 'CLOB';
      case 'bytes':
        return 'BLOB';
      default:
        return super.columnType(kind, o);
    }
  }

  override createTableStart(ifNotExists: boolean): string {
    return ifNotExists && this.atLeast('23') ? 'CREATE TABLE IF NOT EXISTS' : 'CREATE TABLE';
  }

  /** DEFAULT 要写在 NOT NULL 前面 */
  override columnDefinition(name: string, kind: string, o: ColumnOptions): string {
    return [
      this.quote(name),
      this.columnType(kind, o),
      o.generated ? this.identity() : undefined,
      o.dbDefault !== undefined ? `DEFAULT ${o.dbDefault}` : undefined,
      o.nullable ? undefined : 'NOT NULL',
    ]
      .filter(Boolean)
      .join(' ');
  }

  override identity(): string {
    this.requires('IDENTITY columns', '12.1');
    return 'GENERATED BY DEFAULT ON NULL AS IDENTITY';
  }

  override addColumn(table: string, name: string, kind: string, o: ColumnOptions): string {
    return `ALTER TABLE ${this.table(table)} ADD (${this.columnDefinition(name, kind, o)})`;
  }

  /** 读库结构时列类型的写法（user_tab_columns 别名 c），与 columnType 的输出对得上 */
  protected readonly introspectedType: string = `LOWER(c.data_type) || CASE
             WHEN c.data_type IN ('VARCHAR2', 'NVARCHAR2', 'CHAR', 'NCHAR') THEN '(' || c.char_length || CASE c.char_used WHEN 'C' THEN ' char' ELSE '' END || ')'
             WHEN c.data_type = 'NUMBER' AND c.data_precision IS NOT NULL THEN '(' || c.data_precision || CASE WHEN c.data_scale > 0 THEN ', ' || c.data_scale ELSE '' END || ')'
             ELSE '' END`;

  /** 读库结构时判断自增列（1 / 0） */
  protected readonly introspectedIdentity: string = `CASE c.identity_column WHEN 'YES' THEN 1 ELSE 0 END`;

  /** USER_* 数据字典（当前用户的表） */
  override async introspect(run: QueryRunner): Promise<DbTable[]> {
    return assembleTables({
      tables: await run(
        `SELECT t.table_name AS "table_name", c.comments AS "comment" FROM user_tables t
         LEFT JOIN user_tab_comments c ON c.table_name = t.table_name ORDER BY t.table_name`,
      ),
      columns: await run(
        `SELECT c.table_name AS "table_name", c.column_name AS "column_name",
           ${this.introspectedType} AS "column_type",
           CASE c.nullable WHEN 'Y' THEN 1 ELSE 0 END AS "is_nullable", c.data_default AS "column_default",
           m.comments AS "comment", ${this.introspectedIdentity} AS "is_generated",
           CASE WHEN EXISTS (SELECT 1 FROM user_constraints k JOIN user_cons_columns kc ON kc.constraint_name = k.constraint_name
             WHERE k.constraint_type = 'P' AND k.table_name = c.table_name AND kc.column_name = c.column_name) THEN 1 ELSE 0 END AS "primary_key"
         FROM user_tab_columns c
         LEFT JOIN user_col_comments m ON m.table_name = c.table_name AND m.column_name = c.column_name
         ORDER BY c.table_name, c.column_id`,
      ),
      indexes: await run(
        `SELECT i.table_name AS "table_name", i.index_name AS "index_name", CASE i.uniqueness WHEN 'UNIQUE' THEN 1 ELSE 0 END AS "is_unique",
           ic.column_name AS "column_name"
         FROM user_indexes i JOIN user_ind_columns ic ON ic.index_name = i.index_name
         WHERE NOT EXISTS (SELECT 1 FROM user_constraints k WHERE k.index_name = i.index_name AND k.constraint_type = 'P')
         ORDER BY i.table_name, i.index_name, ic.column_position`,
      ),
      foreignKeys: await run(
        `SELECT k.table_name AS "table_name", k.constraint_name AS "constraint_name", kc.column_name AS "column_name",
           r.table_name AS "referenced_table", rc.column_name AS "referenced_column"
         FROM user_constraints k JOIN user_cons_columns kc ON kc.constraint_name = k.constraint_name
         JOIN user_constraints r ON r.constraint_name = k.r_constraint_name
         JOIN user_cons_columns rc ON rc.constraint_name = r.constraint_name AND rc.position = kc.position
         WHERE k.constraint_type = 'R' ORDER BY k.table_name, k.constraint_name, kc.position`,
      ),
    });
  }

  /** varchar2(50 char) 与 VARCHAR2(50 CHAR)、number(10) 等写法不算差异 */
  protected override normalizeType(type: string): string {
    return super.normalizeType(type);
  }

  override renameTable(from: string, to: string): string {
    return `ALTER TABLE ${this.table(from)} RENAME TO ${this.quote(bareName(to))}`;
  }
}
