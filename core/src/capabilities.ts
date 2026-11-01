/**
 * 方言能力写进类型：每个方言包的 adapter 带上它支持的能力，createDb 把能力挂在 schema 类型上（只在类型里，运行时没有这个属性），
 * Db、查询、写入构造器的方法按能力有无——不支持的写法在调用处就报错：
 * ```ts
 * const db = createDb({ schema, adapter: tdengine(sql) })
 * db.update(Reading)   // 类型错误：'error: this Db does not support': "update"
 * ```
 * schema 本来就贯穿 Db、Queryable 与各写入构造器，能力跟着它走，不用给每个类型加泛型参数。
 * `db.readonly()` 也是去掉能力（写入、加锁），只读的 Db 在类型上就没有写方法。
 * 运行时的报错照旧保留（从 JS 调用、或类型被断言掉时兜底）。表达式层面的差异（某个库没有某个函数）仍在渲染时报出
 */

/** 方言可能缺的能力；write 只由 db.readonly() 去掉 */
export type Capability =
  /** 写入：insert、delete、save、remove、建表与同步、迁移 */
  | 'write'
  /** UPDATE（TDengine 没有：同一时间戳再写一次就是覆盖） */
  | 'update'
  /** 能回滚的事务：transaction()、begin()（ClickHouse、Doris、TDengine 没有） */
  | 'transactions'
  /** lock()：锁住一行直到事务结束 */
  | 'lock'
  /** SELECT … FOR UPDATE */
  | 'forUpdate'
  /** FOR UPDATE SKIP LOCKED（或同义写法） */
  | 'skipLocked'
  /** FOR UPDATE NOWAIT（Db2 没有） */
  | 'noWait'
  /** INSERT / UPDATE / DELETE … RETURNING（PG、SQLite、DuckDB 有） */
  | 'returning'
  /** 插入后取回自增主键：returnId()（ClickHouse、Doris、TDengine 取不回） */
  | 'generatedKeys'
  /** upsert：onConflict(…).merge(…)（ClickHouse 没有） */
  | 'upsert'
  /** onConflict(…).ignore()（Doris、TDengine 没有） */
  | 'upsertIgnore';

declare const capabilities: unique symbol;

/** 带能力标记的类型（adapter、schema 上的可选 phantom 属性） */
export interface Capable<C extends Capability> {
  readonly [capabilities]?: C;
}

/** 去掉几项能力：方言包的 adapter 返回 `Adapter<Without<'returning' | 'noWait'>>` */
export type Without<X extends Capability> = Exclude<Capability, X>;

/** 给 schema 挂上能力 */
export type WithCapabilities<S, C extends Capability> = S & Capable<C>;

/** schema 上的能力；没挂（直接用 Db 类型、自己拼的 schema）时当作全部都有 */
export type CapabilitiesOf<S> = S extends { readonly [capabilities]?: infer C }
  ? unknown extends C
    ? Capability
    : Extract<C, Capability>
  : Capability;

/** 不支持时方法的 this 变成这个类型：调用处报错，错误信息里写出缺的能力 */
export interface Unsupported<K extends Capability> {
  readonly 'error: this Db does not support': K;
}

/** db.readonly() 去掉的能力：写入、UPDATE、加锁（从库上都做不了） */
export type WriteCapability = 'write' | 'update' | 'lock' | 'forUpdate' | 'skipLocked' | 'noWait';

/** 只读的 schema：去掉写入与加锁的能力 */
export type ReadOnly<S> = WithCapabilities<S, Exclude<CapabilitiesOf<S>, WriteCapability>>;

/** 方法的 this：有能力 K 时是 Self，没有时是 Unsupported<K> */
export type Requires<S, K extends Capability, Self> = [K] extends [CapabilitiesOf<S>]
  ? Self
  : Unsupported<K>;
