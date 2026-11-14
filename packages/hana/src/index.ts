/**
 * SAP HANA 2.0，驱动用 SAP 维护的纯 JS 驱动 hdb（不需要原生编译）。
 * ```ts
 * const db = createDb({ schema, adapter: hana({ host, port: 39041, user, password, schema: 'APP', max: 5 }) })
 * ```
 * 适配器自带一个小连接池（hdb 一个 client 就是一条连接）。自增主键在同一条连接上用 CURRENT_IDENTITY_VALUE() 取回。
 */
import hdb, { type Client } from 'hdb';
import { hanaFunctions } from './functions.ts';
import {
  assembleTables,
  bareName,
  Dialect,
  SqlWriter,
  type ColumnOptions,
  type Adapter,
  type Without,
  type DbTable,
  type Driver,
  type QueryRunner,
  type ExecuteResult,
  type DatePart,
  type FunctionRenderer,
  type InsertNode,
  type Node,
  type Session,
  type TransactionOptions,
  type UpdateNode,
} from '@zerodep-dev/easy-query-ts';

export { Hana } from './functions.ts';

/**
 * hdb 一个包的上限。默认是 128 KB，一条几千行的多行插入（语句文本就有几百 KB）发不出去；
 * hdb 只在需要时才用到这么大，平时仍按 packetSize 分配
 */
const PACKET_SIZE_LIMIT = 2 ** 24;

/** HANA 的 LIMIT 不能省、OFFSET 前必须有 LIMIT */
const NO_LIMIT = 2147483647;

export class HanaDialect extends Dialect {
  readonly name = 'hana';
  /** HANA 没有 WITH RECURSIVE（层级查询用 HIERARCHY 函数） */
  override readonly supportsRecursiveCte = false;
  /** 条件不能直接当值（`SELECT a > b` 不合法）：写成 CASE WHEN … THEN 1 ELSE 0 END，布尔列当条件写成 = 1 */
  protected override readonly booleanValues = false;

  protected override conditionFunctions(): readonly string[] {
    return [...super.conditionFunctions(), 'json_boolean', 'hana.contains', 'hana.contains_fuzzy'];
  }

  /**
   * 批量插入按估计的字节数再切：多行插入每行是一段 SELECT … FROM DUMMY，语句文本与参数都要装进 hdb 的一个包里
   * （连接的 packetSizeLimit，见 PACKET_SIZE_LIMIT），给文本留出余量
   */
  override readonly maxStatementBytes = PACKET_SIZE_LIMIT / 4;
  /** 多行插入每行是一段 SELECT … FROM DUMMY 再 UNION ALL：行数一多 HANA 解析得很慢，分成小块反而快 */
  override readonly maxInsertRows = 1000;

  override node(n: Node, w: SqlWriter): string {
    // AVG 的结果沿用参数的小数位（DECIMAL(12,2) 的平均值只留两位）：先转成浮点小数再求，整数、浮点列结果不变
    if (n.k === 'agg' && n.fn === 'avg' && n.arg)
      return `AVG(${n.distinct ? 'DISTINCT ' : ''}TO_DECIMAL(${this.node(n.arg, w)}))`;
    return super.node(n, w);
  }

  override columnType(kind: string, o: ColumnOptions): string {
    if (o.dbType) return o.dbType;
    switch (kind) {
      case 'string':
        return `NVARCHAR(${o.length ?? 255})`;
      case 'double':
        return 'DOUBLE';
      case 'datetime':
        return 'TIMESTAMP';
      case 'json':
        return 'NCLOB';
      default:
        return super.columnType(kind, o);
    }
  }

  /** HANA 建列存表用 CREATE COLUMN TABLE，也没有 IF NOT EXISTS（表已存在会报错） */
  override createTableStart(): string {
    return 'CREATE COLUMN TABLE';
  }

  /** CREATE INDEX、DROP TABLE 都没有 IF [NOT] EXISTS */
  override readonly indexIfNotExists = false;
  override readonly dropIfExists = false;

  override renameTable(from: string, to: string): string {
    return `RENAME TABLE ${this.table(from)} TO ${this.quote(bareName(to))}`;
  }

  override renameColumn(table: string, from: string, to: string): string {
    return `RENAME COLUMN ${this.table(table)}.${this.quote(from)} TO ${this.quote(to)}`;
  }

  /** 加列的列定义要放在括号里 */
  override addColumn(table: string, name: string, kind: string, o: ColumnOptions): string {
    return `ALTER TABLE ${this.table(table)} ADD (${this.columnDefinition(name, kind, o)})`;
  }

  /** 读 SYS 系统视图（CURRENT_SCHEMA） */
  override async introspect(run: QueryRunner): Promise<DbTable[]> {
    const schema = 'SCHEMA_NAME = CURRENT_SCHEMA';
    return assembleTables({
      tables: await run(
        `SELECT TABLE_NAME AS "table_name", COMMENTS AS "comment" FROM SYS.TABLES WHERE ${schema} ORDER BY TABLE_NAME`,
      ),
      columns: await run(
        `SELECT c.TABLE_NAME AS "table_name", c.COLUMN_NAME AS "column_name",
           CASE WHEN c.DATA_TYPE_NAME IN ('VARCHAR', 'NVARCHAR', 'VARBINARY') THEN c.DATA_TYPE_NAME || '(' || c.LENGTH || ')'
                WHEN c.DATA_TYPE_NAME = 'DECIMAL' AND c.SCALE IS NOT NULL THEN 'DECIMAL(' || c.LENGTH || ', ' || c.SCALE || ')'
                ELSE c.DATA_TYPE_NAME END AS "column_type",
           c.IS_NULLABLE AS "is_nullable", c.DEFAULT_VALUE AS "column_default", c.COMMENTS AS "comment",
           CASE WHEN c.GENERATION_TYPE IS NULL THEN 0 ELSE 1 END AS "is_generated",
           CASE WHEN EXISTS (SELECT 1 FROM SYS.CONSTRAINTS k WHERE k.SCHEMA_NAME = c.SCHEMA_NAME AND k.TABLE_NAME = c.TABLE_NAME
             AND k.COLUMN_NAME = c.COLUMN_NAME AND k.IS_PRIMARY_KEY = 'TRUE') THEN 1 ELSE 0 END AS "primary_key"
         FROM SYS.TABLE_COLUMNS c WHERE c.${schema} ORDER BY c.TABLE_NAME, c.POSITION`,
      ),
      indexes: await run(
        `SELECT i.TABLE_NAME AS "table_name", i.INDEX_NAME AS "index_name",
           CASE WHEN i.CONSTRAINT IN ('UNIQUE', 'NOT NULL UNIQUE') THEN 1 ELSE 0 END AS "is_unique", i.COLUMN_NAME AS "column_name"
         FROM SYS.INDEX_COLUMNS i WHERE i.${schema} AND (i.CONSTRAINT IS NULL OR i.CONSTRAINT <> 'PRIMARY KEY')
         ORDER BY i.TABLE_NAME, i.INDEX_NAME, i.POSITION`,
      ),
      foreignKeys: await run(
        `SELECT TABLE_NAME AS "table_name", CONSTRAINT_NAME AS "constraint_name", COLUMN_NAME AS "column_name",
           REFERENCED_TABLE_NAME AS "referenced_table", REFERENCED_COLUMN_NAME AS "referenced_column"
         FROM SYS.REFERENTIAL_CONSTRAINTS WHERE ${schema} ORDER BY TABLE_NAME, CONSTRAINT_NAME, POSITION`,
      ),
    });
  }

  /** HANA 跳过被锁行的写法是 IGNORE LOCKED */
  override forUpdate(wait?: 'nowait' | 'skip'): string {
    return (
      ' FOR UPDATE' + (wait === 'nowait' ? ' NOWAIT' : wait === 'skip' ? ' IGNORE LOCKED' : '')
    );
  }

  /**
   * 带 join 时（条件、set 里用了多对一导航）：UPDATE 后面写 FROM 里的别名，目标表与各个 join 都放在 FROM 里（同 SQL Server）。
   * 基类的"目标表另起别名再自连接"在 HANA 上认不出那个别名
   */
  override update(q: UpdateNode, w: SqlWriter = new SqlWriter()): string {
    if (!q.joins?.length) return super.update(q, w);
    const set = q.set.map((s) => `${this.quote(s.column)} = ${this.value(s.e, w)}`).join(', ');
    let s = `UPDATE ${q.from.alias} SET ${set} FROM ${this.table(q.from.table)} ${q.from.alias}${this.joinClauses(q.joins, w)}`;
    if (q.where.length > 0) s += ` WHERE ${this.conjunction(q.where, w)}`;
    return s;
  }

  /** HANA 没有 RELEASE SAVEPOINT：回滚到保存点即可，其余在事务结束时一起清掉 */
  override releaseSavepoint(): string | undefined {
    return undefined;
  }

  protected override functions(): Record<string, FunctionRenderer> {
    return {
      ...super.functions(),
      length: (a) => `LENGTH(${a[0]})`,
      // HANA 的 CONCAT 只收两个参数
      concat: (a) => `(${a.join(' || ')})`,
      // 先转成文字：COALESCE(数字, '') 会把 '' 当数字报错
      text_or_empty: (a) => `COALESCE(TO_NVARCHAR(${a[0]}), '')`,
      ...hanaFunctions,
    };
  }

  /** HANA 的格式化函数叫 TO_VARCHAR，格式符同 TO_CHAR */
  protected override formatDate(value: string, parts: readonly DatePart[]): string {
    return super.formatDate(value, parts).replace(/^TO_CHAR\(/, 'TO_VARCHAR(');
  }

  /** HANA 的 STRING_AGG 不支持 DISTINCT */
  protected override stringAgg(n: Extract<Node, { k: 'string_agg' }>, w: SqlWriter): string {
    if (n.distinct)
      throw new Error('joining({ distinct: true }) is not supported by the hana dialect');
    // STRING_AGG 只收文字，数字等先转
    return super.stringAgg({ ...n, e: { k: 'raw', parts: ['TO_VARCHAR(', ')'], args: [n.e] } }, w);
  }

  /**
   * upsert 写成 MERGE：USING 里每行一个 SELECT … FROM DUMMY（多行 UNION ALL），按 target 列匹配；ignore 时没有 WHEN MATCHED。
   */
  override insert(q: InsertNode, w: SqlWriter = new SqlWriter()): string {
    if (!q.conflict && q.rows.length === 1) return super.insert(q, w);
    const cols = q.columns.map((c) => this.quote(c));
    // 渲染时参数按出现顺序收集，所以 source 只渲染一次
    const source = q.rows
      .map(
        (r) =>
          `SELECT ${r.map((n, i) => `${this.node(n, w)} AS ${cols[i]}`).join(', ')} FROM DUMMY`,
      )
      .join(' UNION ALL ');
    // HANA 的 VALUES 只能一行：多行写成 INSERT … SELECT … FROM DUMMY UNION ALL …
    if (!q.conflict) return `INSERT INTO ${this.table(q.table)} (${cols.join(', ')}) ${source}`;
    const on = q.conflict.target
      .map((t) => `eq_t.${this.quote(t)} = eq_s.${this.quote(t)}`)
      .join(' AND ');
    let sql = `MERGE INTO ${this.table(q.table)} eq_t USING (${source}) eq_s ON (${on})`;
    if (q.conflict.update.length > 0) {
      sql += ` WHEN MATCHED THEN UPDATE SET ${q.conflict.update.map((u) => `eq_t.${this.quote(u)} = eq_s.${this.quote(u)}`).join(', ')}`;
    }
    return `${sql} WHEN NOT MATCHED THEN INSERT (${cols.join(', ')}) VALUES (${cols.map((c) => `eq_s.${c}`).join(', ')})`;
  }

  /**
   * hdb 按服务器推断的参数类型校验 JS 类型；{@code SELECT ? FROM DUMMY}（多行插入、MERGE 的来源）里的参数被推成 NVARCHAR，只收字符串。
   * 数值类型的参数也接受字符串，所以数一律转成字符串传。
   */
  override encodeParam(value: unknown, kind?: string): unknown {
    const v = super.encodeParam(value, kind);
    return typeof v === 'number' || typeof v === 'bigint' ? String(v) : v;
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

function call<T>(fn: (cb: (error: Error | null, result: T) => void) => void): Promise<T> {
  return new Promise((resolve, reject) =>
    fn((error, result) => (error ? reject(error) : resolve(result))),
  );
}

async function run(client: Client, sql: string, params: readonly unknown[]): Promise<unknown> {
  if (params.length === 0) return lobsAsText(await call<unknown>((cb) => client.exec(sql, cb)));
  const statement = await call<import('hdb').Statement>((cb) => client.prepare(sql, cb));
  try {
    return lobsAsText(await call<unknown>((cb) => statement.exec([...params], cb)));
  } finally {
    statement.drop();
  }
}

/** 字符型大对象的类型码：CLOB、NCLOB、NLOCATOR、TEXT */
const TEXT_LOBS = new Set([25, 26, 32, 51]);

/**
 * hdb 把大对象一律读成字节，字符型的（NCLOB：json 列、长文字）也不例外：按结果集的列类型（连接开了 rowsWithMetadata）解成文字，
 * 列的 codec 才读得了。写语句的结果（影响的行数）原样返回
 */
function lobsAsText(result: unknown): unknown {
  const metadata = (result as { metadata?: readonly ColumnMetadata[] } | null)?.metadata;
  if (!Array.isArray(result) || !metadata) return result;
  const columns = metadata.filter((m) => TEXT_LOBS.has(m.dataType)).map((m) => m.columnDisplayName);
  if (columns.length === 0) return result;
  for (const row of result as Record<string, unknown>[])
    for (const column of columns) {
      const value = row[column];
      if (value instanceof Uint8Array) row[column] = cesu8Text(value);
    }
  return result;
}

interface ColumnMetadata {
  readonly columnDisplayName: string;
  readonly dataType: number;
}

/**
 * HANA 的文字在线路上是 CESU-8：BMP 以外的字符（表情、生僻字）写成一对各 3 字节的代理项，按 UTF-8 解会变成替换符。
 * 没有代理项时它就是 UTF-8（绝大多数情况），直接解；有的话逐个码元解成 UTF-16
 */
function cesu8Text(bytes: Uint8Array): string {
  const buffer = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let at = buffer.indexOf(0xed);
  while (at >= 0 && buffer[at + 1]! < 0xa0) at = buffer.indexOf(0xed, at + 1);
  if (at < 0) return buffer.toString('utf8');
  let text = '';
  const units: number[] = [];
  for (let i = 0; i < buffer.length;) {
    const b = buffer[i]!;
    if (b < 0x80) {
      units.push(b);
      i += 1;
    } else if (b < 0xe0) {
      units.push(((b & 0x1f) << 6) | (buffer[i + 1]! & 0x3f));
      i += 2;
    } else {
      units.push(((b & 0x0f) << 12) | ((buffer[i + 1]! & 0x3f) << 6) | (buffer[i + 2]! & 0x3f));
      i += 3;
    }
    if (units.length >= 8192) text += String.fromCharCode(...units.splice(0));
  }
  return text + String.fromCharCode(...units);
}

class HanaSession implements Session {
  protected readonly connection: () => Promise<{ client: Client; release: () => void }>;

  constructor(connection: () => Promise<{ client: Client; release: () => void }>) {
    this.connection = connection;
  }

  async query(sql: string, params: readonly unknown[]): Promise<Record<string, unknown>[]> {
    const { client, release } = await this.connection();
    try {
      return (await run(client, sql, params)) as Record<string, unknown>[];
    } finally {
      release();
    }
  }

  async execute(sql: string, params: readonly unknown[]): Promise<ExecuteResult> {
    const { client, release } = await this.connection();
    try {
      const affected = Number(await run(client, sql, params));
      if (!/^\s*INSERT\b/i.test(sql)) return { affected, insertId: undefined };
      // 同一条连接上取刚生成的 IDENTITY；表没有 IDENTITY 列时为 NULL
      const rows = (await run(
        client,
        'SELECT CURRENT_IDENTITY_VALUE() AS "id" FROM DUMMY',
        [],
      )) as { id: unknown }[];
      const id = rows[0]?.id;
      return { affected, insertId: id === null || id === undefined ? undefined : toKey(id) };
    } finally {
      release();
    }
  }
}

function toKey(value: unknown): number | bigint {
  if (typeof value === 'number' || typeof value === 'bigint') return value;
  const n = Number(value);
  return Number.isSafeInteger(n) ? n : BigInt(String(value));
}

const ISOLATION = {
  'read uncommitted': 'READ COMMITTED',
  'read committed': 'READ COMMITTED',
  'repeatable read': 'REPEATABLE READ',
  serializable: 'SERIALIZABLE',
} as const;

/** HANA 会话默认的隔离级别 */
const DEFAULT_ISOLATION = 'READ COMMITTED';

/** hdb 连接参数（hdb 自己没有类型，这里声明用到的字段；其余原样传给 hdb） */
export interface HdbClientOptions {
  host: string;
  port: number;
  user: string;
  password: string;
  [option: string]: unknown;
}

export interface HanaOptions extends HdbClientOptions {
  /** 连接后 SET SCHEMA */
  schema?: string;
  /** 连接池上限，默认 5 */
  max?: number;
}

/** 最小连接池：空闲的复用，满了排队 */
class Pool {
  private readonly options: HanaOptions;
  private readonly idle: Client[] = [];
  private readonly waiting: ((client: Client) => void)[] = [];
  private size = 0;

  constructor(options: HanaOptions) {
    this.options = options;
  }

  async acquire(): Promise<Client> {
    const idle = this.idle.pop();
    if (idle) return idle;
    if (this.size < (this.options.max ?? 5)) {
      this.size++;
      try {
        return await this.open();
      } catch (error) {
        this.size--;
        throw error;
      }
    }
    return new Promise((resolve) => this.waiting.push(resolve));
  }

  release(client: Client): void {
    const next = this.waiting.shift();
    if (next) next(client);
    else this.idle.push(client);
  }

  /** 状态不可信的连接：关掉，不放回池里；有人在等时给他另开一条 */
  discard(client: Client): void {
    client.end();
    this.size--;
    const next = this.waiting.shift();
    if (!next) return;
    this.size++;
    this.open().then(next, () => {
      // 开不出来：让他继续等别人还回来的连接
      this.size--;
      this.waiting.unshift(next);
    });
  }

  end(): void {
    for (const client of this.idle.splice(0)) client.end();
  }

  private async open(): Promise<Client> {
    const { schema, max: _max, ...connect } = this.options;
    // rowsWithMetadata：结果行带上列的类型，字符型大对象靠它解成文字（见 lobsAsText）
    const client = hdb.createClient({
      packetSizeLimit: PACKET_SIZE_LIMIT,
      ...connect,
      rowsWithMetadata: true,
    });
    client.on('error', () => undefined);
    await call<void>((cb) => client.connect((error) => cb(error, undefined)));
    if (schema) await run(client, `SET SCHEMA "${schema.replace(/"/g, '""')}"`, []);
    return client;
  }
}

class HanaDriver extends HanaSession implements Driver {
  private readonly pool: Pool;

  constructor(pool: Pool) {
    super(async () => {
      const client = await pool.acquire();
      return { client, release: () => pool.release(client) };
    });
    this.pool = pool;
  }

  async transaction<T>(
    work: (session: Session) => Promise<T>,
    options?: TransactionOptions,
  ): Promise<T> {
    const client = await this.pool.acquire();
    client.setAutoCommit(false);
    let usable = true;
    try {
      if (options?.isolation)
        await run(client, `SET TRANSACTION ISOLATION LEVEL ${ISOLATION[options.isolation]}`, []);
      if (options?.readOnly) await run(client, 'SET TRANSACTION READ ONLY', []);
      try {
        const result = await work(
          new HanaSession(async () => ({ client, release: () => undefined })),
        );
        await call<void>((cb) => client.commit((error) => cb(error, undefined)));
        return result;
      } catch (error) {
        // 回滚失败（多半是连接已经断了）不盖住原来的错误
        await call<void>((cb) => client.rollback((error) => cb(error, undefined))).catch(
          () => undefined,
        );
        throw error;
      }
    } finally {
      client.setAutoCommit(true);
      // HANA 的 SET TRANSACTION 作用在会话上，事务结束也不复原：还回池之前改回默认值，
      // 否则下一个借到这条连接的语句还是只读、还是那个隔离级别。改不回去的连接不要了
      try {
        if (options?.readOnly) await run(client, 'SET TRANSACTION READ WRITE', []);
        if (options?.isolation)
          await run(client, `SET TRANSACTION ISOLATION LEVEL ${DEFAULT_ISOLATION}`, []);
      } catch {
        usable = false;
      }
      if (usable) this.pool.release(client);
      else this.pool.discard(client);
    }
  }

  end(): void {
    this.pool.end();
  }
}

/** 关闭空闲连接（测试与进程退出时） */
export function closeHana(adapter: Adapter): void {
  if (adapter.driver instanceof HanaDriver) adapter.driver.end();
}

export function hana(options: HanaOptions): Adapter<Without<'returning'>> {
  return { dialect: new HanaDialect(), driver: new HanaDriver(new Pool(options)) };
}
