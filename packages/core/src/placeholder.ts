/**
 * 预编译查询的占位值（ROADMAP 18.3.2）：prepare 的回调拿到的 p.id 是一个 Placeholder，渲染时绑成 PreparedParam，
 * 执行时再换成真正的值（照常经过列的编码）。放在单独的模块里，方言与查询都要用，又不互相依赖
 */
import type { Codec } from './schema.ts';

/** prepare 回调里 p.x 的值 */
export class Placeholder {
  readonly name: string;
  /** 构建时就要变换的值（like 的转义、加前后缀）：变换留到执行时做 */
  readonly transform: ((value: unknown) => unknown) | undefined;

  constructor(name: string, transform?: (value: unknown) => unknown) {
    this.name = name;
    this.transform = transform;
  }

  /** 再叠一层变换 */
  map(fn: (value: unknown) => unknown): Placeholder {
    const inner = this.transform;
    return new Placeholder(this.name, inner ? (v) => fn(inner(v)) : fn);
  }
}

/** 渲染后语句里的一个待填参数：执行时取 values[name]，经列的编码与方言的参数转换 */
export class PreparedParam {
  readonly placeholder: Placeholder;
  readonly codec: Codec<unknown> | undefined;

  constructor(placeholder: Placeholder, codec: Codec<unknown> | undefined) {
    this.placeholder = placeholder;
    this.codec = codec;
  }
}

/** p：任何属性名都是同名的占位值 */
export function placeholders<P>(): P {
  return new Proxy({} as Record<string, Placeholder>, {
    get: (cache, name) => {
      if (typeof name !== 'string') return undefined;
      return (cache[name] ??= new Placeholder(name));
    },
  }) as P;
}
