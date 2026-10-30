/**
 * 驱动接口与执行上下文。驱动只管执行文本 SQL；方言管渲染，两者由各数据库包一起提供（Adapter）。
 */
import type { Capability, Capable } from './capabilities.ts';
import type { AnySchema } from './relations.ts';
import type { Dialect, Statement } from './dialect.ts';
import type { Interceptors } from './interceptor.ts';

export interface ExecuteResult {
  readonly affected: number;
  /** 自增主键（单行插入时有意义） */
  readonly insertId: number | bigint | undefined;
}

/**
 * 一条连接（或事务）上的执行。signal 是这条语句的取消信号（Db.withSignal、withTimeout 合成的）：
 * 能在服务端终止语句的驱动在它触发时终止（PG pg_cancel_backend、MySQL KILL QUERY）；不能的忽略它，核心照样不再等待
 */
export interface Session {
  query(
    sql: string,
    params: readonly unknown[],
    signal?: AbortSignal,
  ): Promise<Record<string, unknown>[]>;
  execute(sql: string, params: readonly unknown[], signal?: AbortSignal): Promise<ExecuteResult>;
  /**
   * 流式读取：每次产出一批（最多 batchSize 行），不把整个结果集读进内存。驱动不支持时不实现，
   * 核心退化成一次读完再分批产出（API 一致，只是没有省内存）。
   */
  stream?(
    sql: string,
    params: readonly unknown[],
    batchSize: number,
  ): AsyncIterable<Record<string, unknown>[]>;
}

export type IsolationLevel =
  'read uncommitted' | 'read committed' | 'repeatable read' | 'serializable';

export interface TransactionOptions {
  readonly isolation?: IsolationLevel;
  /** 只读事务：数据库会拒绝其中的写入，部分库还能据此做优化 */
  readonly readOnly?: boolean;
}

export interface Driver extends Session {
  /** 在同一条连接上开事务执行 work，正常返回时提交、抛错时回滚 */
  transaction<T>(work: (session: Session) => Promise<T>, options?: TransactionOptions): Promise<T>;
}

/** 各数据库包提供：方言 + 驱动；C 是方言支持的能力（只在类型里，见 capabilities.ts） */
export interface Adapter<C extends Capability = Capability> extends Capable<C> {
  readonly dialect: Dialect;
  readonly driver: Driver;
}

/** 一条语句执行完（成功或失败）后交给 onExecute 的信息，对应 Java 版的 JdbcExecutorListener */
export interface ExecutionEvent {
  readonly statement: Statement;
  /** 方言名（Dialect.name）：'postgres'、'mysql'…… */
  readonly dialect: string;
  /** query 是读（返回行），execute 是写（返回影响的行数） */
  readonly kind: 'query' | 'execute';
  /** 驱动执行耗时，毫秒 */
  readonly durationMs: number;
  /** 读返回的行数 / 写影响的行数；失败时为 0 */
  readonly rows: number;
  /** 失败时的错误；成功时为 undefined。错误之后仍会照常抛给调用方 */
  readonly error: unknown;
}

/** 构建器执行时用到的一切 */
export interface Context {
  readonly schema: AnySchema;
  readonly dialect: Dialect;
  readonly session: Session;
  /** 每条语句执行前调用 */
  readonly log: ((statement: Statement) => void) | undefined;
  /** 每条语句执行后调用（成功与失败都会），用来记耗时、慢 SQL、链路追踪 */
  readonly onExecute: ((event: ExecutionEvent) => void) | undefined;
  readonly interceptors: Interceptors;
  /** 取消信号：已取消的信号让新语句直接失败，执行中取消则不再等待结果（见 Db.withSignal） */
  readonly signal: AbortSignal | undefined;
  /** 每条语句的超时（毫秒，Db.withTimeout / createDb 的 statementTimeout）：到点按取消处理 */
  readonly timeoutMs: number | undefined;
  /** 事务结束后要做的事（Db.afterCommit / afterRollback）；不在事务里时没有 */
  readonly hooks: TransactionHooks | undefined;
  /** 全局护栏（createDb 的 hardDelete、maxRows） */
  readonly guards: Guards;
  /** 读写分离的从库：事务外的读按轮询分给它们；写入、事务里、usePrimary() 之后没有 */
  readonly replicas: Replicas | undefined;
}

/** 从库与轮询的位置（同一个 Db 派生出来的都共用） */
export interface Replicas {
  readonly sessions: readonly Session[];
  next: number;
}

/** 读用哪个连接：事务里（有 hooks）一律主库，否则轮询从库 */
function readSession(ctx: Context): Session {
  const replicas = ctx.replicas;
  if (ctx.hooks || !replicas || replicas.sessions.length === 0) return ctx.session;
  return replicas.sessions[replicas.next++ % replicas.sessions.length]!;
}

/** 全局护栏：防误删、防误拉整表 */
export interface Guards {
  /** 'forbid' 时没有逻辑删除的 delete 要显式写 .hard() 才执行（对应 Java 版的 deleteThrow） */
  readonly hardDelete: 'allow' | 'forbid';
  /** 没写 limit 的 toList 最多读这么多行，多了报错（不悄悄截断）；undefined 不限 */
  readonly maxRows: number | undefined;
  /** 分页的偏移量超过它、且超过总数一半时倒序取再翻回来（深分页）；undefined 不倒序 */
  readonly reversePageAfter: number | undefined;
  /** db.readonly() 之后：写入、DDL、sql.execute 直接报错 */
  readonly readonly: boolean;
}

/** 写入前检查：只读的 Db 上报错（类型上已经没有写方法，这里兜住从 JS 调用、断言掉类型的情况） */
export function assertWritable(ctx: Context): void {
  if (ctx.guards.readonly)
    throw new Error('this Db is read-only (db.readonly()): writes are not allowed');
}

/** 事务结束后要做的事：一层一帧，保存点（嵌套事务）成功时并进外层，失败时丢掉它登记的提交后的事 */
export interface TransactionHooks {
  readonly frames: { readonly commit: (() => unknown)[]; readonly rollback: (() => unknown)[] }[];
}

/** 新的一组事务钩子 */
export const newTransactionHooks = (): TransactionHooks => ({
  frames: [{ commit: [], rollback: [] }],
});

/**
 * 依次执行钩子，都执行完再抛出其中的错误（一个就是它，几个就是 AggregateError）。
 * 提交后的钩子出错时数据已经提交：错误抛给调用方，提示"已提交，但后续动作失败了"
 */
export async function runHooks(hooks: readonly (() => unknown)[]): Promise<void> {
  const errors: unknown[] = [];
  for (const hook of hooks) {
    try {
      await hook();
    } catch (error) {
      errors.push(error);
    }
  }
  if (errors.length === 1) throw errors[0];
  if (errors.length > 1) throw new AggregateError(errors, 'transaction hooks failed');
}

export function query(ctx: Context, statement: Statement): Promise<Record<string, unknown>[]> {
  return observe(
    ctx,
    statement,
    'query',
    (signal) => readSession(ctx).query(statement.sql, statement.params, signal),
    (rows) => rows.length,
  );
}

export function execute(ctx: Context, statement: Statement): Promise<ExecuteResult> {
  return observe(
    ctx,
    statement,
    'execute',
    (signal) => ctx.session.execute(statement.sql, statement.params, signal),
    (result) => result.affected,
  );
}

/**
 * 执行并通知钩子。钩子在 try 之外调用：钩子自己抛错会让这条语句失败，但不会被当成"语句失败"再通知一次。
 */
async function observe<T>(
  ctx: Context,
  statement: Statement,
  kind: 'query' | 'execute',
  run: (signal: AbortSignal | undefined) => Promise<T>,
  count: (result: T) => number,
): Promise<T> {
  ctx.log?.(statement);
  const started = performance.now();
  const signal = statementSignal(ctx);
  let result: T;
  try {
    result = await abortable(signal, () => run(signal));
  } catch (error) {
    ctx.onExecute?.({
      statement,
      dialect: ctx.dialect.name,
      kind,
      durationMs: performance.now() - started,
      rows: 0,
      error,
    });
    throw error;
  }
  ctx.onExecute?.({
    statement,
    dialect: ctx.dialect.name,
    kind,
    durationMs: performance.now() - started,
    rows: count(result),
    error: undefined,
  });
  return result;
}

/** 一条语句的取消信号：Db 的信号与这条语句的超时，谁先到算谁 */
function statementSignal(ctx: Context): AbortSignal | undefined {
  if (ctx.timeoutMs === undefined) return ctx.signal;
  const timeout = AbortSignal.timeout(ctx.timeoutMs);
  return ctx.signal ? AbortSignal.any([ctx.signal, timeout]) : timeout;
}

/**
 * 带取消地执行：信号已取消就不再发出语句；执行中取消就不再等待，立刻以信号的 reason 失败。
 * 服务端的语句由驱动终止（见 Session 的 signal）；不支持的驱动只是"客户端不再等"。
 */
export async function abortable<T>(
  signal: AbortSignal | undefined,
  run: () => Promise<T>,
): Promise<T> {
  if (!signal) return run();
  signal.throwIfAborted();
  let onAbort!: () => void;
  const aborted = new Promise<never>((_, reject) => {
    onAbort = () => reject(signal.reason);
    signal.addEventListener('abort', onAbort, { once: true });
  });
  try {
    return await Promise.race([run(), aborted]);
  } finally {
    signal.removeEventListener('abort', onAbort);
  }
}

/**
 * 流式执行一条查询，按批产出行。驱动没有 stream 时一次读完再分批。
 * 语句日志、onExecute 的行为与 query 一致：日志在开始前，onExecute 在流结束（或被中途放弃）时，rows 是实际产出的行数。
 */
export async function* streamRows(
  ctx: Context,
  statement: Statement,
  batchSize: number,
): AsyncGenerator<Record<string, unknown>[]> {
  ctx.log?.(statement);
  const started = performance.now();
  let rows = 0;
  let failure: unknown;
  try {
    ctx.signal?.throwIfAborted();
    const session = readSession(ctx);
    const source = session.stream
      ? session.stream(statement.sql, statement.params, batchSize)
      : chunks(
          await abortable(ctx.signal, () => session.query(statement.sql, statement.params)),
          batchSize,
        );
    for await (const batch of source) {
      ctx.signal?.throwIfAborted();
      rows += batch.length;
      yield batch;
    }
  } catch (error) {
    failure = error;
    throw error;
  } finally {
    ctx.onExecute?.({
      statement,
      dialect: ctx.dialect.name,
      kind: 'query',
      durationMs: performance.now() - started,
      rows,
      error: failure,
    });
  }
}

function* chunks<T>(items: readonly T[], size: number): Generator<T[]> {
  for (let i = 0; i < items.length; i += size) yield items.slice(i, i + size);
}
