/**
 * 缓存的存储（ROADMAP 23.2）：进程内的 memoryStore、共享的 redisStore，以及把两者叠起来的 tieredStore（先本机、再 Redis）。
 *
 *   const store = tieredStore({ local: memoryStore(), shared: redisStore(redis), localTtlMs: 30_000 });
 *   const cache = createCache({ entities: [User], store, bus });
 */

/**
 * 缓存的存储（对应官方的 CacheManager）：一个键下多个字段（字段是查询条件），按键删除。
 * Redis 用 HGET / HSET + PEXPIRE / DEL 实现；进程内用 memoryStore（多实例部署要配消息通道，或用共享的存储）
 */
export interface CacheStore {
  get(key: string, field: string): Promise<string | undefined>;
  set(key: string, field: string, value: string, ttlMs: number): Promise<void>;
  delete(keys: readonly string[]): Promise<void>;
  /**
   * 别的实例的失效消息到了：只删本机这一层（共享层写入的那个实例已经删过）；keys 为 undefined 时清空本机层（消息通道断过）。
   * 共享的存储什么也不做；没有这个方法的存储收到消息时按 delete 删
   */
  evictLocal?(keys: readonly string[] | undefined): Promise<void>;
}

/** 进程内的存储：每个字段各自过期；now 可以换成测试用的时钟 */
export function memoryStore(now: () => number = Date.now): CacheStore {
  const keys = new Map<string, Map<string, { value: string; expires: number }>>();
  const store: CacheStore = {
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
    evictLocal(list) {
      if (list) return store.delete(list);
      keys.clear();
      return Promise.resolve();
    },
  };
  return store;
}

/** redisStore 用到的 ioredis 客户端的部分 */
export interface RedisHashClient {
  hget(key: string, field: string): Promise<string | null>;
  multi(): {
    hset(key: string, field: string, value: string): unknown;
    pexpire(key: string, ms: number): unknown;
    exec(): Promise<unknown>;
  };
  del(...keys: string[]): Promise<unknown>;
}

/**
 * Redis 的存储：一个缓存键是一个 hash，字段是查询条件。过期时间设在整个键上（每次写入续到这一次的时长），
 * 字段各自过期要 Redis 7.4 的 HPEXPIRE，这里不依赖它：键被失效时整个删掉
 */
export function redisStore(redis: RedisHashClient): CacheStore {
  return {
    async get(key, field) {
      return (await redis.hget(key, field)) ?? undefined;
    },
    async set(key, field, value, ttlMs) {
      const tx = redis.multi();
      tx.hset(key, field, value);
      tx.pexpire(key, ttlMs);
      await tx.exec();
    },
    async delete(keys) {
      if (keys.length > 0) await redis.del(...keys);
    },
    // 共享的：写入的实例已经删过
    evictLocal: () => Promise.resolve(),
  };
}

/** tieredStore 的选项 */
export interface TieredStoreOptions {
  /** 本机层，通常是 memoryStore() */
  readonly local: CacheStore;
  /** 共享层，通常是 redisStore(redis) */
  readonly shared: CacheStore;
  /** 本机层最多存多久（毫秒），默认 30 秒：消息丢了时本机层最多旧这么久 */
  readonly localTtlMs?: number;
}

/**
 * 两级存储：读先本机、再共享，共享命中时回填本机；写两层都写（本机层的过期时间取较短的）；删两层都删；
 * 别的实例的失效消息只删本机层
 */
export function tieredStore(options: TieredStoreOptions): CacheStore {
  const { local, shared, localTtlMs = 30_000 } = options;
  return {
    async get(key, field) {
      const near = await local.get(key, field);
      if (near !== undefined) return near;
      const far = await shared.get(key, field);
      if (far !== undefined) await local.set(key, field, far, localTtlMs);
      return far;
    },
    async set(key, field, value, ttlMs) {
      await shared.set(key, field, value, ttlMs);
      await local.set(key, field, value, Math.min(ttlMs, localTtlMs));
    },
    async delete(keys) {
      await shared.delete(keys);
      await local.delete(keys);
    },
    async evictLocal(keys) {
      if (local.evictLocal) await local.evictLocal(keys);
      else if (keys) await local.delete(keys);
    },
  };
}
