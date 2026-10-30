/**
 * 二级缓存（对应 Java 版的 easy-cache）：kv 模式按主键缓存单行，all 模式缓存整张表（适合配置、省市这类小表）。
 *
 * ```ts
 * const cache = createCache({ entities: [User, Province], store: redisStore(redis) })
 * const db = createDb({ schema, adapter, interceptors: [cache.interceptor] })   // 写入这些实体时失效
 * const users = cache.of(db)
 * await users.kv(User).find(1)                                   // 先查缓存，没有再查库并写回
 * await users.kv(User).where((u) => u.enabled.eq(true)).find(1)   // 条件是缓存字段的一部分
 * await users.all(Province).where((p) => p.name.startsWith('浙')).toPage(1, 20)
 * ```
 *
 * 一致性（对应官方的"延迟删除 + 逻辑删除"方案）：
 * - 失效走拦截器：insert 按插入的主键，update / delete 按改之前的行（拦截器对缓存的实体声明 before，核心先按同样条件读出受影响的行），
 *   所以表达式更新也知道该删哪些键——官方要自己实现 CacheKeysProvider 按更新时间回查
 * - 写入时删一次，事务提交后再删一次（事务里别的请求可能把旧值读回缓存）；回滚了第二次也不删，第一次删掉的只是少命中一次
 * - 绕过本库的写入（直接改库、别的服务）不会失效，靠过期时间兜底，或接 CDC 调用 evict
 * - onEvict 在失效之后收到删掉的键：多实例各用进程内缓存时经 PG 的 NOTIFY 转给别的实例，或推给浏览器
 *   （前端存储包 @zerodep-dev/storage 的 cacheStore 能把 IndexedDB 等驱动变成这里的 CacheStore）
 * 读写拦截器（租户等）照常生效，它们加的条件是缓存字段的一部分：不同租户各缓存各的。
 */
import {
  flattenRow,
  nestRow,
  type AnySchema,
  type Cond,
  type Db,
  type Entity,
  type EntityKey,
  type Interceptor,
  type KeyOf,
  type Page,
  type Ref,
  type Row,
} from '@zerodep-dev/easy-query-ts';

declare module '@zerodep-dev/easy-query-ts' {
  interface InterceptorNames {
    /** 二级缓存的失效（easy-query-ts-cache） */
    cache: true;
  }
}

/**
 * 缓存的存储（对应官方的 CacheManager）：一个键下多个字段（字段是查询条件），按键删除。
 * Redis 用 HGET / HSET + PEXPIRE / DEL 实现；进程内用 memoryStore（多实例部署要用共享的存储）
 */
export interface CacheStore {
  get(key: string, field: string): Promise<string | undefined>;
  set(key: string, field: string, value: string, ttlMs: number): Promise<void>;
  delete(keys: readonly string[]): Promise<void>;
}

/** 进程内的存储：每个字段各自过期；now 可以换成测试用的时钟 */
export function memoryStore(now: () => number = Date.now): CacheStore {
  const keys = new Map<string, Map<string, { value: string; expires: number }>>();
  return {
    get(key, field) {
      const item = keys.get(key)?.get(field);
      if (!item) return Promise.resolve(undefined);
      if (item.expires <= now()) {
        keys.get(key)!.delete(field);
        return Promise.resolve(undefined);
      }
      return Promise.resolve(item.value);
    },
    set(key, field, value, ttlMs) {
      let fields = keys.get(key);
      if (!fields) keys.set(key, (fields = new Map()));
      fields.set(field, { value, expires: now() + ttlMs });
      return Promise.resolve();
    },
    delete(list) {
      for (const key of list) keys.delete(key);
      return Promise.resolve();
    },
  };
}

export interface CacheOptions {
  /** 要缓存的实体：写入它们时失效（只有列在这里的实体能用 kv / all） */
  readonly entities: readonly Entity[];
  /** 默认进程内的 memoryStore() */
  readonly store?: CacheStore;
  /** 缓存的过期时间，默认 5 分钟 */
  readonly ttlMs?: number;
  /** 查不到的行也缓存（防穿透），过期时间默认 10 秒 */
  readonly nullTtlMs?: number;
  /** 键的前缀，默认 'CACHE'：键是 CACHE:表名:主键、CACHE:表名:all */
  readonly keyPrefix?: string;
  /**
   * 失效之后通知删掉的键（写入时在提交后的那次删除之后，evict 时在删除之后）：
   * `onEvict: (keys) => db.notify('cache_evict', JSON.stringify(keys))`，别的实例 listen 到后从自己的存储里删
   */
  readonly onEvict?: (keys: readonly string[]) => unknown;
}

/** 键的类型：单列主键的值 */
type KeyValue = string | number | bigint;

/** 缓存里表示"库里没有"的值 */
const MISSING = 'null';

export class EasyCache {
  /** 放进 createDb 的 interceptors：写入缓存的实体时失效 */
  readonly interceptor: Interceptor;
  private readonly store: CacheStore;
  private readonly tables: ReadonlySet<string>;
  private readonly ttlMs: number;
  private readonly nullTtlMs: number;
  private readonly prefix: string;
  private readonly onEvict: ((keys: readonly string[]) => unknown) | undefined;

  constructor(options: CacheOptions) {
    this.store = options.store ?? memoryStore();
    this.tables = new Set(options.entities.map((e) => e.table));
    this.ttlMs = options.ttlMs ?? 300_000;
    this.nullTtlMs = options.nullTtlMs ?? 10_000;
    this.prefix = options.keyPrefix ?? 'CACHE';
    this.onEvict = options.onEvict;
    this.interceptor = {
      name: 'cache',
      before: (entity) => this.tables.has(entity.table),
      afterWrite: async (event) => {
        if (!this.tables.has(event.entity.table)) return;
        const rows = event.kind === 'insert' ? event.rows : (event.before ?? []);
        const keys = [this.allKey(event.entity), ...this.keysOf(event.entity, rows)];
        // 延迟双删：现在删一次，提交后再删一次
        await this.store.delete(keys);
        event.afterCommit(() => this.remove(keys));
      },
    };
  }

  /** 绑定一个 Db（事务里的 tx 也行）：缓存没命中时用它查库 */
  of<S extends AnySchema>(db: Db<S>): CacheClient<S> {
    return new CacheClient(db, this);
  }

  /** 手动失效（CDC、别的服务改了库）：给主键删这几行，不给删这个实体的全部 kv 之外的 all 缓存 */
  async evict(entity: Entity, keys: readonly KeyValue[] = []): Promise<void> {
    await this.remove([this.allKey(entity), ...keys.map((k) => this.kvKey(entity, k))]);
  }

  /** 删掉这些键并通知 onEvict */
  private async remove(keys: readonly string[]): Promise<void> {
    await this.store.delete(keys);
    await this.onEvict?.(keys);
  }

  /** @internal 缓存里的值：undefined 是没缓存，null 是缓存了"库里没有" */
  async read(key: string, field: string): Promise<string | null | undefined> {
    const cached = await this.store.get(key, field);
    return cached === MISSING ? null : cached;
  }

  /** @internal 写回缓存；value 为 undefined 表示库里没有（较短的过期时间） */
  async write(key: string, field: string, value: string | undefined): Promise<void> {
    await this.store.set(
      key,
      field,
      value ?? MISSING,
      value === undefined ? this.nullTtlMs : this.ttlMs,
    );
  }

  /** @internal */
  check(entity: Entity, mode: string): void {
    if (!this.tables.has(entity.table))
      throw new Error(
        `cache.${mode}(${entity.name}): list ${entity.name} in createCache({ entities }) so that writes evict it`,
      );
  }

  /** @internal */
  kvKey(entity: Entity, key: KeyValue): string {
    return `${this.prefix}:${entity.table}:${String(key)}`;
  }

  /** @internal */
  allKey(entity: Entity): string {
    return `${this.prefix}:${entity.table}:all`;
  }

  private keysOf(entity: Entity, rows: readonly Readonly<Record<string, unknown>>[]): string[] {
    const [pk] = entity.primaryKey;
    if (pk === undefined || entity.primaryKey.length > 1) return [];
    return rows
      .map((row) => row[pk])
      .filter((v): v is KeyValue => v !== undefined && v !== null)
      .map((v) => this.kvKey(entity, v));
  }
}

/** 建一个缓存；它的 interceptor 要放进 createDb */
export function createCache(options: CacheOptions): EasyCache {
  return new EasyCache(options);
}

/** 绑定了 Db 的缓存入口 */
export class CacheClient<S extends AnySchema> {
  private readonly db: Db<S>;
  private readonly cache: EasyCache;

  constructor(db: Db<S>, cache: EasyCache) {
    this.db = db;
    this.cache = cache;
  }

  /** kv 模式（对应官方 kvStorage）：按单列主键缓存单行 */
  kv<E extends S['entities'][EntityKey<S>]>(entity: E): KvCache<S, KeyOf<S, E>> {
    this.cache.check(entity, 'kv');
    if (entity.primaryKey.length !== 1)
      throw new Error(`cache.kv(${entity.name}) needs a single-column primary key`);
    return new KvCache(this.db, this.cache, entity, []);
  }

  /** all 模式（对应官方 allStorage）：整张表按条件缓存成一个列表，toList / toPage 在内存里取 */
  all<E extends S['entities'][EntityKey<S>]>(entity: E): AllCache<S, KeyOf<S, E>> {
    this.cache.check(entity, 'all');
    return new AllCache(this.db, this.cache, entity, []);
  }
}

type Filter<S extends AnySchema, K extends EntityKey<S>> = (r: Ref<S, K>) => Cond;
type RowOf<S extends AnySchema, K extends EntityKey<S>> = Row<S['entities'][K]>;

export class KvCache<S extends AnySchema, K extends EntityKey<S>> {
  private readonly db: Db<S>;
  private readonly cache: EasyCache;
  private readonly entity: Entity;
  private readonly filters: readonly Filter<S, K>[];

  constructor(db: Db<S>, cache: EasyCache, entity: Entity, filters: readonly Filter<S, K>[]) {
    this.db = db;
    this.cache = cache;
    this.entity = entity;
    this.filters = filters;
  }

  /** 加条件（对应官方 kvStorage 的 where）：不满足条件的行当作没有；条件连同拦截器加的条件是缓存字段 */
  where(filter: Filter<S, K>): KvCache<S, K> {
    return new KvCache(this.db, this.cache, this.entity, [...this.filters, filter]);
  }

  async find(key: KeyValue): Promise<RowOf<S, K> | null> {
    return (await this.findMany([key]))[0] ?? null;
  }

  /** 几个主键一起取：没命中的用一条 IN 查询补上；返回按给出的顺序，库里没有的跳过 */
  async findMany(keys: readonly KeyValue[]): Promise<RowOf<S, K>[]> {
    const field = this.field();
    const found = new Map<string, RowOf<S, K>>();
    const missing: KeyValue[] = [];
    for (const key of keys) {
      const cached = await this.cache.read(this.cache.kvKey(this.entity, key), field);
      if (cached === undefined) missing.push(key);
      else if (cached !== null)
        found.set(String(key), deserialize(this.entity, cached) as RowOf<S, K>);
    }
    if (missing.length > 0) {
      const pk = this.entity.primaryKey[0]!;
      const rows = (await this.query()
        .where((r: any) => r[pk].in(missing))
        .toList()) as Record<string, unknown>[];
      const byKey = new Map(rows.map((row) => [String(row[pk]), row]));
      for (const key of missing) {
        const row = byKey.get(String(key));
        await this.cache.write(
          this.cache.kvKey(this.entity, key),
          field,
          row && serialize(this.entity, row),
        );
        if (row) found.set(String(key), row as RowOf<S, K>);
      }
    }
    return keys
      .map((key) => found.get(String(key)))
      .filter((row): row is RowOf<S, K> => row !== undefined);
  }

  private query() {
    const q = this.db.queryable(this.entity as never) as any;
    return this.filters.reduce((acc, f) => acc.where(f), q);
  }

  /** 缓存字段：条件（含拦截器加的）的 SQL 与参数 */
  private field(): string {
    const { sql, params } = this.query().toSQL();
    return fingerprint(sql, params);
  }
}

export class AllCache<S extends AnySchema, K extends EntityKey<S>> {
  private readonly db: Db<S>;
  private readonly cache: EasyCache;
  private readonly entity: Entity;
  private readonly filters: readonly Filter<S, K>[];

  constructor(db: Db<S>, cache: EasyCache, entity: Entity, filters: readonly Filter<S, K>[]) {
    this.db = db;
    this.cache = cache;
    this.entity = entity;
    this.filters = filters;
  }

  where(filter: Filter<S, K>): AllCache<S, K> {
    return new AllCache(this.db, this.cache, this.entity, [...this.filters, filter]);
  }

  async toList(): Promise<RowOf<S, K>[]> {
    const query = this.filters.reduce(
      (acc, f) => acc.where(f),
      this.db.queryable(this.entity as never) as any,
    );
    const pk = this.entity.primaryKey;
    const ordered = pk.length > 0 ? query.orderBy((r: any) => pk.map((k) => r[k])) : query;
    const { sql, params } = ordered.toSQL();
    const key = this.cache.allKey(this.entity);
    const field = fingerprint(sql, params);
    let text = await this.cache.read(key, field);
    if (typeof text !== 'string') {
      const rows = (await ordered.toList()) as Record<string, unknown>[];
      text = JSON.stringify(rows.map((row) => serialize(this.entity, row)));
      await this.cache.write(key, field, text);
    }
    const list = JSON.parse(text) as string[];
    return list.map((item) => deserialize(this.entity, item) as RowOf<S, K>);
  }

  /** 在缓存的整表上分页（page 从 1 开始） */
  async toPage(page: number, size: number): Promise<Page<RowOf<S, K>>> {
    const rows = await this.toList();
    return { rows: rows.slice((page - 1) * size, page * size), total: rows.length, page, size };
  }
}

/** 一行按列的编码写成文字（日期、大整数、二进制都能原样读回） */
function serialize(entity: Entity, row: Readonly<Record<string, unknown>>): string {
  const flat = flattenRow(entity, row);
  const encoded = Object.fromEntries(
    Object.entries(entity.columns).map(([p, column]) => {
      const value = flat[p];
      return [
        p,
        value === null || value === undefined ? null : column.codec.encode(value as never),
      ];
    }),
  );
  return JSON.stringify(encoded, (_key, value: unknown) => {
    if (typeof value === 'bigint') return { $bigint: value.toString() };
    if (value instanceof Uint8Array) return { $bytes: Buffer.from(value).toString('base64') };
    return value;
  });
}

function deserialize(entity: Entity, text: string): Record<string, unknown> {
  const raw = JSON.parse(text, (_key, value: unknown) => {
    if (value && typeof value === 'object') {
      const tagged = value as { $bigint?: string; $bytes?: string };
      if (tagged.$bigint !== undefined) return BigInt(tagged.$bigint);
      if (tagged.$bytes !== undefined) return new Uint8Array(Buffer.from(tagged.$bytes, 'base64'));
    }
    return value;
  }) as Record<string, unknown>;
  const flat = Object.fromEntries(
    Object.entries(entity.columns).map(([p, column]) => {
      const value = raw[p];
      return [p, value === null || value === undefined ? null : column.codec.decode(value)];
    }),
  );
  return nestRow(flat);
}

/** 条件的指纹：SQL 与参数（cyrb53，够用来区分缓存字段） */
function fingerprint(sql: string, params: readonly unknown[]): string {
  const text = JSON.stringify([sql, params], (_k, v: unknown) =>
    typeof v === 'bigint' ? v.toString() : v,
  );
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 2654435761);
    h2 = Math.imul(h2 ^ c, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}
