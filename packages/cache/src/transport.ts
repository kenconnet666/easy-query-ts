/**
 * 多实例之间的失效通知：一个实例写入后，让别的实例删掉本机层里的缓存。本库不带 Redis、MQ 的驱动，传输由使用方实现两个方法：
 *
 *   const transport: CacheTransport = {
 *     send: (text) => producer.send({ topic: 'cache-evict', messages: [{ value: text }] }).then(() => {}),
 *     listen: async (onText, onReset) => {
 *       // Kafka 每个实例一个消费组才是广播；重平衡、重连时调 onReset
 *       await consumer.subscribe({ topic: 'cache-evict' });
 *       await consumer.run({ eachMessage: async ({ message }) => onText(String(message.value)) });
 *       return () => consumer.disconnect();
 *     },
 *   };
 *
 * 消息至少送达一次就够：收到后做的都是删除，重复无害；传输断过又连上时调 onReset（中间的可能丢了），收的一方清空本机层。
 * 接 Redis 发布订阅的完整示例在仓库的 packages/test/src/redis-cache.ts。
 */

/** 传输：把文字发给所有实例（包括自己）、收别的实例发的文字 */
export interface CacheTransport {
  /** 发给所有实例 */
  send(text: string): Promise<void>;
  /** 开始收；连接断过又连上时调 onReset。返回停止收的函数 */
  listen(onText: (text: string) => void, onReset: () => void): Promise<() => Promise<void>>;
  /** 一条消息最多多少字节（如 PG 的 NOTIFY 不到 8000）；超出时切成几条 */
  readonly maxBytes?: number;
}

/** 线上的样子：o 是来源标记，k 是删掉的键 */
interface Wire {
  o: string;
  k: string[];
}

const encoder = new TextEncoder();

/** @internal 把要删的键写成消息，按字节上限切开 */
export function encodeEviction(
  origin: string,
  keys: readonly string[],
  maxBytes = Infinity,
): string[] {
  const encode = (k: string[]) => JSON.stringify({ o: origin, k } satisfies Wire);
  const whole = encode([...keys]);
  if (encoder.encode(whole).length <= maxBytes) return [whole];
  const texts: string[] = [];
  let part: string[] = [];
  for (const key of keys) {
    if (part.length > 0 && encoder.encode(encode([...part, key])).length > maxBytes) {
      texts.push(encode(part));
      part = [];
    }
    part.push(key);
  }
  texts.push(encode(part));
  return texts;
}

/** @internal 读消息；解析不了的（通道上别的内容）返回 undefined */
export function decodeEviction(
  text: string,
): { readonly origin: string; readonly keys: readonly string[] } | undefined {
  try {
    const wire = JSON.parse(text) as Wire;
    return Array.isArray(wire.k) ? { origin: wire.o, keys: wire.k } : undefined;
  } catch {
    return undefined;
  }
}

/**
 * 进程内的传输：同一个 memoryTransport 上的几个缓存互相收得到（测试里模拟几个实例）。
 * 发出去的在下一个微任务送达，和真的传输一样是异步的
 */
export function memoryTransport(): CacheTransport & { reset(): void } {
  const listeners = new Set<{ onText: (text: string) => void; onReset: () => void }>();
  return {
    send(text) {
      queueMicrotask(() => {
        for (const listener of listeners) listener.onText(text);
      });
      return Promise.resolve();
    },
    listen(onText, onReset) {
      const listener = { onText, onReset };
      listeners.add(listener);
      return Promise.resolve(() => {
        listeners.delete(listener);
        return Promise.resolve();
      });
    },
    /** 模拟传输断过又连上（测试用） */
    reset() {
      for (const listener of listeners) listener.onReset();
    },
  };
}
