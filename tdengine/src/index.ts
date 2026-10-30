/**
 * TDengine 3.x（时序库，对应官方的 sql-tsdb），驱动用官方的 @tdengine/websocket（taosAdapter 的 WebSocket 接口）。
 * ```ts
 * import { sqlConnect, WSConfig } from '@tdengine/websocket'
 * const conf = new WSConfig('ws://host:6041'); conf.setUser('root'); conf.setPwd('…'); conf.setDb('power'); conf.setTimezone('UTC')
 * const db = createDb({ schema, adapter: tdengine(await sqlConnect(conf)) })
 * ```
 * 时序库的模型：每张表第一列是 TIMESTAMP 主键，同一时间戳再写一次就是覆盖（只写给出的列）。所以：
 * - 实体的主键必须是一个 datetime 列；建表时排在第一列；列不能声明 NOT NULL、DEFAULT
 * - 没有 UPDATE（报错，改成按时间戳再插入一次）；upsert 就是普通插入；删除写成 DELETE FROM t WHERE …（不带别名）
 * - 查询有条件、排序、分页、聚合、分组；没有子查询（IN / EXISTS）、窗口函数、行锁、事务
 * - 语句不带参数：值按字面量写进 SQL（字符串转义引号与反斜杠）
 */
import type { WsSql } from '@tdengine/websocket';
import {
  assembleTables,
  Dialect,
  sqlString,
  SqlWriter,
  type Adapter,
  type Without,
  type ColumnOptions,
  type ConflictNode,
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

/** 字符串字面量：反斜杠与单引号都要转义 */
function literal(text: string): string {
  return `'${text.replaceAll('\\', '\\\\').replaceAll("'", "\\'")}'`;
}

export class TdengineDialect extends Dialect {
  readonly name = 'tdengine';
  override readonly indexIfNotExists = true;

  /** 删除时列名不带别名 */
  private bareColumns = false;

  override quote(identifier: string): string {
    return `\`${identifier.replace(/`/g, '``')}\``;
  }

  /** 没有绑定参数：值写成字面量 */
  override bindParam(value: unknown): string {
    if (value === null || value === undefined) return 'NULL';
    if (typeof value === 'boolean') return value ? 'true' : 'false';
    if (typeof value === 'number' || typeof value === 'bigint') return String(value);
    if (typeof value === 'string') return literal(value);
    throw new Error(`the tdengine dialect cannot write ${typeof value} values into SQL`);
  }

  override encodeParam(value: unknown, kind?: string): unknown {
    return typeof value === 'boolean' ? value : super.encodeParam(value, kind);
  }

  override likeEscape(): string {
    return '';
  }

  override node(n: Node, w: SqlWriter): string {
    if (n.k === 'col' && this.bareColumns) return this.quote(n.name);
    return super.node(n, w);
  }

  override get rowLocks(): boolean {
    return false;
  }

  override forUpdate(): string {
    throw new Error('row locks are not supported by the tdengine dialect');
  }

  // ---- 写入 ----

  override update(_q: UpdateNode): string {
    throw new Error(
      'TDengine has no UPDATE: insert a row with the same timestamp to overwrite the given columns',
    );
  }

  override delete(q: DeleteNode, w: SqlWriter = new SqlWriter()): string {
    if (q.joins?.length)
      throw new Error('deletes through navigations are not supported by the tdengine dialect');
    this.bareColumns = true;
    try {
      const where = q.where.length > 0 ? ` WHERE ${this.conjunction(q.where, w)}` : '';
      return `DELETE FROM ${this.table(q.from.table)}${where}`;
    } finally {
      this.bareColumns = false;
    }
  }

  /** 同一时间戳再写一次就是覆盖给出的列：merge 就是普通插入；ignore 做不到 */
  override onConflict(c: ConflictNode): string {
    if (c.update.length === 0)
      throw new Error('onConflict(..).ignore() is not supported by the tdengine dialect');
    return '';
  }

  override identity(): string {
    throw new Error('TDengine has no auto-increment columns: the key is the row timestamp');
  }

  // ---- 函数 ----

  protected override functions(): Record<string, FunctionRenderer> {
    return {
      ...super.functions(),
      length: (a) => `CHAR_LENGTH(${a[0]})`,
      substring: (a) => `SUBSTR(${a.join(', ')})`,
      now: () => 'NOW()',
      cast_string: (a) => `CAST(${a[0]} AS VARCHAR(4096))`,
    };
  }

  // ---- 建表 ----

  override columnType(kind: string, o: ColumnOptions): string {
    if (o.dbType) return o.dbType;
    switch (kind) {
      case 'string':
        return `NCHAR(${o.length ?? 255})`;
      case 'int':
        return 'INT';
      case 'bigint':
        return 'BIGINT';
      case 'decimal':
        return `DECIMAL(${o.precision ?? 18}, ${o.scale ?? 4})`;
      case 'double':
        return 'DOUBLE';
      case 'boolean':
        return 'BOOL';
      case 'datetime':
        return 'TIMESTAMP';
      case 'date':
        return 'VARCHAR(10)';
      case 'time':
        return 'VARCHAR(12)';
      case 'json':
        return 'NCHAR(4096)';
      case 'bytes':
        return 'VARBINARY(4096)';
      default:
        return super.columnType(kind, o);
    }
  }

  /** 列只有名字与类型（没有 NOT NULL、DEFAULT、列注释） */
  override columnDefinition(name: string, kind: string, o: ColumnOptions): string {
    if (o.generated) this.identity();
    return `${this.quote(name)} ${this.columnType(kind, o)}`;
  }

  /** 时间戳主键排在第一列；没有约束子句 */
  override createTable(
    entity: Entity,
    ifNotExists = true,
    foreignKeys: readonly ForeignKeySpec[] = [],
  ): string {
    if (foreignKeys.length > 0) this.addForeignKey(foreignKeys[0]!);
    const [key, ...more] = entity.primaryKey;
    if (!key || more.length > 0 || entity.columns[key]!.codec.kind !== 'datetime')
      throw new Error(
        `${entity.table} needs a single datetime primary key (the row timestamp) on tdengine`,
      );
    const props = [key, ...Object.keys(entity.columns).filter((p) => p !== key)];
    const columns = props.map((p) => {
      const column = entity.columns[p]!;
      return this.columnDefinition(entity.columnNames[p]!, column.codec.kind, column.options);
    });
    return `${this.createTableStart(ifNotExists)} ${this.table(entity.table)} (${columns.join(', ')})${this.tableOptions(entity)}`;
  }

  protected override tableOptions(entity: Entity): string {
    return entity.comment !== undefined ? ` COMMENT ${sqlString(entity.comment)}` : '';
  }

  override readonly commentStyle = 'none' as const;

  override createIndex(table: string, index: TableIndex, ifNotExists: boolean): string {
    if (index.unique || index.columns.length > 1)
      throw new Error(
        `only single-column, non-unique indexes are supported by the tdengine dialect (${index.name})`,
      );
    return `CREATE INDEX ${ifNotExists ? 'IF NOT EXISTS ' : ''}${this.quote(index.name)} ON ${this.table(table)} (${this.quote(index.columns[0]!)})`;
  }

  override addForeignKey(fk: ForeignKeySpec): string {
    throw new Error(`foreign keys are not supported by the tdengine dialect (${fk.name})`);
  }

  /** information_schema.ins_tables / ins_columns（当前库）；第一列（时间戳）是主键，其余列都可空 */
  override async introspect(run: QueryRunner): Promise<DbTable[]> {
    const tables = await run(
      `SELECT table_name, table_comment AS \`comment\` FROM information_schema.ins_tables WHERE db_name = DATABASE() ORDER BY table_name`,
    );
    const columns = await run(
      `SELECT table_name, col_name AS column_name, col_type AS column_type FROM information_schema.ins_columns
       WHERE db_name = DATABASE() AND table_type = 'NORMAL_TABLE'`,
    );
    const first = new Set<string>();
    return assembleTables({
      tables: tables.map((t) => ({ ...t, comment: t['comment'] || null })),
      // ins_columns 按列的顺序给出：每张表的第一列是时间戳主键
      columns: columns.map((c) => {
        const table = String(c['table_name']);
        const key = !first.has(table);
        first.add(table);
        return {
          ...c,
          column_type: String(c['column_type']).toLowerCase(),
          is_nullable: !key,
          column_default: null,
          comment: null,
          is_generated: false,
          primary_key: key,
        };
      }),
      indexes: [],
      foreignKeys: [],
    });
  }
}

// ---- 驱动 ----

const TEXT_TYPES = new Set(['NCHAR', 'VARCHAR', 'BINARY', 'VARBINARY', 'JSON', 'GEOMETRY']);

/** 读出的值：时间戳是毫秒数（bigint）→ UTC 文字，由列的 codec 解码；BIGINT 写成文字 */
function decode(value: unknown, type: string): unknown {
  if (value === null || value === undefined) return null;
  // 驱动把数字列的空值交成字符串 'NULL'
  if (value === 'NULL' && !TEXT_TYPES.has(type)) return null;
  if (type === 'TIMESTAMP')
    return new Date(Number(value)).toISOString().replace('T', ' ').replace('Z', '');
  if (typeof value === 'bigint') return value.toString();
  return value;
}

class TdengineDriver implements Driver {
  private readonly sql: WsSql;

  constructor(sql: WsSql) {
    this.sql = sql;
  }

  async query(sql: string): Promise<Record<string, unknown>[]> {
    const rows = await this.sql.query(sql);
    try {
      const meta = rows.getMeta() ?? [];
      const out: Record<string, unknown>[] = [];
      while (await rows.next()) {
        const data = rows.getData() ?? [];
        out.push(Object.fromEntries(meta.map((m, i) => [m.name, decode(data[i], m.type)])));
      }
      return out;
    } finally {
      await rows.close();
    }
  }

  async execute(sql: string): Promise<ExecuteResult> {
    const result = await this.sql.exec(sql);
    return { affected: result.getAffectRows() ?? 0, insertId: undefined };
  }

  /** 没有事务：依次执行 */
  async transaction<T>(work: (session: Session) => Promise<T>): Promise<T> {
    return work(this);
  }
}

/** sql 是 sqlConnect 建好的连接（WSConfig 里设好库与时区 UTC） */
/** TDengine 缺的能力：没有 UPDATE、事务、行锁、RETURNING、自增；写同一时间戳就是覆盖 */
export type TdengineAdapter = Adapter<
  Without<
    | 'update'
    | 'transactions'
    | 'lock'
    | 'forUpdate'
    | 'skipLocked'
    | 'noWait'
    | 'returning'
    | 'generatedKeys'
    | 'upsertIgnore'
  >
>;

export function tdengine(sql: WsSql): TdengineAdapter {
  return { dialect: new TdengineDialect(), driver: new TdengineDriver(sql) };
}
