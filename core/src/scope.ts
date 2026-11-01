/**
 * 可复用的通用条件（ROADMAP 18.3.1）：条件只依赖几列（结构类型），任何有这些列的实体都能用，不用每个实体写一遍：
 * ```ts
 * const ofTenant = defineScope<{ tenantId: number }, [tenantId: number]>((row, id) => row.tenantId.eq(id))
 * const live = defineScope<{ deletedAt: Date | null }>((row) => row.deletedAt.isNull())
 *
 * db.queryable(Order).apply(ofTenant, 7).apply(live).toList()
 * db.queryable(Company).apply(ofTenant, 7)   // 类型错误：Company 没有 tenantId 列
 * ```
 * 声明的列类型要与实体的列一致（可空的列写成 `T | null`）；参数在 apply 时给，类型也检查
 */
import type { Cond, Expr } from './expr.ts';

/** 有这些列的行：列名 → 表达式 */
export type HasColumns<C> = { readonly [K in keyof C]: Expr<C[K]> };

/** 一个可复用的条件；C 是它依赖的列，A 是调用时给的参数 */
export interface ColumnScope<C, A extends readonly unknown[] = []> {
  readonly condition: (row: HasColumns<C>, ...args: A) => Cond;
}

/** 声明一个只依赖某几列的条件 */
export function defineScope<C, A extends readonly unknown[] = []>(
  condition: (row: HasColumns<C>, ...args: A) => Cond,
): ColumnScope<C, A> {
  return { condition };
}
