/**
 * 键集分页（toCursorPage）的游标：上一页最后一行各排序键的值，编码成一段不透明的文字交给客户端，下一页原样带回。
 * 文字是 base64url 的 JSON；里面的值回来之后只当参数用（经过列的 codec 编码），改坏的游标抛 InvalidCursorError
 */
import type { Node, OrderNode } from './ast.ts';
import { InvalidCursorError } from './errors.ts';
import { Expr, or, type Cond } from './expr.ts';
import type { Codec } from './schema.ts';

/** 一个排序键：表达式、方向，以及把游标里的值编码回参数用的 codec */
export interface OrderKey extends OrderNode {
  readonly codec: Codec<any> | undefined;
  /** 确知不会是 NULL（主表上不可空的列）：条件里不用再带 IS NULL，索引用得上 */
  readonly notNull?: boolean;
}

/** JSON 表示不了的值带上一个标记：d 时刻、n 大整数、b 二进制 */
type Tagged = { d: string } | { n: string } | { b: string } | { j: unknown };

function tag(value: unknown): unknown {
  if (value === null || ['string', 'number', 'boolean'].includes(typeof value)) return value;
  if (value instanceof Date) return { d: value.toISOString() } satisfies Tagged;
  if (typeof value === 'bigint') return { n: value.toString() } satisfies Tagged;
  if (value instanceof Uint8Array)
    return {
      b: Array.from(value, (x) => x.toString(16).padStart(2, '0')).join(''),
    } satisfies Tagged;
  return { j: value } satisfies Tagged;
}

function untag(value: unknown): unknown {
  if (typeof value !== 'object' || value === null) return value;
  const tagged = value as Partial<Record<'d' | 'n' | 'b' | 'j', unknown>>;
  if (typeof tagged.d === 'string') return new Date(tagged.d);
  if (typeof tagged.n === 'string') return BigInt(tagged.n);
  if (typeof tagged.b === 'string')
    return Uint8Array.from(tagged.b.match(/../g) ?? [], (x) => parseInt(x, 16));
  if ('j' in tagged) return tagged.j;
  throw new InvalidCursorError('the cursor holds a value this version cannot read');
}

export function encodeCursor(values: readonly unknown[]): string {
  const bytes = new TextEncoder().encode(JSON.stringify(values.map(tag)));
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

export function decodeCursor(text: string): unknown[] {
  let parsed: unknown;
  try {
    const binary = atob(text.replaceAll('-', '+').replaceAll('_', '/'));
    parsed = JSON.parse(new TextDecoder().decode(Uint8Array.from(binary, (c) => c.charCodeAt(0))));
  } catch {
    throw new InvalidCursorError('the cursor is not one that toCursorPage() returned');
  }
  if (!Array.isArray(parsed))
    throw new InvalidCursorError('the cursor is not one that toCursorPage() returned');
  return parsed.map(untag);
}

/** 一行里排序键的值（驱动读出的原值经 codec 解码），放进游标 */
export function cursorValue(key: OrderKey, raw: unknown): unknown {
  if (raw === null || raw === undefined) return null;
  // Date 只到毫秒：库里存到微秒的时刻放进游标会丢掉尾数，下一页的"大于它"又把这一行取回来
  if (key.codec?.kind === 'datetime' && typeof raw === 'string' && /\.\d{3}0*[1-9]/.test(raw))
    throw new Error(
      `toCursorPage(): the order key ${raw} has sub-millisecond precision, which a JS Date cannot carry; ` +
        'store it at millisecond precision or order by another key',
    );
  return key.codec ? key.codec.decode(raw) : raw;
}

/**
 * "排在游标那一行之后"的条件：逐个键展开成 (k0 在后) OR (k0 相同 AND k1 在后) OR …
 * NULL 排在哪头各库不同（Dialect.nullOrder），键可空时照它来
 */
export function afterCursor(
  keys: readonly OrderKey[],
  values: readonly unknown[],
  nullOrder: 'smallest' | 'largest' | 'last',
): Cond {
  if (values.length !== keys.length)
    throw new InvalidCursorError(
      `the cursor has ${values.length} keys but the query orders by ${keys.length}: it belongs to a different query`,
    );
  const branches: Cond[] = [];
  const same: Cond[] = [];
  keys.forEach((key, i) => {
    const e = new Expr<unknown>(key.e as Node, key.codec);
    const value = values[i];
    // 这个键的排序里 NULL 是不是排在非空值后面
    const nullsLast = nullOrder === 'last' || (nullOrder === 'smallest' ? key.desc : !key.desc);
    let later: Cond;
    if (value === null) later = nullsLast ? false : e.isNotNull();
    else {
      const beyond = key.desc ? e.lt(value as never) : e.gt(value as never);
      later = nullsLast && !key.notNull ? or(beyond, e.isNull()) : beyond;
    }
    if (later) branches.push([...same, later]);
    same.push(value === null ? e.isNull() : e.eq(value as never));
  });
  return or(...branches);
}
