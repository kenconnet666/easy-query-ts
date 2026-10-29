/**
 * Apache Doris（MPP 分析库，MySQL 协议）：驱动同样是 mysql2，方言继承 MySQL 方言后覆盖差异。
 * - 建表用主键模型：`UNIQUE KEY(主键) DISTRIBUTED BY HASH(主键) BUCKETS AUTO`，键列排在最前面；没有唯一约束、外键
 * - 插入同一主键就是整行覆盖：upsert 只支持"冲突时用新值覆盖全部列"；ignore、只更新部分列报错
 * - 自增列能建（AUTO_INCREMENT），但驱动取不回生成的值：主键最好由应用给值
 * - 没有行锁；事务不能回滚，transaction() 里的语句依次执行
 */
import {
  Dialect,
  SqlWriter,
  sqlString,
  standardJsonPath,
  type ColumnOptions,
  type ConflictNode,
  type DbTable,
  type DeleteNode,
  type Entity,
  type ForeignKeySpec,
  type FunctionRenderer,
  type InsertNode,
  type QueryRunner,
  type TableIndex,
  type UpdateNode,
} from '@zerodep-dev/easy-query-ts';
import { MySqlDialect } from './dialect.ts';

export interface DorisOptions {
  /** 建表时的副本数（PROPERTIES replication_num）；不给按集群默认（3），单 BE 的测试环境给 1 */
  readonly replication?: number;
}

export class DorisDialect extends MySqlDialect {
  override readonly name: string = 'doris';
  override readonly commentStyle = 'inline';
  private readonly replication: number | undefined;

  constructor(options: DorisOptions = {}) {
    super();
    this.replication = options.replication;
  }

  override get rowLocks(): boolean {
    return false;
  }

  override forUpdate(): string {
    throw new Error('row locks are not supported by the doris dialect');
  }

  /** 主键模型的表：同一主键的新行整行覆盖旧行，所以"冲突时覆盖全部列"就是普通的插入；ignore、只更新部分列做不到 */
  override insert(q: InsertNode, w: SqlWriter = new SqlWriter()): string {
    const c = q.conflict;
    if (c) {
      const rest = q.columns.filter((col) => !c.target.includes(col));
      if (c.update.length === 0 || rest.some((col) => !c.update.includes(col)))
        throw new Error(
          'the doris dialect can only upsert by overwriting every inserted column (a unique-key table replaces the whole row)',
        );
    }
    return super.insert(q, w);
  }

  override onConflict(_c: ConflictNode): string {
    return '';
  }

  /** 带 join 的更新、删除用核心的通用写法（UPDATE … FROM、DELETE … WHERE EXISTS）；Doris 不认 MySQL 的多表写法 */
  override update(q: UpdateNode, w: SqlWriter = new SqlWriter()): string {
    return Dialect.prototype.update.call(this, q, w);
  }

  override delete(q: DeleteNode, w: SqlWriter = new SqlWriter()): string {
    return Dialect.prototype.delete.call(this, q, w);
  }

  protected override functions(): Record<string, FunctionRenderer> {
    return {
      ...super.functions(),
      json_has: (a) => `JSON_EXISTS_PATH(${a[0]}, ${standardJsonPath(a[1]!)})`,
    };
  }

  // ---- 建表 ----

  override columnType(kind: string, o: ColumnOptions): string {
    if (o.dbType) return o.dbType;
    if (kind === 'bytes') return 'STRING';
    if (kind === 'time') return 'VARCHAR(12)';
    return super.columnType(kind, o);
  }

  /** 键列排在最前面（主键模型的要求） */
  override createTable(
    entity: Entity,
    ifNotExists = true,
    foreignKeys: readonly ForeignKeySpec[] = [],
  ): string {
    if (foreignKeys.length > 0) this.addForeignKey(foreignKeys[0]!);
    const keys = new Set(entity.primaryKey);
    const props = Object.keys(entity.columns).sort(
      (a, b) => Number(keys.has(b)) - Number(keys.has(a)),
    );
    const columns = props.map((p) => {
      const column = entity.columns[p]!;
      return this.columnDefinition(entity.columnNames[p]!, column.codec.kind, column.options);
    });
    return `${this.createTableStart(ifNotExists)} ${this.table(entity.table)} (${columns.join(', ')})${this.tableOptions(entity)}`;
  }

  protected override tableOptions(entity: Entity): string {
    const key = entity.primaryKey.map((p) => this.quote(entity.columnNames[p]!)).join(', ');
    if (!key) throw new Error(`${entity.table} needs a primary key to be created on doris`);
    let s = ` UNIQUE KEY(${key})`;
    if (entity.comment !== undefined) s += ` COMMENT ${sqlString(entity.comment)}`;
    s += ` DISTRIBUTED BY HASH(${key}) BUCKETS AUTO`;
    if (this.replication !== undefined)
      s += ` PROPERTIES ("replication_num" = "${this.replication}")`;
    return s;
  }

  /** 倒排索引（CREATE INDEX … USING INVERTED）；没有唯一索引 */
  override createIndex(table: string, index: TableIndex, ifNotExists: boolean): string {
    if (index.unique)
      throw new Error(`unique indexes are not supported by the doris dialect (${index.name})`);
    return `CREATE INDEX ${ifNotExists ? 'IF NOT EXISTS ' : ''}${this.quote(index.name)} ON ${this.table(table)} (${index.columns.map((c) => this.quote(c)).join(', ')}) USING INVERTED`;
  }

  override addForeignKey(fk: ForeignKeySpec): string {
    throw new Error(`foreign keys are not supported by the doris dialect (${fk.name})`);
  }

  /** 主键模型的键列在 information_schema 里是 UNI */
  override async introspect(run: QueryRunner): Promise<DbTable[]> {
    const tables = await super.introspect(async (sql, params) =>
      run(
        sql.replace(
          "COLUMN_KEY = 'PRI' AS primary_key",
          "COLUMN_KEY IN ('PRI', 'UNI') AS primary_key",
        ),
        params,
      ),
    );
    // 倒排索引不在 information_schema.STATISTICS 里：逐表 SHOW INDEX
    return Promise.all(
      tables.map(async (t) => {
        const rows = await run(`SHOW INDEX FROM ${this.quote(t.name)}`);
        const indexes = new Map<string, string[]>();
        for (const r of rows) {
          const name = String(r['Key_name']);
          indexes.set(name, [...(indexes.get(name) ?? []), String(r['Column_name'])]);
        }
        return {
          ...t,
          indexes: [...indexes].map(([name, columns]) => ({ name, columns, unique: false })),
          foreignKeys: [],
        };
      }),
    );
  }
}
