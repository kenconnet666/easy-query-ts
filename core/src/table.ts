/**
 * 列表页的请求 → 查询（对应 Java 版的 whereObject / orderByObject，契约同组件库 useTableQuery 的 tableParams）：
 *
 *   GET /orders?page=2&pageSize=20&sort=-amount,name&total=368&filter.status=draft&filter.status=paid&search.supplier=启航&keyword=泵
 *
 *   const request = parseTableRequest(new URL(url).searchParams);
 *   const page = await db.queryable(Order)
 *     .where((o) => [request.params.keyword?.[0] && o.title.like(request.params.keyword[0])])   // 查询栏的条件由使用方写
 *     .select((o) => ({ id: o.id, status: o.status, supplier: o.supplier.name, amount: o.amount }))
 *     .table(request);                                                                         // { rows, total, page, size }
 *
 * 表头的多选筛选（filter.列，IN）、关键字筛选（search.列，包含）、排序（sort，减号是倒序）只认结果里的列：
 * 键是 select 里的名字（没有 select 时是实体的列），相当于白名单，请求碰不到结果以外的列；嵌套对象、一对多的数组不能筛、不能排。
 * 前端已知总数时（只翻页、换排序）带上 total，不再执行 COUNT。
 */
import { and, Expr, not, or, type Cond } from './expr.ts';

/** 每页条数的上限：超过时报错，不悄悄少给（同 Spring Data 的 max-page-size） */
const MAX_PAGE_SIZE = 2000;

/** 解析后的列表请求 */
export interface TableRequest {
  /** 页码，从 1 开始 */
  readonly page: number;
  /** 每页条数 */
  readonly pageSize: number;
  /** 排序，前面的优先 */
  readonly sorts: readonly { readonly key: string; readonly descending: boolean }[];
  /** 前端已知的总数（只翻页、换排序时带来）；有它时不再数行数 */
  readonly total: number | undefined;
  /** 表头的多选筛选 filter.列：值在其中 */
  readonly filters: Readonly<Record<string, readonly string[]>>;
  /** 表头的关键字筛选 search.列：文字包含 */
  readonly searches: Readonly<Record<string, string>>;
  /** 条件树（FilterBar 的高级筛选，参数 condition 里的 JSON）；没有时 undefined */
  readonly condition: ConditionTree | undefined;
  /** 其余参数（查询栏的条件），原样交给使用方；区间用 rangeOf */
  readonly params: Readonly<Record<string, readonly string[]>>;
}

/** 请求参数：URLSearchParams，或框架解析好的 query 对象（同名参数是数组） */
export type TableRequestInput =
  URLSearchParams | Readonly<Record<string, string | readonly string[] | undefined>>;

/** 把地址栏参数解析成列表请求；页码、条数不对时报错 */
export function parseTableRequest(input: TableRequestInput): TableRequest {
  const entries: [string, string][] =
    input instanceof URLSearchParams
      ? [...input.entries()]
      : Object.entries(input).flatMap(([key, value]) =>
          value === undefined
            ? []
            : (typeof value === 'string' ? [value] : value).map((item): [string, string] => [
                key,
                item,
              ]),
        );
  const all = new Map<string, string[]>();
  for (const [key, value] of entries) all.set(key, [...(all.get(key) ?? []), value]);
  const one = (key: string) => all.get(key)?.[0];

  const page = positiveInt(one('page') ?? '1', 'page');
  const pageSize = positiveInt(one('pageSize') ?? '10', 'pageSize');
  if (pageSize > MAX_PAGE_SIZE)
    throw new Error(`pageSize must not exceed ${MAX_PAGE_SIZE}, got ${pageSize}`);
  const totalText = one('total');
  const total =
    totalText === undefined || totalText === '' ? undefined : nonNegativeInt(totalText, 'total');
  const sorts = parseSort(one('sort') ?? '');

  const filters: Record<string, string[]> = {};
  const searches: Record<string, string> = {};
  const params: Record<string, string[]> = {};
  for (const [key, values] of all) {
    if (key.startsWith('filter.')) {
      const kept = values.filter((value) => value.trim() !== '');
      if (kept.length) filters[key.slice('filter.'.length)] = kept;
    } else if (key.startsWith('search.')) {
      const text = values[0]?.trim() ?? '';
      if (text) searches[key.slice('search.'.length)] = text;
    } else if (!['page', 'pageSize', 'sort', 'total', 'condition'].includes(key))
      params[key] = values;
  }
  const conditionText = one('condition');
  let condition: ConditionTree | undefined;
  if (conditionText) {
    try {
      condition = JSON.parse(conditionText) as ConditionTree;
    } catch {
      throw new Error('condition must be JSON (the value of ConditionBuilder)');
    }
  }
  return { page, pageSize, sorts, total, filters, searches, condition, params };
}

function positiveInt(text: string, name: string): number {
  const value = Number(text);
  if (!Number.isInteger(value) || value < 1)
    throw new Error(`${name} must be a positive integer, got '${text}'`);
  return value;
}

function nonNegativeInt(text: string, name: string): number {
  const value = Number(text);
  if (!Number.isInteger(value) || value < 0)
    throw new Error(`${name} must be a non-negative integer, got '${text}'`);
  return value;
}

/** 结果里一列的表达式；不是列（嵌套对象、一对多的数组）或没有这个名字时报错，说明能用哪些 */
export function resultColumn(shape: unknown, key: string, use: string): Expr<unknown> {
  // 值对象里的列写成路径：'address.city'
  const value = key
    .split('.')
    .reduce<unknown>((item, part) => (item as Record<string, unknown> | null)?.[part], shape);
  if (value instanceof Expr) return value;
  const columns = Object.entries((shape ?? {}) as Record<string, unknown>)
    .filter(([, item]) => item instanceof Expr)
    .map(([name]) => name);
  throw new Error(
    `cannot ${use} by '${key}': not a column of the result (columns: ${columns.join(', ')})`,
  );
}

/**
 * 地址栏里的文字按列的类型读成值：字符串原样（加密列比较时照常加密）；布尔认 true / false / 1 / 0；
 * 其余交给列的解码（数字、bigint、decimal、日期、时间都认文字），读不成时报错
 */
export function parseColumnText(column: Expr<unknown>, text: string, key: string): unknown {
  const kind = column.codec?.kind ?? 'string';
  if (kind === 'string') return text;
  if (kind === 'boolean') {
    if (text === 'true' || text === '1') return true;
    if (text === 'false' || text === '0') return false;
    throw new Error(`'${key}' expects true or false, got '${text}'`);
  }
  if (kind === 'json' || kind === 'bytes')
    throw new Error(`'${key}' (${kind}) cannot be filtered by text`);
  const value = column.codec!.decode(text);
  if (typeof value === 'number' && Number.isNaN(value))
    throw new Error(`'${key}' expects a number, got '${text}'`);
  if (value instanceof Date && Number.isNaN(value.getTime()))
    throw new Error(`'${key}' expects a date-time, got '${text}'`);
  return value;
}

/** 条件树里比较的方式（同组件库 ConditionBuilder 的 ConditionOp） */
export type ConditionOp =
  | 'eq'
  | 'ne'
  | 'gt'
  | 'gte'
  | 'lt'
  | 'lte'
  | 'between'
  | 'in'
  | 'notIn'
  | 'contains'
  | 'notContains'
  | 'startsWith'
  | 'exists'
  | 'empty';

/**
 * 条件树（组件库 ConditionBuilder、FilterBar 高级筛选的值，纯 JSON），与组件库的 Condition 同形：
 * 比较一个字段，或用 all（全部满足）/ any（任一满足）/ not（不满足）组合
 */
export type ConditionTree =
  | { readonly field: string; readonly op: ConditionOp; readonly value?: unknown }
  | { readonly all: readonly ConditionTree[] }
  | { readonly any: readonly ConditionTree[] }
  | { readonly not: ConditionTree };

/** 条件树里用到的字段 */
export function conditionFields(tree: ConditionTree): string[] {
  if ('all' in tree) return tree.all.flatMap(conditionFields);
  if ('any' in tree) return tree.any.flatMap(conditionFields);
  if ('not' in tree) return conditionFields(tree.not);
  return [tree.field];
}

/** 解析排序参数：'-amount,name' 或 'amount desc, name asc' */
export function parseSort(text: string): { key: string; descending: boolean }[] {
  return text
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => {
      const [name = '', direction] = item.split(/\s+/);
      if (name.startsWith('-')) return { key: name.slice(1), descending: true };
      return { key: name, descending: direction?.toLowerCase() === 'desc' };
    });
}

/** filterBy 的比较方式（对应 Java 版 @EasyWhereCondition 的 type） */
export type FilterOp =
  | 'eq'
  | 'ne'
  | 'gt'
  | 'ge'
  | 'lt'
  | 'le'
  | 'like'
  | 'notLike'
  | 'startsWith'
  | 'endsWith'
  | 'in'
  | 'notIn'
  | 'between';

/** 一个值算不算"没填"：undefined、null、空串、全空白、空数组（allowEmpty 时空串照样算填了） */
export function blankValue(value: unknown, allowEmpty = false): boolean {
  if (value === undefined || value === null) return true;
  if (typeof value === 'string') return !allowEmpty && value.trim() === '';
  if (Array.isArray(value))
    return value.length === 0 || value.every((v) => blankValue(v, allowEmpty));
  return false;
}

/** 按 op 把一列与值比成条件（filterBy 用） */
export function compareColumn(
  column: Expr<unknown>,
  op: FilterOp,
  value: unknown,
  key: string,
): Cond {
  const any = column as Expr<any>;
  switch (op) {
    case 'eq':
      return any.eq(value);
    case 'ne':
      return any.ne(value);
    case 'gt':
      return any.gt(value);
    case 'ge':
      return any.ge(value);
    case 'lt':
      return any.lt(value);
    case 'le':
      return any.le(value);
    case 'like':
      return any.like(textOf(value, key));
    case 'notLike':
      return any.notLike(textOf(value, key));
    case 'startsWith':
      return any.startsWith(textOf(value, key));
    case 'endsWith':
      return any.endsWith(textOf(value, key));
    case 'in':
      return any.in(asArray(value, key) as never);
    case 'notIn':
      return any.notIn(asArray(value, key) as never);
    case 'between': {
      const [start, end] = asArray(value, key);
      return rangeOf(column, key, start, end);
    }
    default:
      throw new Error(`unknown filter op '${String(op)}' on '${key}'`);
  }
}

/** 日期时间列上的整天：按哪个时区算一天的开始（默认 UTC） */
export interface DayOptions {
  /** IANA 时区名，例如 'Asia/Shanghai' */
  readonly timeZone?: string;
}

/**
 * 条件树转成条件：字段只认 shape 里的列（结果列，相当于白名单），值按列的类型读。
 * between 的任一端为空时不限；日期时间列上只写了日期的一端按整天算（起端是那天的零点，止端是"早于后一天的零点"）
 */
export function conditionOf(tree: ConditionTree, shape: unknown, options: DayOptions = {}): Cond {
  if ('all' in tree) return and(...tree.all.map((item) => conditionOf(item, shape, options)));
  if ('any' in tree) return or(...tree.any.map((item) => conditionOf(item, shape, options)));
  if ('not' in tree) return not(conditionOf(tree.not, shape, options));
  const { field, op, value } = tree;
  const column = resultColumn(shape, field, 'filter');
  const text = column as Expr<string | null>;
  const read = (item: unknown) => columnValue(column, item, field);
  switch (op) {
    case 'eq':
      return column.eq(read(value) as never);
    case 'ne':
      return column.ne(read(value) as never);
    case 'gt':
      return column.gt(read(value) as never);
    case 'gte':
      return column.ge(read(value) as never);
    case 'lt':
      return column.lt(read(value) as never);
    case 'lte':
      return column.le(read(value) as never);
    case 'between': {
      const [start, end] = Array.isArray(value) ? value : [];
      return rangeOf(column, field, start, end, options);
    }
    case 'in':
      return column.in(asArray(value, field).map(read) as never);
    case 'notIn':
      return column.notIn(asArray(value, field).map(read) as never);
    case 'contains':
      return text.like(textOf(value, field));
    case 'notContains':
      return text.notLike(textOf(value, field));
    case 'startsWith':
      return text.startsWith(textOf(value, field));
    case 'exists':
      return isText(column) ? and(column.isNotNull(), text.ne('')) : column.isNotNull();
    case 'empty':
      return isText(column) ? or(column.isNull(), text.eq('')) : column.isNull();
    default:
      throw new Error(`unknown condition op '${String(op)}' on '${field}'`);
  }
}

/**
 * 一列在两个值之间（含两端），任一端为空（null、undefined、空字符串）时不限：查询栏的区间（`created=2026-01-01&created=2026-01-31`）
 * 与条件树的 between 都用它。日期时间列上只写了日期的一端按整天算
 */
export function rangeOf(
  column: Expr<unknown>,
  field: string,
  start: unknown,
  end: unknown,
  options: DayOptions = {},
): Cond {
  const blank = (item: unknown) => item === null || item === undefined || item === '';
  const day = (item: unknown) =>
    column.codec?.kind === 'datetime' &&
    typeof item === 'string' &&
    /^\d{4}-\d{2}-\d{2}$/.test(item);
  return [
    !blank(start) &&
      column.ge(
        (day(start)
          ? dayStart(start as string, options)
          : columnValue(column, start, field)) as never,
      ),
    !blank(end) &&
      (day(end)
        ? column.lt(dayStart(nextDay(end as string), options) as never)
        : column.le(columnValue(column, end, field) as never)),
  ];
}

/** JSON 里的值按列的类型读：文字交给 parseColumnText，decimal 列上的数字转成文字，其余原样 */
function columnValue(column: Expr<unknown>, value: unknown, field: string): unknown {
  if (typeof value === 'string') return parseColumnText(column, value, field);
  if (typeof value === 'number' && column.codec?.kind === 'decimal') return String(value);
  return value;
}

/** contains、startsWith 的值：文字，数字也按文字比 */
function textOf(value: unknown, field: string): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return String(value);
  throw new Error(`'${field}' expects text to search for`);
}

const isText = (column: Expr<unknown>) => (column.codec?.kind ?? 'string') === 'string';

function asArray(value: unknown, field: string): readonly unknown[] {
  if (!Array.isArray(value)) throw new Error(`'${field}' expects an array of values`);
  return value;
}

/** 'YYYY-MM-DD' 的后一天 */
function nextDay(text: string): string {
  const [year, month, day] = text.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(year, month - 1, day + 1)).toISOString().slice(0, 10);
}

/** 某个时区里这一天零点对应的时刻 */
function dayStart(text: string, { timeZone = 'UTC' }: DayOptions): Date {
  const [year, month, day] = text.split('-').map(Number) as [number, number, number];
  const guess = Date.UTC(year, month - 1, day);
  // 先按 UTC 零点猜，再减去那个时刻在目标时区的偏移；跨夏令时的那天再校一次
  const first = guess - zoneOffset(guess, timeZone);
  return new Date(guess - zoneOffset(first, timeZone));
}

/** 时区在某个时刻比 UTC 快多少毫秒 */
function zoneOffset(instant: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(new Date(instant));
  const get = (type: string) => Number(parts.find((part) => part.type === type)!.value);
  const local = Date.UTC(
    get('year'),
    get('month') - 1,
    get('day'),
    get('hour'),
    get('minute'),
    get('second'),
  );
  return local - (instant - (instant % 1000));
}
