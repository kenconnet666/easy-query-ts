/**
 * 拦截器：对应 easy-query 的谓词拦截与写入拦截。在 createDb 时注册，作用于所有查询、更新、删除、插入：
 * ```ts
 * createDb({ schema, adapter, interceptors: [tenant('tenantId', () => currentTenant()), touch('updatedAt')] })
 * db.queryable(User).noInterceptor('tenant').toList()              // 单条语句关掉
 * db.withInterceptors({ skip: 'all' })                              // 整个 Db 关掉（受保护的除外）
 * db.queryable(User).where((u) => u.roles.noInterceptor('softDelete').any())   // 只在这个导航上关
 * ```
 * 条件会加到主表、多对一导航的 JOIN（ON 里）、一对多导航的子查询与 toList 的第二条查询上。
 */
import type { Node } from './ast.ts';
import type { Statement } from './dialect.ts';
import { condNode, type Cond } from './expr.ts';
import { refColumn, REF, type AnyRef } from './ref.ts';
import type { ColumnOptions, Entity } from './schema.ts';

/**
 * 拦截器名字的登记处：noInterceptor / useInterceptor 只接受登记过的名字，写错在编译期就报出来。
 * 内置的已登记；自己的拦截器用声明合并加进来：
 * ```ts
 * declare module '@zerodep-dev/easy-query-ts' { interface InterceptorNames { dataScope: true } }
 * ```
 */
export interface InterceptorNames {
  defaults: true;
  softDelete: true;
  tenant: true;
}

/** 拦截器的名字：登记过的，或 touch 生成的 `touch:列名` */
export type InterceptorName = keyof InterceptorNames | `touch:${string}`;

/** 条件加在哪种语句上 */
export type StatementKind = 'select' | 'update' | 'delete';

/**
 * 一次写入写了什么，按 kind 区分（判别联合，`switch (event.kind)` 之后各自的字段有类型）：
 * - insert：rows 是插入的各行（已补上默认值、租户、版本，值对象是嵌套的）；INSERT … SELECT 时为空，数据不经过应用
 * - update：set 是写进去的值（已补上 $onUpdate、touch；表达式更新的值是 Expr）
 * - delete：soft 为 true 时是逻辑删除（实际执行的是 update）
 */
export type WriteDetail =
  | { readonly kind: 'insert'; readonly rows: readonly Readonly<Record<string, unknown>>[] }
  | { readonly kind: 'update'; readonly set: Readonly<Record<string, unknown>> }
  | { readonly kind: 'delete'; readonly soft: boolean };

/**
 * afterWrite 收到的事件：写了什么（WriteDetail）、哪个实体、影响了多少行、执行的语句（含参数，条件在里面）。
 * 有拦截器声明了 `before: true` 时，update / delete 的事件还带上改之前的行（before）
 */
export type WriteEvent = WriteDetail & {
  readonly entity: Entity;
  readonly affected: number;
  readonly statements: readonly Statement[];
  /** 改之前的整行（值对象是嵌套对象）：update / delete 且有拦截器声明 before 时才有 */
  readonly before?: readonly Readonly<Record<string, unknown>>[];
};

export interface Interceptor {
  /** 用于 noInterceptor(name) / useInterceptor(name) */
  readonly name: InterceptorName;
  /** false 时默认关着，语句或 Db 上 useInterceptor(name) 才生效（只在某些接口里生效的数据范围、排除测试数据） */
  readonly enabled?: boolean;
  /** 受保护：`skip: 'all'` 全关时也不关，只能按名字关（租户） */
  readonly protected?: boolean;
  /** 给这个实体的读、改、删加条件；返回假值表示不加。statement.kind 说明条件加在哪种语句上 */
  filter?(ref: AnyRef, entity: Entity, statement: { readonly kind: StatementKind }): Cond;
  /** 插入前补值；row 是这一行的副本，可以直接改 */
  beforeInsert?(row: Record<string, unknown>, entity: Entity): void;
  /** 更新前补 set 的值；set 是副本，可以直接改 */
  beforeUpdate?(set: Record<string, unknown>, entity: Entity): void;
  /** 写入语句成功执行之后（在同一个事务里）调用：审计日志、发事件、失效缓存。抛错会让这次写入失败（事务里则回滚） */
  afterWrite?(event: WriteEvent): void | Promise<void>;
  /**
   * update / delete 的事件要不要带改之前的行（审计的前后对比）：true 时核心在执行前按同样的条件（含拦截器加的）先读一次整行，
   * 放进 event.before。多一条查询，所以按拦截器声明
   */
  readonly before?: boolean;
  /** 删除前询问：返回值表示"不要物理删除，改成把这些列更新成这些值"（逻辑删除）；返回 undefined 表示照常删除 */
  deleteAs?(entity: Entity): Record<string, unknown> | undefined;
}

/**
 * 拦截器的开关：use 打开（含默认关着的），skip 关掉，`skip: 'all'` 关掉除受保护的以外全部。
 * 几次开关按先后叠加，后面的覆盖前面的：`[{ skip: 'all' }, { use: ['tenant'] }]` 是"只留租户"
 */
export interface InterceptorToggle {
  readonly use?: readonly InterceptorName[];
  readonly skip?: readonly InterceptorName[] | 'all';
}

/** 某个实体上带有指定选项的列（属性名 + 选项） */
function columnsWith<K extends keyof ColumnOptions>(
  entity: Entity,
  option: K,
): { prop: string; value: NonNullable<ColumnOptions[K]> }[] {
  const found: { prop: string; value: NonNullable<ColumnOptions[K]> }[] = [];
  for (const [prop, column] of Object.entries(entity.columns)) {
    const value = column.options[option];
    if (value !== undefined && value !== false)
      found.push({ prop, value: value as NonNullable<ColumnOptions[K]> });
  }
  return found;
}

/** 逻辑删除列的值：deleted 可以是函数（如当前时间），每次用时求值 */
const valueOf = (v: unknown): unknown => (typeof v === 'function' ? (v as () => unknown)() : v);

/**
 * 由列修饰器驱动的内置拦截器，createDb 自动安装（用户的拦截器排在后面）：
 * - defaults：`$default` 在插入时补值、`$onUpdate` 在更新时补值、version 列插入初始版本；
 * - softDelete：逻辑删除列的读过滤、插入默认值、delete 改写成 update。可以用 `noInterceptor('softDelete')` 关掉。
 */
export function columnRules(): Interceptor[] {
  const defaults: Interceptor = {
    name: 'defaults',
    beforeInsert: (row, entity) => {
      for (const { prop, value } of columnsWith(entity, 'defaultFn'))
        if (row[prop] === undefined) row[prop] = value();
      for (const { prop, value } of columnsWith(entity, 'version'))
        if (row[prop] === undefined) row[prop] = value.initial;
    },
    beforeUpdate: (set, entity) => {
      for (const { prop, value } of columnsWith(entity, 'onUpdateFn'))
        if (set[prop] === undefined) set[prop] = value();
    },
  };
  const softDelete: Interceptor = {
    name: 'softDelete',
    filter: (ref, entity) => {
      const found = columnsWith(entity, 'softDelete')[0];
      if (!found) return false;
      const column = refColumn(ref, found.prop);
      return found.value.active === null ? column.isNull() : column.eq(found.value.active as never);
    },
    beforeInsert: (row, entity) => {
      const found = columnsWith(entity, 'softDelete')[0];
      if (found && row[found.prop] === undefined) row[found.prop] = found.value.active;
    },
    deleteAs: (entity) => {
      const found = columnsWith(entity, 'softDelete')[0];
      if (!found) return undefined;
      const set: Record<string, unknown> = { [found.prop]: valueOf(found.value.deleted) };
      // $onDelete 的列（删除人、删除时间）一并写入
      for (const { prop, value } of columnsWith(entity, 'onDeleteFn')) set[prop] = value();
      return set;
    },
  };
  return [defaults, softDelete];
}

/**
 * 多租户：有 prop 列的实体，读、改、删都加 {@code prop = value()}，插入时没给值就填上 value()。value() 每条语句求值一次。
 * 受保护：`skip: 'all'` 不会关掉它，要关得写名字 `noInterceptor('tenant')`
 */
export function tenant(prop: string, value: () => unknown): Interceptor {
  return {
    name: 'tenant',
    protected: true,
    filter: (ref, entity) => prop in entity.columns && refColumn(ref, prop).eq(value() as never),
    beforeInsert: (row, entity) => {
      if (prop in entity.columns && row[prop] === undefined) row[prop] = value();
    },
  };
}

/** 有 prop 列的实体，插入和更新时写入 now()（默认当前时间）；已显式给值时不覆盖 */
export function touch(prop: string, now: () => unknown = () => new Date()): Interceptor {
  const fill = (values: Record<string, unknown>, entity: Entity) => {
    if (prop in entity.columns && values[prop] === undefined) values[prop] = now();
  };
  return { name: `touch:${prop}`, beforeInsert: fill, beforeUpdate: fill };
}

/** 登记的拦截器加上叠加好的开关：一条语句（或一个 Db）里实际生效的是哪些 */
export class Interceptors {
  /** 全都不生效（受保护的也不例外）：Db.lock 这类不该改任何东西的语句用 */
  static readonly none = new Interceptors([]);

  private readonly list: readonly Interceptor[];
  private readonly use: ReadonlySet<string>;
  private readonly skip: ReadonlySet<string>;
  private readonly skipAll: boolean;
  /** 生效的那些，按登记顺序 */
  private readonly active: readonly Interceptor[];
  /** 有生效的拦截器要 update / delete 之前的行 */
  readonly wantsBefore: boolean;

  constructor(
    list: readonly Interceptor[],
    use: ReadonlySet<string> = new Set(),
    skip: ReadonlySet<string> = new Set(),
    skipAll = false,
  ) {
    this.list = list;
    this.use = use;
    this.skip = skip;
    this.skipAll = skipAll;
    this.active = list.filter((i) => {
      if (skip.has(i.name)) return false;
      if (use.has(i.name)) return true;
      if (skipAll && !i.protected) return false;
      return i.enabled !== false;
    });
    this.wantsBefore = this.active.some((i) => i.before === true && i.afterWrite !== undefined);
  }

  /** 叠加开关，返回新的一份（按先后，后面的覆盖前面的） */
  configure(...toggles: readonly InterceptorToggle[]): Interceptors {
    if (toggles.length === 0) return this;
    const use = new Set(this.use);
    const skip = new Set(this.skip);
    let skipAll = this.skipAll;
    for (const toggle of toggles) {
      if (toggle.skip === 'all') {
        // 全关：之前按名字打开的也作废，之后的 use 再打开
        skipAll = true;
        use.clear();
      } else {
        for (const name of toggle.skip ?? []) {
          use.delete(name);
          skip.add(name);
        }
      }
      for (const name of toggle.use ?? []) {
        skip.delete(name);
        use.add(name);
      }
    }
    return new Interceptors(this.list, use, skip, skipAll);
  }

  /** 这张表引用上的附加条件 */
  filters(ref: AnyRef, entity: Entity, kind: StatementKind): Node[] {
    const nodes: Node[] = [];
    for (const interceptor of this.active) {
      const n = interceptor.filter
        ? condNode(interceptor.filter(ref, entity, { kind }))
        : undefined;
      if (n) nodes.push(n);
    }
    return nodes;
  }

  async afterWrite(event: WriteEvent): Promise<void> {
    for (const interceptor of this.active) await interceptor.afterWrite?.(event);
  }

  /** 这个实体的 delete 要不要改写成 update：返回要更新的列，undefined 表示物理删除 */
  deleteAsUpdate(entity: Entity): Record<string, unknown> | undefined {
    let set: Record<string, unknown> | undefined;
    for (const interceptor of this.active) {
      const part = interceptor.deleteAs?.(entity);
      if (part) set = { ...set, ...part };
    }
    return set;
  }

  beforeInsert(row: Record<string, unknown>, entity: Entity): Record<string, unknown> {
    const copy = { ...row };
    for (const interceptor of this.active) interceptor.beforeInsert?.(copy, entity);
    return copy;
  }

  beforeUpdate(set: Record<string, unknown>, entity: Entity): Record<string, unknown> {
    const copy = { ...set };
    for (const interceptor of this.active) interceptor.beforeUpdate?.(copy, entity);
    return copy;
  }
}

/** 表引用的实体 */
export function refEntity(ref: AnyRef): Entity {
  const info = ref[REF];
  return info.schema.entities[info.key]!;
}
