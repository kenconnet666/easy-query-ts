/**
 * 失效的消息通道（ROADMAP 23.1）：多个后端实例之间传"哪些缓存键删了、哪些表改了"。每个实例一个 createBus，消息发给所有实例（包括自己），
 * 收到时知道是不是自己发的。传输留成两个方法，接什么都行：
 *
 *   const bus = createBus(pgTransport(pool));                       // PG 的 NOTIFY / LISTEN（easy-query-ts-pg）
 *   const bus = createBus(redisTransport({ publisher, subscriber })); // Redis 发布订阅（两条 ioredis 连接）
 *   const bus = createBus({                                          // 自己的 MQ（Kafka 每个实例一个消费组，才是广播）
 *     send: (text) => producer.send({ topic: 'cache-evict', messages: [{ value: text }] }).then(() => {}),
 *     listen: async (onText, onReset) => {
 *       await consumer.subscribe({ topic: 'cache-evict' });
 *       await consumer.run({ eachMessage: async ({ message }) => onText(String(message.value)) });
 *       return () => consumer.disconnect();
 *     },
 *   });
 *
 * 消息至少送达一次就够：收到后做的都是删除，重复无害；传输断过又连上时调 onReset（中间的可能丢了），收的一方清空本机层。
 */

/** 一条失效消息：删掉的缓存键与改了的表 */
export interface EvictMessage {
  readonly keys: readonly string[];
  readonly tables: readonly string[];
}

/** 传输：把文字发给所有实例、收别的实例（与自己）发的文字 */
export interface BusTransport {
  send(text: string): Promise<void>;
  /** 开始收；连接断过又连上时调 onReset。返回停止收的函数 */
  listen(onText: (text: string) => void, onReset: () => void): Promise<() => Promise<void>>;
  /** 一条消息最多多少字节（PG 的 NOTIFY 不到 8000）；超出时切成几条 */
  readonly maxBytes?: number;
}

/** 消息通道 */
export interface InvalidationBus {
  /** 发给所有实例（包括自己） */
  publish(message: EvictMessage): Promise<void>;
  /**
   * 收消息：fromSelf 表示是本实例发的；onReset 在传输断过又连上时调用。第一个订阅时才开始收，全部退订后停。
   * 返回退订的函数
   */
  subscribe(
    handler: (message: EvictMessage, fromSelf: boolean) => void,
    onReset?: () => void,
  ): Promise<() => Promise<void>>;
}

/** 线上的样子：o 是来源标记，k、t 是键与表 */
interface Wire {
  o: string;
  k: string[];
  t: string[];
}

const encoder = new TextEncoder();

/** 把一条消息按字节上限切开：表跟着第一段，键分到各段 */
function split(origin: string, message: EvictMessage, maxBytes: number): string[] {
  const encode = (k: string[], t: readonly string[]) =>
    JSON.stringify({ o: origin, k, t: [...t] } satisfies Wire);
  const whole = encode([...message.keys], message.tables);
  if (encoder.encode(whole).length <= maxBytes) return [whole];
  const texts: string[] = [];
  let keys: string[] = [];
  let tables = message.tables;
  for (const key of message.keys) {
    if (keys.length > 0 && encoder.encode(encode([...keys, key], tables)).length > maxBytes) {
      texts.push(encode(keys, tables));
      keys = [];
      tables = [];
    }
    keys.push(key);
  }
  texts.push(encode(keys, tables));
  return texts;
}

/** 在一个传输上建消息通道（每个实例一个） */
export function createBus(transport: BusTransport): InvalidationBus {
  const origin = Math.random().toString(36).slice(2) + Date.now().toString(36);
  const handlers = new Set<(message: EvictMessage, fromSelf: boolean) => void>();
  const resets = new Set<() => void>();
  let listening: Promise<() => Promise<void>> | undefined;

  function receive(text: string) {
    let wire: Wire;
    try {
      wire = JSON.parse(text) as Wire;
    } catch {
      return;
    }
    if (!Array.isArray(wire.k) || !Array.isArray(wire.t)) return;
    const message = { keys: wire.k, tables: wire.t };
    for (const handler of handlers) handler(message, wire.o === origin);
  }

  return {
    async publish(message) {
      if (message.keys.length === 0 && message.tables.length === 0) return;
      for (const text of split(origin, message, transport.maxBytes ?? Infinity)) {
        await transport.send(text);
      }
    },
    async subscribe(handler, onReset) {
      handlers.add(handler);
      if (onReset) resets.add(onReset);
      listening ??= transport.listen(receive, () => {
        for (const reset of resets) reset();
      });
      try {
        await listening;
      } catch (error) {
        listening = undefined;
        handlers.delete(handler);
        if (onReset) resets.delete(onReset);
        throw error;
      }
      return async () => {
        handlers.delete(handler);
        if (onReset) resets.delete(onReset);
        if (handlers.size > 0 || !listening) return;
        const stop = await listening;
        listening = undefined;
        await stop();
      };
    },
  };
}

/**
 * 进程内的传输：同一个 memoryTransport 上的几个 createBus 互相收得到（单实例部署、测试里模拟几个实例）。
 * 发出去的在下一个微任务送达，和真的传输一样是异步的
 */
export function memoryTransport(): BusTransport & { reset(): void } {
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

/** redisTransport 用到的 ioredis 连接的部分（node-redis 包一层也行） */
export interface RedisPubSubClient {
  publish(channel: string, message: string): Promise<unknown>;
  subscribe(channel: string): Promise<unknown>;
  unsubscribe(channel: string): Promise<unknown>;
  on(event: string, listener: (...args: any[]) => void): unknown;
  off(event: string, listener: (...args: any[]) => void): unknown;
}

/**
 * Redis 发布订阅的传输。订阅中的连接不能再发别的命令，所以要两条连接：publisher 发、subscriber 收。
 * ioredis 断线后自己重连并重新订阅；重连好（ready）时报 reset，断开期间的消息 Redis 不保留
 *
 *   const bus = createBus(redisTransport({ publisher: new Redis(url), subscriber: new Redis(url) }));
 */
export function redisTransport(options: {
  publisher: RedisPubSubClient;
  subscriber: RedisPubSubClient;
  channel?: string;
}): BusTransport {
  const { publisher, subscriber, channel = 'eqts:cache-evict' } = options;
  return {
    async send(text) {
      await publisher.publish(channel, text);
    },
    async listen(onText, onReset) {
      const onMessage = (from: string, text: string) => {
        if (from === channel) onText(text);
      };
      let connected = true;
      const onClose = () => (connected = false);
      const onReady = () => {
        if (connected) return;
        connected = true;
        onReset();
      };
      subscriber.on('message', onMessage);
      subscriber.on('close', onClose);
      subscriber.on('ready', onReady);
      await subscriber.subscribe(channel);
      return async () => {
        subscriber.off('message', onMessage);
        subscriber.off('close', onClose);
        subscriber.off('ready', onReady);
        await subscriber.unsubscribe(channel);
      };
    },
  };
}
