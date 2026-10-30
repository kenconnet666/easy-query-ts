/**
 * 带类型的表达式。`u.name` 是 `Expr<string>`，`u.age` 是 `Expr<number | null>`；条件是 `Expr<boolean>`，可以存进变量、放进数组。
 * 只适用于某些类型的方法用 `this` 参数限定（例如 like 只能在字符串上调用），用错在编译期报错。
 */
import type { AggregateFn, BinaryOp, Node, OrderNode, SelectNode } from './ast.ts';
import { col, type Codec, type Column, type DateText, type DecimalText } from './schema.ts';
import { Placeholder } from './placeholder.ts';

export const codecs = {
  int: col.int().codec,
  double: col.double().codec,
  boolean: col.boolean().codec,
  string: col.string().codec,
};

/** 子查询的标记：Queryable 实现它，in(...) 和与标量比较时通过它取出子查询的语法树 */
export const SUBQUERY: unique symbol = Symbol('eqts.subquery');

/**
 * 能当子查询用的东西（一条 Queryable）。T 是它每行产生的值的类型：`select(p => p.userId)` 是 number。
 * 子查询是独立的语句，不能引用外层的表（相关子查询请用一对多导航的 any / count / sum）。
 */
export interface Subquery<T> {
  readonly __row: T;
  [SUBQUERY](): SelectNode;
}

export function isSubquery(value: unknown): value is Subquery<unknown> {
  return typeof value === 'object' && value !== null && SUBQUERY in value;
}

/** 与 T 比较时右边可以写的值：值本身或同类型的表达式；可空的表达式也行（join 条件里 `c.id.eq(u.companyId)`，NULL 不会等于任何值） */
export type Operand<T> =
  | NonNullable<T>
  | Expr<NonNullable<T>>
  | Expr<T>
  | Expr<NonNullable<T> | null>
  | Subquery<NonNullable<T>>
  | Subquery<NonNullable<T> | null>;

/**
 * 第三方数值类型的登记处。@zerodep-dev/easy-query-ts-decimal 之类的扩展包用声明合并把自己的类型加进来，
 * 之后算术、sum / avg、窗口函数就自动认这个类型，核心不依赖任何第三方库：
 * ```ts
 * declare module '@zerodep-dev/easy-query-ts' { interface NumericExtensions { decimalJs: Decimal } }
 * ```
 */
export interface NumericExtensions {}

/** 第三方日期时间类型的登记处，用法同 NumericExtensions（@zerodep-dev/easy-query-ts-date 登记 CalendarDate 等） */
export interface TemporalExtensions {}

/** 可以做算术与 sum / avg 的值类型 */
export type Numeric = number | bigint | DecimalText | NumericExtensions[keyof NumericExtensions];

/** 可以取年 / 月 / 日、加减天数、截断的值类型：Date、date 列的 'YYYY-MM-DD'（DateText）、以及扩展包登记的日期时间类型 */
export type Temporal = Date | DateText | TemporalExtensions[keyof TemporalExtensions];

/**
 * 算术右操作数：与左边同类型的值或表达式。
 * 十进制文字列和第三方数值类型（如 decimal.js 的 Decimal）额外接受 number，写 `amount.times(2)` 更顺手；
 * bigint 列只接受 bigint，避免把浮点数混进 64 位整数运算。
 */
/** 去掉品牌（Branded）的基础类型：带品牌的主键 + 1 照常能写 */
type Unbranded<T> = T extends number
  ? number
  : T extends bigint
    ? bigint
    : T extends string
      ? string
      : T;

export type Arith<T> =
  | Operand<T>
  | Operand<Unbranded<T>>
  | (NonNullable<T> extends DecimalText | NumericExtensions[keyof NumericExtensions]
      ? number
      : never);

/** T 可空时结果也可空 */
type Keep<T, R> = null extends T ? R | null : R;

export class Expr<T> {
  declare readonly __type: T;
  readonly node: Node;
  /** 读结果时怎么解码；与它比较的参数也用它编码 */
  readonly codec: Codec<any> | undefined;

  constructor(node: Node, codec?: Codec<any>) {
    this.node = node;
    this.codec = codec;
  }

  eq(value: Operand<T>): Pred {
    return this.op('=', value);
  }
  ne(value: Operand<T>): Pred {
    return this.op('<>', value);
  }
  gt(value: Operand<T>): Pred {
    return this.op('>', value);
  }
  ge(value: Operand<T>): Pred {
    return this.op('>=', value);
  }
  lt(value: Operand<T>): Pred {
    return this.op('<', value);
  }
  le(value: Operand<T>): Pred {
    return this.op('<=', value);
  }

  /**
   * 在这些值里，或在子查询的结果里：`u.id.in(db.queryable(Post).select(p => p.userId))`。
   * 值列表为空数组时恒为假；子查询必须只选一列。
   */
  in(
    values: readonly NonNullable<T>[] | Subquery<NonNullable<T>> | Subquery<NonNullable<T> | null>,
  ): Pred {
    return this.inNode(values, false);
  }

  /** 不在这些值里 / 子查询的结果里。值列表为空数组时恒为真（子查询里有 NULL 时按 SQL 的 NOT IN 规则，结果为未知） */
  notIn(
    values: readonly NonNullable<T>[] | Subquery<NonNullable<T>> | Subquery<NonNullable<T> | null>,
  ): Pred {
    return this.inNode(values, true);
  }

  private inNode(values: readonly unknown[] | Subquery<unknown>, not: boolean): Pred {
    if (isSubquery(values)) return pred({ k: 'in_sub', e: this.node, q: values[SUBQUERY](), not });
    return pred({
      k: 'in',
      e: this.node,
      list: (values as readonly unknown[]).map((v) => this.operand(v)),
      not,
    });
  }

  between(lo: Operand<T>, hi: Operand<T>): Pred {
    return pred({ k: 'between', e: this.node, lo: this.operand(lo), hi: this.operand(hi) });
  }

  /**
   * null 安全的相等：两边都是 NULL 也算相等（`=` 遇到 NULL 得到未知）。value 可以是 null。
   * MySQL `<=>`、PG `IS NOT DISTINCT FROM`、SQLite `IS`，其它库写成 `(a = b OR (a IS NULL AND b IS NULL))`。
   */
  eqNullSafe(value: Operand<T> | null): Pred {
    return pred({
      k: 'eq_ns',
      l: this.node,
      r: value === null ? { k: 'lit', sql: 'NULL' } : this.operand(value),
    });
  }

  /**
   * 截断到某个时间单位（`createdAt.dateTrunc('month')` 得到当月 1 日 0 点），按月 / 按周 / 按天分组统计时用。
   * 周从星期一开始（与 PG 一致）。HANA 暂不支持，渲染时报错。
   */
  dateTrunc(this: Expr<Temporal | null>, unit: DateUnit): Expr<T> {
    if (!DATE_UNITS.includes(unit))
      throw new RangeError(`dateTrunc unit must be one of ${DATE_UNITS.join(', ')}, got '${unit}'`);
    return new Expr(
      { k: 'fn', name: 'date_trunc', args: [this.node, { k: 'lit', sql: `'${unit}'` }] },
      this.codec,
    ) as Expr<T>;
  }

  isNull(): Pred {
    return pred({ k: 'null', e: this.node, not: false });
  }
  isNotNull(): Pred {
    return pred({ k: 'null', e: this.node, not: true });
  }

  /**
   * 包含 text（两边加 %，text 里的 % _ 按字面匹配）；text 也可以是一列（如路径左匹配 `c.path.startsWith(d.path)`，列里的 % _ 不转义）。
   * `{ ignoreCase: true }` 忽略大小写：PG 写成 ILIKE，别的库两边 LOWER
   */
  like(this: Expr<string | null>, text: string | Expr<string | null>, options?: LikeOptions): Pred {
    return this.likeNode('%', text, '%', false, options);
  }
  notLike(
    this: Expr<string | null>,
    text: string | Expr<string | null>,
    options?: LikeOptions,
  ): Pred {
    return this.likeNode('%', text, '%', true, options);
  }
  startsWith(
    this: Expr<string | null>,
    text: string | Expr<string | null>,
    options?: LikeOptions,
  ): Pred {
    return this.likeNode('', text, '%', false, options);
  }
  endsWith(
    this: Expr<string | null>,
    text: string | Expr<string | null>,
    options?: LikeOptions,
  ): Pred {
    return this.likeNode('%', text, '', false, options);
  }
  notStartsWith(
    this: Expr<string | null>,
    text: string | Expr<string | null>,
    options?: LikeOptions,
  ): Pred {
    return this.likeNode('', text, '%', true, options);
  }
  notEndsWith(
    this: Expr<string | null>,
    text: string | Expr<string | null>,
    options?: LikeOptions,
  ): Pred {
    return this.likeNode('%', text, '', true, options);
  }

  /**
   * 正则匹配（ROADMAP 19.6）：PG `~` / `~*`，MySQL 8.0.4+ 与 Oracle REGEXP_LIKE，DuckDB regexp_matches；别的库渲染时报不支持。
   * 正则的方言各库略有不同（PG 是 POSIX，MySQL 8 是 ICU），只用常见的写法
   */
  matches(this: Expr<string | null>, pattern: string, options?: LikeOptions): Pred {
    return pred({
      k: 'fn',
      name: 'regex_match',
      args: [
        this.node,
        { k: 'param', value: pattern, codec: undefined },
        { k: 'lit', sql: options?.ignoreCase ? "'i'" : "'c'" },
      ],
    });
  }

  /** 按指定的排序规则比较、排序（COLLATE）：`u.name.collate('utf8mb4_bin').eq(x)` 区分大小写；规则名原样写进 SQL，只能是字母数字与 _ - . */
  collate(this: Expr<string | null>, name: string): Expr<T> {
    if (!/^[\w.-]+$/.test(name)) throw new RangeError(`invalid collation name: ${name}`);
    return new Expr(
      { k: 'fn', name: 'collate', args: [this.node, { k: 'lit', sql: sqlString(name) }] },
      this.codec,
    );
  }

  /**
   * 本值在逗号分隔的列表里（MySQL 的 FIND_IN_SET）：`b.id.inCsv(u.bookIds)`，u.bookIds 存的是 '1,3,7'。
   * 各库一致（MySQL 用 FIND_IN_SET，其余拼成 ',1,3,7,' LIKE '%,3,%'）
   */
  inCsv(list: Expr<string | null> | string): Pred {
    return pred({ k: 'fn', name: 'in_csv', args: [this.node, toNode(list, codecs.string)] });
  }

  asc(): Order {
    return new Order({ e: this.node, desc: false });
  }
  desc(): Order {
    return new Order({ e: this.node, desc: true });
  }

  /** 为 NULL 时取 fallback（COALESCE） */
  orElse(fallback: Operand<T>): Expr<NonNullable<T>> {
    return new Expr(
      { k: 'fn', name: 'coalesce', args: [this.node, this.operand(fallback)] },
      this.codec,
    );
  }

  upper(this: Expr<string | null>): Expr<T> {
    return this.fn('upper') as Expr<T>;
  }
  lower(this: Expr<string | null>): Expr<T> {
    return this.fn('lower') as Expr<T>;
  }
  trim(this: Expr<string | null>): Expr<T> {
    return this.fn('trim') as Expr<T>;
  }
  /** 去掉开头的空白 */
  ltrim(this: Expr<string | null>): Expr<T> {
    return this.fn('ltrim') as Expr<T>;
  }
  /** 去掉末尾的空白 */
  rtrim(this: Expr<string | null>): Expr<T> {
    return this.fn('rtrim') as Expr<T>;
  }

  /** 左边补 fill 到 length 个字符（同 JS 的 padStart；比 length 长时截到 length，同 SQL 的 LPAD） */
  padStart(this: Expr<string | null>, length: number, fill = ' '): Expr<T> {
    return this.pad('pad_start', length, fill) as Expr<T>;
  }

  /** 右边补 fill 到 length 个字符（同 JS 的 padEnd） */
  padEnd(this: Expr<string | null>, length: number, fill = ' '): Expr<T> {
    return this.pad('pad_end', length, fill) as Expr<T>;
  }

  /** 与 other 比大小：小于为 -1，等于 0，大于 1（对应 Java 版的 compareTo）；任一为 NULL 时为 NULL */
  compare(other: Operand<T>): Expr<Keep<T, number>> {
    const r = this.operand(other);
    return new Expr(
      {
        k: 'case',
        when: [
          [{ k: 'op', op: '<', l: this.node, r }, intLit(-1)],
          [{ k: 'op', op: '>', l: this.node, r }, intLit(1)],
          [{ k: 'op', op: '=', l: this.node, r }, intLit(0)],
        ],
        else: undefined,
      },
      codecs.int,
    );
  }
  /** 字符数 */
  length(this: Expr<string | null>): Expr<Keep<T, number>> {
    return new Expr({ k: 'fn', name: 'length', args: [this.node] }, codecs.int);
  }
  concat(this: Expr<string | null>, ...parts: (string | Expr<string | null>)[]): Expr<T> {
    return new Expr(
      { k: 'fn', name: 'concat', args: [this.node, ...parts.map((p) => toNode(p, codecs.string))] },
      this.codec,
    );
  }

  // 算术：接收者可以是任何数值类型（number / bigint / 十进制文字 / 通过 NumericExtensions 登记的第三方类型）
  plus(this: Expr<Numeric | null>, value: Arith<T>): Expr<T> {
    return this.arith('+', value) as Expr<T>;
  }
  minus(this: Expr<Numeric | null>, value: Arith<T>): Expr<T> {
    return this.arith('-', value) as Expr<T>;
  }
  times(this: Expr<Numeric | null>, value: Arith<T>): Expr<T> {
    return this.arith('*', value) as Expr<T>;
  }
  div(this: Expr<Numeric | null>, value: Arith<T>): Expr<T> {
    return this.arith('/', value) as Expr<T>;
  }

  year(this: Expr<Temporal | null>): Expr<Keep<T, number>> {
    return new Expr({ k: 'fn', name: 'year', args: [this.node] }, codecs.int);
  }
  month(this: Expr<Temporal | null>): Expr<Keep<T, number>> {
    return new Expr({ k: 'fn', name: 'month', args: [this.node] }, codecs.int);
  }
  day(this: Expr<Temporal | null>): Expr<Keep<T, number>> {
    return new Expr({ k: 'fn', name: 'day', args: [this.node] }, codecs.int);
  }

  // ---- 字符串函数（写法由各方言的函数表决定） ----

  /** 子串：下标按 JS 的 substring，从 start（含）到 end（不含），0 起；省略 end 取到末尾 */
  substring(this: Expr<string | null>, start: number, end?: number): Expr<T> {
    const from = nonNegativeInt(start, 'substring start');
    const args: Node[] = [this.node, intLit(from + 1)];
    if (end !== undefined) {
      const to = nonNegativeInt(end, 'substring end');
      // JS 的 substring 会悄悄交换两个下标；这里直接报错，免得把写反了的下标当成正确结果
      if (to < from)
        throw new RangeError(`substring end (${to}) must not be less than start (${from})`);
      args.push(intLit(to - from));
    }
    return new Expr({ k: 'fn', name: 'substring', args }, this.codec);
  }

  /** 把所有 search 替换成 replacement */
  replace(this: Expr<string | null>, search: string, replacement: string): Expr<T> {
    return new Expr(
      {
        k: 'fn',
        name: 'replace',
        args: [this.node, this.operand(search), this.operand(replacement)],
      },
      this.codec,
    );
  }

  /** text 第一次出现的位置，0 起；没有时为 -1（与 JS 的 indexOf 一致） */
  indexOf(this: Expr<string | null>, text: string): Expr<Keep<T, number>> {
    return new Expr(
      { k: 'fn', name: 'index_of', args: [this.node, this.operand(text)] },
      codecs.int,
    );
  }

  /** 前 n 个字符 */
  left(this: Expr<string | null>, n: number): Expr<T> {
    return new Expr(
      { k: 'fn', name: 'left', args: [this.node, intLit(nonNegativeInt(n, 'left length'))] },
      this.codec,
    );
  }

  /** 后 n 个字符 */
  right(this: Expr<string | null>, n: number): Expr<T> {
    return new Expr(
      { k: 'fn', name: 'right', args: [this.node, intLit(nonNegativeInt(n, 'right length'))] },
      this.codec,
    );
  }

  // ---- 数学函数 ----

  abs(this: Expr<Numeric | null>): Expr<T> {
    return this.fn('abs') as Expr<T>;
  }
  floor(this: Expr<Numeric | null>): Expr<T> {
    return this.fn('floor') as Expr<T>;
  }
  ceil(this: Expr<Numeric | null>): Expr<T> {
    return this.fn('ceil') as Expr<T>;
  }

  /** 四舍五入到 digits 位小数（默认取整） */
  round(this: Expr<Numeric | null>, digits = 0): Expr<T> {
    return new Expr(
      { k: 'fn', name: 'round', args: [this.node, intLit(nonNegativeInt(digits, 'round digits'))] },
      this.codec,
    );
  }

  /** 取余 */
  mod(this: Expr<Numeric | null>, divisor: Arith<T>): Expr<T> {
    return new Expr({ k: 'fn', name: 'mod', args: [this.node, this.operand(divisor)] }, this.codec);
  }

  /** 截断到 digits 位小数（不四舍五入，默认取整） */
  truncate(this: Expr<Numeric | null>, digits = 0): Expr<T> {
    return new Expr(
      {
        k: 'fn',
        name: 'truncate',
        args: [this.node, intLit(nonNegativeInt(digits, 'truncate digits'))],
      },
      this.codec,
    );
  }

  /** 符号：正数 1、负数 -1、零 0 */
  sign(this: Expr<Numeric | null>): Expr<Keep<T, number>> {
    return new Expr({ k: 'fn', name: 'sign', args: [this.node] }, codecs.int);
  }

  /** 幂：本值的 exponent 次方 */
  power(
    this: Expr<Numeric | null>,
    exponent: number | Expr<Numeric | null>,
  ): Expr<Keep<T, number>> {
    return this.math('power', toNode(exponent, undefined));
  }
  /** 平方根 */
  sqrt(this: Expr<Numeric | null>): Expr<Keep<T, number>> {
    return this.math('sqrt');
  }
  /** e 的本值次方 */
  exp(this: Expr<Numeric | null>): Expr<Keep<T, number>> {
    return this.math('exp');
  }
  /** 自然对数 */
  ln(this: Expr<Numeric | null>): Expr<Keep<T, number>> {
    return this.math('ln');
  }
  /** 以 10 为底的对数 */
  log10(this: Expr<Numeric | null>): Expr<Keep<T, number>> {
    return this.math('log10');
  }
  /** 以 base 为底的对数 */
  log(this: Expr<Numeric | null>, base: number): Expr<Keep<T, number>> {
    return this.math('log', toNode(base, undefined));
  }
  sin(this: Expr<Numeric | null>): Expr<Keep<T, number>> {
    return this.math('sin');
  }
  cos(this: Expr<Numeric | null>): Expr<Keep<T, number>> {
    return this.math('cos');
  }
  tan(this: Expr<Numeric | null>): Expr<Keep<T, number>> {
    return this.math('tan');
  }
  asin(this: Expr<Numeric | null>): Expr<Keep<T, number>> {
    return this.math('asin');
  }
  acos(this: Expr<Numeric | null>): Expr<Keep<T, number>> {
    return this.math('acos');
  }
  atan(this: Expr<Numeric | null>): Expr<Keep<T, number>> {
    return this.math('atan');
  }
  /** 坐标 (x, 本值) 的反正切，按象限取角（本值是 y） */
  atan2(this: Expr<Numeric | null>, x: number | Expr<Numeric | null>): Expr<Keep<T, number>> {
    return this.math('atan2', toNode(x, undefined));
  }

  // ---- 日期函数 ----

  /** 加 n 天（n 可为负）。SQLite 的结果不带毫秒 */
  addDays(this: Expr<Temporal | null>, n: number): Expr<T> {
    return new Expr(
      { k: 'fn', name: 'add_days', args: [this.node, intLit(safeInt(n, 'addDays'))] },
      this.codec,
    );
  }

  /** 加 n 个月（n 可为负）；月末按各库自己的规则收敛（如 1 月 31 日加 1 个月） */
  addMonths(this: Expr<Temporal | null>, n: number): Expr<T> {
    return new Expr(
      { k: 'fn', name: 'add_months', args: [this.node, intLit(safeInt(n, 'addMonths'))] },
      this.codec,
    );
  }

  /** 加 n 个时间单位（n 可为负，也可以是一列：`o.createdAt.add(o.days, 'day')`） */
  add(this: Expr<Temporal | null>, n: number | Expr<number | null>, unit: TimeUnit): Expr<T> {
    if (!TIME_UNITS.includes(unit))
      throw new RangeError(`add unit must be one of ${TIME_UNITS.join(', ')}, got '${unit}'`);
    const amount = typeof n === 'number' ? intLit(safeInt(n, 'add amount')) : n.node;
    return new Expr(
      { k: 'fn', name: 'add_time', args: [this.node, amount, { k: 'lit', sql: `'${unit}'` }] },
      this.codec,
    );
  }
  addYears(this: Expr<Temporal | null>, n: number | Expr<number | null>): Expr<T> {
    return this.add(n, 'year') as Expr<T>;
  }
  addHours(this: Expr<Temporal | null>, n: number | Expr<number | null>): Expr<T> {
    return this.add(n, 'hour') as Expr<T>;
  }
  addMinutes(this: Expr<Temporal | null>, n: number | Expr<number | null>): Expr<T> {
    return this.add(n, 'minute') as Expr<T>;
  }
  addSeconds(this: Expr<Temporal | null>, n: number | Expr<number | null>): Expr<T> {
    return this.add(n, 'second') as Expr<T>;
  }

  hour(this: Expr<Temporal | null>): Expr<Keep<T, number>> {
    return new Expr({ k: 'fn', name: 'hour', args: [this.node] }, codecs.int);
  }
  minute(this: Expr<Temporal | null>): Expr<Keep<T, number>> {
    return new Expr({ k: 'fn', name: 'minute', args: [this.node] }, codecs.int);
  }
  /** 秒（整数，不含毫秒） */
  second(this: Expr<Temporal | null>): Expr<Keep<T, number>> {
    return new Expr({ k: 'fn', name: 'second', args: [this.node] }, codecs.int);
  }
  /** 一年中的第几天，1 起 */
  dayOfYear(this: Expr<Temporal | null>): Expr<Keep<T, number>> {
    return new Expr({ k: 'fn', name: 'day_of_year', args: [this.node] }, codecs.int);
  }
  /** 星期几：星期日 0、星期一 1 … 星期六 6（同 JS 的 Date.getDay） */
  dayOfWeek(this: Expr<Temporal | null>): Expr<Keep<T, number>> {
    return new Expr({ k: 'fn', name: 'day_of_week', args: [this.node] }, codecs.int);
  }
  /** ISO 的星期几：星期一 1 … 星期日 7（对应 Java 版的 dayOfWeekSunDayIsLastDay） */
  isoDayOfWeek(this: Expr<Temporal | null>): Expr<Keep<T, number>> {
    return new Expr({ k: 'fn', name: 'iso_day_of_week', args: [this.node] }, codecs.int);
  }

  /**
   * 格式化成文字（对应 Java 版的 format），模式的写法同 Java：yyyy、yy、MM、dd、HH、mm、ss，其余字符原样输出：
   * `createdAt.format('yyyy年MM月dd日 HH:mm')`。各库翻译成自己的格式（DATE_FORMAT、TO_CHAR、strftime）
   */
  format(this: Expr<Temporal | null>, pattern: string): Expr<Keep<T, string>> {
    return new Expr(
      { k: 'fn', name: 'date_format', args: [this.node, { k: 'lit', sql: sqlString(pattern) }] },
      codecs.string,
    );
  }

  /**
   * 与 other 相差多少个时间单位（本值减 other，不满一个单位的部分舍去，对应 Java 版的 duration(...).toHours() 等）：
   * `o.closedAt.diff(o.createdAt, 'hour')`。只看日期部分的整天数用 diffDays
   */
  diff(this: Expr<Temporal | null>, other: Operand<T>, unit: DiffUnit): Expr<Keep<T, number>> {
    if (!DIFF_UNITS.includes(unit))
      throw new RangeError(`diff unit must be one of ${DIFF_UNITS.join(', ')}, got '${unit}'`);
    return new Expr(
      {
        k: 'fn',
        name: 'diff_time',
        args: [this.node, this.operand(other), { k: 'lit', sql: `'${unit}'` }],
      },
      codecs.int,
    );
  }

  /** 与 other 相差的整天数（本值减 other，只看日期部分） */
  diffDays(this: Expr<Temporal | null>, other: Operand<T>): Expr<Keep<T, number>> {
    return new Expr(
      { k: 'fn', name: 'diff_days', args: [this.node, this.operand(other)] },
      codecs.int,
    );
  }

  // ---- 通用 ----

  /** 与 value 相等时得到 NULL（NULLIF） */
  nullIf(value: Operand<T>): Expr<T | null> {
    return new Expr(
      { k: 'fn', name: 'nullif', args: [this.node, this.operand(value)] },
      this.codec,
    );
  }

  // ---- JSON（对应 Java 版的 JSONObject / JSONArray）：路径按 JSON 列的 TS 类型补全、检查 ----

  /**
   * 取 JSON 里路径处的元素（对象、数组或标量），类型由路径推出：`u.attrs.json('profile', 'tags')` 是 `string[] | null`。
   * 数组下标写数字：`o.items.json(0, 'name')`。HANA 只能取对象和数组
   */
  json<P extends JsonPath<NonNullable<T>>>(
    this: Expr<object | null>,
    ...path: P
  ): Expr<JsonAt<NonNullable<T>, P> | null> {
    return new Expr(this.jsonNode('json_value', path), jsonCodec);
  }

  /** 取路径处的值作文字（字符串不带引号），比较、like 时用：`u.attrs.jsonText('code').eq('200')` */
  jsonText<P extends JsonPath<NonNullable<T>>>(
    this: Expr<object | null>,
    ...path: P
  ): Expr<string | null> {
    return new Expr(this.jsonNode('json_text', path), codecs.string);
  }

  /** 取路径处的数字；路径的终点必须是数字 */
  jsonNumber<P extends JsonLeafPath<NonNullable<T>, number>>(
    this: Expr<object | null>,
    ...path: P
  ): Expr<number | null> {
    return new Expr(this.jsonNode('json_number', path), codecs.double);
  }

  /** 取路径处的布尔；路径的终点必须是布尔 */
  jsonBoolean<P extends JsonLeafPath<NonNullable<T>, boolean>>(
    this: Expr<object | null>,
    ...path: P
  ): Expr<boolean | null> {
    return new Expr(this.jsonNode('json_boolean', path), codecs.boolean);
  }

  /** 路径处有值（对应 Java 版的 containsKey） */
  jsonHas<P extends JsonPath<NonNullable<T>>>(this: Expr<object | null>, ...path: P): Pred {
    return pred(this.jsonNode('json_has', path));
  }

  /** 路径处（不写路径就是本身）数组的长度 */
  jsonLength<P extends JsonLeafPath<NonNullable<T>, readonly unknown[]> | []>(
    this: Expr<object | null>,
    ...path: P
  ): Expr<number | null> {
    return new Expr(this.jsonNode('json_length', path), codecs.int);
  }

  // ---- JSON 的更新写法（ROADMAP 19.4）：结果是改过的整个文档，写进 set：`set((u) => ({ attrs: u.attrs.jsonSet(['profile', 'name'], 'x') }))`
  // PG、MySQL、SQLite 有；别的方言渲染时报不支持。文档是 NULL 时结果也是 NULL

  /** 把路径处的值换成 value（路径上缺的最后一层会补上）：PG jsonb_set、MySQL / SQLite JSON_SET */
  jsonSet<D extends object | null, P extends JsonPath<NonNullable<D>>>(
    this: Expr<D>,
    path: P,
    value: JsonAt<NonNullable<D>, P>,
  ): Expr<D> {
    return jsonEdit(this, 'json_set', path, [jsonParam(value)]);
  }

  /** 删掉路径处的键或数组元素：PG `#-`、MySQL / SQLite JSON_REMOVE */
  jsonRemove<D extends object | null, P extends JsonPath<NonNullable<D>>>(
    this: Expr<D>,
    ...path: P
  ): Expr<D> {
    if (path.length === 0) throw new TypeError('jsonRemove needs a path');
    return jsonEdit(this, 'json_remove', path, []);
  }

  /** 浅合并：给出的顶层键整个换掉，别的键不动（PG `||`；MySQL、SQLite 逐键 JSON_SET） */
  jsonMerge<D extends object | null>(this: Expr<D>, patch: Partial<NonNullable<D>>): Expr<D> {
    const keys = Object.keys(patch);
    if (keys.length === 0) throw new TypeError('jsonMerge needs at least one key');
    const args = keys.flatMap((key): Node[] => [
      { k: 'lit', sql: sqlString(JSON.stringify([key])) },
      jsonParam((patch as Record<string, unknown>)[key]),
    ]);
    return new Expr(
      { k: 'fn', name: 'json_merge', args: [this.node, jsonParam(patch), ...args] },
      this.codec,
    );
  }

  /** 往路径处的数组末尾加一项：PG jsonb_insert(…, true)、MySQL JSON_ARRAY_APPEND、SQLite json_insert(…[#]) */
  jsonAppend<
    D extends object | null,
    P extends JsonLeafPath<NonNullable<D>, readonly unknown[]> | [],
  >(
    this: Expr<D>,
    path: P,
    value: JsonAt<NonNullable<D>, P> extends readonly (infer E)[] ? E : unknown,
  ): Expr<D> {
    return jsonEdit(this, 'json_append', path, [jsonParam(value)]);
  }

  /**
   * JSON 数组里有满足条件的元素（ROADMAP 19.4）：数组在库里展开成行（PG jsonb_to_recordset、MySQL JSON_TABLE、SQLite json_each），
   * columns 声明用到的元素字段与类型（只能是元素上有的键），条件里按列写：
   * ```ts
   * o.payload.jsonSome(['items'], { sku: col.string(), qty: col.int() }, (it) => [it.sku.eq('A1'), it.qty.gt(2)])
   * ```
   * 数组不在（NULL、路径不存在）时为假
   */
  jsonSome<
    D extends object | null,
    P extends JsonLeafPath<NonNullable<D>, readonly object[]> | [],
    C extends Record<string, Column<any, boolean, boolean>>,
  >(
    this: Expr<D>,
    path: P,
    columns: C & Record<Exclude<keyof C, keyof JsonElement<NonNullable<D>, P>>, never>,
    predicate: (item: JsonItem<C>) => Cond,
  ): Pred {
    for (const part of path)
      if (typeof part === 'number' && (!Number.isSafeInteger(part) || part < 0))
        throw new RangeError(`json array index must be a non-negative integer, got ${part}`);
    const entries = Object.entries(columns as Record<string, Column<any, boolean, boolean>>);
    if (entries.length === 0) throw new TypeError('jsonSome needs at least one column');
    const item: Record<string, Expr<unknown>> = {};
    for (const [name, column] of entries)
      item[name] = new Expr(
        { k: 'fn', name: 'json_field', args: [{ k: 'lit', sql: sqlString(name) }] },
        column.codec,
      );
    const cond = condNode(predicate(item as JsonItem<C>)) ?? { k: 'lit', sql: '1 = 1' };
    return pred({
      k: 'json_some',
      doc: this.node,
      path: sqlString(JSON.stringify(path)),
      columns: entries.map(([name, column]) => ({
        name,
        kind: column.codec.kind,
        options: column.options,
      })),
      cond,
    });
  }

  /**
   * 类型转换（CAST）。decimal 要给精度与小数位：`x.cast('decimal', 12, 2)`。
   * 各库的类型名不同（MySQL 的整数是 SIGNED、字符串是 CHAR），由方言函数表翻译。
   */
  cast<K extends keyof CastTypes>(
    type: K,
    precision?: number,
    scale?: number,
  ): Expr<Keep<T, CastTypes[K]>> {
    const args: Node[] = [this.node];
    if (type === 'decimal')
      args.push(
        intLit(nonNegativeInt(precision ?? 38, 'cast precision')),
        intLit(nonNegativeInt(scale ?? 10, 'cast scale')),
      );
    return new Expr({ k: 'fn', name: `cast_${type}`, args }, castCodecs[type]);
  }

  /** 把值转成参数节点，用本表达式的编码 */
  operand(value: unknown): Node {
    return toNode(value, this.codec);
  }

  // ---- 数组列（col.array，PostgreSQL）；别的方言渲染时报不支持 ----

  /** 数组里有这个值：`? = ANY(col)` */
  has<E>(this: Expr<readonly E[] | null>, value: E | Expr<E>): Pred {
    const node =
      value instanceof Expr
        ? value.node
        : { k: 'param' as const, value, codec: this.codec?.element };
    return pred({ k: 'fn', name: 'array_has', args: [this.node, node] });
  }
  /** 这些值都在数组里：`col @> ?` */
  hasAll<E>(this: Expr<readonly E[] | null>, values: readonly E[]): Pred {
    return pred({ k: 'fn', name: 'array_contains', args: [this.node, this.arrayParam(values)] });
  }
  /** 至少一个值在数组里（有交集）：`col && ?` */
  hasAny<E>(this: Expr<readonly E[] | null>, values: readonly E[]): Pred {
    return pred({ k: 'fn', name: 'array_overlaps', args: [this.node, this.arrayParam(values)] });
  }
  /** 元素个数：`cardinality(col)`；空数组是 0，NULL 是 NULL */
  arrayLength(this: Expr<readonly unknown[] | null>): Expr<Keep<T, number>> {
    return new Expr({ k: 'fn', name: 'array_length', args: [this.node] }, codecs.int);
  }

  private arrayParam(values: readonly unknown[]): Node {
    if (values.length === 0) throw new TypeError('give at least one value');
    return { k: 'param', value: values, codec: this.codec };
  }

  private op(op: BinaryOp, value: unknown): Pred {
    if (value === null || value === undefined)
      throw new TypeError(`cannot compare with ${String(value)}; use isNull() / isNotNull()`);
    return pred({ k: 'op', op, l: this.node, r: this.operand(value) });
  }

  private arith(op: BinaryOp, value: unknown): Expr<unknown> {
    return new Expr({ k: 'op', op, l: this.node, r: this.operand(value) }, this.codec);
  }

  private fn(name: string): Expr<unknown> {
    return new Expr({ k: 'fn', name, args: [this.node] }, this.codec);
  }

  /** JSON 函数的节点：路径写成 JSON 数组的字面量，各库翻成自己的路径写法 */
  private jsonNode(name: string, path: readonly (string | number)[]): Node {
    for (const part of path)
      if (typeof part === 'number' && (!Number.isSafeInteger(part) || part < 0))
        throw new RangeError(`json array index must be a non-negative integer, got ${part}`);
    return { k: 'fn', name, args: [this.node, { k: 'lit', sql: sqlString(JSON.stringify(path)) }] };
  }

  /** 数学函数：结果是浮点数 */
  private math(name: string, ...rest: Node[]): Expr<any> {
    return new Expr({ k: 'fn', name, args: [this.node, ...rest] }, codecs.double);
  }

  private pad(name: string, length: number, fill: string): Expr<T> {
    if (fill.length === 0) throw new RangeError('pad fill must not be empty');
    return new Expr(
      {
        k: 'fn',
        name,
        args: [
          this.node,
          intLit(nonNegativeInt(length, 'pad length')),
          toNode(fill, codecs.string),
        ],
      },
      this.codec,
    );
  }

  /** LIKE before + text + after；加密列上搜索词先按同样的策略加密（策略不可分段搜索时报错，否则会拿明文去比密文、静默查不到） */
  private likeNode(
    before: string,
    text: string | Expr<string | null>,
    after: string,
    not: boolean,
    options: LikeOptions | undefined,
  ): Pred {
    const ci = options?.ignoreCase ? { ci: true } : {};
    if (text instanceof Expr) {
      // 模式是一列：前后拼上 %，列里的通配符原样生效
      const parts = [
        before && toNode(before, codecs.string),
        text.node,
        after && toNode(after, codecs.string),
      ];
      return pred({
        k: 'like',
        e: this.node,
        pattern: { k: 'fn', name: 'concat', args: parts.filter((p): p is Node => !!p) },
        not,
        ...ci,
      });
    }
    const encryption = this.codec?.encryption;
    if (encryption && options?.ignoreCase)
      throw new Error(
        'like / startsWith / endsWith with ignoreCase cannot search an encrypted column',
      );
    if (encryption && !encryption.searchable)
      throw new Error(
        'like / startsWith / endsWith on an encrypted column need a searchable encryption strategy; use sqlConvert to search inside the database',
      );
    const pattern = (value: string) =>
      before + escapeLike(encryption ? encryption.encrypt(value) : value) + after;
    return pred({
      k: 'like',
      e: this.node,
      // 预编译查询的占位值：转义与前后缀留到执行时做
      pattern: {
        k: 'param',
        value:
          (text as unknown) instanceof Placeholder
            ? (text as unknown as Placeholder).map((v) => pattern(String(v)))
            : pattern(text),
        codec: undefined,
      },
      not,
      ...ci,
    });
  }
}

export type Pred = Expr<boolean>;

/** like 家族与 matches 的选项 */
export interface LikeOptions {
  /** 忽略大小写 */
  readonly ignoreCase?: boolean;
}

/** dateTrunc 的时间单位 */
export type DateUnit = 'year' | 'quarter' | 'month' | 'week' | 'day' | 'hour' | 'minute' | 'second';
const DATE_UNITS: readonly DateUnit[] = [
  'year',
  'quarter',
  'month',
  'week',
  'day',
  'hour',
  'minute',
  'second',
];

/** JSON 元素的解码：各库都按 JSON 文字返回（取元素时转成文字），解析成对象、数组或标量 */
/** JSON 更新函数的节点：文档、路径字面量（各库翻成自己的路径写法）、其余参数；结果仍按这一列解码 */
function jsonEdit<D>(
  doc: Expr<D>,
  name: string,
  path: readonly (string | number)[],
  rest: Node[],
): Expr<D> {
  for (const part of path)
    if (typeof part === 'number' && (!Number.isSafeInteger(part) || part < 0))
      throw new RangeError(`json array index must be a non-negative integer, got ${part}`);
  const lit: Node = { k: 'lit', sql: sqlString(JSON.stringify(path)) };
  return new Expr({ k: 'fn', name, args: [doc.node, lit, ...rest] }, doc.codec);
}

/**
 * JSON 更新里写进去的值：先序列化成 JSON 文字再绑定，方言转成 JSON（PG CAST(? AS JSONB)、MySQL CAST(? AS JSON)、SQLite json(?)），
 * 字符串、数字、对象、数组、null 都按 JSON 写进去
 */
function jsonParam(value: unknown): Node {
  if (value === undefined) throw new TypeError('a JSON value cannot be undefined; use null');
  return { k: 'param', value: JSON.stringify(value), codec: undefined };
}

const jsonCodec: Codec<any> = {
  kind: 'json',
  decode: (raw) => (typeof raw === 'string' ? JSON.parse(raw) : raw),
  encode: (value) => JSON.stringify(value),
};

/** JSON 路径的递归深度上限（再深的路径类型不再展开） */
type JsonDepth = [never, 0, 1, 2, 3, 4];

/**
 * JSON 列的类型 T 上可以走的路径：对象的键、数组的下标（数字），最多 5 层。
 * T 是 unknown（`col.json()` 没写类型）时任何路径都行
 */
export type JsonPath<T, D extends number = 5> = unknown extends T
  ? (string | number)[]
  : [D] extends [never]
    ? never
    : T extends readonly (infer E)[]
      ? [number] | [number, ...JsonPath<NonNullable<E>, JsonDepth[D]>]
      : T extends object
        ? {
            [K in keyof T & string]: [K] | [K, ...JsonPath<NonNullable<T[K]>, JsonDepth[D]>];
          }[keyof T & string]
        : never;

/** 终点的值是 V 的路径 */
export type JsonLeafPath<T, V, D extends number = 5> = unknown extends T
  ? (string | number)[]
  : [D] extends [never]
    ? never
    : T extends readonly (infer E)[]
      ? | (NonNullable<E> extends V ? [number] : never)
        | [number, ...JsonLeafPath<NonNullable<E>, V, JsonDepth[D]>]
      : T extends object
        ? {
            [K in keyof T & string]:
              | (NonNullable<T[K]> extends V ? [K] : never)
              | [K, ...JsonLeafPath<NonNullable<T[K]>, V, JsonDepth[D]>];
          }[keyof T & string]
        : never;

/** 路径 P 处数组的元素类型 */
export type JsonElement<T, P> = JsonAt<T, P> extends readonly (infer E)[] ? E : never;

/** jsonSome 的条件里元素的字段：按声明的列类型，可能缺所以可空 */
export type JsonItem<C> = {
  readonly [K in keyof C]: C[K] extends Column<infer V, boolean, boolean> ? Expr<V | null> : never;
};

/** 路径 P 处的值的类型 */
export type JsonAt<T, P> = P extends readonly [infer K, ...infer Rest]
  ? T extends readonly (infer E)[]
    ? JsonAt<NonNullable<E>, Rest>
    : K extends keyof T
      ? JsonAt<NonNullable<T[K]>, Rest>
      : unknown
  : T;

/** add 的时间单位 */
export type TimeUnit = 'year' | 'month' | 'day' | 'hour' | 'minute' | 'second';
const TIME_UNITS: readonly TimeUnit[] = ['year', 'month', 'day', 'hour', 'minute', 'second'];

/** diff 的时间单位（按经过的时长算，月、年长短不一，不在其中） */
export type DiffUnit = 'day' | 'hour' | 'minute' | 'second';
const DIFF_UNITS: readonly DiffUnit[] = ['day', 'hour', 'minute', 'second'];

/** SQL 的字符串字面量：单引号括起来，里面的单引号写两次 */
export function sqlString(text: string): string {
  return `'${text.replaceAll("'", "''")}'`;
}

/** sqlString 的反操作：方言的函数表拿到的是渲染好的字面量 */
export function unquoteSql(literal: string): string {
  return literal.slice(1, -1).replaceAll("''", "'");
}

/** cast 的目标类型 → 转换后的 JS 类型 */
export interface CastTypes {
  string: string;
  int: number;
  bigint: number;
  double: number;
  decimal: DecimalText;
  date: DateText;
  datetime: Date;
}

const castCodecs: Record<keyof CastTypes, Codec<any>> = {
  string: col.string().codec,
  int: col.int().codec,
  bigint: col.bigint().codec,
  double: col.double().codec,
  decimal: col.decimal().codec,
  date: col.date().codec,
  datetime: col.datetime().codec,
};

/** 受信任的整数字面量：函数的位置、长度等参数直接写进 SQL，不占绑定参数（PG 的 SUBSTRING 等对参数类型很挑） */
function intLit(n: number): Node {
  return { k: 'lit', sql: String(n) };
}

function safeInt(n: number, what: string): number {
  if (!Number.isSafeInteger(n)) throw new RangeError(`${what} must be an integer, got ${n}`);
  return n;
}

function nonNegativeInt(n: number, what: string): number {
  if (!Number.isSafeInteger(n) || n < 0)
    throw new RangeError(`${what} must be a non-negative integer, got ${n}`);
  return n;
}

/**
 * CASE WHEN 的构建器。结果类型是各分支值类型的并集：
 * ```ts
 * caseWhen(u.age.lt(18), 'minor').when(u.age.lt(65), 'adult').else('senior')   // Expr<string>
 * caseWhen(u.age.isNull(), 0).end()                                           // 没有 ELSE：不匹配时为 NULL，Expr<number | null>
 * ```
 */
export class CaseBuilder<T> {
  private readonly branches: readonly (readonly [Node, Node])[];
  private readonly codec: Codec<any> | undefined;

  constructor(branches: readonly (readonly [Node, Node])[], codec: Codec<any> | undefined) {
    this.branches = branches;
    this.codec = codec;
  }

  when<V>(condition: Pred, value: V | Expr<V>): CaseBuilder<T | V> {
    const [node, codec] = branchValue(value);
    return new CaseBuilder<T | V>([...this.branches, [condition.node, node]], this.codec ?? codec);
  }

  /** 以 ELSE 结束 */
  else<V>(value: V | Expr<V>): Expr<T | V> {
    const [node, codec] = branchValue(value);
    return new Expr({ k: 'case', when: this.branches, else: node }, this.codec ?? codec);
  }

  /** 不写 ELSE 就结束：没有分支命中时为 NULL */
  end(): Expr<T | null> {
    return new Expr({ k: 'case', when: this.branches, else: undefined }, this.codec);
  }
}

/** 从 `when` 条件开始一个 CASE 表达式 */
/** joining 的选项：分隔符（默认逗号）、拼接的顺序、去重 */
export interface JoiningOptions<R extends readonly unknown[]> {
  readonly separator?: string;
  readonly orderBy?: (...refs: R) => OrderItem | readonly OrderItem[];
  readonly distinct?: boolean;
}

/** 字符串聚合的表达式（GROUP_CONCAT / STRING_AGG）：没有行时为 NULL */
export function joiningExpr(
  value: Expr<unknown>,
  separator: string | undefined,
  order: readonly OrderNode[],
  distinct: boolean | undefined,
): Expr<string | null> {
  return new Expr<string | null>(
    {
      k: 'string_agg',
      e: value.node,
      separator: separator ?? ',',
      order,
      distinct: distinct ?? false,
    },
    codecs.string,
  );
}

/** 当前时刻（UTC），对应 Java 版的 now / utcNow：`where((t) => t.expiresAt.gt(now()))` */
export function now(): Expr<Date> {
  return new Expr<Date>({ k: 'fn', name: 'now', args: [] }, col.datetime().codec);
}

/**
 * 几个值里最大的（对应 Java 版的 maxColumns）：忽略 NULL，全为 NULL 时才是 NULL（各库一致，PG 原生如此，其余库改写）
 * `greatest(t.createdAt, t.updatedAt)`
 */
export function greatest<V>(
  first: Expr<V>,
  ...rest: (Expr<V> | Expr<V | null> | NonNullable<V>)[]
): Expr<V> {
  return extreme('greatest', first, rest);
}

/** 几个值里最小的（对应 Java 版的 minColumns），NULL 的处理同 greatest */
export function least<V>(
  first: Expr<V>,
  ...rest: (Expr<V> | Expr<V | null> | NonNullable<V>)[]
): Expr<V> {
  return extreme('least', first, rest);
}

function extreme<V>(name: string, first: Expr<V>, rest: readonly unknown[]): Expr<V> {
  return new Expr<V>(
    { k: 'fn', name, args: [first.node, ...rest.map((v) => toNode(v, first.codec))] },
    first.codec,
  );
}

/**
 * 字符串模板（对应 Java 版的 stringFormat）：插进来的表达式按列拼接，其余值作为参数：
 * `text\`编号 \${b.code}，类型 \${b.type}\``。任一部分为 NULL 时结果的处理随各库的 CONCAT（MySQL 为 NULL，PG 当空串）
 */
export function text(strings: TemplateStringsArray, ...values: unknown[]): Expr<string> {
  const parts: Node[] = [];
  strings.forEach((s, i) => {
    if (s) parts.push(toNode(s, codecs.string));
    if (i < values.length) parts.push(toNode(values[i], codecs.string));
  });
  if (parts.length === 0) parts.push(toNode('', codecs.string));
  return new Expr<string>({ k: 'fn', name: 'concat', args: parts }, codecs.string);
}

export function caseWhen<V>(condition: Pred, value: V | Expr<V>): CaseBuilder<V> {
  const [node, codec] = branchValue(value);
  return new CaseBuilder<V>([[condition.node, node]], codec);
}

/** 分支值 → 节点与读结果用的解码：表达式沿用自己的；字面量按 JS 类型选 */
function branchValue(value: unknown): [Node, Codec<any> | undefined] {
  if (value instanceof Expr) return [value.node, value.codec];
  const codec =
    typeof value === 'string'
      ? codecs.string
      : typeof value === 'number'
        ? codecs.double
        : typeof value === 'boolean'
          ? codecs.boolean
          : value instanceof Date
            ? col.datetime().codec
            : undefined;
  return [{ k: 'param', value, codec: undefined }, codec];
}

export class Order {
  readonly node: OrderNode;
  constructor(node: OrderNode) {
    this.node = node;
  }
}

export type OrderItem = Order | Expr<unknown>;

/** 条件：数组表示 AND；false / null / undefined / 0 / '' 跳过，方便写 `age != null && u.age.ge(age)` */
export type Cond =
  Expr<boolean> | Expr<boolean | null> | false | null | undefined | 0 | '' | readonly Cond[];

export function and(...conds: Cond[]): Pred {
  return pred(combine('and', conds) ?? { k: 'lit', sql: '1 = 1' });
}

/** 全部跳过时恒为假 */
export function or(...conds: Cond[]): Pred {
  const items = conds.map(condNode).filter((n): n is Node => n !== undefined);
  if (items.length === 0) return pred({ k: 'lit', sql: '1 = 0' });
  return pred(items.length === 1 ? items[0]! : { k: 'or', items });
}

export function not(cond: Cond): Pred {
  const n = condNode(cond);
  return pred(n ? { k: 'not', e: n } : { k: 'lit', sql: '1 = 0' });
}

/** 条件 → 节点；全部跳过时为 undefined */
export function condNode(cond: Cond): Node | undefined {
  if (!cond) return undefined;
  if (cond instanceof Expr) return cond.node;
  return combine('and', cond);
}

function combine(kind: 'and', conds: readonly Cond[]): Node | undefined {
  const items = conds.map(condNode).filter((n): n is Node => n !== undefined);
  if (items.length === 0) return undefined;
  return items.length === 1 ? items[0]! : { k: kind, items };
}

export function orderNodes(items: OrderItem | readonly OrderItem[]): OrderNode[] {
  const list = Array.isArray(items) ? items : [items];
  return list.map((o: OrderItem) => (o instanceof Order ? o.node : { e: o.node, desc: false }));
}

export function toNode(value: unknown, codec: Codec<any> | undefined): Node {
  if (value instanceof Expr) return value.node;
  // 子查询当标量用：`(SELECT …)`，要求它只返回一行一列
  if (isSubquery(value)) return { k: 'sub', q: value[SUBQUERY]() };
  return { k: 'param', value, codec };
}

export function pred(node: Node): Pred {
  return new Expr<boolean>(node, codecs.boolean);
}

export function aggregate<T>(
  fn: AggregateFn,
  arg: Expr<unknown> | undefined,
  codec: Codec<any> | undefined,
  distinct = false,
): Expr<T> {
  return new Expr<T>({ k: 'agg', fn, arg: arg?.node, distinct }, codec);
}

/** 聚合结果的解码：AVG 总是小数；SUM 跟着列（decimal 仍是文字） */
export function aggregateCodec(fn: AggregateFn, e: Expr<unknown>): Codec<any> | undefined {
  if (fn === 'count') return codecs.int;
  if (fn === 'avg') return e.codec?.kind === 'decimal' ? e.codec : codecs.double;
  return e.codec;
}

function escapeLike(text: string): string {
  return text.replace(/[\\%_]/g, (c) => '\\' + c);
}

/**
 * 原生 SQL 片段。插进来的表达式按列渲染，其余值作为绑定参数；T 是结果类型。
 * ```ts
 * db.queryable(User).where(u => sql<boolean>`${u.name} REGEXP ${pattern}`)
 * ```
 */
export function sql<T>(strings: TemplateStringsArray, ...args: unknown[]): Expr<T> {
  return new Expr<T>({
    k: 'raw',
    parts: [...strings],
    args: args.map((a) => toNode(a, undefined)),
  });
}

/** 带解码的原生片段：`sql.typed(codecs.int)\`...\`` */
sql.typed =
  <T>(codec: Codec<T>) =>
  (strings: TemplateStringsArray, ...args: unknown[]): Expr<T> =>
    new Expr<T>(
      { k: 'raw', parts: [...strings], args: args.map((a) => toNode(a, undefined)) },
      codec,
    );

/**
 * 方言专属函数的节点：name 由方言的函数表认领（如 'mysql.json_contains'），别的方言渲染时报不支持。
 * 参数里的表达式按列渲染，节点原样放入（如受信任的 lit），其余值作为绑定参数。
 */
export function dialectFn<T>(name: string, args: readonly unknown[], codec?: Codec<any>): Expr<T> {
  const nodes = args.map((a): Node =>
    a instanceof Expr ? a.node : isNode(a) ? a : { k: 'param', value: a, codec: undefined },
  );
  return new Expr<T>({ k: 'fn', name, args: nodes }, codec);
}

function isNode(value: unknown): value is Node {
  return (
    typeof value === 'object' &&
    value !== null &&
    'k' in value &&
    (value as { k: unknown }).k === 'lit'
  );
}
