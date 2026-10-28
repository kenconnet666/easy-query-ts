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
import { Expr } from './expr.ts';

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
  /** 其余参数（查询栏的条件），原样交给使用方 */
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
  const sorts = (one('sort') ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => {
      // 也认 `amount desc, name asc`
      const [name = '', direction] = item.split(/\s+/);
      if (name.startsWith('-')) return { key: name.slice(1), descending: true };
      return { key: name, descending: direction?.toLowerCase() === 'desc' };
    });

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
    } else if (!['page', 'pageSize', 'sort', 'total'].includes(key)) params[key] = values;
  }
  return { page, pageSize, sorts, total, filters, searches, params };
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
  const value = (shape as Record<string, unknown> | null)?.[key];
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
