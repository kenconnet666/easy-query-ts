/**
 * SQL Server，驱动用 mssql（tedious，纯 JS）。按服务器版本渲染：
 * ```ts
 * import sql from 'mssql'
 * const pool = await new sql.ConnectionPool({ server, user, password, database, options: { trustServerCertificate: true } }).connect()
 * const db = createDb({ schema, adapter: mssql(pool) })                    // 默认按最新（2022）
 * const old = createDb({ schema, adapter: mssql(pool, { version: 2008 }) }) // 2008 R2：ROW_NUMBER 分页、没有 STRING_AGG 等
 * ```
 * 版本门槛（低于时退回旧写法，没有旧写法就报错并说明要哪个版本）：
 * - 2012：OFFSET … FETCH 分页（之前用 ROW_NUMBER() 包一层）、CONCAT、IIF、FORMAT
 * - 2016：DROP TABLE IF EXISTS、JSON_VALUE / JSON_QUERY / OPENJSON
 * - 2017：STRING_AGG、TRIM
 * - 2022：GREATEST / LEAST、IS [NOT] DISTINCT FROM、DATETRUNC、JSON_PATH_EXISTS
 * 与其它库的差异：比较等条件不能直接当值（select 里写成 CASE WHEN … THEN 1 ELSE 0 END），布尔列当条件写成 `= 1`；
 * 行锁是表提示 WITH (UPDLOCK, ROWLOCK)；RETURNING 不支持（自增主键用 SCOPE_IDENTITY()）；表与列注释不写（扩展属性不做）。
 */
import sql from 'mssql';
import {
  assembleTables,
  bareName,
  dateFormatParts,
  Dialect,
  SqlWriter,
  standardJsonPath,
  unquoteSql,
  type Adapter,
  type ColumnOptions,
  type ConflictNode,
  type DatePart,
  type DbTable,
  type DeleteNode,
  type DialectOptions,
  type Driver,
  type Entity,
  type ExecuteResult,
  type FunctionRenderer,
  type InsertNode,
  type Node,
  type QueryRunner,
  type SelectNode,
  type Session,
  type TransactionOptions,
  type UpdateNode,
} from '@zerodep-dev/easy-query-ts';
import { msSqlFunctions } from './functions.ts';

export { MsSql } from './functions.ts';

/** 支持的服务器版本（主版本年份） */
export type SqlServerVersion = 2008 | 2012 | 2014 | 2016 | 2017 | 2019 | 2022 | 2025;

/** 本身就是条件（不能直接当值、能直接放进 WHERE）的节点 */
const CONDITIONS = new Set([
  'and',
  'or',
  'not',
  'null',
  'in',
  'in_sub',
  'between',
  'like',
  'exists',
  'eq_ns',
]);
const COMPARISONS = new Set(['=', '<>', '!=', '<', '<=', '>', '>=']);

/** 渲染出来是条件的函数 */
const CONDITION_FNS = new Set(['in_csv', 'json_has', 'sqlserver.contains', 'sqlserver.freetext']);

function isCondition(n: Node): boolean {
  return (
    CONDITIONS.has(n.k) ||
    (n.k === 'op' && COMPARISONS.has(n.op)) ||
    (n.k === 'fn' && CONDITION_FNS.has(n.name))
  );
}

const SECONDS: Record<string, number> = { second: 1, minute: 60, hour: 3600, day: 86400 };

export class MsSqlDialect extends Dialect {
  readonly name = 'sqlserver';
  /** SQL Server 一条语句最多 2100 个参数 */
  override readonly maxBindParams = 2000;
  /** 注释写成扩展属性 MS_Description（SSMS 等工具认它） */
  override readonly commentStyle = 'statement';
  override readonly indexIfNotExists = false;
  override readonly transactionalDdl = true;
  protected override readonly recursiveKeyword = '';

  /** 2022 起有 IS [NOT] DISTINCT FROM */
  override readonly nullSafeEquals: string | undefined;
  /** 2016 起有 DROP TABLE IF EXISTS */
  override readonly dropIfExists: boolean;

  constructor(options: DialectOptions = {}) {
    super(options);
    this.nullSafeEquals = this.atLeast('2022') ? 'IS NOT DISTINCT FROM' : undefined;
    this.dropIfExists = this.atLeast('2016');
  }

  /** Db.lock 用 SELECT … WITH (UPDLOCK, ROWLOCK) */
  override get rowLocks(): boolean {
    return true;
  }

  override quote(identifier: string): string {
    return `[${identifier.replace(/]/g, ']]')}]`;
  }

  override placeholder(index: number): string {
    return `@p${index}`;
  }

  // ---- 值与条件 ----

  /** 条件当值用：CASE WHEN … THEN 1 ELSE 0 END */
  protected override value(n: Node, w: SqlWriter): string {
    return isCondition(n) ? `CASE WHEN ${this.node(n, w)} THEN 1 ELSE 0 END` : this.node(n, w);
  }

  protected override caseValue(n: Node, w: SqlWriter): string {
    return this.value(n, w);
  }

  /** 不是条件的表达式（布尔列）当条件用：写成 = 1 */
  private condition(n: Node, w: SqlWriter): string {
    if (isCondition(n)) {
      const s = this.node(n, w);
      return n.k === 'and' || n.k === 'or' ? `(${s})` : s;
    }
    return `${this.node(n, w)} = 1`;
  }

  override node(n: Node, w: SqlWriter): string {
    switch (n.k) {
      case 'raw':
        if (n.parts[0] === 'NTH_VALUE(')
          throw new Error(
            'nthValue() is not supported by the sqlserver dialect (no NTH_VALUE); number the rows with rowNumber() instead',
          );
        return super.node(n, w);
      case 'and':
        return n.items.map((i) => this.condition(i, w)).join(' AND ');
      case 'or':
        return n.items.map((i) => this.condition(i, w)).join(' OR ');
      case 'not':
        return `NOT (${this.condition(n.e, w)})`;
      case 'case': {
        const whens = n.when
          .map(([c, t]) => ` WHEN ${this.condition(c, w)} THEN ${this.caseValue(t, w)}`)
          .join('');
        return `CASE${whens}${n.else ? ` ELSE ${this.caseValue(n.else, w)}` : ''} END`;
      }
      default:
        return super.node(n, w);
    }
  }

  protected override conjunction(items: readonly Node[], w: SqlWriter): string {
    return items.map((i) => this.condition(i, w)).join(' AND ');
  }

  // ---- 查询 ----

  /** 2012 起 OFFSET … FETCH（要有 ORDER BY，没有时补 ORDER BY (SELECT NULL)） */
  override limitOffset(
    limit: number | undefined,
    offset: number | undefined,
    ordered = false,
  ): string {
    if (limit === undefined && (offset === undefined || offset === 0)) return '';
    this.requires('OFFSET … FETCH paging', '2012');
    let s = ordered ? '' : ' ORDER BY (SELECT NULL)';
    s += ` OFFSET ${Math.trunc(offset ?? 0)} ROWS`;
    if (limit !== undefined) s += ` FETCH NEXT ${Math.trunc(limit)} ROWS ONLY`;
    return s;
  }

  override select(q: SelectNode, w: SqlWriter = new SqlWriter()): string {
    // WITH 只能写在最外层：子查询里的 CTE（IN (WITH …)）提到外面；递归 CTE 只能 UNION ALL
    const hoisted = hoistCtes(q);
    if (hoisted !== q) return this.select(hoisted, w);
    // 行锁：表提示写在 FROM 的表后面
    if (q.forUpdate) {
      const hint = `WITH (UPDLOCK, ROWLOCK${q.lockWait === 'skip' ? ', READPAST' : ''}${q.lockWait === 'nowait' ? ', NOWAIT' : ''})`;
      return this.select(
        { ...q, forUpdate: false, lockWait: undefined, from: { ...q.from, hint } },
        w,
      );
    }
    // 2012 以前没有 OFFSET … FETCH：只限条数用 TOP，带偏移用 ROW_NUMBER() 包一层
    if (!this.atLeast('2012') && (q.limit !== undefined || (q.offset ?? 0) > 0))
      return this.rowNumberPage(q, w);
    return super.select(q, w);
  }

  /** SQL Server 2008 的分页：SELECT 列 FROM (SELECT …, ROW_NUMBER() OVER (ORDER BY …) AS eq_rn …) eq_page WHERE eq_rn 在区间里 ORDER BY eq_rn */
  private rowNumberPage(q: SelectNode, w: SqlWriter): string {
    const offset = Math.trunc(q.offset ?? 0);
    const rn: Node = {
      k: 'over',
      fn: { k: 'lit', sql: 'ROW_NUMBER()' },
      partition: [],
      order:
        q.orderBy.length > 0 ? q.orderBy : [{ e: { k: 'lit', sql: '(SELECT NULL)' }, desc: false }],
      frame: undefined,
    } as Node;
    const inner: SelectNode = {
      ...q,
      orderBy: [],
      limit: undefined,
      offset: undefined,
      columns: [...q.columns, { e: rn, as: 'eq_rn' }],
    };
    const col = (name: string): Node => ({ k: 'col', alias: 'eq_page', name });
    const lit = (n: number): Node => ({ k: 'lit', sql: String(n) });
    const where: Node[] = [{ k: 'op', op: '>', l: col('eq_rn'), r: lit(offset) }];
    if (q.limit !== undefined)
      where.push({ k: 'op', op: '<=', l: col('eq_rn'), r: lit(offset + Math.trunc(q.limit)) });
    return super.select(
      {
        from: { table: '', alias: 'eq_page', sub: inner },
        joins: [],
        where,
        groupBy: [],
        having: [],
        orderBy: [{ e: col('eq_rn'), desc: false }],
        columns: q.columns.map((c) => ({ e: col(c.as), as: c.as })),
        distinct: false,
        limit: undefined,
        offset: undefined,
        forUpdate: false,
      },
      w,
    );
  }

  // ---- 写入 ----

  /** UPDATE t0 SET … FROM 表 AS t0 [JOIN …] WHERE …（导航的 join 原样写进 FROM） */
  override update(q: UpdateNode, w: SqlWriter = new SqlWriter()): string {
    const set = q.set.map((s) => `${this.quote(s.column)} = ${this.value(s.e, w)}`).join(', ');
    let s = `UPDATE ${q.from.alias} SET ${set} FROM ${this.table(q.from.table)} AS ${q.from.alias}${this.joinClauses(q.joins ?? [], w)}`;
    if (q.where.length > 0) s += ` WHERE ${this.conjunction(q.where, w)}`;
    return s;
  }

  override delete(q: DeleteNode, w: SqlWriter = new SqlWriter()): string {
    let s = `DELETE ${q.from.alias} FROM ${this.table(q.from.table)} AS ${q.from.alias}${this.joinClauses(q.joins ?? [], w)}`;
    if (q.where.length > 0) s += ` WHERE ${this.conjunction(q.where, w)}`;
    return s;
  }

  /** upsert 写成 MERGE … USING (VALUES …) AS eq_s (列)；MERGE 要以分号结尾 */
  override insert(q: InsertNode, w: SqlWriter = new SqlWriter()): string {
    const sql = q.conflict ? this.merge(q, q.conflict, w) : super.insert(q, w);
    if (!q.identityInsert) return sql;
    // 给自增列写了值：同一批里打开再关上 IDENTITY_INSERT
    const table = this.table(q.table);
    return `SET IDENTITY_INSERT ${table} ON; ${sql}${sql.endsWith(';') ? '' : ';'} SET IDENTITY_INSERT ${table} OFF`;
  }

  private merge(q: InsertNode, conflict: ConflictNode, w: SqlWriter): string {
    const cols = q.columns.map((c) => this.quote(c));
    const rows = q.rows.map((r) => `(${r.map((n) => this.node(n, w)).join(', ')})`).join(', ');
    const on = conflict.target
      .map((t) => `eq_t.${this.quote(t)} = eq_s.${this.quote(t)}`)
      .join(' AND ');
    let s = `MERGE INTO ${this.table(q.table)} AS eq_t USING (VALUES ${rows}) AS eq_s (${cols.join(', ')}) ON (${on})`;
    if (conflict.update.length > 0)
      s += ` WHEN MATCHED THEN UPDATE SET ${conflict.update.map((u) => `eq_t.${this.quote(u)} = eq_s.${this.quote(u)}`).join(', ')}`;
    return `${s} WHEN NOT MATCHED THEN INSERT (${cols.join(', ')}) VALUES (${cols.map((c) => `eq_s.${c}`).join(', ')});`;
  }

  override savepoint(name: string): string {
    return `SAVE TRANSACTION ${name}`;
  }

  override releaseSavepoint(): string | undefined {
    return undefined;
  }

  override rollbackToSavepoint(name: string): string {
    return `ROLLBACK TRANSACTION ${name}`;
  }

  // ---- 函数 ----

  protected override functions(): Record<string, FunctionRenderer> {
    const concat = (a: readonly string[]) =>
      this.atLeast('2012')
        ? `CONCAT(${a.join(', ')})`
        : `(${a.map((x) => `ISNULL(CAST(${x} AS NVARCHAR(4000)), '')`).join(' + ')})`;
    const json = (name: string) => {
      this.requires(name, '2016');
    };
    return {
      ...super.functions(),
      length: (a) => `LEN(${a[0]})`,
      // SUBSTRING 必须给长度：取到末尾时给一个够大的长度
      substring: (a) => `SUBSTRING(${a[0]}, ${a[1]}, ${a[2] ?? '2147483647'})`,
      concat,
      trim: (a) => (this.atLeast('2017') ? `TRIM(${a[0]})` : `LTRIM(RTRIM(${a[0]}))`),
      year: (a) => `YEAR(${a[0]})`,
      month: (a) => `MONTH(${a[0]})`,
      day: (a) => `DAY(${a[0]})`,
      index_of: (a) => `(CHARINDEX(${a[1]}, ${a[0]}) - 1)`,
      ceil: (a) => `CEILING(${a[0]})`,
      mod: (a) => `(${a[0]} % ${a[1]})`,
      // 与 LPAD 一样：本来就够长时截成前 n 个字符
      pad_start: (a) =>
        `(CASE WHEN LEN(${a[0]}) >= ${a[1]} THEN LEFT(${a[0]}, ${a[1]}) ELSE RIGHT(REPLICATE(${a[2]}, ${a[1]}) + ${a[0]}, ${a[1]}) END)`,
      pad_end: (a) => `LEFT(${a[0]} + REPLICATE(${a[2]}, ${a[1]}), ${a[1]})`,
      truncate: (a) => `ROUND(${a[0]}, ${a[1]}, 1)`,
      ln: (a) => `LOG(${a[0]})`,
      log: (a) => `LOG(${a[0]}, ${a[1]})`,
      atan2: (a) => `ATN2(${a[0]}, ${a[1]})`,
      // 2022 起 GREATEST / LEAST（本来就忽略 NULL）；之前写成 VALUES 的子查询取最值
      greatest: (a) =>
        this.atLeast('2022')
          ? `GREATEST(${a.join(', ')})`
          : `(SELECT MAX(eq_v) FROM (VALUES ${a.map((x) => `(${x})`).join(', ')}) AS eq_g (eq_v))`,
      least: (a) =>
        this.atLeast('2022')
          ? `LEAST(${a.join(', ')})`
          : `(SELECT MIN(eq_v) FROM (VALUES ${a.map((x) => `(${x})`).join(', ')}) AS eq_g (eq_v))`,
      add_days: (a) => `DATEADD(DAY, ${a[1]}, ${a[0]})`,
      add_months: (a) => `DATEADD(MONTH, ${a[1]}, ${a[0]})`,
      diff_days: (a) => `DATEDIFF(DAY, ${a[1]}, ${a[0]})`,
      add_time: (a) => `DATEADD(${unquoteSql(a[2]!).toUpperCase()}, ${a[1]}, ${a[0]})`,
      // 按经过的秒数整除（向零截断），与其它库一致；DATEDIFF 数的是跨过的边界
      diff_time: (a) => `(DATEDIFF_BIG(SECOND, ${a[1]}, ${a[0]}) / ${SECONDS[unquoteSql(a[2]!)]})`,
      hour: (a) => `DATEPART(HOUR, ${a[0]})`,
      minute: (a) => `DATEPART(MINUTE, ${a[0]})`,
      second: (a) => `DATEPART(SECOND, ${a[0]})`,
      day_of_year: (a) => `DATEPART(DAYOFYEAR, ${a[0]})`,
      // WEEKDAY 受 @@DATEFIRST 影响：换算成星期日 0 / 星期一 1 …
      day_of_week: (a) => `((DATEPART(WEEKDAY, ${a[0]}) + @@DATEFIRST - 1) % 7)`,
      iso_day_of_week: (a) => `(((DATEPART(WEEKDAY, ${a[0]}) + @@DATEFIRST - 2) % 7) + 1)`,
      date_format: (a) => this.formatDate(a[0]!, dateFormatParts(unquoteSql(a[1]!))),
      date_trunc: (a) => this.dateTrunc(a[0]!, unquoteSql(a[1]!)),
      now: () => 'SYSUTCDATETIME()',
      in_csv: (a) => `(${concat(["','", a[1]!, "','"])} LIKE ${concat(["'%,'", a[0]!, "',%'"])})`,
      json_value: (a) => (
        json('JSON_QUERY'),
        `ISNULL(JSON_QUERY(${a[0]}, ${standardJsonPath(a[1]!)}), JSON_VALUE(${a[0]}, ${standardJsonPath(a[1]!)}))`
      ),
      json_text: (a) => (json('JSON_VALUE'), `JSON_VALUE(${a[0]}, ${standardJsonPath(a[1]!)})`),
      json_number: (a) => (
        json('JSON_VALUE'),
        `CAST(JSON_VALUE(${a[0]}, ${standardJsonPath(a[1]!)}) AS FLOAT)`
      ),
      json_boolean: (a) => (
        json('JSON_VALUE'),
        `(CASE JSON_VALUE(${a[0]}, ${standardJsonPath(a[1]!)}) WHEN 'true' THEN 1 WHEN 'false' THEN 0 END)`
      ),
      json_has: (a) =>
        this.atLeast('2022')
          ? `JSON_PATH_EXISTS(${a[0]}, ${standardJsonPath(a[1]!)}) = 1`
          : (json('OPENJSON'),
            `(ISNULL(JSON_QUERY(${a[0]}, ${standardJsonPath(a[1]!)}), JSON_VALUE(${a[0]}, ${standardJsonPath(a[1]!)})) IS NOT NULL)`),
      json_length: (a) => (
        json('OPENJSON'),
        `(SELECT COUNT(*) FROM OPENJSON(${a[0]}, ${standardJsonPath(a[1]!)}))`
      ),
      cast_string: (a) => `CAST(${a[0]} AS NVARCHAR(4000))`,
      cast_double: (a) => `CAST(${a[0]} AS FLOAT)`,
      cast_datetime: (a) => `CAST(${a[0]} AS DATETIME2(3))`,
      ...msSqlFunctions,
    };
  }

  /** 截断到时间单位：2022 起 DATETRUNC，之前按"从 0 起经过多少个单位再加回去" */
  private dateTrunc(x: string, unit: string): string {
    if (this.atLeast('2022'))
      return `CAST(DATETRUNC(${unit === 'week' ? 'ISO_WEEK' : unit.toUpperCase()}, ${x}) AS DATETIME2(3))`;
    if (unit === 'second') return `CAST(CONVERT(VARCHAR(19), ${x}, 120) AS DATETIME2(3))`;
    if (unit === 'week')
      return `CAST(DATEADD(DAY, -((DATEPART(WEEKDAY, ${x}) + @@DATEFIRST - 2) % 7), CAST(${x} AS DATE)) AS DATETIME2(3))`;
    const part = unit.toUpperCase();
    return `CAST(DATEADD(${part}, DATEDIFF(${part}, 0, ${x}), 0) AS DATETIME2(3))`;
  }

  /** FORMAT(值, '.NET 格式')（2012+）：yyyy、MM、dd、HH、mm、ss 与我们的写法相同，其余文字用单引号括起来 */
  protected override formatDate(value: string, parts: readonly DatePart[]): string {
    this.requires('FORMAT', '2012');
    const format = parts
      .map((p) => ('token' in p ? p.token : /^[\s\-/:.,]*$/.test(p.text) ? p.text : `'${p.text}'`))
      .join('');
    // N'…'：格式里的汉字等要按 Unicode 写
    return `FORMAT(${value}, N'${format.replaceAll("'", "''")}')`;
  }

  /** STRING_AGG(e, 分隔符) WITHIN GROUP (ORDER BY …)（2017+，不支持 DISTINCT） */
  protected override stringAgg(n: Extract<Node, { k: 'string_agg' }>, w: SqlWriter): string {
    this.requires('STRING_AGG', '2017');
    if (n.distinct)
      throw new Error('joining({ distinct: true }) is not supported by the sqlserver dialect');
    const order = this.aggOrder(n.order, w);
    return `STRING_AGG(CAST(${this.node(n.e, w)} AS NVARCHAR(MAX)), N'${n.separator.replaceAll("'", "''")}')${order ? ` WITHIN GROUP (${order.trim()})` : ''}`;
  }

  // ---- 建表 ----

  /** 表与列注释：sp_addextendedproperty 的 MS_Description（当前 schema） */
  override commentStatements(entity: Entity): string[] {
    const table = bareName(entity.table);
    const add = (text: string, column?: string) =>
      `DECLARE @eq_schema sysname = SCHEMA_NAME(); EXEC sp_addextendedproperty @name = N'MS_Description', @value = N'${text.replaceAll("'", "''")}', @level0type = N'SCHEMA', @level0name = @eq_schema, @level1type = N'TABLE', @level1name = N'${table.replaceAll("'", "''")}'${column === undefined ? '' : `, @level2type = N'COLUMN', @level2name = N'${column.replaceAll("'", "''")}'`}`;
    const out = entity.comment !== undefined ? [add(entity.comment)] : [];
    for (const [prop, column] of Object.entries(entity.columns))
      if (column.options.comment !== undefined)
        out.push(add(column.options.comment, entity.columnNames[prop]!));
    return out;
  }

  override columnType(kind: string, o: ColumnOptions): string {
    if (o.dbType) return o.dbType;
    switch (kind) {
      case 'string':
        return `NVARCHAR(${o.length ?? 255})`;
      case 'int':
        return 'INT';
      case 'double':
        return 'FLOAT';
      case 'boolean':
        return 'BIT';
      case 'time':
        return 'TIME(3)';
      case 'datetime':
        return 'DATETIME2(3)';
      case 'json':
        return 'NVARCHAR(MAX)';
      case 'bytes':
        return 'VARBINARY(MAX)';
      default:
        return super.columnType(kind, o);
    }
  }

  override identity(): string {
    return 'IDENTITY(1,1)';
  }

  /** 没有 CREATE TABLE IF NOT EXISTS：createTables 先读库结构，只建缺的表 */
  override createTableStart(): string {
    return 'CREATE TABLE';
  }

  override renameTable(from: string, to: string): string {
    return `EXEC sp_rename '${bareName(from).replaceAll("'", "''")}', '${bareName(to).replaceAll("'", "''")}'`;
  }

  override renameColumn(table: string, from: string, to: string): string {
    return `EXEC sp_rename '${bareName(table).replaceAll("'", "''")}.${from.replaceAll("'", "''")}', '${to.replaceAll("'", "''")}', 'COLUMN'`;
  }

  override addColumn(table: string, name: string, kind: string, o: ColumnOptions): string {
    return `ALTER TABLE ${this.table(table)} ADD ${this.columnDefinition(name, kind, o)}`;
  }

  /** sys 目录视图（当前库的 dbo / 默认 schema） */
  override async introspect(run: QueryRunner): Promise<DbTable[]> {
    const schema = 's.name = SCHEMA_NAME()';
    return assembleTables({
      tables: await run(
        `SELECT t.name AS table_name, CAST(p.value AS NVARCHAR(4000)) AS comment FROM sys.tables t
         JOIN sys.schemas s ON s.schema_id = t.schema_id
         LEFT JOIN sys.extended_properties p ON p.major_id = t.object_id AND p.minor_id = 0 AND p.class = 1 AND p.name = 'MS_Description'
         WHERE ${schema} ORDER BY t.name`,
      ),
      columns: await run(
        `SELECT t.name AS table_name, c.name AS column_name,
           LOWER(ty.name) + CASE
             WHEN ty.name IN ('nvarchar', 'nchar') THEN '(' + CASE WHEN c.max_length = -1 THEN 'max' ELSE CAST(c.max_length / 2 AS VARCHAR(10)) END + ')'
             WHEN ty.name IN ('varchar', 'char', 'varbinary', 'binary') THEN '(' + CASE WHEN c.max_length = -1 THEN 'max' ELSE CAST(c.max_length AS VARCHAR(10)) END + ')'
             WHEN ty.name IN ('decimal', 'numeric') THEN '(' + CAST(c.precision AS VARCHAR(10)) + ',' + CAST(c.scale AS VARCHAR(10)) + ')'
             WHEN ty.name IN ('datetime2', 'time', 'datetimeoffset') THEN '(' + CAST(c.scale AS VARCHAR(10)) + ')'
             ELSE '' END AS column_type,
           c.is_nullable AS is_nullable, OBJECT_DEFINITION(c.default_object_id) AS column_default,
           (SELECT CAST(p.value AS NVARCHAR(4000)) FROM sys.extended_properties p WHERE p.major_id = t.object_id
             AND p.minor_id = c.column_id AND p.class = 1 AND p.name = 'MS_Description') AS comment,
           c.is_identity AS is_generated,
           CASE WHEN EXISTS (SELECT 1 FROM sys.index_columns ic JOIN sys.indexes i ON i.object_id = ic.object_id AND i.index_id = ic.index_id
             WHERE i.is_primary_key = 1 AND ic.object_id = t.object_id AND ic.column_id = c.column_id) THEN 1 ELSE 0 END AS primary_key
         FROM sys.tables t JOIN sys.schemas s ON s.schema_id = t.schema_id
         JOIN sys.columns c ON c.object_id = t.object_id JOIN sys.types ty ON ty.user_type_id = c.user_type_id
         WHERE ${schema} ORDER BY t.name, c.column_id`,
      ),
      indexes: await run(
        `SELECT t.name AS table_name, i.name AS index_name, i.is_unique AS is_unique, c.name AS column_name
         FROM sys.tables t JOIN sys.schemas s ON s.schema_id = t.schema_id
         JOIN sys.indexes i ON i.object_id = t.object_id AND i.is_primary_key = 0 AND i.name IS NOT NULL
         JOIN sys.index_columns ic ON ic.object_id = i.object_id AND ic.index_id = i.index_id
         JOIN sys.columns c ON c.object_id = t.object_id AND c.column_id = ic.column_id
         WHERE ${schema} ORDER BY t.name, i.name, ic.key_ordinal`,
      ),
      foreignKeys: await run(
        `SELECT t.name AS table_name, fk.name AS constraint_name, c.name AS column_name,
           rt.name AS referenced_table, rc.name AS referenced_column
         FROM sys.foreign_keys fk JOIN sys.tables t ON t.object_id = fk.parent_object_id
         JOIN sys.schemas s ON s.schema_id = t.schema_id
         JOIN sys.foreign_key_columns fkc ON fkc.constraint_object_id = fk.object_id
         JOIN sys.columns c ON c.object_id = fkc.parent_object_id AND c.column_id = fkc.parent_column_id
         JOIN sys.tables rt ON rt.object_id = fkc.referenced_object_id
         JOIN sys.columns rc ON rc.object_id = fkc.referenced_object_id AND rc.column_id = fkc.referenced_column_id
         WHERE ${schema} ORDER BY t.name, fk.name, fkc.constraint_column_id`,
      ),
    });
  }

  /** nvarchar(255) 与 NVARCHAR(255)、float 与 FLOAT(53)、bit 与 BIT 等写法不算差异 */
  protected override normalizeType(type: string): string {
    return super.normalizeType(type).replace(/^float\(53\)$/, 'float');
  }
}

/**
 * 把子查询里的 CTE 提到最外层（SQL Server 的 WITH 只能写在语句开头），并让递归 CTE 用 UNION ALL（它不认递归里的 UNION）。
 * 没有要动的地方时原样返回同一个对象
 */
function hoistCtes(q: SelectNode): SelectNode {
  const found: NonNullable<SelectNode['ctes']>[number][] = [];
  let changed = false;
  const visit = (value: unknown, top: boolean): unknown => {
    if (Array.isArray(value)) {
      const items = value.map((v) => visit(v, false));
      return items.some((v, i) => v !== value[i]) ? items : value;
    }
    if (!value || typeof value !== 'object') return value;
    const record = value as Record<string, unknown>;
    let out = record;
    for (const [key, item] of Object.entries(record)) {
      if (key === 'ctes') continue;
      const next = visit(item, false);
      if (next !== item) out = { ...out, [key]: next };
    }
    const ctes = record['ctes'] as SelectNode['ctes'];
    if (!top && 'from' in record && 'columns' in record && ctes && ctes.length > 0) {
      found.push(...ctes);
      out = { ...out, ctes: undefined };
    }
    if (out !== record) changed = true;
    return out;
  };
  const body = visit(q, true) as SelectNode;
  const all = [...found, ...(body.ctes ?? [])];
  const unique = all.filter((c, i) => all.findIndex((d) => d.name === c.name) === i);
  const ctes = unique.map((c) =>
    c.recursive && c.q.unions?.some((u) => !u.all)
      ? { ...c, q: { ...c.q, unions: c.q.unions.map((u) => ({ ...u, all: true })) } }
      : c,
  );
  if (!changed && ctes.every((c, i) => c === unique[i])) return q;
  return { ...body, ctes: ctes.length > 0 ? ctes : undefined };
}

// ---- 驱动 ----

/** JS 值 → 带类型的参数（mssql 自己推断时整数一律当 INT，超过 32 位会出错） */
function bind(request: sql.Request, params: readonly unknown[]): sql.Request {
  params.forEach((value, i) => {
    const name = `p${i + 1}`;
    if (value === null || value === undefined) request.input(name, sql.NVarChar, null);
    else if (typeof value === 'boolean') request.input(name, sql.Bit, value);
    else if (typeof value === 'bigint') request.input(name, sql.BigInt, value.toString());
    else if (typeof value === 'number')
      request.input(
        name,
        Number.isInteger(value) ? (Math.abs(value) < 2 ** 31 ? sql.Int : sql.BigInt) : sql.Float,
        value,
      );
    else if (value instanceof Uint8Array)
      request.input(name, sql.VarBinary(sql.MAX), Buffer.from(value));
    else request.input(name, sql.NVarChar(sql.MAX), String(value as string | number));
  });
  return request;
}

/** 读出的行：DATE / TIME 写成文字（tedious 给的是 1970 年的 Date），其余原样 */
function rows(result: sql.IResult<Record<string, unknown>>): Record<string, unknown>[] {
  const set = result.recordset;
  if (!set) return [];
  const textual = Object.values(set.columns).flatMap((c): [string, 'date' | 'time'][] => {
    const type = typeof c.type === 'function' ? c.type : c.type.type;
    if (type === sql.Date) return [[c.name, 'date']];
    if (type === sql.Time) return [[c.name, 'time']];
    return [];
  });
  if (textual.length === 0) return [...set];
  return set.map((row) => {
    const out = { ...row };
    for (const [name, kind] of textual) {
      const v = out[name];
      if (v instanceof Date)
        out[name] = kind === 'date' ? v.toISOString().slice(0, 10) : v.toISOString().slice(11, 23);
    }
    return out;
  });
}

class MsSqlSession implements Session {
  protected readonly request: () => sql.Request;

  constructor(request: () => sql.Request) {
    this.request = request;
  }

  async query(text: string, params: readonly unknown[]): Promise<Record<string, unknown>[]> {
    return rows(await bind(this.request(), params).query(text));
  }

  async execute(text: string, params: readonly unknown[]): Promise<ExecuteResult> {
    // 单行插入：同一批里取 SCOPE_IDENTITY()（表没有 IDENTITY 列时为 NULL）
    const insert = /^\s*INSERT\b/i.test(text);
    const result = await bind(this.request(), params).query(
      insert ? `${text}; SELECT SCOPE_IDENTITY() AS eq_id` : text,
    );
    const id = insert
      ? (result.recordset?.[0] as { eq_id?: unknown } | undefined)?.eq_id
      : undefined;
    return {
      affected: result.rowsAffected[0] ?? 0,
      insertId: id === null || id === undefined ? undefined : toKey(id),
    };
  }
}

function toKey(value: unknown): number | bigint {
  const n = Number(value);
  return Number.isSafeInteger(n) ? n : BigInt(String(value));
}

const ISOLATION = {
  'read uncommitted': sql.ISOLATION_LEVEL.READ_UNCOMMITTED,
  'read committed': sql.ISOLATION_LEVEL.READ_COMMITTED,
  'repeatable read': sql.ISOLATION_LEVEL.REPEATABLE_READ,
  serializable: sql.ISOLATION_LEVEL.SERIALIZABLE,
} as const;

class MsSqlDriver extends MsSqlSession implements Driver {
  private readonly pool: sql.ConnectionPool;

  constructor(pool: sql.ConnectionPool) {
    super(() => new sql.Request(pool));
    this.pool = pool;
  }

  async transaction<T>(
    work: (session: Session) => Promise<T>,
    options?: TransactionOptions,
  ): Promise<T> {
    if (options?.readOnly)
      throw new Error('read-only transactions are not supported by the sqlserver dialect');
    const tx = new sql.Transaction(this.pool);
    await tx.begin(options?.isolation ? ISOLATION[options.isolation] : undefined);
    try {
      const result = await work(new MsSqlSession(() => new sql.Request(tx)));
      await tx.commit();
      return result;
    } catch (error) {
      await tx.rollback().catch(() => undefined);
      throw error;
    }
  }
}

export interface MsSqlOptions {
  /** 服务器的主版本：按它选写法，默认最新 */
  readonly version?: SqlServerVersion;
}

/** pool 要已经 connect() 过 */
export function mssql(pool: sql.ConnectionPool, options: MsSqlOptions = {}): Adapter {
  return { dialect: new MsSqlDialect({ version: options.version }), driver: new MsSqlDriver(pool) };
}
