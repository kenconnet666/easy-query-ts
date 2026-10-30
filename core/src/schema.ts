import type { SelectNode } from './ast.ts';
import type { Expr } from './expr.ts';
import type { ShardingRule } from './sharding.ts';

/**
 * 实体与列的定义。列的 TS 类型、是否可空、是否由库生成都记在类型参数里，查询与插入的类型由它推导，不需要代码生成。
 *
 * ```ts
 * export const User = entity('t_user', {
 *   id: col.bigint().primaryKey().generated(),
 *   name: col.string(),
 *   age: col.int().nullable(),
 * })
 * type UserRow = Row<typeof User>   // { id: number; name: string; age: number | null }
 * ```
 */

/** 值在库与 JS 之间怎么转换：drivers 读出的原始值 → JS 值，JS 值 → 绑定参数 */
export interface Codec<T> {
  readonly kind: ColumnKind;
  decode(raw: unknown): T;
  encode(value: T): unknown;
  /** 透明加密的列带着它的加密策略：like 据此加密搜索词，或在策略不支持时报错 */
  readonly encryption?: Encryption | undefined;
}

/**
 * 列的种类：决定聚合结果怎么解码（avg 对 decimal 保持 decimal）等少数行为。
 * 内置种类之外允许任意字符串，扩展包可以登记自己的种类而不用改核心；未知的种类按"普通值"处理。
 * 与 json-wire 的种类对应：bigint↔bigint、decimal↔decimal、date↔date、time↔time、
 * datetime↔timestamp / timestamptz（是否带时区由列类型决定）、bytes↔bytes。
 */
export type ColumnKind =
  | 'string'
  | 'int'
  | 'bigint'
  | 'decimal'
  | 'double'
  | 'boolean'
  | 'date'
  | 'time'
  | 'datetime'
  | 'json'
  | 'bytes'
  | (string & {});

/** 逻辑删除：active 是"未删除"时的值（null 表示 IS NULL），deleted 是删除时写入的值（可以是函数，如当前时间） */
export interface SoftDelete {
  readonly active: unknown;
  readonly deleted: unknown;
}

export interface ColumnOptions {
  readonly nullable: boolean;
  readonly primaryKey: boolean;
  readonly generated: boolean;
  readonly hasDefault: boolean;
  readonly name?: string;
  /** 插入时没给值就用它（客户端生成，如 uuid、雪花 id） */
  readonly defaultFn?: (() => unknown) | undefined;
  /** 逻辑删除时一并写入（删除人、删除时间） */
  readonly onDeleteFn?: (() => unknown) | undefined;
  /** 更新时没给值就用它（如更新时间） */
  readonly onUpdateFn?: (() => unknown) | undefined;
  readonly softDelete?: SoftDelete | undefined;
  /** 乐观锁版本列的规则 */
  readonly version?: VersionRule | undefined;
  /** 只在插入时写入，更新永远不碰（创建人、创建时间） */
  readonly insertOnly?: boolean | undefined;
  /** 读这一列时在 SQL 里的转换（见 Column.sqlConvert） */
  readonly sqlRead?: ((column: Expr<any>) => Expr<unknown>) | undefined;
  /** 写进这一列的值在 SQL 里的转换（见 Column.sqlConvert） */
  readonly sqlWrite?: ((value: Expr<any>) => Expr<unknown>) | undefined;
  // ---- 建表（createTables）用的元数据，查询和写入不看它们 ----
  /** 字符串列的长度，默认 255 */
  readonly length?: number | undefined;
  readonly precision?: number | undefined;
  readonly scale?: number | undefined;
  /** 直接指定库里的列类型（如 'JSONB'、'TEXT'），优先于按 kind 推断 */
  readonly dbType?: string | undefined;
  /** 库里的默认值，原样写进 DEFAULT 子句（受信任的 SQL，如 `'draft'`、`CURRENT_TIMESTAMP`） */
  readonly dbDefault?: string | undefined;
  readonly unique?: boolean | undefined;
  /** 列注释：MySQL 写进列定义的 COMMENT，PG / HANA 用 COMMENT ON COLUMN，SQLite 没有 */
  readonly comment?: string | undefined;
  /** 库里原来的列名：syncTables 发现新列名不在、旧列名在时改名而不是加列（对应 Java 版的 @Column(renameFrom)） */
  readonly renamedFrom?: string | undefined;
}

/** 乐观锁版本列的规则：initial 是插入时的值；next 由当前版本算出下一个，没有时按整数加 1（表达式更新里在 SQL 里加 1） */
export interface VersionRule {
  readonly initial: unknown;
  readonly next: ((current: unknown) => unknown) | undefined;
}

/** 字符串列的加解密策略：写入前 encrypt、读出后 decrypt。要用 eq 查询必须是确定性的（同一明文得到同一密文） */
export interface Encryption {
  encrypt(plain: string): string;
  decrypt(cipher: string): string;
  /**
   * 可分段搜索（对应 Java 版的 supportQueryLike）：一段明文的密文是整段密文的一部分（按固定长度分段、逐段加密的算法）。
   * 为 true 时 like / startsWith / endsWith 把搜索词加密后匹配
   */
  readonly searchable?: boolean;
}

/** 一列：T 是 JS 类型，N 是否可空，O 插入时是否可省（自增、有默认值、可空） */
export class Column<T, N extends boolean = false, O extends boolean = false> {
  declare readonly __type: T;
  declare readonly __nullable: N;
  declare readonly __optional: O;
  readonly codec: Codec<T>;
  readonly options: ColumnOptions;

  constructor(codec: Codec<T>, options: ColumnOptions) {
    this.codec = codec;
    this.options = options;
  }

  /** 可为 NULL：读出的类型带上 null，插入时可省 */
  nullable(): Column<T, true, true> {
    return new Column(this.codec, { ...this.options, nullable: true });
  }

  primaryKey(): Column<T, N, O> {
    return new Column(this.codec, { ...this.options, primaryKey: true });
  }

  /** 由库生成（自增、IDENTITY）：插入时可省 */
  generated(): Column<T, N, true> {
    return new Column(this.codec, { ...this.options, generated: true });
  }

  /** 库里有默认值：插入时可省 */
  defaulted(): Column<T, N, true> {
    return new Column(this.codec, { ...this.options, hasDefault: true });
  }

  /**
   * 插入时没给值就调用 fn 生成（uuid、雪花 id 等客户端生成的默认值）；插入时这一列可省。
   * 也可以返回 sql 片段，由库里的函数生成（对应 Java 版的 generatedSQLColumnGenerator）：`$default(() => sql\`nextval('order_no')\`)`
   */
  $default(fn: () => T | Expr<T>): Column<T, N, true> {
    return new Column(this.codec, { ...this.options, defaultFn: fn });
  }

  /** 更新时没给值就调用 fn（更新时间、更新人） */
  $onUpdate(fn: () => T): Column<T, N, O> {
    return new Column(this.codec, { ...this.options, onUpdateFn: fn });
  }

  /**
   * 逻辑删除时一并写入 fn 的值（删除人、删除时间）：`deletedBy: col.string().nullable().$onDelete(() => currentUser())`。
   * 只在实体有 softDelete 列、delete 改写成 update 时生效；物理删除不写
   */
  $onDelete(fn: () => T): Column<T, N, O> {
    return new Column(this.codec, { ...this.options, onDeleteFn: fn });
  }

  /** 只改 TS 类型不改运行时：品牌类型（`col.bigint().$type<UserId>()`）让不同表的 id 不能混用 */
  $type<U extends T>(): Column<U, N, O> {
    return new Column(this.codec as unknown as Codec<U>, this.options);
  }

  /**
   * 逻辑删除列：delete 改写成把这一列设为 deleted 的 update；读、改、删（含导航的 JOIN 与子查询）自动只看 active 的行；
   * 插入时没给值就写 active。不传参数时布尔列是 false / true，整数列是 0 / 1；其它类型（如可空时间戳 `{ active: null, deleted: () => new Date() }`）要显式给。
   * 单条语句用 `noInterceptor('softDelete')` 看到已删除的行；`delete(X).hard()` 物理删除。
   */
  softDelete(values?: { active: T | null; deleted: T | (() => T) }): Column<T, N, true> {
    const kind = this.codec.kind;
    const chosen =
      values ??
      (kind === 'boolean'
        ? { active: false, deleted: true }
        : kind === 'int' || kind === 'bigint'
          ? { active: 0, deleted: 1 }
          : undefined);
    if (!chosen)
      throw new Error(
        `softDelete() needs explicit { active, deleted } values on a '${kind}' column`,
      );
    return new Column(this.codec, { ...this.options, softDelete: chosen });
  }

  /**
   * 乐观锁版本列。`update(X).entity(row)`、`changes(before, after)`、`withVersion(v)` 带上版本条件并写入下一个版本，没更新到行就抛错；
   * 其它更新也换成下一个版本，别人手里的旧版本随之失效。整数列不用给规则（插入为 0、每次加 1）；
   * 别的类型给出规则，如 UUID：`col.string().version({ initial: '0', next: () => crypto.randomUUID() })`。
   * next 收到当前版本；表达式更新没给 withVersion 时不知道当前版本，收到 undefined
   */
  version(rule?: { initial: T; next: (current: T | undefined) => T }): Column<T, N, true> {
    if (!rule && this.codec.kind !== 'int' && this.codec.kind !== 'bigint')
      throw new Error(
        `version() on a '${this.codec.kind}' column needs { initial, next }; only integer columns have a default`,
      );
    const version: VersionRule = rule
      ? { initial: rule.initial, next: rule.next as (current: unknown) => unknown }
      : { initial: 0, next: undefined };
    return new Column(this.codec, { ...this.options, version });
  }

  /**
   * 给值类型打上品牌（只在类型里）：`id: col.bigint().primaryKey().brand<'UserId'>()`。
   * UserId 与 OrderId 不能混传；关系的 from / to 品牌对不上在定义处就报错；`find(id)`、条件、结果里的值都带品牌。
   * 品牌值从查询结果里来，手写的值用 `1 as Row<typeof User>['id']`
   */
  brand<B extends string>(): Column<Branded<T, B>, N, O> {
    return this as unknown as Column<Branded<T, B>, N, O>;
  }

  /** 只在插入时写入，更新永远不碰；在 set 里给它赋值会报错 */
  insertOnly(): Column<T, N, O> {
    return new Column(this.codec, { ...this.options, insertOnly: true });
  }

  /**
   * 透明加解密（仅字符串列）。等值比较照常可用；like / startsWith 只在策略声明 searchable 时可用（搜索词加密后匹配），
   * 否则报错——要在库里搜索请改用 sqlConvert 由库加解密
   */
  encrypted(this: Column<string, N, O>, strategy: Encryption): Column<string, N, O> {
    const inner = this.codec;
    const codec: Codec<string> = {
      kind: inner.kind,
      decode: (raw) => strategy.decrypt(inner.decode(raw)),
      encode: (v) => inner.encode(strategy.encrypt(v)),
      encryption: strategy,
    };
    return new Column(codec, this.options);
  }

  /**
   * 列值在 SQL 里转换（对应 Java 版的 ColumnValueSQLConverter）：read 包住读这一列的地方（select、where、orderBy、导航的条件都用转换后的值），
   * write 包住写进去的值（insert、update）。用库里的函数加解密、读写空间类型时用它；转换后的值仍按这一列的类型解码：
   * ```ts
   * phone: col.string().sqlConvert({
   *   read: (c) => sql<string>`AES_DECRYPT(${c}, ${key})`,
   *   write: (v) => sql<string>`AES_ENCRYPT(${v}, ${key})`,
   * })
   * ```
   * 与 encrypted 的区别：encrypted 在应用里加解密，库里只能做等值比较；这里在库里转换，like、排序、函数都能用。
   * RETURNING 拿不到转换后的值：returning() 选到这种列时报错，returnEntity() 改为插入后再按主键查回
   */
  sqlConvert(convert: {
    read?: (column: Expr<T>) => Expr<unknown>;
    write?: (value: Expr<T>) => Expr<unknown>;
  }): Column<T, N, O> {
    return new Column(this.codec, {
      ...this.options,
      sqlRead: convert.read,
      sqlWrite: convert.write,
    });
  }

  /** 建表时直接用这个类型，如 `col.json<Tags>().dbType('JSONB')`；不影响读写 */
  dbType(type: string): Column<T, N, O> {
    return new Column(this.codec, { ...this.options, dbType: type });
  }

  /** 建表时的 DEFAULT 子句，原样写入（受信任的 SQL）：`.dbDefault("'draft'")`；同时让插入时这一列可省 */
  dbDefault(sql: string): Column<T, N, true> {
    return new Column(this.codec, { ...this.options, dbDefault: sql, hasDefault: true });
  }

  /** 建表时加唯一约束 */
  unique(): Column<T, N, O> {
    return new Column(this.codec, { ...this.options, unique: true });
  }

  /** 库里的列名（默认是属性名转下划线） */
  named(name: string): Column<T, N, O> {
    return new Column(this.codec, { ...this.options, name });
  }

  /** 列注释（建表与 syncTables 写进库里） */
  comment(text: string): Column<T, N, O> {
    return new Column(this.codec, { ...this.options, comment: text });
  }

  /** 库里原来的列名：改了列名之后 syncTables 把旧列改名，而不是加一列新的 */
  renamedFrom(oldName: string): Column<T, N, O> {
    return new Column(this.codec, { ...this.options, renamedFrom: oldName });
  }
}

/**
 * 十进制数文字：decimal 列在 JS 里的类型。用模板字面量类型而不是 string，
 * 一是让 `'10.50'` 这样的字面量可以直接写入，二是让算术方法能区分"数值文字"和普通字符串。
 */
export type DecimalText = `${number}`;

/**
 * 日历日期文字 'YYYY-MM-DD'：date 列在 JS 里的类型。同样用模板字面量类型，`'2026-01-02'` 可以直接写入，
 * 而普通字符串列不能调用 year() / month() / dateTrunc() 这类日期方法。
 */
export type DateText = `${number}-${number}-${number}`;

const SAFE_MAX = BigInt(Number.MAX_SAFE_INTEGER);

function codec<T>(
  kind: ColumnKind,
  decode: (raw: unknown) => T,
  encode: (value: T) => unknown = (v) => v,
): Codec<T> {
  return { kind, decode, encode };
}

function toNumber(raw: unknown): number {
  if (typeof raw === 'number') return raw;
  if (typeof raw === 'bigint') {
    if (raw > SAFE_MAX || raw < -SAFE_MAX)
      throw new RangeError(
        `bigint ${raw} does not fit a JS number; use col.bigint({ mode: 'bigint' })`,
      );
    return Number(raw);
  }
  const n = Number(raw);
  if (!Number.isSafeInteger(n) && Number.isInteger(n))
    throw new RangeError(`integer ${String(raw)} does not fit a JS number exactly`);
  return n;
}

function pad(n: number, width = 2): string {
  return String(n).padStart(width, '0');
}

/** Date → 'YYYY-MM-DD HH:MM:SS.mmm'（UTC），各库都认 */
export function utcText(d: Date): string {
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}.${pad(d.getUTCMilliseconds(), 3)}`;
}

/**
 * 驱动读出的日期时间 → Date（无时区的文字按 UTC 读）。
 * 导出给 @zerodep-dev/easy-query-ts-date 等扩展列类型复用，保证各种日期类型"驱动值怎么读"的口径一致。
 */
export function toDate(raw: unknown): Date {
  if (raw instanceof Date) return raw;
  const text = String(raw);
  // 'YYYY-MM-DD HH:MM:SS[.fff]' 按 UTC 读；带偏移的（PG timestamptz 的 '+00'、'+08:00'）按偏移读
  const iso = text.replace(' ', 'T');
  if (/[zZ]$/.test(iso)) return new Date(iso);
  const offset = /([+-]\d\d)(?::?(\d\d))?$/.exec(iso);
  if (offset && offset.index > 10)
    return new Date(`${iso.slice(0, offset.index)}${offset[1]}:${offset[2] ?? '00'}`);
  return new Date(iso + 'Z');
}

/** 驱动读出的日期 → 'YYYY-MM-DD'（按 UTC 取年月日，不经过本地时区） */
export function toDateText(raw: unknown): string {
  if (raw instanceof Date)
    return `${raw.getUTCFullYear()}-${pad(raw.getUTCMonth() + 1)}-${pad(raw.getUTCDate())}`;
  return String(raw).slice(0, 10);
}

/** 个别驱动 / 配置会把二进制读成十六进制文字（可带 \x 或 0x 前缀） */
function hexToBytes(text: string): Uint8Array {
  const hex = text.replace(/^(\\x|0x)/i, '');
  if (hex.length % 2 !== 0 || /[^0-9a-f]/i.test(hex))
    throw new TypeError(`not a hex string for a bytes column: ${text.slice(0, 20)}`);
  return Uint8Array.from(hex.match(/../g) ?? [], (b) => parseInt(b, 16));
}

function base<T>(c: Codec<T>, extra: Partial<ColumnOptions> = {}): Column<T, false, false> {
  return new Column(c, {
    nullable: false,
    primaryKey: false,
    generated: false,
    hasDefault: false,
    ...extra,
  });
}

/**
 * Standard Schema（https://standardschema.dev）的最小子集：只依赖 `~standard.validate`，不引入任何校验库。
 * zod ≥3.24、valibot、arktype 等都实现了它。
 */
export interface StandardSchema<Output = unknown> {
  readonly '~standard': {
    readonly version: 1;
    readonly vendor: string;
    readonly validate: (value: unknown) =>
      | { readonly value: Output; readonly issues?: undefined }
      | {
          readonly issues: readonly {
            readonly message: string;
            readonly path?: readonly unknown[] | undefined;
          }[];
        }
      | Promise<unknown>;
    /** 仅类型用：校验器的输出类型 */
    readonly types?: { readonly input: unknown; readonly output: Output } | undefined;
  };
}

/** 同步校验：不合格或校验器是异步的都抛错 */
function validated<T>(schema: StandardSchema<T>, value: unknown, what: string): T {
  const result = schema['~standard'].validate(value);
  if (result instanceof Promise)
    throw new TypeError(`${what}: asynchronous schemas are not supported for json columns`);
  const r = result as {
    value?: T;
    issues?: readonly { message: string; path?: readonly unknown[] | undefined }[];
  };
  if (r.issues) {
    const list = r.issues
      .map((i) =>
        i.path && i.path.length > 0 ? `${i.path.map(String).join('.')}: ${i.message}` : i.message,
      )
      .join('; ');
    throw new TypeError(`${what}: invalid JSON value: ${list}`);
  }
  return r.value as T;
}

function jsonColumn<T = unknown>(): Column<T, false, false>;
function jsonColumn<S extends StandardSchema>(
  schema: S,
): Column<S extends StandardSchema<infer O> ? O : never, false, false>;
function jsonColumn(schema?: StandardSchema): Column<unknown, false, false> {
  const parse = (r: unknown): unknown => (typeof r === 'string' ? JSON.parse(r) : r);
  if (!schema) return base(codec<unknown>('json', parse, (v) => JSON.stringify(v)));
  return base(
    codec<unknown>(
      'json',
      (r) => validated(schema, parse(r), 'read'),
      (v) => JSON.stringify(validated(schema, v, 'write')),
    ),
  );
}

/** 列的类型 */
export const col = {
  /** 字符串；length 只在建表时用（默认 255） */
  string: (length?: number) =>
    base(
      codec<string>('string', (r) => String(r)),
      { length },
    ),
  int: () => base(codec<number>('int', toNumber)),
  /** 64 位整数；mode 'number'（默认，超出安全整数时报错）、'bigint'、'string' */
  bigint: <M extends 'number' | 'bigint' | 'string' = 'number'>(opts?: { mode?: M }) => {
    const mode = opts?.mode ?? 'number';
    type V = M extends 'bigint' ? bigint : M extends 'string' ? string : number;
    const decode = (r: unknown): V =>
      (mode === 'bigint' ? BigInt(r as string) : mode === 'string' ? String(r) : toNumber(r)) as V;
    return base(codec<V>('bigint', decode));
  },
  /** 精确小数：JS 里是数值文字（DecimalText），不经过浮点；要对象形式可用 @zerodep-dev/easy-query-ts-decimal 的 decimalJs() */
  decimal: (precision?: number, scale?: number) =>
    base(
      codec<DecimalText>('decimal', (r) => String(r) as DecimalText),
      { precision, scale },
    ),
  double: () => base(codec<number>('double', (r) => Number(r))),
  /** 绑定时交给方言转换（SQLite / MySQL 写 1 / 0，PG 原样传布尔） */
  boolean: () =>
    base(
      codec<boolean>('boolean', (r) => r === true || r === 1 || r === '1' || r === 1n || r === 't'),
    ),
  /** 日历日期 'YYYY-MM-DD'，不经过时区 */
  date: () => base(codec<DateText>('date', (r) => toDateText(r) as DateText)),
  /** 一天里的时刻 'HH:MM:SS' */
  time: () => base(codec<string>('time', (r) => String(r).slice(0, 8))),
  /** 时刻：JS 的 Date，库里按 UTC 存 */
  datetime: () => base(codec<Date>('datetime', toDate, (v) => utcText(v))),
  /** 二进制：JS 里是 Uint8Array（驱动给的 Buffer 会复制成普通的 Uint8Array），库里是 BLOB / BYTEA */
  bytes: () =>
    base(
      codec<Uint8Array>('bytes', (r) =>
        typeof r === 'string' ? hexToBytes(r) : new Uint8Array(r as ArrayLike<number>),
      ),
    ),
  /**
   * JSON 列。只写泛型时不校验（`col.json<Tags>()`）；传入符合 Standard Schema 的校验器（zod、valibot、arktype 等）时，
   * 类型取自校验器的输出，读出和写入都会校验，不合格抛错并带上问题列表：`col.json(z.object({ tags: z.array(z.string()) }))`。
   * 校验器必须是同步的。
   */
  json: jsonColumn,
  /** 字符串枚举：写入和读出都校验在列表里，TS 类型是这些字面量的并集 */
  enum: <const V extends string>(values: readonly V[]) => {
    const check = (v: unknown): V => {
      if (!values.includes(v as V))
        throw new TypeError(
          `'${String(v)}' is not one of ${values.map((x) => `'${x}'`).join(', ')}`,
        );
      return v as V;
    };
    return base(codec<V>('string', (r) => check(String(r)), check));
  },
  /** 自定义的读写 */
  custom: <T>(kind: ColumnKind, decode: (raw: unknown) => T, encode: (value: T) => unknown) =>
    base(codec<T>(kind, decode, encode)),
};

export type AnyColumn = Column<any, boolean, boolean>;
export type Columns = Record<string, AnyColumn>;

/**
 * 值对象（对应 Java 版的 @ValueObject）：几列合成实体上的一个嵌套对象（地址、金额与币种）。
 * 库里仍是普通的列，列名默认是"属性名_子属性名"（prefix 换掉"属性名_"；子列 named() 时用它给的全名）；
 * 读出来是嵌套对象，查询里 `c.address.city` 是一列，写入时给嵌套对象，更新时可以只给其中几项。值对象里可以再嵌值对象
 * ```ts
 * const Company = entity('t_company', {
 *   id: col.int().primaryKey(),
 *   address: embed({ province: col.string(), city: col.string(), street: col.string().nullable() }),
 * })
 * ```
 */
export class Embedded<F extends Fields = Fields> {
  readonly fields: F;
  readonly prefix: string | undefined;

  constructor(fields: F, prefix: string | undefined) {
    this.fields = fields;
    this.prefix = prefix;
  }
}

/** 值对象，见 Embedded */
export function embed<F extends Fields>(fields: F, options: { prefix?: string } = {}): Embedded<F> {
  return new Embedded(fields, options.prefix);
}

/** 实体声明的列：普通的列，或值对象 */
export type Fields = { readonly [key: string]: AnyColumn | Embedded<any> };

/**
 * 派生实体的来源：不是真实的表，而是一条查询的结果。
 * subquery 渲染为 `FROM (子查询) 别名`；cte 渲染为最外层的 `WITH 名字 (列) AS (子查询)`，再 `FROM 名字`。
 */
export interface DerivedSource {
  readonly kind: 'subquery' | 'cte';
  /** 子查询。递归 CTE 要先登记名字才能构建它的递归部分，所以构建完成后才写入这个字段 */
  q: SelectNode;
  readonly recursive: boolean;
  /** 子查询输出的列名，顺序与 q 的 columns 一致 */
  readonly columns: readonly string[];
}

/** 一个实体：名字、表名、列 */
export interface Entity<Name extends string = string, F extends Fields = Fields> {
  readonly kind: 'entity';
  readonly name: Name;
  readonly table: string;
  /** 声明的列（值对象是嵌套的 embed）：行、插入、表引用的类型都由它推导 */
  readonly fields: F;
  /** 展开后的列：值对象的列按路径展开（'address.city'），读写、建表都看它；没有值对象时与 fields 相同 */
  readonly columns: Columns;
  /** 列的路径 → 库里的列名 */
  readonly columnNames: Readonly<Record<string, string>>;
  readonly primaryKey: readonly string[];
  /** 派生实体（子查询 / CTE）才有；普通的表没有 */
  readonly derived?: DerivedSource;
  /** 表注释（建表与 syncTables 用） */
  readonly comment?: string;
  /** 索引（建表与 syncTables 用），列已换成库里的列名 */
  readonly indexes?: readonly TableIndex[];
  /** 库里原来的表名：改了表名之后 syncTables 把旧表改名，而不是新建 */
  readonly renamedFrom?: string;
  /** 单库分表的规则（byMod / byTime …）：查询按条件裁剪出要查的表，写入按分片键路由 */
  readonly sharding?: ShardingRule;
  /** 多态实体（entity.union）：判别列与各子类型自己的列 */
  readonly variants?: VariantSpec;
}

/** 多态实体的运行时信息 */
export interface VariantSpec {
  /** 判别列（属性名） */
  readonly discriminator: string;
  /** 共有的列 */
  readonly base: Fields;
  /** 子类型名 → 它自己的列（声明时的样子，可空性没改） */
  readonly members: Readonly<Record<string, Fields>>;
}

/** 一个索引：名字、库里的列名（按顺序）、是否唯一 */
export interface TableIndex {
  readonly name: string;
  readonly columns: readonly string[];
  readonly unique: boolean;
}

/** 能当索引列的列（值对象不能整个当索引列，写它展开后的路径 'address.city'） */
type IndexColumn<F extends Fields> =
  | ({ [K in keyof F]: F[K] extends Embedded<any> ? never : K }[keyof F] & string)
  | `${string}.${string}`;

/** 定义实体时的选项：表注释、索引、原来的表名（都只在建表与 syncTables 时用） */
export interface EntityOptions<F extends Fields = Fields> {
  readonly comment?: string;
  /** 索引：`[{ columns: ['tenantId', 'createdAt'] }, { columns: ['email'], unique: true }]`；名字默认 表_列_idx / uidx */
  readonly indexes?: readonly {
    readonly columns: readonly [IndexColumn<F>, ...IndexColumn<F>[]];
    readonly unique?: boolean;
    readonly name?: string;
  }[];
  readonly renamedFrom?: string;
  /** 分表：`byMonth('createdAt', { from: '2025-01' })`、`byMod('userId', 4)`，见 sharding.ts */
  readonly sharding?: ShardingRule<IndexColumn<F>>;
}

/** 一条查询的结果行（Out，列名 → 类型）对应的派生实体的列：值可空的列对应可空列 */
export type DerivedColumns<Out> = {
  [P in keyof Out & string]: Column<NonNullable<Out[P]>, null extends Out[P] ? true : false, false>;
};
export type DerivedEntity<Name extends string, Out> = Entity<Name, DerivedColumns<Out>>;

function snake(name: string): string {
  return name.replace(/[A-Z]/g, (c) => '_' + c.toLowerCase());
}

/**
 * 定义实体；name 默认用表名。options 里是建表与 syncTables 用的元数据：
 * `entity('t_order', { … }, { comment: '订单', indexes: [{ columns: ['tenantId', 'createdAt'] }] })`
 */
export function entity<const Table extends string, F extends Fields>(
  table: Table,
  fields: F,
  options?: EntityOptions<F>,
): Entity<Table, F>;
export function entity<const Name extends string, F extends Fields>(
  table: string,
  fields: F,
  options: EntityOptions<F> & { name: Name },
): Entity<Name, F>;
export function entity(
  table: string,
  fields: Fields,
  options?: EntityOptions & { name?: string },
): Entity {
  const columns: Record<string, AnyColumn> = {};
  const columnNames: Record<string, string> = {};
  const primaryKey: string[] = [];
  const walk = (group: Fields, path: string, namePrefix: string) => {
    for (const [key, field] of Object.entries(group)) {
      if (field instanceof Embedded) {
        walk(field.fields, `${path}${key}.`, field.prefix ?? `${namePrefix}${snake(key)}_`);
        continue;
      }
      columns[path + key] = field;
      columnNames[path + key] = field.options.name ?? namePrefix + snake(key);
      if (!field.options.primaryKey) continue;
      if (path)
        throw new Error(`${table}: a primary key column cannot be inside embed() (${path}${key})`);
      primaryKey.push(key);
    }
  };
  walk(fields, '', '');
  // 默认的索引名：表名（去掉 schema 前缀）_列_idx / uidx
  const bare = table.split('@')[0]!.split('.').pop()!;
  const indexes = (options?.indexes ?? []).map((index): TableIndex => {
    const names = index.columns.map((path) => {
      const name = columnNames[path];
      if (name === undefined) throw new Error(`${table}: index column '${path}' is not a column`);
      return name;
    });
    const unique = index.unique === true;
    return {
      name: index.name ?? `${bare}_${names.join('_')}_${unique ? 'uidx' : 'idx'}`,
      columns: names,
      unique,
    };
  });
  return {
    kind: 'entity',
    name: options?.name ?? table,
    table,
    fields,
    columns,
    columnNames,
    primaryKey,
    ...(options?.comment !== undefined ? { comment: options.comment } : {}),
    ...(indexes.length > 0 ? { indexes } : {}),
    ...(options?.renamedFrom !== undefined ? { renamedFrom: options.renamedFrom } : {}),
    ...(options?.sharding ? { sharding: checkSharding(table, options.sharding, columns) } : {}),
  };
}

/**
 * 多态实体：一张表存几种子类型（单表继承），按判别列区分。读出的行、插入的形状是判别联合，
 * `db.queryable(Payment).variant('card')` 只查这一种、结果类型也收窄：
 * ```ts
 * const Payment = entity.union('t_payment', 'kind', {
 *   base: { id: col.bigint().primaryKey().generated(), amount: col.decimal(12, 2) },
 *   variants: {
 *     card: { cardNo: col.string(19), holder: col.string() },
 *     wechat: { openId: col.string() },
 *   },
 * })
 * ```
 * 判别列存子类型名；各子类型的列在表里都可空（别的子类型的行里是 NULL），声明时的可空性用于读出的类型、插入与校验器
 */
entity.union = function union<
  const Table extends string,
  const D extends string,
  Base extends Fields,
  V extends Record<string, Fields>,
>(
  table: Table,
  discriminator: D,
  spec: { readonly base: Base; readonly variants: V },
  options?: EntityOptions,
): UnionEntity<Table, Base, D, V> {
  const names = Object.keys(spec.variants);
  if (names.length === 0) throw new Error(`${table}: entity.union needs at least one variant`);
  const fields: Record<string, AnyColumn | Embedded<any>> = { ...spec.base };
  if (discriminator in fields)
    throw new Error(`${table}: the discriminator '${discriminator}' is also a column`);
  fields[discriminator] = col.enum(names);
  for (const [name, own] of Object.entries(spec.variants)) {
    for (const [key, field] of Object.entries(own)) {
      if (key in fields)
        throw new Error(`${table}: column '${key}' of variant '${name}' is already declared`);
      if (field instanceof Embedded)
        throw new Error(`${table}: variant '${name}' cannot use embed() (${key})`);
      fields[key] = (field as AnyColumn).nullable();
    }
  }
  const base = entity(table, fields as Fields, options as EntityOptions<Fields>);
  const variants: VariantSpec = { discriminator, base: spec.base, members: spec.variants };
  return { ...base, variants } as never;
};

function checkSharding(
  table: string,
  rule: ShardingRule,
  columns: Readonly<Record<string, AnyColumn>>,
): ShardingRule {
  if (!(rule.column in columns))
    throw new Error(`${table}: sharding column '${rule.column}' is not a column`);
  return rule;
}

/** 一列（或值对象）读出来的类型 */
declare const brandKey: unique symbol;

/** 带品牌的值类型：运行时就是 T，类型上与别的品牌互不相容 */
export type Branded<T, B extends string> = T & { readonly [brandKey]: B };

/** 值类型上的品牌；没有品牌时是 never */
export type BrandOf<T> = T extends { readonly [brandKey]: infer B } ? B : never;

export type ValueOf<C> =
  C extends Embedded<infer F>
    ? RowOf<F>
    : C extends Column<infer T, infer N, any>
      ? N extends true
        ? T | null
        : T
      : never;

/** 一组声明的列读出来的形状 */
export type RowOf<F extends Fields> = { -readonly [K in keyof F]: ValueOf<F[K]> };

declare const variantsKey: unique symbol;

/** 多态实体的类型信息（只在类型里）：共有的列、判别列、各子类型的列 */
export interface VariantTypes<
  Base extends Fields = Fields,
  D extends string = string,
  V extends Record<string, Fields> = Record<string, Fields>,
> {
  readonly base: Base;
  readonly discriminator: D;
  readonly variants: V;
}

/** entity.union 返回的实体：类型上带着各子类型 */
export interface UnionEntity<
  Name extends string,
  Base extends Fields,
  D extends string,
  V extends Record<string, Fields>,
> extends Entity<Name, UnionFields<Base, D, V>> {
  readonly [variantsKey]?: VariantTypes<Base, D, V>;
}

type UnionToIntersection<U> = (U extends unknown ? (x: U) => void : never) extends (
  x: infer I,
) => void
  ? I
  : never;

/** 合在一张表里的列：共有的列、判别列，各子类型的列在表里都可空 */
export type UnionFields<
  Base extends Fields,
  D extends string,
  V extends Record<string, Fields>,
> = Base & {
  readonly [P in D]: Column<keyof V & string, false, false>;
} & {
  readonly [K in keyof UnionToIntersection<V[keyof V]>]: UnionToIntersection<
    V[keyof V]
  >[K] extends Column<infer T, any, any>
    ? Column<T, true, true>
    : never;
};

/** 别的子类型的列 */
type OtherKeys<V extends Record<string, Fields>, N extends keyof V> = Exclude<
  { [M in keyof V]: keyof V[M] }[keyof V],
  keyof V[N]
>;

type Flat<T> = { [K in keyof T]: T[K] } & {};

/** 多态实体读出的行：按判别列区分的联合，别的子类型的列是 null */
type UnionRow<Base extends Fields, D extends string, V extends Record<string, Fields>> = {
  [N in keyof V & string]: Flat<
    RowOf<Base> & { -readonly [P in D]: N } & RowOf<V[N]> & {
        -readonly [P in OtherKeys<V, N>]: null;
      }
  >;
}[keyof V & string];

/** 多态实体插入的形状：先选子类型，再给它自己的列；别的子类型的列不能给值 */
type UnionInsert<Base extends Fields, D extends string, V extends Record<string, Fields>> = {
  [N in keyof V & string]: Flat<
    InsertOf<Base> & { [P in D]: N } & InsertOf<V[N]> & { [P in OtherKeys<V, N>]?: null }
  >;
}[keyof V & string];

/** 实体上的多态信息；普通实体是 never */
export type VariantsOf<E> = E extends { readonly [variantsKey]?: infer I }
  ? [I] extends [VariantTypes<infer Base, infer D, infer V>]
    ? VariantTypes<Base, D, V>
    : never
  : never;

/** 读出的整行；多态实体是按判别列区分的联合 */
export type Row<E extends Entity> = [VariantsOf<E>] extends [never]
  ? RowOf<E['fields']>
  : VariantsOf<E> extends VariantTypes<infer Base, infer D, infer V>
    ? UnionRow<Base, D, V>
    : never;

/** 插入时可省的键：自增、有默认值、可空的列，以及里面全都可省的值对象 */
type OptionalKeys<F extends Fields> = {
  [K in keyof F]: F[K] extends Column<any, any, true>
    ? K
    : F[K] extends Embedded<infer G>
      ? [RequiredKeys<G>] extends [never]
        ? K
        : never
      : never;
}[keyof F];
type RequiredKeys<F extends Fields> = Exclude<keyof F, OptionalKeys<F>>;
/** 插入的值：值本身，或由库生成的 sql 片段（`sql\`nextval('s')\``） */
type InsertValue<C> = C extends Embedded<infer G> ? InsertOf<G> : ValueOf<C> | Expr<ValueOf<C>>;

/** 一组声明的列插入时的形状 */
export type InsertOf<F extends Fields> = {
  [K in RequiredKeys<F>]: InsertValue<F[K]>;
} & {
  [K in OptionalKeys<F>]?: InsertValue<F[K]>;
};

/** 插入时的形状：自增、有默认值、可空的列可省；多态实体先选子类型 */
export type Insert<E extends Entity> = [VariantsOf<E>] extends [never]
  ? InsertOf<E['fields']>
  : VariantsOf<E> extends VariantTypes<infer Base, infer D, infer V>
    ? UnionInsert<Base, D, V>
    : never;

/** 一组声明的列是不是都可空（值对象整个给 null 时要求这样） */
export type AllNullable<F extends Fields> = {
  [K in keyof F]: F[K] extends Embedded<infer G>
    ? AllNullable<G>
    : F[K] extends Column<any, true, any>
      ? true
      : false;
}[keyof F] extends true
  ? true
  : false;

/** 一组声明的列更新时的形状：都可选，值对象也可以只给其中几项 */
export type UpdateOf<F extends Fields> = {
  [K in keyof F]?: F[K] extends Embedded<infer G> ? UpdateOf<G> : ValueOf<F[K]>;
};

/** 更新时的形状：都可选 */
export type Update<E extends Entity> = UpdateOf<E['fields']>;

/**
 * 写入用：值对象的嵌套对象按路径展开成 'address.city' 这样的键，与 entity.columns 对上。
 * 值对象给 null 时它的每一列都写 NULL；没给（undefined）的照旧跳过；其余键原样保留（由调用方报"没有这一列"）
 */
export function flattenRow(
  entity: Entity,
  row: Readonly<Record<string, unknown>>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const walk = (fields: Fields, value: Readonly<Record<string, unknown>>, path: string) => {
    for (const [key, item] of Object.entries(value)) {
      const field = fields[key];
      if (!(field instanceof Embedded)) {
        out[path + key] = item;
        continue;
      }
      if (item === undefined) continue;
      if (item === null) {
        for (const column of Object.keys(entity.columns))
          if (column.startsWith(`${path}${key}.`)) out[column] = null;
        continue;
      }
      walk(field.fields, item as Record<string, unknown>, `${path}${key}.`);
    }
  };
  walk(entity.fields, row, '');
  return out;
}

/** 按路径展开的一行（'address.city'）放回嵌套对象 */
export function nestRow(row: Readonly<Record<string, unknown>>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [path, value] of Object.entries(row)) setPath(out, path, value);
  return out;
}

/** 读出用：把按路径展开的键（'address.city'）放回嵌套对象里 */
export function setPath(target: Record<string, unknown>, path: string, value: unknown): void {
  const parts = path.split('.');
  let current = target;
  for (const part of parts.slice(0, -1))
    current = (current[part] ??= {}) as Record<string, unknown>;
  current[parts.at(-1)!] = value;
}
