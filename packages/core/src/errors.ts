/**
 * 调用方会在运行时接住处理的错误，各有一个类：用 `instanceof` 判断，不用去匹配消息文字。
 * ```ts
 * try {
 *   await db.insert(User).values(form).execute();
 * } catch (error) {
 *   if (error instanceof UniqueViolationError) return conflict('邮箱已注册');
 *   throw error;
 * }
 * ```
 * 用法写错（没写条件就更新、列名不对、方言不支持……）抛的仍是普通的 Error：那是要改代码的，不是要处理的。
 */

/** 查不到要的行（firstOrThrow、findOrThrow、single）：接口层据此回 404 */
export class NotFoundError extends Error {
  override readonly name = 'NotFoundError';
}

/** 乐观锁失败：带着版本条件的更新 / 删除一行都没改到（或批量里少改了几行），行已被别人改过或删掉 */
export class OptimisticLockError extends Error {
  override readonly name = 'OptimisticLockError';
  /** 哪张表 */
  readonly table: string;

  constructor(message: string, table: string) {
    super(message);
    this.table = table;
  }
}

/**
 * 客户端传来的列表请求不合法：页码、每页条数、排序、筛选的字段与取值、条件树、游标（parseTableRequest、parseSearchRequest、
 * table()、conditionOf、toCursorPage）。接口层据此回 400，别的错误才是 500
 */
export class InvalidRequestError extends Error {
  override readonly name: string = 'InvalidRequestError';
}

/** toCursorPage 收到的游标不是它给出去的（被改过、截断了，或者是另一条查询的） */
export class InvalidCursorError extends InvalidRequestError {
  override readonly name = 'InvalidCursorError';
}

/** save() 里子项带的主键是别的父行名下的行，而这个导航没写 adopt */
export class ChildOwnershipError extends Error {
  override readonly name = 'ChildOwnershipError';
}

/**
 * 数据库报的错里，各库都有、调用方常要区别对待的几种：
 * 唯一键冲突、外键冲突、非空约束、死锁、串行化失败（后两种重试多半能成，见 transaction 的 retries）
 */
export type DatabaseErrorKind = 'unique' | 'foreignKey' | 'notNull' | 'deadlock' | 'serialization';

/**
 * 归一之后的数据库错误。各驱动的错误码五花八门，方言认出种类（Dialect.errorKind）后包成它的子类；
 * 驱动原来的错误在 cause 里，它上面的字段（code、errno、constraint、detail……）也照搬到这个对象上，
 * 以前按 `error.code` 判断的代码不用改
 */
export class DatabaseError extends Error {
  override readonly name: string = 'DatabaseError';
  readonly kind: DatabaseErrorKind;

  constructor(kind: DatabaseErrorKind, cause: unknown) {
    super(cause instanceof Error ? cause.message : String(cause), { cause });
    if (typeof cause === 'object' && cause !== null) {
      for (const [key, value] of Object.entries(cause))
        if (!(key in this)) (this as Record<string, unknown>)[key] = value;
    }
    this.kind = kind;
  }
}

/** 唯一键（含主键）冲突 */
export class UniqueViolationError extends DatabaseError {
  override readonly name = 'UniqueViolationError';
}

/** 外键冲突：引用的行不存在，或者还有行引用着要删的行 */
export class ForeignKeyViolationError extends DatabaseError {
  override readonly name = 'ForeignKeyViolationError';
}

/** 往不可空的列写了 NULL */
export class NotNullViolationError extends DatabaseError {
  override readonly name = 'NotNullViolationError';
}

/** 死锁：这个事务被数据库选中回滚 */
export class DeadlockError extends DatabaseError {
  override readonly name = 'DeadlockError';
}

/** 串行化失败：可串行化 / 可重复读的事务与别的事务冲突，被数据库回滚 */
export class SerializationError extends DatabaseError {
  override readonly name = 'SerializationError';
}

const CLASSES = {
  unique: UniqueViolationError,
  foreignKey: ForeignKeyViolationError,
  notNull: NotNullViolationError,
  deadlock: DeadlockError,
  serialization: SerializationError,
} as const;

/**
 * 驱动抛出的错误 → 归一的错误：方言认得出种类就包一层，认不出（或已经包过）原样返回
 */
export function databaseError(
  dialect: { errorKind(error: unknown): DatabaseErrorKind | undefined },
  error: unknown,
): unknown {
  if (error instanceof DatabaseError) return error;
  const kind = dialect.errorKind(error);
  return kind ? new CLASSES[kind](kind, error) : error;
}

/** SQLSTATE（PostgreSQL 系、Db2 等按标准报的五位状态码）→ 种类 */
export function sqlStateKind(state: unknown): DatabaseErrorKind | undefined {
  switch (state) {
    case '23505':
      return 'unique';
    case '23503':
      return 'foreignKey';
    case '23502':
      return 'notNull';
    case '40P01':
      return 'deadlock';
    case '40001':
      return 'serialization';
    default:
      return undefined;
  }
}
