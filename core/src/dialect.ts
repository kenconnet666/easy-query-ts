/**
 * 方言：把语法树渲染成某种数据库的 SQL。基类按 SQL 标准写，各库继承后只覆盖不同的地方（引号、函数、分页、锁）。
 */
import type {
  ConflictNode,
  CteNode,
  DeleteNode,
  InsertNode,
  Join,
  JoinKind,
  Node,
  OrderNode,
  SelectNode,
  UpdateNode,
} from './ast.ts';
import { sqlString, unquoteSql } from './expr.ts';
import { bareName, type DbTable, type ForeignKeySpec, type QueryRunner } from './ddl.ts';
import { utcText, type ColumnOptions, type Entity, type TableIndex } from './schema.ts';

export interface Statement {
  readonly sql: string;
  readonly params: readonly unknown[];
}

/** 函数参数的记号：DeferredWriter 留下，Dialect.node 换成真正的占位符 */
const PARAM_MARK = /(\d+)/g;

/** 渲染一条语句时收集参数 */
export class SqlWriter {
  readonly params: unknown[] = [];

  bind(dialect: Dialect, value: unknown): string {
    // 超出数据库的占位符上限时，在发给数据库之前报出清楚的错误（而不是一句 "too many placeholders"）
    if (this.params.length >= dialect.maxBindParams) {
      throw new Error(
        `statement binds more than ${dialect.maxBindParams} parameters, the limit of the ${dialect.name} dialect; split the in-list or the batch into several statements`,
      );
    }
    this.params.push(value);
    return dialect.placeholder(this.params.length, value);
  }
}

export type FunctionRenderer = (args: string[]) => string;

/** 渲染函数参数用：参数先记下、返回记号，函数拼好文字后再按记号的顺序绑定 */
class DeferredWriter extends SqlWriter {
  readonly values: unknown[] = [];

  override bind(_dialect: Dialect, value: unknown): string {
    this.values.push(value);
    return `${this.values.length - 1}`;
  }
}

/** greatest / least 的参数列表：COALESCE(本值, 其余各值)，NULL 就不会让结果变成 NULL（参数可以重复，见 Dialect.node 的 fn） */
export function coalesceEach(args: readonly string[]): string {
  if (args.length < 2) return args.join(', ');
  return args
    .map((value, i) => `COALESCE(${[value, ...args.filter((_, j) => j !== i)].join(', ')})`)
    .join(', ');
}

/** 方言的选项：面向的服务器版本 */
export interface DialectOptions {
  /** 服务器版本（'2017'、'8.0.18'、'12.2'）：低于某个特性的最低版本时退回旧写法，没有旧写法就报错。不给按最新 */
  readonly version?: string | number | undefined;
}

/** 点分版本比较：'8.0.18' 与 '8.0.9' 按数字逐段比 */
export function compareVersions(a: string, b: string): number {
  const x = a.split('.').map(Number);
  const y = b.split('.').map(Number);
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const d = (x[i] ?? 0) - (y[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

/** 本身就是条件（能直接放进 WHERE、不能直接当值）的节点 */
const CONDITION_NODES = new Set([
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

export abstract class Dialect {
  abstract readonly name: string;
  /** 面向的服务器版本；undefined 表示最新 */
  readonly version: string | undefined;

  constructor(options: DialectOptions = {}) {
    this.version = options.version === undefined ? undefined : String(options.version);
  }

  /** 服务器版本至少是 min（没配置版本时按最新，总是真） */
  protected atLeast(min: string): boolean {
    return this.version === undefined || compareVersions(this.version, min) >= 0;
  }

  /** 用到的特性要求更高的版本时报错，说清要哪个版本、配置的是哪个 */
  protected requires(feature: string, min: string): void {
    if (!this.atLeast(min))
      throw new Error(
        `${feature} needs ${this.name} ${min} or later (the dialect is configured for ${this.version})`,
      );
  }

  private cachedFunctions: Record<string, FunctionRenderer> | undefined;

  /** 函数表：节点 { k: 'fn', name } 按名字找写法；子类 `{ ...super.functions(), length: … }` 覆盖 */
  protected functions(): Record<string, FunctionRenderer> {
    return {
      upper: (a) => `UPPER(${a[0]})`,
      lower: (a) => `LOWER(${a[0]})`,
      trim: (a) => `TRIM(${a[0]})`,
      length: (a) => `CHAR_LENGTH(${a[0]})`,
      concat: (a) => `CONCAT(${a.join(', ')})`,
      coalesce: (a) => `COALESCE(${a.join(', ')})`,
      year: (a) => `EXTRACT(YEAR FROM ${a[0]})`,
      month: (a) => `EXTRACT(MONTH FROM ${a[0]})`,
      day: (a) => `EXTRACT(DAY FROM ${a[0]})`,
      // 字符串：substring 的位置、长度已经是 1 起的整数字面量
      substring: (a) => `SUBSTRING(${a.join(', ')})`,
      replace: (a) => `REPLACE(${a.join(', ')})`,
      index_of: (a) => `(POSITION(${a[1]} IN ${a[0]}) - 1)`,
      left: (a) => `LEFT(${a[0]}, ${a[1]})`,
      right: (a) => `RIGHT(${a[0]}, ${a[1]})`,
      // 数学
      abs: (a) => `ABS(${a[0]})`,
      floor: (a) => `FLOOR(${a[0]})`,
      ceil: (a) => `CEIL(${a[0]})`,
      round: (a) => `ROUND(${a[0]}, ${a[1]})`,
      mod: (a) => `MOD(${a[0]}, ${a[1]})`,
      nullif: (a) => `NULLIF(${a[0]}, ${a[1]})`,
      // 日期：天数 / 月数是整数字面量。基类按 PG 的区间写法，其它库覆盖
      add_days: (a) => `(${a[0]} + INTERVAL '${a[1]} day')`,
      add_months: (a) => `(${a[0]} + INTERVAL '${a[1]} month')`,
      diff_days: (a) => `(CAST(${a[0]} AS DATE) - CAST(${a[1]} AS DATE))`,
      grouping: (a) => `GROUPING(${a[0]})`,
      // 几个值里的最大、最小，忽略 NULL：每个值先用其余的值兜底，结果不变、全为 NULL 才是 NULL。原生忽略 NULL 的库（PG）覆盖
      greatest: (a) => `GREATEST(${coalesceEach(a)})`,
      least: (a) => `LEAST(${coalesceEach(a)})`,
      // 字符串
      ltrim: (a) => `LTRIM(${a[0]})`,
      rtrim: (a) => `RTRIM(${a[0]})`,
      pad_start: (a) => `LPAD(${a[0]}, ${a[1]}, ${a[2]})`,
      pad_end: (a) => `RPAD(${a[0]}, ${a[1]}, ${a[2]})`,
      // 数学
      truncate: (a) => `TRUNC(${a[0]}, ${a[1]})`,
      sign: (a) => `SIGN(${a[0]})`,
      power: (a) => `POWER(${a[0]}, ${a[1]})`,
      sqrt: (a) => `SQRT(${a[0]})`,
      exp: (a) => `EXP(${a[0]})`,
      ln: (a) => `LN(${a[0]})`,
      log10: (a) => `LOG10(${a[0]})`,
      log: (a) => `LOG(${a[1]}, ${a[0]})`,
      sin: (a) => `SIN(${a[0]})`,
      cos: (a) => `COS(${a[0]})`,
      tan: (a) => `TAN(${a[0]})`,
      asin: (a) => `ASIN(${a[0]})`,
      acos: (a) => `ACOS(${a[0]})`,
      atan: (a) => `ATAN(${a[0]})`,
      atan2: (a) => `ATAN2(${a[0]}, ${a[1]})`,
      // 日期：数量可以是列；单位是受信任的字面量
      add_time: (a) => `(${a[0]} + (${a[1]}) * INTERVAL '1 ${unquoteSql(a[2]!)}')`,
      hour: (a) => `CAST(EXTRACT(HOUR FROM ${a[0]}) AS INTEGER)`,
      minute: (a) => `CAST(EXTRACT(MINUTE FROM ${a[0]}) AS INTEGER)`,
      second: (a) => `CAST(FLOOR(EXTRACT(SECOND FROM ${a[0]})) AS INTEGER)`,
      day_of_year: (a) => `CAST(EXTRACT(DOY FROM ${a[0]}) AS INTEGER)`,
      day_of_week: (a) => `CAST(EXTRACT(DOW FROM ${a[0]}) AS INTEGER)`,
      iso_day_of_week: (a) => `CAST(EXTRACT(ISODOW FROM ${a[0]}) AS INTEGER)`,
      date_format: (a) => this.formatDate(a[0]!, dateFormatParts(unquoteSql(a[1]!))),
      diff_time: (a) =>
        `CAST(TRUNC(EXTRACT(EPOCH FROM (CAST(${a[0]} AS TIMESTAMP) - CAST(${a[1]} AS TIMESTAMP))) / ${SECONDS[unquoteSql(a[2]!)]}) AS BIGINT)`,
      now: () => 'CURRENT_TIMESTAMP',
      in_csv: (a) => `(CONCAT(',', ${a[1]}, ',') LIKE CONCAT('%,', ${a[0]}, ',%'))`,
      // JSON：基类按 PG 的 jsonb 写法；路径是 JSON 数组的字面量（见 Expr.json）
      json_value: (a) => `CAST(CAST(${a[0]} AS JSONB) #> ${pgJsonPath(a[1]!)} AS TEXT)`,
      json_text: (a) => `(CAST(${a[0]} AS JSONB) #>> ${pgJsonPath(a[1]!)})`,
      json_number: (a) =>
        `CAST(CAST(${a[0]} AS JSONB) #>> ${pgJsonPath(a[1]!)} AS DOUBLE PRECISION)`,
      json_boolean: (a) => `CAST(CAST(${a[0]} AS JSONB) #>> ${pgJsonPath(a[1]!)} AS BOOLEAN)`,
      // #> 括起来：openGauss 里 #> 的优先级低于 IS NOT NULL
      json_has: (a) => `((CAST(${a[0]} AS JSONB) #> ${pgJsonPath(a[1]!)}) IS NOT NULL)`,
      json_length: (a) => `JSONB_ARRAY_LENGTH(CAST(${a[0]} AS JSONB) #> ${pgJsonPath(a[1]!)})`,
      // 类型转换：基类用标准类型名，各库差异覆盖
      cast_string: (a) => `CAST(${a[0]} AS VARCHAR(4000))`,
      cast_int: (a) => `CAST(${a[0]} AS INTEGER)`,
      cast_bigint: (a) => `CAST(${a[0]} AS BIGINT)`,
      cast_double: (a) => `CAST(${a[0]} AS DOUBLE PRECISION)`,
      cast_decimal: (a) => `CAST(${a[0]} AS DECIMAL(${a[1]}, ${a[2]}))`,
      cast_date: (a) => `CAST(${a[0]} AS DATE)`,
      cast_datetime: (a) => `CAST(${a[0]} AS TIMESTAMP)`,
    };
  }

  /** 日期格式化：基类按 TO_CHAR 的写法（PG、Oracle）；含字母、数字、汉字的文字用双引号括起来，免得被当成格式符 */
  protected formatDate(value: string, parts: readonly DatePart[]): string {
    const tokens: Record<DateToken, string> = {
      yyyy: 'YYYY',
      yy: 'YY',
      MM: 'MM',
      dd: 'DD',
      HH: 'HH24',
      mm: 'MI',
      ss: 'SS',
    };
    const format = parts
      .map((p) => {
        if ('token' in p) return tokens[p.token];
        return /^[\s\-/:.,]*$/.test(p.text) ? p.text : `"${p.text.replaceAll('"', '\\"')}"`;
      })
      .join('');
    return `TO_CHAR(${value}, ${sqlString(format)})`;
  }

  /** 字符串聚合：基类是 STRING_AGG(e, 分隔符 ORDER BY …)（PG、HANA、SQL Server） */
  protected stringAgg(n: Extract<Node, { k: 'string_agg' }>, w: SqlWriter): string {
    return `STRING_AGG(${n.distinct ? 'DISTINCT ' : ''}${this.node(n.e, w)}, ${sqlString(n.separator)}${this.aggOrder(n.order, w)})`;
  }

  /** 聚合函数里的 ORDER BY 子句（没有时为空） */
  protected aggOrder(order: readonly OrderNode[], w: SqlWriter): string {
    if (order.length === 0) return '';
    return ` ORDER BY ${order.map((o) => this.node(o.e, w) + (o.desc ? ' DESC' : ' ASC')).join(', ')}`;
  }

  /**
   * 条件能不能直接当值（`SELECT a > b`）、布尔列能不能直接当条件（`WHERE active`）。
   * SQL Server、Oracle 23ai 之前不能：条件当值写成 CASE WHEN … THEN 1 ELSE 0 END，布尔列当条件写成 = 1
   */
  protected readonly booleanValues: boolean = true;

  /** 渲染出来本身是条件的函数（函数表里的名字）；方言专属的条件函数在子类里追加 */
  protected conditionFunctions(): readonly string[] {
    return ['in_csv', 'json_has'];
  }

  private cachedConditionFunctions: ReadonlySet<string> | undefined;

  /** 这个节点渲染出来是不是条件 */
  protected isCondition(n: Node): boolean {
    if (CONDITION_NODES.has(n.k) || (n.k === 'op' && COMPARISONS.has(n.op))) return true;
    return (
      n.k === 'fn' &&
      (this.cachedConditionFunctions ??= new Set(this.conditionFunctions())).has(n.name)
    );
  }

  /** 当作值用的表达式（select 的列、set 的值、CASE 的分支） */
  protected value(n: Node, w: SqlWriter): string {
    if (this.booleanValues || !this.isCondition(n)) return this.node(n, w);
    return `CASE WHEN ${this.node(n, w)} THEN 1 ELSE 0 END`;
  }

  /** 当作条件用的表达式（WHERE、AND / OR / NOT 的项、CASE 的 WHEN） */
  protected condition(n: Node, w: SqlWriter): string {
    if (this.booleanValues || this.isCondition(n)) return this.node(n, w);
    return `${this.node(n, w)} = 1`;
  }

  /**
   * CASE 分支里的值。默认原样渲染；PG 这类不能从上下文推断参数类型的库覆盖它，给参数加类型转换。
   */
  protected caseValue(n: Node, w: SqlWriter): string {
    return this.value(n, w);
  }

  /** 一条语句最多能绑定多少个参数；多行插入据此自动分块。默认取各库里最小的常见上限（SQLite 32766） */
  readonly maxBindParams: number = 32766;

  /** 一条 INSERT 最多写几行（Oracle 的多行写法对自增列只生成一次值，只能一行一条） */
  readonly maxInsertRows: number = Number.POSITIVE_INFINITY;

  // ---- 建表（代码优先）。基类写标准 SQL，各库覆盖类型与自增的写法 ----

  /** 列在库里的类型：优先用 dbType，否则按 kind 推断；认不得的 kind 要求显式给 dbType */
  columnType(kind: string, o: ColumnOptions): string {
    if (o.dbType) return o.dbType;
    switch (kind) {
      case 'string':
        return `VARCHAR(${o.length ?? 255})`;
      case 'int':
        return 'INTEGER';
      case 'bigint':
        return 'BIGINT';
      case 'decimal':
        return `DECIMAL(${o.precision ?? 38}, ${o.scale ?? 10})`;
      case 'double':
        return 'DOUBLE PRECISION';
      case 'boolean':
        return 'BOOLEAN';
      case 'date':
        return 'DATE';
      case 'time':
        return 'TIME';
      case 'datetime':
        return 'TIMESTAMP(3)';
      case 'json':
        return 'TEXT';
      case 'bytes':
        return 'BLOB';
      default:
        throw new Error(
          `no database type for a '${kind}' column on the ${this.name} dialect; give one with .dbType('…')`,
        );
    }
  }

  /** 自增列的子句（接在类型后面） */
  identity(): string {
    return 'GENERATED BY DEFAULT AS IDENTITY';
  }

  /** CREATE TABLE 的开头；HANA 要 CREATE COLUMN TABLE，也不支持 IF NOT EXISTS */
  createTableStart(ifNotExists: boolean): string {
    return ifNotExists ? 'CREATE TABLE IF NOT EXISTS' : 'CREATE TABLE';
  }

  /** 一列的定义（含类型、自增、NOT NULL、DEFAULT，MySQL 还有 COMMENT）；SQLite 的自增主键写法特殊，会覆盖它 */
  columnDefinition(name: string, kind: string, o: ColumnOptions): string {
    return [
      this.quote(name),
      this.columnType(kind, o),
      o.generated ? this.identity() : undefined,
      o.nullable ? undefined : 'NOT NULL',
      o.dbDefault !== undefined ? `DEFAULT ${o.dbDefault}` : undefined,
      o.comment !== undefined && this.commentStyle === 'inline'
        ? `COMMENT ${sqlString(o.comment)}`
        : undefined,
    ]
      .filter(Boolean)
      .join(' ');
  }

  /**
   * 按实体生成建表语句：列、主键、唯一约束（foreignKeys 给出时也写进来，SQLite 只能这样加外键）。
   * 表注释、索引、外键的其余语句见 commentStatements / createIndex / addForeignKey。派生实体（子查询 / CTE）没有表，不能建
   */
  createTable(
    entity: Entity,
    ifNotExists = true,
    foreignKeys: readonly ForeignKeySpec[] = [],
  ): string {
    if (entity.derived) throw new Error(`${entity.name} is a derived table and cannot be created`);
    const parts: string[] = [];
    for (const [prop, column] of Object.entries(entity.columns)) {
      parts.push(
        this.columnDefinition(entity.columnNames[prop]!, column.codec.kind, column.options),
      );
    }
    parts.push(...this.tableConstraints(entity));
    parts.push(...foreignKeys.map((fk) => this.foreignKeyClause(fk)));
    return `${this.createTableStart(ifNotExists)} ${this.table(entity.table)} (${parts.join(', ')})${this.tableOptions(entity)}`;
  }

  /** 建表语句末尾的选项（MySQL 的表注释） */
  protected tableOptions(_entity: Entity): string {
    return '';
  }

  /** 注释怎么写：inline 写在建表语句里（MySQL），statement 用 COMMENT ON（PG、HANA），none 没有注释（SQLite） */
  readonly commentStyle: 'inline' | 'statement' | 'none' = 'statement';

  /** 表与列注释的 COMMENT ON 语句（commentStyle 为 statement 时） */
  commentStatements(entity: Entity): string[] {
    if (this.commentStyle !== 'statement') return [];
    const table = this.table(entity.table);
    const out =
      entity.comment !== undefined
        ? [`COMMENT ON TABLE ${table} IS ${sqlString(entity.comment)}`]
        : [];
    for (const [prop, column] of Object.entries(entity.columns))
      if (column.options.comment !== undefined)
        out.push(
          `COMMENT ON COLUMN ${table}.${this.quote(entity.columnNames[prop]!)} IS ${sqlString(column.options.comment)}`,
        );
    return out;
  }

  /** 外键只能写在建表语句里（SQLite 不能 ALTER TABLE ADD CONSTRAINT） */
  readonly inlineForeignKeys: boolean = false;

  /** CREATE INDEX 认不认 IF NOT EXISTS（MySQL、HANA 不认） */
  readonly indexIfNotExists: boolean = true;

  createIndex(table: string, index: TableIndex, ifNotExists: boolean): string {
    const guard = ifNotExists && this.indexIfNotExists ? 'IF NOT EXISTS ' : '';
    return `CREATE ${index.unique ? 'UNIQUE ' : ''}INDEX ${guard}${this.quote(index.name)} ON ${this.table(table)} (${index.columns.map((c) => this.quote(c)).join(', ')})`;
  }

  /** 外键约束子句（建表语句里与 ALTER TABLE ADD 共用） */
  protected foreignKeyClause(fk: ForeignKeySpec): string {
    const list = (names: readonly string[]) => names.map((n) => this.quote(n)).join(', ');
    let s = `CONSTRAINT ${this.quote(fk.name)} FOREIGN KEY (${list(fk.columns)}) REFERENCES ${this.table(fk.references)} (${list(fk.referencedColumns)})`;
    if (fk.onDelete) s += ` ON DELETE ${fk.onDelete.toUpperCase()}`;
    if (fk.onUpdate) s += ` ON UPDATE ${fk.onUpdate.toUpperCase()}`;
    return s;
  }

  addForeignKey(fk: ForeignKeySpec): string {
    return `ALTER TABLE ${this.table(fk.table)} ADD ${this.foreignKeyClause(fk)}`;
  }

  renameTable(from: string, to: string): string {
    return `ALTER TABLE ${this.table(from)} RENAME TO ${this.quote(bareName(to))}`;
  }

  renameColumn(table: string, from: string, to: string): string {
    return `ALTER TABLE ${this.table(table)} RENAME COLUMN ${this.quote(from)} TO ${this.quote(to)}`;
  }

  addColumn(table: string, name: string, kind: string, o: ColumnOptions): string {
    return `ALTER TABLE ${this.table(table)} ADD COLUMN ${this.columnDefinition(name, kind, o)}`;
  }

  /** DROP TABLE 认不认 IF EXISTS（HANA 不认） */
  readonly dropIfExists: boolean = true;

  dropTable(table: string): string {
    return `DROP TABLE ${this.dropIfExists ? 'IF EXISTS ' : ''}${this.table(table)}`;
  }

  /** DDL 能不能放进事务一起回滚（PG、SQLite 能；MySQL、HANA 的 DDL 会隐式提交） */
  readonly transactionalDdl: boolean = false;

  /** 声明的类型与库里读出的类型算不算同一个（大小写、空格、同义词不算差异） */
  sameType(declared: string, actual: string): boolean {
    return this.normalizeType(declared) === this.normalizeType(actual);
  }

  /** 类型的规范写法：小写、去空格、同义词换成同一个；各方言补自己的写法 */
  protected normalizeType(type: string): string {
    let t = type.toLowerCase().replace(/\s+/g, ' ').trim();
    for (const [pattern, to] of TYPE_SYNONYMS) t = t.replace(pattern, to);
    return t.replace(/\s+/g, '');
  }

  /** 读当前 schema 里的表结构（syncTables、tableExists、由表生成实体用）；各方言实现 */
  introspect(_run: QueryRunner): Promise<DbTable[]> {
    return Promise.reject(
      new Error(`reading the table structure is not supported by the ${this.name} dialect`),
    );
  }

  /** 主键与唯一约束 */
  protected tableConstraints(entity: Entity): string[] {
    const names = (props: readonly string[]) =>
      props.map((p) => this.quote(entity.columnNames[p]!)).join(', ');
    const constraints: string[] = [];
    if (entity.primaryKey.length > 0) constraints.push(`PRIMARY KEY (${names(entity.primaryKey)})`);
    for (const [prop, column] of Object.entries(entity.columns)) {
      if (column.options.unique) constraints.push(`UNIQUE (${names([prop])})`);
    }
    return constraints;
  }

  /** 单行插入后怎么拿自增主键：驱动直接返回（SQLite、MySQL），或 INSERT … RETURNING 主键（PG） */
  readonly generatedKeys: 'driver' | 'returning' = 'driver';

  returning(column: string): string {
    return ` RETURNING ${this.quote(column)}`;
  }

  quote(identifier: string): string {
    return `"${identifier.replace(/"/g, '""')}"`;
  }

  /** 第 index 个参数（从 1 开始）的占位符；value 是绑定的值（ClickHouse 的占位符要写出类型） */
  placeholder(_index: number, _value?: unknown): string {
    return '?';
  }

  /** LIKE 的转义子句；默认转义符就是反斜杠的库返回空串 */
  likeEscape(): string {
    return " ESCAPE '\\'";
  }

  /** 把编码后的参数绑定进语句，返回它在 SQL 里的写法；默认是占位符。驱动不能可靠传递的值（见 MySQL 的 bigint）可以覆盖成字面量 */
  bindParam(value: unknown, w: SqlWriter): string {
    return w.bind(this, value);
  }

  /** 没有列编码时，JS 值 → 驱动接受的参数 */
  encodeParam(value: unknown): unknown {
    if (value instanceof Date) return utcText(value);
    if (typeof value === 'boolean') return value ? 1 : 0;
    return value;
  }

  /** 分页子句；ordered 说明前面有没有 ORDER BY（SQL Server 的 OFFSET … FETCH 要求有） */
  limitOffset(limit: number | undefined, offset: number | undefined, _ordered = false): string {
    let s = '';
    if (limit !== undefined) s += ` LIMIT ${int(limit)}`;
    if (offset !== undefined && offset > 0) s += ` OFFSET ${int(offset)}`;
    return s;
  }

  /** 行锁子句。wait：nowait 立即报错、skip 跳过被锁的行（MySQL 8.0.1+、PG 的写法） */
  /** 有行锁：Db.lock 用 SELECT … FOR UPDATE；没有时（SQLite）用一条把主键写回自己的 UPDATE 拿到写锁 */
  get rowLocks(): boolean {
    return true;
  }

  forUpdate(wait?: 'nowait' | 'skip'): string {
    return ' FOR UPDATE' + (wait === 'nowait' ? ' NOWAIT' : wait === 'skip' ? ' SKIP LOCKED' : '');
  }

  /** null 安全相等的运算符（MySQL `<=>`、PG `IS NOT DISTINCT FROM`）；没有的库写成 (a = b OR (a IS NULL AND b IS NULL)) */
  readonly nullSafeEquals: string | undefined = undefined;

  /** GROUP BY 子句里的键列表：rollup / cube 默认写成 ROLLUP(…) / CUBE(…)（PG、HANA）；MySQL 等写法不同的库覆盖 */
  groupByKeys(keys: string[], mode: 'rollup' | 'cube' | undefined): string {
    return mode ? `${mode.toUpperCase()}(${keys.join(', ')})` : keys.join(', ');
  }

  /** 嵌套事务用的保存点语句；保存点名字由核心生成（只含字母数字下划线） */
  savepoint(name: string): string {
    return `SAVEPOINT ${name}`;
  }

  /** 释放保存点；没有这条语句的库返回 undefined（回滚到保存点后事务照常继续） */
  releaseSavepoint(name: string): string | undefined {
    return `RELEASE SAVEPOINT ${name}`;
  }

  rollbackToSavepoint(name: string): string {
    return `ROLLBACK TO SAVEPOINT ${name}`;
  }

  /**
   * WITH 只能写在语句开头、递归 CTE 只能 UNION ALL（SQL Server、Oracle）：渲染前把子查询里的 CTE 提到最外层，
   * 递归 CTE 的 UNION 换成 UNION ALL（数据里有环时由库的递归上限报错，而不是像 UNION 那样停下）
   */
  protected readonly ctesAtTop: boolean = false;

  /** 递归 CTE 的关键字（SQL Server、Oracle 不写，直接 WITH） */
  protected readonly recursiveKeyword: string = 'RECURSIVE ';

  /** 是否支持递归 CTE（WITH RECURSIVE）。HANA 没有，用层级函数代替 */
  readonly supportsRecursiveCte: boolean = true;

  /** 完整的查询语句：WITH 子句 + 查询体 + UNION 的各成员 */
  select(q: SelectNode, w: SqlWriter = new SqlWriter()): string {
    if (this.ctesAtTop) {
      const hoisted = hoistCtes(q);
      if (hoisted !== q) return this.select(hoisted, w);
    }
    // 绑定参数按渲染顺序收集，所以必须严格按文本顺序渲染：WITH、主体、再是 UNION 的各成员
    const withs = q.ctes && q.ctes.length > 0 ? this.withClause(q.ctes, w) : '';
    let sql = withs + this.selectCore(q, w);
    for (const u of q.unions ?? [])
      sql += ` UNION ${u.all ? 'ALL ' : ''}${this.selectCore(u.q, w)}`;
    return sql;
  }

  private withClause(ctes: readonly CteNode[], w: SqlWriter): string {
    const recursive = ctes.some((c) => c.recursive);
    if (recursive && !this.supportsRecursiveCte)
      throw new Error(`recursive CTEs are not supported by the ${this.name} dialect`);
    const parts = ctes.map(
      (c) =>
        `${this.quote(c.name)} (${c.columns.map((x) => this.quote(x)).join(', ')}) AS (${this.select(c.q, w)})`,
    );
    return `WITH ${recursive ? this.recursiveKeyword : ''}${parts.join(', ')} `;
  }

  private selectCore(q: SelectNode, w: SqlWriter): string {
    const cols =
      q.columns.length === 0
        ? '1'
        : q.columns.map((c) => `${this.value(c.e, w)} AS ${this.quote(c.as)}`).join(', ');
    let s = `SELECT ${q.distinct ? 'DISTINCT ' : ''}${cols} FROM ${q.from.sub ? `(${this.select(q.from.sub, w)})` : this.table(q.from.table)} ${q.from.alias}${q.from.hint ? ` ${q.from.hint}` : ''}`;
    s += this.joinClauses(q.joins, w);
    if (q.where.length > 0) s += ` WHERE ${this.conjunction(q.where, w)}`;
    if (q.groupBy.length > 0)
      s += ` GROUP BY ${this.groupByKeys(
        q.groupBy.map((g) => this.node(g, w)),
        q.groupMode,
      )}`;
    if (q.having.length > 0) s += ` HAVING ${this.conjunction(q.having, w)}`;
    if (q.orderBy.length > 0)
      s += ` ORDER BY ${q.orderBy.map((o) => this.node(o.e, w) + (o.desc ? ' DESC' : ' ASC')).join(', ')}`;
    s += this.limitOffset(q.limit, q.offset, q.orderBy.length > 0);
    if (q.forUpdate) s += this.forUpdate(q.lockWait);
    return s;
  }

  /** 是否支持 INSERT / UPDATE / DELETE … RETURNING（PG、SQLite 3.35+；MySQL、HANA 没有） */
  readonly supportsReturning: boolean = false;

  /** RETURNING 子句，列名已经是库里的名字 */
  returningColumns(columns: readonly string[]): string {
    if (!this.supportsReturning)
      throw new Error(`returning() is not supported by the ${this.name} dialect`);
    return ` RETURNING ${columns.map((c) => this.quote(c)).join(', ')}`;
  }

  insert(q: InsertNode, w: SqlWriter = new SqlWriter()): string {
    if (q.source)
      return `INSERT INTO ${this.table(q.table)} (${q.columns.map((c) => this.quote(c)).join(', ')}) ${this.select(q.source, w)}`;
    const rows = q.rows.map((r) => `(${r.map((n) => this.node(n, w)).join(', ')})`).join(', ');
    return `INSERT INTO ${this.table(q.table)} (${q.columns.map((c) => this.quote(c)).join(', ')}) VALUES ${rows}${q.conflict ? this.onConflict(q.conflict) : ''}`;
  }

  /** upsert 子句；默认是 SQLite / PG 的 ON CONFLICT 写法 */
  onConflict(c: ConflictNode): string {
    const target = `(${c.target.map((t) => this.quote(t)).join(', ')})`;
    if (c.update.length === 0) return ` ON CONFLICT ${target} DO NOTHING`;
    return ` ON CONFLICT ${target} DO UPDATE SET ${c.update.map((u) => `${this.quote(u)} = excluded.${this.quote(u)}`).join(', ')}`;
  }

  /** JOIN 子句（连着前面的 FROM） */
  protected joinClauses(joins: readonly Join[], w: SqlWriter): string {
    let s = '';
    for (const j of joins) {
      const source = j.sub ? `(${this.select(j.sub, w)})` : this.table(j.table);
      s += ` ${JOIN_WORDS[j.kind ?? 'left']} ${source} ${j.alias}${j.hint ? ` ${j.hint}` : ''}`;
      if (j.on) s += ` ON ${this.node(j.on, w)}`;
    }
    return s;
  }

  /**
   * 带 join 时（条件、set 里用了多对一导航）：目标表另起别名，FROM 里放原别名的同一张表与各个 join，按主键对上——
   * `UPDATE t AS t0_w SET c = t1.x FROM t t0 LEFT JOIN u t1 ON … WHERE t0_w.id = t0.id AND …`。
   * 表达式照旧引用 t0，LEFT JOIN 的语义不变（目标不存在的行照样更新，导航的列为 NULL）；PG、SQLite 3.33+ 都认这种自连接
   */
  update(q: UpdateNode, w: SqlWriter = new SqlWriter()): string {
    const set = q.set.map((s) => `${this.quote(s.column)} = ${this.value(s.e, w)}`).join(', ');
    if (!q.joins?.length) {
      let s = `UPDATE ${this.table(q.from.table)} AS ${q.from.alias} SET ${set}`;
      if (q.where.length > 0) s += ` WHERE ${this.conjunction(q.where, w)}`;
      return s;
    }
    const self = `${q.from.alias}_w`;
    const from = `${this.table(q.from.table)} ${q.from.alias}${this.joinClauses(q.joins, w)}`;
    const where = this.conjunction([...this.sameRow(q, self), ...q.where], w);
    return `UPDATE ${this.table(q.from.table)} AS ${self} SET ${set} FROM ${from} WHERE ${where}`;
  }

  /** 带 join 时：`DELETE FROM t AS t0_w WHERE EXISTS (SELECT 1 FROM t t0 LEFT JOIN … WHERE t0_w.id = t0.id AND …)`，各库都认 */
  delete(q: DeleteNode, w: SqlWriter = new SqlWriter()): string {
    if (!q.joins?.length) {
      let s = `DELETE FROM ${this.table(q.from.table)} AS ${q.from.alias}`;
      if (q.where.length > 0) s += ` WHERE ${this.conjunction(q.where, w)}`;
      return s;
    }
    const self = `${q.from.alias}_w`;
    const from = `${this.table(q.from.table)} ${q.from.alias}${this.joinClauses(q.joins, w)}`;
    const where = this.conjunction([...this.sameRow(q, self), ...q.where], w);
    return `DELETE FROM ${this.table(q.from.table)} AS ${self} WHERE EXISTS (SELECT 1 FROM ${from} WHERE ${where})`;
  }

  /** 自连接的两份目标表按主键对上 */
  private sameRow(q: UpdateNode | DeleteNode, self: string): Node[] {
    if (!q.key?.length)
      throw new Error(
        `update / delete through a navigation needs a primary key on ${q.from.table}`,
      );
    return q.key.map((name) => ({
      k: 'op',
      op: '=',
      l: { k: 'col', alias: self, name },
      r: { k: 'col', alias: q.from.alias, name },
    }));
  }

  /** 表名可以带 schema 前缀（a.b）与跨库链接（a.b@link，链接名原样） */
  table(name: string): string {
    const [table = '', link] = name.split('@');
    const quoted = table
      .split('.')
      .map((p) => this.quote(p))
      .join('.');
    return link ? `${quoted}@${link}` : quoted;
  }

  node(n: Node, w: SqlWriter): string {
    switch (n.k) {
      case 'col':
        return `${n.alias}.${this.quote(n.name)}`;
      // 列编码之后再交给方言：例如布尔列编码后仍是布尔，由方言决定写 1 / 0 还是 true / false
      case 'param':
        return this.bindParam(
          n.value == null ? null : this.encodeParam(n.codec ? n.codec.encode(n.value) : n.value),
          w,
        );
      case 'lit':
        return n.sql;
      case 'raw':
        return n.parts.reduce(
          (s, part, i) => s + part + (i < n.args.length ? this.node(n.args[i]!, w) : ''),
          '',
        );
      case 'op':
        return `${this.operand(n.l, w)} ${n.op} ${this.operand(n.r, w)}`;
      case 'and':
        return n.items.map((i) => this.wrap(i, 'and', w)).join(' AND ');
      case 'or':
        return n.items.map((i) => this.wrap(i, 'or', w)).join(' OR ');
      case 'not':
        return `NOT (${this.condition(n.e, w)})`;
      case 'null':
        return `${this.operand(n.e, w)} IS ${n.not ? 'NOT ' : ''}NULL`;
      case 'in':
        if (n.list.length === 0) return n.not ? '1 = 1' : '1 = 0';
        return `${this.operand(n.e, w)} ${n.not ? 'NOT ' : ''}IN (${n.list.map((i) => this.node(i, w)).join(', ')})`;
      case 'eq_ns': {
        if (this.nullSafeEquals)
          return `${this.operand(n.l, w)} ${this.nullSafeEquals} ${this.operand(n.r, w)}`;
        // 没有专用运算符：两边各渲染两次（参数也各绑两次，顺序与文本一致）
        return `(${this.operand(n.l, w)} = ${this.operand(n.r, w)} OR (${this.operand(n.l, w)} IS NULL AND ${this.operand(n.r, w)} IS NULL))`;
      }
      case 'in_sub':
        return `${this.operand(n.e, w)} ${n.not ? 'NOT ' : ''}IN (${this.select(n.q, w)})`;
      case 'between':
        return `${this.operand(n.e, w)} BETWEEN ${this.operand(n.lo, w)} AND ${this.operand(n.hi, w)}`;
      case 'like':
        return `${this.operand(n.e, w)} ${n.not ? 'NOT ' : ''}LIKE ${this.node(n.pattern, w)}${this.likeEscape()}`;
      case 'fn': {
        const render = (this.cachedFunctions ??= this.functions())[n.name];
        if (!render)
          throw new Error(`function '${n.name}' is not supported by the ${this.name} dialect`);
        // 参数先只记下、在文字里留记号；函数拼好整段（参数可能换序、重复）后按记号出现的顺序真正绑定，位置占位符（?）才对得上
        const deferred = new DeferredWriter();
        const sql = render(n.args.map((a) => this.node(a, deferred)));
        return sql.replace(PARAM_MARK, (_, i: string) => w.bind(this, deferred.values[Number(i)]));
      }
      case 'agg': {
        const arg = n.arg ? this.node(n.arg, w) : '*';
        return `${n.fn.toUpperCase()}(${n.distinct ? 'DISTINCT ' : ''}${arg})`;
      }
      case 'case': {
        const whens = n.when
          .map(([c, t]) => ` WHEN ${this.condition(c, w)} THEN ${this.caseValue(t, w)}`)
          .join('');
        return `CASE${whens}${n.else ? ` ELSE ${this.caseValue(n.else, w)}` : ''} END`;
      }
      case 'exists':
        return `${n.not ? 'NOT ' : ''}EXISTS (${this.select(n.q, w)})`;
      case 'over': {
        const parts: string[] = [];
        if (n.partition.length > 0)
          parts.push(`PARTITION BY ${n.partition.map((p) => this.node(p, w)).join(', ')}`);
        if (n.order.length > 0)
          parts.push(
            `ORDER BY ${n.order.map((o) => this.node(o.e, w) + (o.desc ? ' DESC' : ' ASC')).join(', ')}`,
          );
        if (n.frame) parts.push(n.frame);
        return `${this.node(n.fn, w)} OVER (${parts.join(' ')})`;
      }
      case 'sub':
        return `(${this.select(n.q, w)})`;
      case 'string_agg':
        return this.stringAgg(n, w);
    }
  }

  protected conjunction(items: readonly Node[], w: SqlWriter): string {
    return items.map((i) => this.wrap(i, 'and', w)).join(' AND ');
  }

  /** AND 里的 OR、比较里的运算要加括号 */
  private wrap(n: Node, parent: 'and' | 'or', w: SqlWriter): string {
    const s = this.condition(n, w);
    return (n.k === 'or' && parent === 'and') || (n.k === 'and' && parent === 'or') ? `(${s})` : s;
  }

  private operand(n: Node, w: SqlWriter): string {
    const s = this.node(n, w);
    return n.k === 'op' || n.k === 'and' || n.k === 'or' || n.k === 'raw' ? `(${s})` : s;
  }
}

/** 路径里的一段键：双引号括起来，里面的双引号与反斜杠前面加反斜杠 */
function quoteJsonKey(key: string): string {
  return `"${key.replace(/["\\]/g, (c) => `\\${c}`)}"`;
}

/** JSON 函数的路径（JSON 数组的字面量）拆回各段 */
export function jsonPathParts(literal: string): (string | number)[] {
  return JSON.parse(unquoteSql(literal)) as (string | number)[];
}

/** 标准 JSON 路径：$."key"[0]（MySQL、SQLite、HANA），键一律加引号 */
export function standardJsonPath(literal: string): string {
  const path = jsonPathParts(literal)
    .map((p) => (typeof p === 'number' ? `[${p}]` : `.${quoteJsonKey(p)}`))
    .join('');
  return sqlString(`$${path}`);
}

/** PG 的路径：'{key,0}'（文字数组），每段加引号 */
function pgJsonPath(literal: string): string {
  const parts = jsonPathParts(literal).map((p) => quoteJsonKey(String(p)));
  return sqlString(`{${parts.join(',')}}`);
}

/** diff 的单位折合多少秒 */
const SECONDS: Record<string, number> = { second: 1, minute: 60, hour: 3600, day: 86400 };

/** 日期格式里认得的部分（写法同 Java 的 DateTimeFormatter） */
export type DateToken = 'yyyy' | 'yy' | 'MM' | 'dd' | 'HH' | 'mm' | 'ss';
export type DatePart = { readonly token: DateToken } | { readonly text: string };
const DATE_TOKENS: readonly DateToken[] = ['yyyy', 'yy', 'MM', 'dd', 'HH', 'mm', 'ss'];

/** 把 'yyyy-MM-dd HH:mm' 拆成格式符与原样输出的文字 */
export function dateFormatParts(pattern: string): DatePart[] {
  const parts: DatePart[] = [];
  let i = 0;
  while (i < pattern.length) {
    const token = DATE_TOKENS.find((t) => pattern.startsWith(t, i));
    if (token) {
      parts.push({ token });
      i += token.length;
      continue;
    }
    const last = parts.at(-1);
    if (last && 'text' in last) parts[parts.length - 1] = { text: last.text + pattern[i] };
    else parts.push({ text: pattern[i]! });
    i++;
  }
  return parts;
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

/** 类型同义词（先长后短）：PG 的全称、各库的别名 */
const TYPE_SYNONYMS: readonly [RegExp, string][] = [
  [/\b(timestamp(?:\(\d+\))?) without time zone\b/g, '$1'],
  [/\btimestamp(\(\d+\))? with time zone\b/g, 'timestamptz$1'],
  [/\b(time(?:\(\d+\))?) without time zone\b/g, '$1'],
  [/\bcharacter varying\b/g, 'varchar'],
  [/\bdouble precision\b/g, 'double'],
  [/\b(?:integer|int4)\b/g, 'int'],
  [/\bint8\b/g, 'bigint'],
  [/\bnumeric\b/g, 'decimal'],
  [/\bbool\b/g, 'boolean'],
];

const JOIN_WORDS: Record<JoinKind, string> = {
  inner: 'INNER JOIN',
  left: 'LEFT JOIN',
  right: 'RIGHT JOIN',
  cross: 'CROSS JOIN',
};

function int(n: number): number {
  if (!Number.isSafeInteger(n) || n < 0)
    throw new RangeError(`limit/offset must be a non-negative integer, got ${n}`);
  return n;
}
