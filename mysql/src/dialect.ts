/** MySQL 方言（不依赖驱动）：MySQL 与 MySQL 协议的兼容库（Doris）共用 */
import {
  assembleTables,
  Dialect,
  sqlString,
  standardJsonPath,
  SqlWriter,
  type ColumnOptions,
  type ConflictNode,
  type DatePart,
  type DbTable,
  type DialectOptions,
  type DeleteNode,
  type Entity,
  type FunctionRenderer,
  type Node,
  type QueryRunner,
  type SelectNode,
  type TableIndex,
  type UpdateNode,
} from '@zerodep-dev/easy-query-ts';
import { mysqlFunctions } from './functions.ts';

/** MySQL 要求 OFFSET 前必须有 LIMIT；没给 LIMIT 时用最大值 */
const NO_LIMIT = '18446744073709551615';

/** MySQL 的版本：'8.0.18'（PolarDB 基线）、'8.4'、'9.1' …；5.7 也能用，只是窗口函数、CTE 渲染时报错 */
export type MySqlVersion = `${5 | 8 | 9}.${number}` | `${5 | 8 | 9}.${number}.${number}`;

/** 方言选项：版本与服务器的 max_allowed_packet（字节） */
export interface MySqlDialectOptions extends DialectOptions {
  readonly maxPacket?: number | undefined;
}

/** 没给 max_allowed_packet 时按 4 MiB（5.7 的默认值；8.0 默认 64 MiB，mysql.detect 读服务器的实际值） */
const DEFAULT_PACKET = 4 * 1024 * 1024;

/** 专属函数的最低版本 */
const MYSQL_MINIMUM: Record<string, string> = {
  'mysql.json_overlaps': '8.0.17',
  'mysql.member_of': '8.0.17',
  'mysql.member_of_path': '8.0.17',
};

export class MySqlDialect extends Dialect {
  /** 带 join：MySQL 的多表 UPDATE，JOIN 写在 SET 前面，SET 的列带上别名 */
  /** UPDATE / DELETE 单表时可以带 ORDER BY … LIMIT */
  override readonly nativeWriteLimit: boolean = true;

  override update(q: UpdateNode, w: SqlWriter = new SqlWriter()): string {
    if (!q.joins?.length)
      return super.update({ ...q, limit: undefined }, w) + this.writeLimit(q, w);
    const alias = q.from.alias;
    let s = `UPDATE ${this.table(q.from.table)} AS ${alias}${this.joinClauses(q.joins, w)}`;
    s += ` SET ${q.set.map((c) => `${alias}.${this.quote(c.column)} = ${this.node(c.e, w)}`).join(', ')}`;
    if (q.where.length > 0) s += ` WHERE ${this.conjunction(q.where, w)}`;
    return s;
  }

  private writeLimit(q: UpdateNode | DeleteNode, w: SqlWriter): string {
    if (!q.limit) return '';
    const order = q.limit.orderBy
      .map((o) => `${this.node(o.e, w)}${o.desc ? ' DESC' : ''}`)
      .join(', ');
    return `${order ? ` ORDER BY ${order}` : ''} LIMIT ${q.limit.count}`;
  }

  /** 带 join：`DELETE t0 FROM t AS t0 LEFT JOIN …` */
  override delete(q: DeleteNode, w: SqlWriter = new SqlWriter()): string {
    if (!q.joins?.length)
      return super.delete({ ...q, limit: undefined }, w) + this.writeLimit(q, w);
    let s = `DELETE ${q.from.alias} FROM ${this.table(q.from.table)} AS ${q.from.alias}${this.joinClauses(q.joins, w)}`;
    if (q.where.length > 0) s += ` WHERE ${this.conjunction(q.where, w)}`;
    return s;
  }

  readonly name: string = 'mysql';
  /** 一条语句的大小上限：max_allowed_packet 的四分之三（估计的字节数有误差，留余量） */
  override readonly maxStatementBytes: number | undefined;

  constructor(options: MySqlDialectOptions = {}) {
    super(options);
    this.maxStatementBytes = Math.floor((options.maxPacket ?? DEFAULT_PACKET) * 0.75);
  }
  /** MySQL 预处理语句最多 65535 个占位符 */
  override readonly maxBindParams = 65535;

  /**
   * mysql2 的 query 在客户端把参数插进 SQL：bigint 会被写成带引号的字符串，`BIGINT + '1'` 在 MySQL 里按 DOUBLE 运算，
   * 超过 2^53 的值就丢精度。bigint 只含数字和负号，直接写成整数字面量；二进制统一成 Buffer（mysql2 只认 Buffer）。
   */
  /** uuid 列存 BINARY(16)：标准写法的文字换成 16 个字节 */
  override encodeParam(value: unknown, kind?: string): unknown {
    if (kind === 'uuid' && typeof value === 'string')
      return Buffer.from(value.replace(/-/g, ''), 'hex');
    return super.encodeParam(value, kind);
  }

  override bindParam(value: unknown, w: SqlWriter): string {
    if (typeof value === 'bigint') return value.toString();
    return super.bindParam(
      value instanceof Uint8Array && !Buffer.isBuffer(value) ? Buffer.from(value) : value,
      w,
    );
  }

  override columnType(kind: string, o: ColumnOptions): string {
    if (o.dbType) return o.dbType;
    const type = this.baseColumnType(kind, o);
    return o.unsigned && /^(TINYINT|SMALLINT|INT|BIGINT|DECIMAL|DOUBLE)\b/.test(type)
      ? `${type} UNSIGNED`
      : type;
  }

  private baseColumnType(kind: string, o: ColumnOptions): string {
    if (o.nativeEnum && o.enumValues) return `ENUM(${o.enumValues.map(sqlString).join(', ')})`;
    switch (kind) {
      // 16 个字节：比 CHAR(36) 省一半多，比较也快；绑定时把文字换成字节（encodeParam）
      case 'uuid':
        return 'BINARY(16)';
      case 'int':
        return 'INT';
      case 'double':
        return 'DOUBLE';
      case 'datetime':
        return 'DATETIME(3)';
      case 'json':
        return 'JSON';
      default:
        return super.columnType(kind, o);
    }
  }

  override identity(): string {
    return 'AUTO_INCREMENT';
  }

  /** 列注释写在列定义里，表注释写在建表语句末尾 */
  override readonly commentStyle = 'inline';
  /** MySQL 的 CREATE INDEX 没有 IF NOT EXISTS */
  override readonly indexIfNotExists = false;

  /** FORMAT=JSON 的计划；analyze 要 8.0.18（只有文字树的格式） */
  override explainStatement(sql: string, analyze: boolean): string {
    if (!analyze) return `EXPLAIN FORMAT=JSON ${sql}`;
    this.requires('EXPLAIN ANALYZE', '8.0.18');
    return `EXPLAIN ANALYZE ${sql}`;
  }

  override explainResult(rows: readonly Record<string, unknown>[]): unknown {
    // FORMAT=JSON 是一段 JSON 文字，EXPLAIN ANALYZE 是文字树
    const text = rows[0]?.['EXPLAIN'];
    return typeof text === 'string' && text.startsWith('{') ? JSON.parse(text) : text;
  }

  /** 表达式索引（8.0.13+，多值索引也是它）与 USING BTREE / HASH；没有部分索引 */
  override readonly indexFeatures = { using: true, partial: false, expressions: true };

  /** 表达式写成 ((expr))；方法写在列后面，只有 BTREE、HASH */
  // MySQL 的 CREATE INDEX 没有 IF NOT EXISTS（indexIfNotExists），ifNotExists 用不上
  override createIndex(table: string, index: TableIndex, _ifNotExists: boolean): string {
    this.checkIndex(index);
    if (index.using && !['btree', 'hash'].includes(index.using))
      throw new Error(`index ${index.name}: USING ${index.using} is not supported by MySQL`);
    if (index.expressions?.length) this.requires('expression indexes', '8.0.13');
    const parts = [
      ...index.columns.map((c) => this.quote(c)),
      ...(index.expressions ?? []).map((e) => `(${e})`),
    ];
    const using = index.using ? ` USING ${index.using.toUpperCase()}` : '';
    return `CREATE ${index.unique ? 'UNIQUE ' : ''}INDEX ${this.quote(index.name)} ON ${this.table(table)} (${parts.join(', ')})${using}`;
  }

  protected override generatedColumn(computed: NonNullable<ColumnOptions['computed']>): string {
    return `GENERATED ALWAYS AS (${computed.sql}) ${computed.stored ? 'STORED' : 'VIRTUAL'}`;
  }

  protected override tableOptions(entity: Entity): string {
    return entity.comment !== undefined ? ` COMMENT=${sqlString(entity.comment)}` : '';
  }

  /** 整数的显示宽度（int(11)）不算类型差异；BOOLEAN 在库里是 tinyint(1) */
  protected override normalizeType(type: string): string {
    const t = super.normalizeType(type);
    if (t === 'tinyint(1)') return 'boolean';
    return t.replace(/^(tinyint|smallint|mediumint|int|bigint)\(\d+\)/, '$1');
  }

  /** 读 information_schema（当前库） */
  override async introspect(run: QueryRunner): Promise<DbTable[]> {
    const schema = 'TABLE_SCHEMA = DATABASE()';
    return assembleTables({
      tables: await run(
        `SELECT TABLE_NAME AS table_name, TABLE_COMMENT AS comment FROM information_schema.TABLES
         WHERE ${schema} AND TABLE_TYPE = 'BASE TABLE' ORDER BY TABLE_NAME`,
      ),
      columns: await run(
        `SELECT TABLE_NAME AS table_name, COLUMN_NAME AS column_name, COLUMN_TYPE AS column_type,
           IS_NULLABLE AS is_nullable, COLUMN_DEFAULT AS column_default, COLUMN_COMMENT AS comment,
           EXTRA LIKE '%auto_increment%' AS is_generated, COLUMN_KEY = 'PRI' AS primary_key
         FROM information_schema.COLUMNS WHERE ${schema} ORDER BY TABLE_NAME, ORDINAL_POSITION`,
      ),
      indexes: await run(
        `SELECT TABLE_NAME AS table_name, INDEX_NAME AS index_name, NON_UNIQUE = 0 AS is_unique,
           COLUMN_NAME AS column_name
         FROM information_schema.STATISTICS WHERE ${schema} AND INDEX_NAME <> 'PRIMARY'
         ORDER BY TABLE_NAME, INDEX_NAME, SEQ_IN_INDEX`,
      ),
      foreignKeys: await run(
        `SELECT TABLE_NAME AS table_name, CONSTRAINT_NAME AS constraint_name, COLUMN_NAME AS column_name,
           REFERENCED_TABLE_NAME AS referenced_table, REFERENCED_COLUMN_NAME AS referenced_column
         FROM information_schema.KEY_COLUMN_USAGE WHERE ${schema} AND REFERENCED_TABLE_NAME IS NOT NULL
         ORDER BY TABLE_NAME, CONSTRAINT_NAME, ORDINAL_POSITION`,
      ),
    });
  }

  /** MySQL 的 `<=>` 就是 null 安全的相等 */
  override readonly nullSafeEquals = '<=>';

  /** DATE_FORMAT：%Y-%m-%d %H:%i:%s，文字里的 % 写两次 */
  protected override formatDate(value: string, parts: readonly DatePart[]): string {
    const tokens = { yyyy: '%Y', yy: '%y', MM: '%m', dd: '%d', HH: '%H', mm: '%i', ss: '%s' };
    const format = parts
      .map((p) => ('token' in p ? tokens[p.token] : p.text.replaceAll('%', '%%')))
      .join('');
    return `DATE_FORMAT(${value}, ${sqlString(format)})`;
  }

  /** GROUP_CONCAT([DISTINCT] e ORDER BY … SEPARATOR '…') */
  /**
   * JSON_TABLE（8.0.4+）按声明的列把数组展开成行。不用 EXISTS：MySQL 把关联 JSON_TABLE 的 EXISTS 改写成不带关联条件的连接，
   * 结果错（8.4.11 实测，EXPLAIN 是 Inner hash join (no condition)）；数个数再比较结果正确，JSON 数组通常很小
   */
  protected override jsonSome(n: Extract<Node, { k: 'json_some' }>, w: SqlWriter): string {
    this.requires('JSON_TABLE (jsonSome)', '8.0.4');
    const rows = standardJsonPath(n.path).replace(/'$/, "[*]'");
    const columns = n.columns
      .map(
        (c) =>
          `${this.quote(c.name)} ${this.columnType(c.kind, c.options)} PATH ${standardJsonPath(sqlString(JSON.stringify([c.name])))}`,
      )
      .join(', ');
    return `((SELECT COUNT(*) FROM JSON_TABLE(${this.node(n.doc, w)}, ${rows} COLUMNS (${columns})) eq_j WHERE ${this.condition(n.cond, w)}) > 0)`;
  }

  protected override stringAgg(n: Extract<Node, { k: 'string_agg' }>, w: SqlWriter): string {
    return `GROUP_CONCAT(${n.distinct ? 'DISTINCT ' : ''}${this.node(n.e, w)}${this.aggOrder(n.order, w)} SEPARATOR ${sqlString(n.separator)})`;
  }

  /** MySQL 只有 WITH ROLLUP（没有 CUBE） */
  override groupByKeys(keys: string[], mode: 'rollup' | 'cube' | undefined): string {
    if (mode === 'cube')
      throw new Error(
        'cube() is not supported by MySQL; use rollup() or group the combinations yourself',
      );
    return keys.join(', ') + (mode === 'rollup' ? ' WITH ROLLUP' : '');
  }

  /** MySQL.json / MySQL.match 的函数（见 functions.ts） */
  protected override functions(): Record<string, FunctionRenderer> {
    const gated = Object.fromEntries(
      Object.entries(MYSQL_MINIMUM).map(([name, min]): [string, FunctionRenderer] => {
        const render = mysqlFunctions[name]!;
        return [
          name,
          (a) => (this.requires(`${name.replace(/^mysql\./, '').toUpperCase()}`, min), render(a)),
        ];
      }),
    );
    return { ...super.functions(), ...mysqlFunctions, ...gated };
  }

  override quote(identifier: string): string {
    return '`' + identifier.replace(/`/g, '``') + '`';
  }

  /** MySQL 的 LIKE 默认转义符就是反斜杠 */
  override likeEscape(): string {
    return '';
  }

  /**
   * MySQL 按表上的主键 / 唯一键判断冲突；用 VALUES(col) 取新值（8.0.19 起的 AS 别名写法 8.0.18 不认）。
   * ignore 写成对 target 的空更新，而不是 INSERT IGNORE（后者会吞掉其它错误）。
   */
  override onConflict(c: ConflictNode): string {
    if (c.update.length === 0)
      return ` ON DUPLICATE KEY UPDATE ${c.target.map((t) => `${this.quote(t)} = ${this.quote(t)}`).join(', ')}`;
    // 8.0.19 起用行别名取新值（VALUES() 在 8.0.20 起弃用）；之前（PolarDB 8.0.18）用 VALUES(col)
    if (this.atLeast('8.0.19'))
      return ` AS eq_new ON DUPLICATE KEY UPDATE ${c.update.map((u) => `${this.quote(u)} = eq_new.${this.quote(u)}`).join(', ')}`;
    return ` ON DUPLICATE KEY UPDATE ${c.update.map((u) => `${this.quote(u)} = VALUES(${this.quote(u)})`).join(', ')}`;
  }

  /** 窗口函数与 CTE 要 8.0 */
  override node(n: Node, w: SqlWriter): string {
    if (n.k === 'over') this.requires('window functions', '8.0');
    return super.node(n, w);
  }

  override select(q: SelectNode, w: SqlWriter = new SqlWriter()): string {
    if (q.ctes?.length) this.requires('WITH (common table expressions)', '8.0');
    return super.select(q, w);
  }

  /** NOWAIT / SKIP LOCKED 要 8.0.1 */
  override forUpdate(wait?: 'nowait' | 'skip'): string {
    if (wait) this.requires(wait === 'skip' ? 'SKIP LOCKED' : 'NOWAIT', '8.0.1');
    return super.forUpdate(wait);
  }

  /** FOR SHARE 要 8.0.1（之前是 LOCK IN SHARE MODE）；没有 FOR NO KEY UPDATE */
  protected override rowLock(mode: SelectNode['lockMode'], wait: SelectNode['lockWait']): string {
    if (mode !== 'share') return super.rowLock(mode, wait);
    this.requires('FOR SHARE', '8.0.1');
    return ` FOR SHARE${wait === 'nowait' ? ' NOWAIT' : wait === 'skip' ? ' SKIP LOCKED' : ''}`;
  }

  override limitOffset(
    limit: number | undefined,
    offset: number | undefined,
    ordered = false,
  ): string {
    if (limit === undefined && offset !== undefined && offset > 0)
      return ` LIMIT ${NO_LIMIT} OFFSET ${offset}`;
    return super.limitOffset(limit, offset, ordered);
  }
}
