/**
 * MariaDB（ROADMAP 19.9，MySQL 协议，驱动同样是 mysql2）：方言继承 MySQL 方言，按 MySQL 8.0.18 的写法渲染
 * （upsert 用 VALUES(col)，有窗口函数、CTE、JSON_TABLE），再覆盖 MariaDB 的差异：
 * - uuid 是原生的 UUID 类型（10.7+），按文字绑定，不像 MySQL 那样存 BINARY(16)
 * - 正则是 REGEXP 运算符（没有 REGEXP_LIKE）；共享锁是 LOCK IN SHARE MODE
 * - JSON 不是 CAST 的目标类型：写进 JSON 的值用 JSON_EXTRACT(?, '$') 转成 JSON
 * - EXPLAIN ANALYZE 写成 ANALYZE FORMAT=JSON；单表 DELETE 不能给表起别名；没有 GROUPING()
 * 面向 11.4 LTS 验证（容器见 infra/dev/compose.yaml 的 mariadb profile）
 */
import {
  SqlWriter,
  standardJsonPath,
  type DeleteNode,
  type ColumnOptions,
  type FunctionRenderer,
  type SelectNode,
} from '@zerodep-dev/easy-query-ts';
import { MySqlDialect } from './dialect.ts';

export interface MariaDbOptions {
  /** 服务器的 max_allowed_packet（字节）：批量插入按它切分语句；mariadb.detect 自动读 */
  readonly maxPacket?: number | undefined;
}

/** 写进 JSON 的值（JSON 文字的参数）转成 JSON */
const json = (value: string) => `JSON_EXTRACT(${value}, '$')`;

export class MariaDbDialect extends MySqlDialect {
  override readonly name: string = 'mariadb';

  constructor(options: MariaDbOptions = {}) {
    // MySQL 侧的写法按 8.0.18：没有 8.0.19 的 upsert 行别名，JSON_TABLE、窗口函数、CTE 都有
    super({ version: '8.0.18', maxPacket: options.maxPacket });
  }

  /** 原生 UUID 类型（10.7+） */
  override columnType(kind: string, o: ColumnOptions): string {
    if (kind === 'uuid' && !o.dbType) return 'UUID';
    return super.columnType(kind, o);
  }

  /** uuid 按文字绑定（MySQL 方言会换成 16 个字节） */
  override encodeParam(value: unknown, kind?: string): unknown {
    return super.encodeParam(value, kind === 'uuid' ? undefined : kind);
  }

  /**
   * 单表 DELETE 不能给表起别名（11.4）：写成多表的 \`DELETE t0 FROM t AS t0\`；带 limit 时（多表形式不能带 ORDER BY … LIMIT）
   * 写成"主键 IN (按条件排序取前 n 行的派生表)"，派生表先物化，不受"同一张表"的限制
   */
  override delete(q: DeleteNode, w: SqlWriter = new SqlWriter()): string {
    if (q.joins?.length) return super.delete(q, w);
    const alias = q.from.alias;
    if (!q.limit) {
      const where = q.where.length > 0 ? ` WHERE ${this.conjunction(q.where, w)}` : '';
      return `DELETE ${alias} FROM ${this.table(q.from.table)} AS ${alias}${where}`;
    }
    const key = q.key?.length === 1 ? q.key[0]! : undefined;
    if (!key) throw new Error('limit() on a delete needs a single-column primary key');
    const picked: SelectNode = {
      from: q.from,
      joins: [],
      where: q.where,
      groupBy: [],
      having: [],
      orderBy: q.limit.orderBy,
      columns: [{ e: { k: 'col', alias, name: key }, as: 'k' }],
      distinct: false,
      limit: q.limit.count,
      offset: undefined,
      forUpdate: false,
    };
    return `DELETE FROM ${this.table(q.from.table)} WHERE ${this.quote(key)} IN (SELECT k FROM (${this.select(picked, w)}) eq_b)`;
  }

  protected override rowLock(mode: SelectNode['lockMode'], wait: SelectNode['lockWait']): string {
    if (mode !== 'share') return super.rowLock(mode, wait);
    return ` LOCK IN SHARE MODE${wait === 'nowait' ? ' NOWAIT' : wait === 'skip' ? ' SKIP LOCKED' : ''}`;
  }

  override explainStatement(sql: string, analyze: boolean): string {
    return `${analyze ? 'ANALYZE' : 'EXPLAIN'} FORMAT=JSON ${sql}`;
  }

  /** EXPLAIN 的列叫 EXPLAIN，ANALYZE 的叫 ANALYZE；都是 JSON 文字 */
  override explainResult(rows: readonly Record<string, unknown>[]): unknown {
    const row = rows[0] ?? {};
    const text = row['EXPLAIN'] ?? row['ANALYZE'];
    return typeof text === 'string' ? JSON.parse(text) : text;
  }

  protected override functions(): Record<string, FunctionRenderer> {
    // 没有 GROUPING()（WITH ROLLUP 能用）：删掉它，用到时报不支持
    const { grouping: _grouping, ...functions } = super.functions();
    return {
      ...functions,
      // 'c' 区分大小写：转成二进制再匹配；'i' 用默认（不区分大小写）的排序规则
      regex_match: (a) =>
        a[2] === "'c'" ? `(CAST(${a[0]} AS BINARY) REGEXP ${a[1]})` : `(${a[0]} REGEXP ${a[1]})`,
      json_set: (a) => `JSON_SET(${a[0]}, ${standardJsonPath(a[1]!)}, ${json(a[2]!)})`,
      json_merge: (a) => {
        const pairs: string[] = [];
        for (let i = 2; i < a.length; i += 2)
          pairs.push(`${standardJsonPath(a[i]!)}, ${json(a[i + 1]!)}`);
        return `JSON_SET(${a[0]}, ${pairs.join(', ')})`;
      },
      json_append: (a) => `JSON_ARRAY_APPEND(${a[0]}, ${standardJsonPath(a[1]!)}, ${json(a[2]!)})`,
    };
  }
}
