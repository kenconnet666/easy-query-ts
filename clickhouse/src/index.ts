/**
 * ClickHouse（列式分析库），驱动用官方的 @clickhouse/client（HTTP 接口）。以查询为主，写入按它的能力裁剪：
 * ```ts
 * import { createClient } from '@clickhouse/client'
 * const db = createDb({ schema, adapter: clickhouse(createClient({ url, username, password, database })) })
 * ```
 * - 参数是带类型的 `{p1:Int64}`（类型按 JS 值推断，字符串由服务端按列的类型转换）
 * - 没有自增列与 RETURNING：主键要由应用给值（雪花 ID、UUID）
 * - 更新、删除是 mutation：`ALTER TABLE t UPDATE … WHERE …` / `ALTER TABLE t DELETE WHERE …`，每条都设 mutations_sync=2 等它做完；
 *   驱动报不出影响的行数（返回 0），所以乐观锁（version 列）的检查不可用
 * - 没有事务：transaction() 里的语句依次执行，出错时不回滚
 * - 建表：ENGINE = MergeTree ORDER BY 主键；可空列写成 Nullable(T)；没有唯一约束与外键（unique 不写进建表语句）
 */
import type { ClickHouseClient, ClickHouseSettings } from '@clickhouse/client';
import {
  assembleTables,
  Dialect,
  sqlString,
  SqlWriter,
  standardJsonPath,
  unquoteSql,
  type Adapter,
  type Without,
  type ColumnOptions,
  type DbTable,
  type DeleteNode,
  type Driver,
  type Entity,
  type ExecuteResult,
  type ForeignKeySpec,
  type FunctionRenderer,
  type Node,
  type QueryRunner,
  type Session,
  type TableIndex,
  type UpdateNode,
} from '@zerodep-dev/easy-query-ts';

const SECONDS: Record<string, number> = { second: 1, minute: 60, hour: 3600, day: 86400 };

/** JS 值 → 参数的 ClickHouse 类型 */
function paramType(value: unknown): string {
  if (value === null || value === undefined) return 'Nullable(String)';
  if (typeof value === 'boolean') return 'Bool';
  if (typeof value === 'bigint') return 'Int64';
  if (typeof value === 'number') return Number.isInteger(value) ? 'Int64' : 'Float64';
  return 'String';
}

export class ClickHouseDialect extends Dialect {
  readonly name = 'clickhouse';
  override readonly commentStyle = 'inline' as const;
  override readonly indexIfNotExists = true;

  /** 更新、删除的 mutation 里不能有表别名：渲染时列名不带别名 */
  private bareColumns = false;

  override quote(identifier: string): string {
    return `\`${identifier.replace(/`/g, '``')}\``;
  }

  /** 占位符带上按值推断的类型 */
  override placeholder(index: number, value: unknown): string {
    return `{p${index}:${paramType(value)}}`;
  }

  /** 反斜杠本来就是 LIKE 的转义符（字面量里写 '\' 反而是没闭合的字符串） */
  override likeEscape(): string {
    return '';
  }

  /** 有 Bool 类型，不转 1 / 0 */
  override encodeParam(value: unknown, kind?: string): unknown {
    return typeof value === 'boolean' ? value : super.encodeParam(value, kind);
  }

  override node(n: Node, w: SqlWriter): string {
    if (n.k === 'col' && this.bareColumns) return this.quote(n.name);
    return super.node(n, w);
  }

  /** 没有行锁 */
  override get rowLocks(): boolean {
    return false;
  }

  override forUpdate(): string {
    throw new Error('row locks are not supported by the clickhouse dialect');
  }

  // ---- 写入（mutation） ----

  /** `ALTER TABLE t UPDATE c = … WHERE …`；经过导航时范围写成主键 IN (带 join 的子查询)，新值只能用本表的列 */
  override update(q: UpdateNode, w: SqlWriter = new SqlWriter()): string {
    return this.mutation(q, w, (where) => {
      const set = this.bare(() =>
        q.set.map((s) => `${this.quote(s.column)} = ${this.value(s.e, w)}`).join(', '),
      );
      return `ALTER TABLE ${this.table(q.from.table)} UPDATE ${set} WHERE ${where}`;
    });
  }

  override delete(q: DeleteNode, w: SqlWriter = new SqlWriter()): string {
    return this.mutation(
      q,
      w,
      (where) => `ALTER TABLE ${this.table(q.from.table)} DELETE WHERE ${where}`,
    );
  }

  private mutation(
    q: UpdateNode | DeleteNode,
    w: SqlWriter,
    render: (where: string) => string,
  ): string {
    if (!q.joins?.length)
      return render(q.where.length > 0 ? this.bare(() => this.conjunction(q.where, w)) : '1');
    if (!q.key?.length)
      throw new Error(`a mutation through a navigation needs a primary key on ${q.from.table}`);
    const key = q.key.map((k) => this.quote(k));
    const scope = `SELECT ${q.key.map((k) => `${q.from.alias}.${this.quote(k)}`).join(', ')} FROM ${this.table(q.from.table)} AS ${q.from.alias}${this.joinClauses(q.joins, w)}${q.where.length > 0 ? ` WHERE ${this.conjunction(q.where, w)}` : ''}`;
    return render(`(${key.join(', ')}) IN (${scope})`);
  }

  private bare<T>(work: () => T): T {
    this.bareColumns = true;
    try {
      return work();
    } finally {
      this.bareColumns = false;
    }
  }

  /** 没有自增列 */
  override identity(): string {
    throw new Error(
      'ClickHouse has no auto-increment columns: give the key a value (snowflake id, UUID …)',
    );
  }

  // ---- 函数 ----

  protected override functions(): Record<string, FunctionRenderer> {
    return {
      ...super.functions(),
      length: (a) => `char_length(${a[0]})`,
      index_of: (a) => `(positionUTF8(${a[0]}, ${a[1]}) - 1)`,
      substring: (a) => `substringUTF8(${a.join(', ')})`,
      left: (a) => `leftUTF8(${a[0]}, ${a[1]})`,
      right: (a) => `rightUTF8(${a[0]}, ${a[1]})`,
      pad_start: (a) => `leftPadUTF8(${a.join(', ')})`,
      pad_end: (a) => `rightPadUTF8(${a.join(', ')})`,
      ceil: (a) => `ceil(${a[0]})`,
      truncate: (a) => `trunc(${a[0]}, ${a[1]})`,
      log: (a) => `(log(${a[0]}) / log(${a[1]}))`,
      atan2: (a) => `atan2(${a[0]}, ${a[1]})`,
      add_days: (a) => `addDays(${a[0]}, ${a[1]})`,
      add_months: (a) => `addMonths(${a[0]}, ${a[1]})`,
      add_time: (a) => `date_add(${unquoteSql(a[2]!).toUpperCase()}, ${a[1]}, ${a[0]})`,
      diff_days: (a) => `dateDiff('day', toDate(${a[1]}), toDate(${a[0]}))`,
      // 按经过的秒数整除（向零截断），与其它库一致；dateDiff 数的是跨过的边界
      diff_time: (a) =>
        `intDiv(dateDiff('second', ${a[1]}, ${a[0]}), ${SECONDS[unquoteSql(a[2]!)]})`,
      year: (a) => `toYear(${a[0]})`,
      month: (a) => `toMonth(${a[0]})`,
      day: (a) => `toDayOfMonth(${a[0]})`,
      hour: (a) => `toHour(${a[0]})`,
      minute: (a) => `toMinute(${a[0]})`,
      second: (a) => `toSecond(${a[0]})`,
      day_of_year: (a) => `toDayOfYear(${a[0]})`,
      day_of_week: (a) => `(toDayOfWeek(${a[0]}) % 7)`,
      iso_day_of_week: (a) => `toDayOfWeek(${a[0]})`,
      date_trunc: (a) => `toDateTime64(date_trunc(${a[1]}, ${a[0]}), 3)`,
      now: () => `now64(3, 'UTC')`,
      in_csv: (a) => `has(splitByChar(',', ${a[1]}), toString(${a[0]}))`,
      json_value: (a) => `JSONExtractRaw(${a[0]}, ${jsonKeys(a[1]!)})`,
      json_text: (a) => `JSONExtractString(${a[0]}, ${jsonKeys(a[1]!)})`,
      json_number: (a) => `JSONExtractFloat(${a[0]}, ${jsonKeys(a[1]!)})`,
      json_boolean: (a) => `JSONExtractBool(${a[0]}, ${jsonKeys(a[1]!)})`,
      json_has: (a) => `JSONHas(${a[0]}, ${jsonKeys(a[1]!)})`,
      json_length: (a) => `JSONLength(${a[0]}, ${jsonKeys(a[1]!)})`,
      cast_string: (a) => `toString(${a[0]})`,
      cast_int: (a) => `toInt32(${a[0]})`,
      cast_bigint: (a) => `toInt64(${a[0]})`,
      cast_double: (a) => `toFloat64(${a[0]})`,
      cast_datetime: (a) => `toDateTime64(${a[0]}, 3)`,
    };
  }

  /** groupArray 再拼接；ORDER BY 用 arraySort 按排序键排 */
  protected override stringAgg(n: Extract<Node, { k: 'string_agg' }>, w: SqlWriter): string {
    const value = this.node(n.e, w);
    const values = n.distinct ? `groupUniqArray(${value})` : `groupArray(${value})`;
    return `arrayStringConcat(${values}, ${sqlString(n.separator)})`;
  }

  // ---- 建表 ----

  override columnType(kind: string, o: ColumnOptions): string {
    if (o.dbType) return o.dbType;
    switch (kind) {
      case 'uuid':
        return 'UUID';
      case 'string':
      case 'json':
      case 'time':
      case 'bytes':
        return 'String';
      case 'int':
        return 'Int32';
      case 'bigint':
        return 'Int64';
      case 'decimal':
        return `Decimal(${o.precision ?? 38}, ${o.scale ?? 10})`;
      case 'double':
        return 'Float64';
      case 'boolean':
        return 'Bool';
      case 'date':
        return 'Date32';
      case 'datetime':
        return 'DateTime64(3)';
      default:
        return super.columnType(kind, o);
    }
  }

  /** 可空列写成 Nullable(T)；DEFAULT、COMMENT 跟在类型后面 */
  override columnDefinition(name: string, kind: string, o: ColumnOptions): string {
    if (o.generated) this.identity();
    const type = this.columnType(kind, o);
    return [
      this.quote(name),
      o.nullable ? `Nullable(${type})` : type,
      o.dbDefault !== undefined ? `DEFAULT ${o.dbDefault}` : undefined,
      o.comment !== undefined ? `COMMENT ${sqlString(o.comment)}` : undefined,
    ]
      .filter(Boolean)
      .join(' ');
  }

  /** 没有主键、唯一约束：主键写成 MergeTree 的排序键 */
  protected override tableConstraints(): string[] {
    return [];
  }

  protected override tableOptions(entity: Entity): string {
    const key = entity.primaryKey.map((p) => this.quote(entity.columnNames[p]!));
    const order = key.length > 0 ? `(${key.join(', ')})` : 'tuple()';
    const comment = entity.comment !== undefined ? ` COMMENT ${sqlString(entity.comment)}` : '';
    return ` ENGINE = MergeTree ORDER BY ${order}${comment}`;
  }

  /** 索引是跳数索引（minmax）；没有唯一索引 */
  override createIndex(table: string, index: TableIndex, ifNotExists: boolean): string {
    if (index.unique)
      throw new Error(`unique indexes are not supported by the clickhouse dialect (${index.name})`);
    return `ALTER TABLE ${this.table(table)} ADD INDEX ${ifNotExists ? 'IF NOT EXISTS ' : ''}${this.quote(index.name)} (${index.columns.map((c) => this.quote(c)).join(', ')}) TYPE minmax GRANULARITY 1`;
  }

  override addForeignKey(fk: ForeignKeySpec): string {
    throw new Error(`foreign keys are not supported by the clickhouse dialect (${fk.name})`);
  }

  override addColumn(table: string, name: string, kind: string, o: ColumnOptions): string {
    return `ALTER TABLE ${this.table(table)} ADD COLUMN ${this.columnDefinition(name, kind, o)}`;
  }

  /** system.tables / system.columns / system.data_skipping_indices（当前库） */
  override async introspect(run: QueryRunner): Promise<DbTable[]> {
    return assembleTables({
      tables: await run(
        `SELECT name AS table_name, comment FROM system.tables
         WHERE database = currentDatabase() AND NOT is_temporary AND engine NOT LIKE '%View' ORDER BY name`,
      ),
      columns: await run(
        `SELECT table AS table_name, name AS column_name, replaceRegexpOne(type, '^Nullable\\\\((.*)\\\\)$', '\\\\1') AS column_type,
           startsWith(type, 'Nullable(') AS is_nullable, if(default_kind = '', NULL, default_expression) AS column_default,
           if(comment = '', NULL, comment) AS comment, 0 AS is_generated, is_in_sorting_key AS primary_key
         FROM system.columns WHERE database = currentDatabase() ORDER BY table, position`,
      ),
      indexes: await run(
        `SELECT table AS table_name, name AS index_name, 0 AS is_unique, trim(BOTH ' ' FROM column_name) AS column_name
         FROM system.data_skipping_indices ARRAY JOIN splitByChar(',', expr) AS column_name
         WHERE database = currentDatabase() ORDER BY table, name`,
      ),
      foreignKeys: [],
    });
  }
}

/** JSON 路径 '$.a.b[0]' → JSONExtract 的键参数 'a', 'b', 1（数组下标从 1 开始） */
function jsonKeys(path: string): string {
  const parts = unquoteSql(standardJsonPath(path))
    .replace(/^\$\.?/, '')
    .split(/\.|(?=\[)/)
    .filter(Boolean);
  return parts
    .map((p) => {
      const index = /^\[(\d+)\]$/.exec(p);
      return index ? String(Number(index[1]) + 1) : sqlString(p.replace(/^"|"$/g, ''));
    })
    .join(', ');
}

// ---- 驱动 ----

/** 每条语句都带的设置：mutation 同步完成、LEFT JOIN 补 NULL、DECIMAL 按文字输出（保留小数位）、会话时区 UTC */
const SETTINGS: ClickHouseSettings = {
  mutations_sync: '2',
  join_use_nulls: 1,
  output_format_json_quote_decimals: 1,
  output_format_decimal_trailing_zeros: 1,
  session_timezone: 'UTC',
};

function queryParams(params: readonly unknown[]): Record<string, unknown> {
  return Object.fromEntries(
    params.map((v, i) => [
      `p${i + 1}`,
      v instanceof Uint8Array ? Buffer.from(v).toString('latin1') : v,
    ]),
  );
}

class ClickHouseDriver implements Driver {
  private readonly client: ClickHouseClient;

  constructor(client: ClickHouseClient) {
    this.client = client;
  }

  async query(sql: string, params: readonly unknown[]): Promise<Record<string, unknown>[]> {
    const result = await this.client.query({
      query: sql,
      query_params: queryParams(params),
      format: 'JSONEachRow',
      clickhouse_settings: SETTINGS,
    });
    return result.json<Record<string, unknown>>();
  }

  async execute(sql: string, params: readonly unknown[]): Promise<ExecuteResult> {
    const { summary } = await this.client.command({
      query: sql,
      query_params: queryParams(params),
      clickhouse_settings: SETTINGS,
    });
    // 插入报得出写入的行数；mutation 报不出影响的行数
    return {
      affected: /^INSERT /.test(sql) ? Number(summary?.written_rows ?? 0) : 0,
      insertId: undefined,
    };
  }

  /** 没有事务：依次执行，出错时不回滚 */
  async transaction<T>(work: (session: Session) => Promise<T>): Promise<T> {
    return work(this);
  }
}

/** ClickHouse 缺的能力：没有事务、行锁、RETURNING、自增、upsert */
export type ClickHouseAdapter = Adapter<
  Without<
    | 'transactions'
    | 'lock'
    | 'forUpdate'
    | 'skipLocked'
    | 'noWait'
    | 'returning'
    | 'generatedKeys'
    | 'upsert'
    | 'upsertIgnore'
  >
>;

export function clickhouse(client: ClickHouseClient): ClickHouseAdapter {
  return { dialect: new ClickHouseDialect(), driver: new ClickHouseDriver(client) };
}
