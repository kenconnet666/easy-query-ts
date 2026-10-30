/** SQLite 方言：各个 SQLite 驱动（node:sqlite、bun:sqlite、D1、libSQL）共用 */
import {
  Dialect,
  type ColumnOptions,
  type DbTable,
  type Entity,
  type QueryRunner,
  coalesceEach,
  sqlString,
  standardJsonPath,
  unquoteSql,
  type DatePart,
  type FunctionRenderer,
  type Node,
  type SqlWriter,
} from '@zerodep-dev/easy-query-ts';
/** SQLite 的日期时间是文字：用 strftime 取整，结果仍是 'YYYY-MM-DD HH:MM:SS' */
/** LPAD / RPAD 的 SQLite 写法：比 length 长时截到 length，否则用 fill 补足（fill 重复 length 次再截取） */
function pad([value, length, fill]: string[], start: boolean): string {
  const filler = `SUBSTR(REPLACE(HEX(ZEROBLOB(${length})), '00', ${fill}), 1, ${length} - LENGTH(${value}))`;
  const padded = start ? `${filler} || ${value}` : `${value} || ${filler}`;
  return `(CASE WHEN LENGTH(${value}) >= ${length} THEN SUBSTR(${value}, 1, ${length}) ELSE ${padded} END)`;
}

/** diff 的单位折合多少秒 */
const DIFF_SECONDS: Record<string, number> = { second: 1, minute: 60, hour: 3600, day: 86400 };

function dateTrunc(x: string, unit: string): string {
  switch (unit) {
    case 'year':
      return `strftime('%Y-01-01 00:00:00', ${x})`;
    // 季度：本季第一个月 = ((月 - 1) / 3) * 3 + 1
    case 'quarter':
      return `(strftime('%Y-', ${x}) || printf('%02d', ((CAST(strftime('%m', ${x}) AS INTEGER) - 1) / 3) * 3 + 1) || '-01 00:00:00')`;
    case 'month':
      return `strftime('%Y-%m-01 00:00:00', ${x})`;
    // 'weekday 0' 先走到本周日（或当天就是周日），再退 6 天回到周一
    case 'week':
      return `strftime('%Y-%m-%d 00:00:00', ${x}, 'weekday 0', '-6 days')`;
    case 'day':
      return `strftime('%Y-%m-%d 00:00:00', ${x})`;
    case 'hour':
      return `strftime('%Y-%m-%d %H:00:00', ${x})`;
    case 'minute':
      return `strftime('%Y-%m-%d %H:%M:00', ${x})`;
    default:
      return `strftime('%Y-%m-%d %H:%M:%S', ${x})`;
  }
}

export class SqliteDialect extends Dialect {
  readonly name = 'sqlite';
  /** SQLite 的 IS 就是 null 安全的相等 */
  override readonly nullSafeEquals = 'IS';
  /** SQLite 3.35+（node:sqlite 自带的版本满足） */
  override readonly supportsReturning = true;
  /** 没有注释；外键只能写在建表语句里；DDL 能放进事务 */
  override readonly commentStyle = 'none';
  override readonly inlineForeignKeys = true;
  override readonly transactionalDdl = true;

  /** 读 sqlite_master 与 pragma_table_info / index_list / foreign_key_list（外键没有名字，按列比较） */
  override async introspect(run: QueryRunner): Promise<DbTable[]> {
    const tables = await run(
      `SELECT name, sql FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name`,
    );
    const out: DbTable[] = [];
    for (const t of tables) {
      const name = String(t['name']);
      const autoincrement = /\bAUTOINCREMENT\b/i.test(typeof t['sql'] === 'string' ? t['sql'] : '');
      const columns = await run(
        `SELECT name, type, "notnull" AS not_null, dflt_value, pk FROM pragma_table_info(?) ORDER BY cid`,
        [name],
      );
      const indexes = [];
      for (const i of await run(
        `SELECT name, "unique" AS is_unique FROM pragma_index_list(?) WHERE origin <> 'pk' ORDER BY name`,
        [name],
      )) {
        const parts = await run(`SELECT name FROM pragma_index_info(?) ORDER BY seqno`, [
          i['name'],
        ]);
        indexes.push({
          name: String(i['name']),
          columns: parts.map((p) => String(p['name'])),
          unique: Number(i['is_unique']) === 1,
        });
      }
      const keys = await run(
        `SELECT id, "table" AS referenced_table, "from" AS column_name, "to" AS referenced_column
         FROM pragma_foreign_key_list(?) ORDER BY id, seq`,
        [name],
      );
      const foreignKeys = [...new Set(keys.map((k) => Number(k['id'])))].map((id) => {
        const list = keys.filter((k) => Number(k['id']) === id);
        return {
          name: `fk_${name}_${id}`,
          columns: list.map((k) => String(k['column_name'])),
          references: String(list[0]!['referenced_table']),
          referencedColumns: list.map((k) => String(k['referenced_column'])),
        };
      });
      out.push({
        name,
        comment: null,
        columns: columns.map((c) => ({
          name: String(c['name']),
          type: String(c['type']),
          // 主键列在 SQLite 里可以不写 NOT NULL，按声明它不会是 NULL
          nullable: Number(c['not_null']) === 0 && Number(c['pk']) === 0,
          default: c['dflt_value'] === null ? null : String(c['dflt_value'] as string | number),
          comment: null,
          generated: autoincrement && Number(c['pk']) === 1,
        })),
        primaryKey: columns
          .filter((c) => Number(c['pk']) > 0)
          .sort((a, b) => Number(a['pk']) - Number(b['pk']))
          .map((c) => String(c['name'])),
        indexes,
        foreignKeys,
      });
    }
    return out;
  }

  /** SQLite 只有 INTEGER / REAL / TEXT / BLOB / NUMERIC 几种亲和性：日期时间都是 TEXT，布尔是 INTEGER */
  override columnType(kind: string, o: ColumnOptions): string {
    if (o.dbType) return o.dbType;
    switch (kind) {
      case 'int':
      case 'bigint':
      case 'boolean':
        return 'INTEGER';
      case 'decimal':
        return 'NUMERIC';
      case 'double':
        return 'REAL';
      case 'bytes':
        return 'BLOB';
      default:
        return 'TEXT';
    }
  }

  /** 自增主键必须写成 `INTEGER PRIMARY KEY AUTOINCREMENT`（主键约束就在列上） */
  override columnDefinition(name: string, kind: string, o: ColumnOptions): string {
    if (o.generated) return `${this.quote(name)} INTEGER PRIMARY KEY AUTOINCREMENT`;
    return super.columnDefinition(name, kind, o);
  }

  protected override tableConstraints(entity: Entity): string[] {
    const hasGenerated = Object.values(entity.columns).some((c) => c.options.generated);
    return super
      .tableConstraints(entity)
      .filter((c) => !(hasGenerated && c.startsWith('PRIMARY KEY')));
  }

  /** SQLite 没有 ROLLUP / CUBE */
  override groupByKeys(keys: string[], mode: 'rollup' | 'cube' | undefined): string {
    if (mode) throw new Error(`${mode}() is not supported by SQLite`);
    return keys.join(', ');
  }

  protected override functions(): Record<string, FunctionRenderer> {
    return {
      ...super.functions(),
      length: (a) => `LENGTH(${a[0]})`,
      concat: (a) => `(${a.join(' || ')})`,
      year: (a) => `CAST(strftime('%Y', ${a[0]}) AS INTEGER)`,
      month: (a) => `CAST(strftime('%m', ${a[0]}) AS INTEGER)`,
      day: (a) => `CAST(strftime('%d', ${a[0]}) AS INTEGER)`,
      substring: (a) => `SUBSTR(${a.join(', ')})`,
      index_of: (a) => `(INSTR(${a[0]}, ${a[1]}) - 1)`,
      left: (a) => `SUBSTR(${a[0]}, 1, ${a[1]})`,
      // 起点小于 1 时 SQLite 会改成"从右数"，所以用 MAX 夹在 1 以上（n 超过长度时取整个字符串）
      right: (a) => `SUBSTR(${a[0]}, MAX(LENGTH(${a[0]}) - ${a[1]} + 1, 1))`,
      // 内置的 FLOOR / CEIL 要编译时打开数学函数，不一定有，用取整加修正代替
      floor: (a) => `(CAST(${a[0]} AS INTEGER) - (${a[0]} < CAST(${a[0]} AS INTEGER)))`,
      ceil: (a) => `(CAST(${a[0]} AS INTEGER) + (${a[0]} > CAST(${a[0]} AS INTEGER)))`,
      mod: (a) => `(${a[0]} % ${a[1]})`,
      // SQLite 的日期时间是文字，用 datetime() 做加减；结果是 'YYYY-MM-DD HH:MM:SS'，不带毫秒
      add_days: (a) => `datetime(${a[0]}, '${a[1]} days')`,
      add_months: (a) => `datetime(${a[0]}, '${a[1]} months')`,
      diff_days: (a) =>
        `CAST(ROUND(julianday(date(${a[0]})) - julianday(date(${a[1]}))) AS INTEGER)`,
      date_trunc: (a) => dateTrunc(a[0]!, a[1]!.replace(/'/g, '')),
      // 加时间单位：修饰符可以是表达式拼出来的（'3 hours'）；%f 保留毫秒
      add_time: (a) =>
        `strftime('%Y-%m-%d %H:%M:%f', ${a[0]}, (${a[1]}) || ' ${unquoteSql(a[2]!)}s')`,
      hour: (a) => `CAST(strftime('%H', ${a[0]}) AS INTEGER)`,
      minute: (a) => `CAST(strftime('%M', ${a[0]}) AS INTEGER)`,
      second: (a) => `CAST(strftime('%S', ${a[0]}) AS INTEGER)`,
      day_of_year: (a) => `CAST(strftime('%j', ${a[0]}) AS INTEGER)`,
      day_of_week: (a) => `CAST(strftime('%w', ${a[0]}) AS INTEGER)`,
      iso_day_of_week: (a) => `CAST(strftime('%u', ${a[0]}) AS INTEGER)`,
      // 按秒算再整除（向零取整）：julianday 的差直接乘会有浮点误差
      diff_time: (a) =>
        `(CAST(ROUND((julianday(${a[0]}) - julianday(${a[1]})) * 86400) AS INTEGER) / ${DIFF_SECONDS[unquoteSql(a[2]!)]})`,
      now: () => `strftime('%Y-%m-%d %H:%M:%f', 'now')`,
      in_csv: (a) => `((',' || ${a[1]} || ',') LIKE ('%,' || ${a[0]} || ',%'))`,
      // JSON：-> 取元素（总是 JSON 文字），json_extract 取标量
      json_value: (a) => `(${a[0]} -> ${standardJsonPath(a[1]!)})`,
      json_text: (a) => `CAST(json_extract(${a[0]}, ${standardJsonPath(a[1]!)}) AS TEXT)`,
      json_number: (a) => `CAST(json_extract(${a[0]}, ${standardJsonPath(a[1]!)}) AS REAL)`,
      json_boolean: (a) => `json_extract(${a[0]}, ${standardJsonPath(a[1]!)})`,
      json_has: (a) => `(json_type(${a[0]}, ${standardJsonPath(a[1]!)}) IS NOT NULL)`,
      json_length: (a) => `json_array_length(${a[0]}, ${standardJsonPath(a[1]!)})`,
      // 没有 LPAD / RPAD：比 length 长时截断，否则补足（参数可以重复，见 Dialect.node 的 fn）
      pad_start: (a) => pad(a, true),
      pad_end: (a) => pad(a, false),
      // 多参数的 MAX / MIN 就是 GREATEST / LEAST
      greatest: (a) => `MAX(${coalesceEach(a)})`,
      least: (a) => `MIN(${coalesceEach(a)})`,
      // 两个参数的 LOG 在 libSQL 自带的 SQLite 里没有：换底公式
      log: (a) => `(LN(${a[0]}) / LN(${a[1]}))`,
      // CAST AS INTEGER 向零截断：trunc() 要 SQLite 3.46+（libSQL、较老的系统库没有）
      truncate: (a) => `(CAST((${a[0]}) * POWER(10, ${a[1]}) AS INTEGER) / POWER(10, ${a[1]}))`,
      cast_string: (a) => `CAST(${a[0]} AS TEXT)`,
      cast_double: (a) => `CAST(${a[0]} AS REAL)`,
      cast_decimal: (a) => `CAST(${a[0]} AS NUMERIC)`,
      cast_date: (a) => `date(${a[0]})`,
      cast_datetime: (a) => `datetime(${a[0]})`,
    };
  }

  /** strftime：%Y-%m-%d %H:%M:%S，文字里的 % 写两次；两位年份没有对应的格式符 */
  protected override formatDate(value: string, parts: readonly DatePart[]): string {
    const tokens: Record<string, string> = {
      yyyy: '%Y',
      MM: '%m',
      dd: '%d',
      HH: '%H',
      mm: '%M',
      ss: '%S',
    };
    const format = parts
      .map((p) => {
        if (!('token' in p)) return p.text.replaceAll('%', '%%');
        const token = tokens[p.token];
        if (!token)
          throw new Error(`date format '${p.token}' is not supported by the sqlite dialect`);
        return token;
      })
      .join('');
    return `strftime(${sqlString(format)}, ${value})`;
  }

  /** GROUP_CONCAT(e, '分隔符' ORDER BY …)；DISTINCT 只能用默认的逗号分隔 */
  protected override stringAgg(n: Extract<Node, { k: 'string_agg' }>, w: SqlWriter): string {
    if (n.distinct) {
      if (n.separator !== ',')
        throw new Error(
          "sqlite only supports joining({ distinct: true }) with the default ',' separator",
        );
      return `GROUP_CONCAT(DISTINCT ${this.node(n.e, w)}${this.aggOrder(n.order, w)})`;
    }
    return `GROUP_CONCAT(${this.node(n.e, w)}, ${sqlString(n.separator)}${this.aggOrder(n.order, w)})`;
  }

  /** SQLite 没有行锁，事务本身锁库 */
  override forUpdate(): string {
    return '';
  }

  /** 没有行锁：Db.lock 改用一条写语句，让事务马上拿到写锁（延迟事务在第一次写之前只有读锁） */
  override get rowLocks(): boolean {
    return false;
  }
}
