/**
 * 发件箱（ROADMAP 23.5）：失效消息和业务写入在同一个事务里落一行，后台的 relayOutbox 读出来发进消息通道再删掉。
 * 提交了就一定会发出去（进程在提交后、发消息前挂了也不丢）；回滚了这一行跟着没了。
 * createCache 与 tableChanges 配了 outbox 时照样在提交后马上发一次（求快），发件箱保底，重复的消息无害（收到后做的都是删除）。
 *
 *   const CacheOutbox = outboxTable();                         // 放进 schema，建表、同步时一起建
 *   const schema = defineSchema({ User, CacheOutbox });
 *   const cache = createCache({ entities: [User], store, bus, outbox: { db, table: CacheOutbox } });
 *   const relay = relayOutbox({ db, bus, table: CacheOutbox }); // 每个实例跑一个也行：同一行发两次无害
 *   await relay.stop();
 */
import { col, entity, type Db, type Entity, type WriteEvent } from '@zerodep-dev/easy-query-ts';
import type { EvictMessage, InvalidationBus } from './bus.ts';

/** 发件箱表（默认表名 eqts_cache_outbox）：自增主键与消息 */
export function outboxTable(name = 'eqts_cache_outbox') {
  return entity(name, {
    id: col.bigint({ mode: 'bigint' }).primaryKey().generated(),
    message: col.json<EvictMessage>(),
  });
}

/** 发件箱表的实体 */
export type OutboxTable = ReturnType<typeof outboxTable>;

/** createCache、tableChanges 的 outbox 选项：用哪个 Db 生成插入语句（方言一致就行）、哪张表 */
export interface OutboxOptions {
  // 任何 schema 的 Db：只用它生成插入语句、转发时读删发件箱
  readonly db: Db<any>;
  readonly table: OutboxTable;
}

/** @internal 在写入所在的连接上（事务里时同一个事务）落一行 */
export async function writeOutbox(
  outbox: OutboxOptions,
  event: WriteEvent,
  message: EvictMessage,
): Promise<void> {
  const insert = outbox.db.insert(outbox.table as Entity);
  for (const statement of insert.values({ message } as never).toSQL()) {
    await event.execute(statement);
  }
}

/** relayOutbox 的选项 */
export interface RelayOptions extends OutboxOptions {
  readonly bus: InvalidationBus;
  /** 多久看一次发件箱（毫秒），默认 1000 */
  readonly intervalMs?: number;
  /** 一次最多取多少行，默认 100；取满了马上接着取 */
  readonly batch?: number;
  /** 一轮出错时（库或通道暂时不可用）调用；下一轮照常重试。默认什么也不做 */
  readonly onError?: (error: unknown) => void;
}

/** 后台转发：按 id 顺序取出、发进通道、删掉。返回 drain（立即转发完现有的，测试与停机前用）与 stop */
export function relayOutbox(options: RelayOptions): {
  drain(): Promise<void>;
  stop(): Promise<void>;
} {
  const { bus, table, intervalMs = 1000, batch = 100, onError } = options;
  // 发件箱不归租户、逻辑删除这类拦截器管
  const db = options.db.withInterceptors({ skip: 'all' });
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;
  let running: Promise<void> = Promise.resolve();

  /** 转发一批；返回取到了几行 */
  async function relayBatch(): Promise<number> {
    const rows = (await db
      .queryable(table as Entity)
      .orderBy((r: any) => r.id)
      .limit(batch)
      .toList()) as { id: bigint; message: EvictMessage }[];
    for (const row of rows) await bus.publish(row.message);
    if (rows.length > 0) {
      const ids = rows.map((row) => row.id);
      await db
        .delete(table as Entity)
        .where((r: any) => r.id.in(ids))
        .execute();
    }
    return rows.length;
  }

  async function drainAll(): Promise<void> {
    while ((await relayBatch()) === batch);
  }

  function schedule() {
    if (stopped) return;
    timer = setTimeout(() => {
      running = drainAll()
        .catch((error: unknown) => onError?.(error))
        .finally(schedule);
    }, intervalMs);
    (timer as { unref?: () => void }).unref?.();
  }

  schedule();
  return {
    async drain() {
      await running;
      await drainAll();
    },
    async stop() {
      stopped = true;
      clearTimeout(timer);
      await running;
    },
  };
}
