/**
 * 官方 search 扩展（sql-search，Bean Searcher 风格）的参数约定，解析成 table() 认的 TableRequest：
 *
 *   userName=user_&userName-op=lml          字段与比较方式（op 默认 eq）
 *   userId=101&userId=102&userId-op=in      多个值；也可以写成 userId-0、userId-1 …
 *   createTime-1=2026-01-01&createTime-2=2026-02-01&createTime-op=roc   区间的两端
 *   deleteTime=true&deleteTime-op=inn       是否非空
 *   sort=createTime:desc&sort=userId:ascend 排序（asc / desc / ascend / descend）
 *   current=2&pageSize=20                   分页
 *
 * ```ts
 * const request = parseSearchRequest(query, { fields: ['userName', 'userId', 'createTime'], defaultSort: ['createTime:desc'] })
 * await db.queryable(User).select(…).table(request, { filterable: [...], sortable: [...] })
 * ```
 * 比较方式：eq ne gt ge lt le、in ni、lk nl（包含 / 不包含）、lml nlml（开头是 / 不是）、lmr nlmr（结尾是 / 不是）、
 * rc ro roc rco（闭、开、左开右闭、左闭右开区间）与 nrc nro nroc nrco（不在区间里）、inn（true 非空 / false 为空）。
 * 严格模式（默认）下不认识的参数、字段、比较方式都报错，与官方的 strict 一致。
 */
import type { ConditionTree, TableRequest, TableRequestInput } from './table.ts';

export interface SearchOptions {
  /** 能搜的字段（结果里的名字，关联表写 'ext.mobile'）；严格模式下别的字段报错 */
  readonly fields?: readonly string[];
  /** 没给 sort 时的排序：['createTime:desc', 'userId'] */
  readonly defaultSort?: readonly string[];
  /** 不认识的参数报错，默认 true */
  readonly strict?: boolean;
  /** 每页条数，默认 20 */
  readonly pageSize?: number;
}

/** 区间：左右两端是否包含 */
const RANGES: Readonly<Record<string, readonly [boolean, boolean]>> = {
  rc: [true, true],
  ro: [false, false],
  roc: [false, true],
  rco: [true, false],
};

export function parseSearchRequest(
  input: TableRequestInput,
  options: SearchOptions = {},
): TableRequest {
  const strict = options.strict ?? true;
  const params = new Map<string, string[]>();
  const entries =
    input instanceof URLSearchParams
      ? [...input.entries()]
      : Object.entries(input).flatMap(([k, v]) =>
          v === undefined
            ? []
            : (typeof v === 'string' ? [v] : v).map((x): [string, string] => [k, x]),
        );
  for (const [key, value] of entries) params.set(key, [...(params.get(key) ?? []), value]);
  const take = (key: string) => {
    const list = params.get(key);
    params.delete(key);
    return list;
  };

  const page = Number(take('current')?.[0] ?? take('page')?.[0] ?? 1);
  const pageSize = Number(take('pageSize')?.[0] ?? options.pageSize ?? 20);
  if (!Number.isInteger(page) || page < 1) throw new Error(`current must be a positive integer`);
  if (!Number.isInteger(pageSize) || pageSize < 1)
    throw new Error(`pageSize must be a positive integer`);
  const sortItems = take('sort') ?? options.defaultSort ?? [];
  const sorts = sortItems.flatMap((item) =>
    item.split(',').flatMap((part) => {
      const [key = '', direction = 'asc'] = part.trim().split(':');
      if (!key) return [];
      if (!/^(asc|desc|ascend|descend)$/i.test(direction))
        throw new Error(`unknown sort direction '${direction}'`);
      return [{ key, descending: /^desc/i.test(direction) }];
    }),
  );

  // 按字段收集：值（name、name-0、name-1 …）、比较方式（name-op）
  const fields = new Map<string, { values: Map<number, string[]>; op: string | undefined }>();
  const field = (name: string) => {
    if (strict && options.fields && !options.fields.includes(name))
      throw new Error(`cannot search by '${name}' (allowed: ${options.fields.join(', ')})`);
    let entry = fields.get(name);
    if (!entry) fields.set(name, (entry = { values: new Map(), op: undefined }));
    return entry;
  };
  for (const [key, values] of params) {
    const match = /^(.+?)-(op|\d+)$/.exec(key);
    if (!match) {
      field(key).values.set(-1, values);
      continue;
    }
    const [, name, suffix] = match as unknown as [string, string, string];
    if (suffix === 'op') field(name).op = values[0];
    else field(name).values.set(Number(suffix), values);
  }

  const leaves: ConditionTree[] = [];
  for (const [name, { values, op = 'eq' }] of fields) {
    // name-0、name-1、name-2 按序号排在 name 的值后面；区间的两端是序号 1、2
    const ordered = [...values].sort(([a], [b]) => a - b);
    const all = ordered.flatMap(([, v]) => v);
    const at = (i: number) => values.get(i)?.[0] ?? (i === 1 ? values.get(-1)?.[0] : undefined);
    const leaf = condition(name, op, all, at, strict);
    if (leaf) leaves.push(leaf);
  }
  return {
    page,
    pageSize,
    sorts,
    total: undefined,
    filters: {},
    searches: {},
    condition: leaves.length > 0 ? { all: leaves } : undefined,
    params: {},
  };
}

function condition(
  field: string,
  op: string,
  values: readonly string[],
  at: (index: number) => string | undefined,
  strict: boolean,
): ConditionTree | undefined {
  const value = values.find((v) => v !== '');
  const negate = (tree: ConditionTree | undefined): ConditionTree | undefined =>
    tree && { not: tree };
  const range = (code: string): ConditionTree | undefined => {
    const [lowInclusive, highInclusive] = RANGES[code]!;
    // 区间的两端：name-1 / name-2，或者 name 给了两个值
    const low = at(1) ?? values[0];
    const high = at(2) ?? values[1];
    const items: ConditionTree[] = [];
    if (low) items.push({ field, op: lowInclusive ? 'gte' : 'gt', value: low });
    if (high) items.push({ field, op: highInclusive ? 'lte' : 'lt', value: high });
    return items.length === 0 ? undefined : items.length === 1 ? items[0] : { all: items };
  };
  const simple = (
    to:
      | 'eq'
      | 'ne'
      | 'gt'
      | 'gte'
      | 'lt'
      | 'lte'
      | 'contains'
      | 'notContains'
      | 'startsWith'
      | 'endsWith',
  ) => (value === undefined ? undefined : ({ field, op: to, value } as ConditionTree));
  switch (op) {
    case 'eq':
      return simple('eq');
    case 'ne':
      return simple('ne');
    case 'gt':
      return simple('gt');
    case 'ge':
      return simple('gte');
    case 'lt':
      return simple('lt');
    case 'le':
      return simple('lte');
    case 'lk':
      return simple('contains');
    case 'nl':
      return simple('notContains');
    case 'lml':
      return simple('startsWith');
    case 'nlml':
      return negate(simple('startsWith'));
    case 'lmr':
      return simple('endsWith');
    case 'nlmr':
      return negate(simple('endsWith'));
    case 'in':
    case 'ni': {
      const list = values.filter((v) => v !== '');
      if (list.length === 0) return undefined;
      return { field, op: op === 'in' ? 'in' : 'notIn', value: list };
    }
    case 'rc':
    case 'ro':
    case 'roc':
    case 'rco':
      return range(op);
    case 'nrc':
    case 'nro':
    case 'nroc':
    case 'nrco':
      return negate(range(op.slice(1)));
    case 'inn': {
      if (value === undefined) return undefined;
      return { field, op: /^(true|1)$/i.test(value) ? 'notNull' : 'isNull' };
    }
    default:
      if (strict) throw new Error(`unknown search op '${op}' on '${field}'`);
      return undefined;
  }
}
