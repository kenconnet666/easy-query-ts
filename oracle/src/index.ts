/**
 * Oracle Database，驱动用 oracledb 的 Thin 模式（纯 JS，不装 Instant Client）。按服务器版本渲染：
 * ```ts
 * import oracledb from 'oracledb'
 * const pool = await oracledb.createPool({ user, password, connectString: 'host:1521/FREEPDB1' })
 * const db = createDb({ schema, adapter: oracle(pool) })                      // 默认按最新（23ai）
 * const old = createDb({ schema, adapter: oracle(pool, { version: '11.2' }) }) // ROWNUM 分页、NUMBER(1) 布尔
 * ```
 * 版本门槛（低于时退回旧写法，没有旧写法就报错并说明要哪个版本）：
 * - 12.1：OFFSET … FETCH 分页（之前用 ROWNUM 包两层）、IDENTITY 列、LISTAGG 之外的 JSON_VALUE 等
 * - 23：SQL 的 BOOLEAN（条件能直接当值、布尔列能直接当条件、BOOLEAN 列类型）、多行 VALUES、IF [NOT] EXISTS
 * 与其它库的差异：表别名不写 AS；参数是 :1、:2；空字符串就是 NULL；没有 TIME 类型（存成 VARCHAR2(12) 的文字）。
 * 会话的日期格式设成 ISO，日期、时间戳按文字读出再由列的 codec 解码（与 MySQL、PG 的口径一致，不受 Node 的本地时区影响）。
 */
import oracledb from 'oracledb';
import {
  type Adapter,
  type Without,
  type Driver,
  type ExecuteResult,
  type Session,
  type TransactionOptions,
} from '@zerodep-dev/easy-query-ts';
import { OracleDialect, type OracleVersion } from './dialect.ts';

export { OracleDialect, type OracleVersion } from './dialect.ts';

// ---- 驱动 ----

const SESSION_FORMATS = [
  `ALTER SESSION SET NLS_DATE_FORMAT = 'YYYY-MM-DD HH24:MI:SS'`,
  `ALTER SESSION SET NLS_TIMESTAMP_FORMAT = 'YYYY-MM-DD HH24:MI:SS.FF3'`,
  `ALTER SESSION SET TIME_ZONE = '+00:00'`,
];

/** 驱动按本地时区造出的 Date → 'YYYY-MM-DD HH:MM:SS.mmm'（库里存的不带时区的时刻，核心按 UTC 读） */
function wallClock(d: Date): string {
  const p = (n: number, w = 2) => String(n).padStart(w, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)}`;
}

/** 读出的值：日期、数字、大文本按文字（数字精度、日期时区都不经过 JS 的转换），二进制按 Buffer */
function fetchInfo(): oracledb.ExecuteOptions {
  return {
    outFormat: oracledb.OUT_FORMAT_OBJECT,
    fetchTypeHandler: (meta) => {
      switch (meta.dbType) {
        // 不带时区的 DATE / TIMESTAMP：驱动按 Node 的本地时区造 Date，取回本地的各部分就是库里存的墙上时间
        case oracledb.DB_TYPE_DATE:
        case oracledb.DB_TYPE_TIMESTAMP:
          return { converter: (v: unknown) => (v instanceof Date ? wallClock(v) : null) };
        case oracledb.DB_TYPE_TIMESTAMP_TZ:
        case oracledb.DB_TYPE_TIMESTAMP_LTZ:
          return { converter: (v: unknown) => (v instanceof Date ? v.toISOString() : null) };
        case oracledb.DB_TYPE_NUMBER:
        case oracledb.DB_TYPE_CLOB:
        case oracledb.DB_TYPE_NCLOB:
          return { type: oracledb.STRING };
        case oracledb.DB_TYPE_BLOB:
          return { type: oracledb.BUFFER };
        case oracledb.DB_TYPE_JSON:
          return { converter: (v: unknown) => (v === null ? null : JSON.stringify(v)) };
        default:
          return undefined;
      }
    },
  };
}

class OracleSession implements Session {
  protected readonly connection: () => Promise<{
    conn: oracledb.Connection;
    release: () => Promise<void>;
  }>;
  private readonly autoCommit: boolean;

  constructor(
    connection: () => Promise<{ conn: oracledb.Connection; release: () => Promise<void> }>,
    autoCommit: boolean,
  ) {
    this.connection = connection;
    this.autoCommit = autoCommit;
  }

  async query(sql: string, params: readonly unknown[]): Promise<Record<string, unknown>[]> {
    const { conn, release } = await this.connection();
    try {
      // INSERT … RETURNING 主键 INTO :eq_id：取输出变量当成一行返回
      if (/\bINTO :eq_id$/.test(sql)) {
        const result = await conn.execute(
          sql,
          [...params.map(bindValue), { dir: oracledb.BIND_OUT, type: oracledb.STRING }],
          {
            autoCommit: this.autoCommit,
          },
        );
        const out = result.outBinds as unknown[];
        return [{ eq_id: (out[out.length - 1] as unknown[])[0] }];
      }
      const result = await conn.execute<Record<string, unknown>>(
        sql,
        params.map(bindValue),
        fetchInfo(),
      );
      return result.rows ?? [];
    } finally {
      await release();
    }
  }

  async execute(sql: string, params: readonly unknown[]): Promise<ExecuteResult> {
    const { conn, release } = await this.connection();
    try {
      const result = await conn.execute(sql, params.map(bindValue), {
        autoCommit: this.autoCommit,
      });
      // 方言把多行插入写成匿名块里的逐行 INSERT：块不报告行数，成功就是每行一行
      if (/^BEGIN INSERT INTO /.test(sql))
        return { affected: sql.match(/\bINSERT INTO /g)!.length, insertId: undefined };
      return { affected: result.rowsAffected ?? 0, insertId: undefined };
    } finally {
      await release();
    }
  }
}

/** JS 值 → 绑定值：bigint 写成文字，Uint8Array 写成 Buffer */
function bindValue(value: unknown): unknown {
  if (typeof value === 'bigint') return value.toString();
  if (value instanceof Uint8Array && !Buffer.isBuffer(value)) return Buffer.from(value);
  return value;
}

const ISOLATION = {
  'read uncommitted': 'READ COMMITTED',
  'read committed': 'READ COMMITTED',
  'repeatable read': 'SERIALIZABLE',
  serializable: 'SERIALIZABLE',
} as const;

class OracleDriver extends OracleSession implements Driver {
  private readonly pool: oracledb.Pool;

  constructor(pool: oracledb.Pool) {
    super(async () => {
      const conn = await pool.getConnection();
      return { conn, release: () => conn.close() };
    }, true);
    this.pool = pool;
  }

  async transaction<T>(
    work: (session: Session) => Promise<T>,
    options?: TransactionOptions,
  ): Promise<T> {
    const conn = await this.pool.getConnection();
    try {
      if (options?.readOnly) await conn.execute('SET TRANSACTION READ ONLY');
      else if (options?.isolation)
        await conn.execute(`SET TRANSACTION ISOLATION LEVEL ${ISOLATION[options.isolation]}`);
      try {
        const result = await work(
          new OracleSession(async () => ({ conn, release: async () => undefined }), false),
        );
        await conn.commit();
        return result;
      } catch (error) {
        await conn.rollback();
        throw error;
      }
    } finally {
      await conn.close();
    }
  }
}

export interface OracleOptions {
  /** 服务器版本：按它选写法，默认最新（23ai） */
  readonly version?: OracleVersion;
}

/**
 * 连接池：建池时给 sessionCallback 设好会话的日期格式与时区（见 oracleSession），
 * `oracledb.createPool({ …, sessionCallback: oracleSession })`
 */
export function oracle(
  pool: oracledb.Pool,
  options: OracleOptions = {},
): Adapter<Without<'returning'>> {
  return {
    dialect: new OracleDialect({ version: options.version }),
    driver: new OracleDriver(pool),
  };
}

/** 连上库读出服务器版本（如 23.5.0.24.7）再建 adapter，部署到 11g 还是 23ai 都自动选对写法 */
oracle.detect = async (pool: oracledb.Pool): Promise<Adapter<Without<'returning'>>> => {
  const conn = await pool.getConnection();
  try {
    return {
      dialect: new OracleDialect({ version: conn.oracleServerVersionString }),
      driver: new OracleDriver(pool),
    };
  } finally {
    await conn.close();
  }
};

/** 建池时的 sessionCallback：日期、时间戳的会话格式设成 ISO、时区 UTC（核心按 UTC 文字读写日期时间） */
export function oracleSession(
  conn: oracledb.Connection,
  _requested: string,
  done: (error?: Error) => void,
): void {
  // 驱动要的是回调形式：依次执行，完成或出错时调 done
  SESSION_FORMATS.reduce<Promise<unknown>>(
    (prev, sql) => prev.then(() => conn.execute(sql)),
    Promise.resolve(),
  ).then(
    () => done(),
    (error: unknown) => done(error as Error),
  );
}
