/**
 * 缓存的存储。三种部署各用一种：
 *
 *   createCache({ entities });                                      // 单实例：默认的 memoryStore，本机缓存
 *   createCache({ entities, store: redisStore });                   // 多实例：只用外部 Redis，实现 CacheStore
 *   createCache({                                                   // 多实例：本机 + 外部 Redis，再加失效通知
 *     entities,
 *     store: tieredStore({ local: memoryStore(), shared: redisStore }),
 *     transport,
 *   });
 *
 * 本库不带 Redis 驱动，CacheStore 由使用方按自己的客户端实现（完整示例在仓库的 packages/test/src/redis-cache.ts）。
 */

/**
 * 缓存的存储（对应官方的 CacheManager）：一个键下多个字段（字段是查询条件），按键删除。
 * Redis 用 HGET / HSET + PEXPIRE / DEL 实现
 */
export interface CacheStore {
  /** 读一个字段；没有或过期时返回 undefined */
  get(key: string, field: string): Promise<string | undefined>;
  /** 写一个字段，ttlMs 毫秒后过期 */
  set(key: string, field: string, value: string, ttlMs: number): Promise<void>;
  /** 删掉这些键（连同它们所有的字段） */
  delete(keys: readonly string[]): Promise<void>;
  /**
   * 别的实例的失效通知到了：只删本机这一层（共享层写入的那个实例已经删过）；keys 为 undefined 时清空本机层（通知断过）。
   * 没有这个方法的存储收到通知时按 delete 删
   */
  evictLocal?(keys: readonly string[] | undefined): Promise<void>;
}

/** memoryStore 的选项 */
export interface MemoryStoreOptions {
  /** 最多存多少个键，默认 10000：超出时删最久没用过的。过期的键没人再读就不会被清掉，靠这个上限兜底 */
  readonly maxKeys?: number;
  /** 当前时间，可以换成测试用的时钟 */
  readonly now?: () => number;
}

/** 进程内的存储：每个字段各自过期，键数有上限 */
export function memoryStore(options: MemoryStoreOptions = {}): CacheStore {
  const { maxKeys = 10_000, now = Date.now } = options;
  // Map 按插入顺序遍历：用过的键挪到末尾，最前面的就是最久没用过的
  const keys = new Map<string, Map<string, { value: string; expires: number }>>();
  const touch = (key: string, fields: Map<string, { value: string; expires: number }>) => {
    keys.delete(key);
    keys.set(key, fields);
  };
  const store: CacheStore = {
    get(key, field) {
      const fields = keys.get(key);
      const item = fields?.get(field);
      if (!fields || !item) return Promise.resolve(undefined);
      if (item.expires <= now()) {
        fields.delete(field);
        return Promise.resolve(undefined);
      }
      touch(key, fields);
      return Promise.resolve(item.value);
    },
    set(key, field, value, ttlMs) {
      const fields = keys.get(key) ?? new Map<string, { value: string; expires: number }>();
      fields.set(field, { value, expires: now() + ttlMs });
      touch(key, fields);
      if (keys.size > maxKeys) keys.delete(keys.keys().next().value!);
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

/** tieredStore 的选项 */
export interface TieredStoreOptions {
  /** 本机层，通常是 memoryStore() */
  readonly local: CacheStore;
  /** 共享层：使用方实现的 Redis 存储 */
  readonly shared: CacheStore;
  /** 本机层最多存多久（毫秒），默认 30 秒：失效通知丢了时本机层最多旧这么久 */
  readonly localTtlMs?: number;
}

/**
 * 两级存储：读先本机、再共享，共享命中时回填本机；写两层都写（本机层的过期时间取较短的）；删两层都删；
 * 别的实例的失效通知只删本机层
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
