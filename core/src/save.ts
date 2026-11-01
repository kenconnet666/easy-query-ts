/**
 * 聚合保存（对应 Java 版的 savable，ROADMAP 16.4.1）：保存一棵对象树——新增、按差异修改、脱钩。
 * 不需要追踪上下文：在事务里先按父键把现有的子项查出来，与提交的树比较。保存哪些导航由带类型的 include 树决定：
 * ```ts
 * await db.save(User, form, {
 *   include: {
 *     posts: { removed: 'delete', include: { comments: true } },   // 一对多：不在列表里的帖子删掉，评论跟着保存
 *     roles: true,                                                  // 多对多：只维护中间表
 *     company: true,                                                // 多对一：先存公司，再把外键设成它的主键
 *   },
 * })
 * ```
 * - 一对多、一对一（外键在对方）：子项按主键（没给时按 key 指定的列，对应 SaveKey）认出原来的行，按差异更新，否则插入；
 *   不在输入里的按 removed 处理：'delete' 删除（沿 include 先删它的子项）、'unlink' 外键置空、'keep' 不动。
 *   没写 removed 时外键可空就置空，不可空且确实有要移除的行就报错（免得默认就删数据）
 * - 多对一（外键在本表）：先保存目标再设外键；给 null 时外键置空
 * - 多对多：子项只给了关联列时只维护中间表，带了别的字段时先保存目标；中间表只增删变化的行（中间表可以有业务列）。
 *   removed 默认 'unlink'（删中间表的行），'delete' 连目标一起删
 * - 输入里没出现的导航不动；出现了却没写进 include 的导航报错
 */
import type { Db } from './db.ts';
import { and, or, type Cond, type Expr } from './expr.ts';
import type { AnySchema, EntityKey, Many, Member, One, Relation } from './relations.ts';
import { flattenRow, type Entity, type UpdateOf } from './schema.ts';

/** 不在输入里的子项怎么处理 */
export type RemovedPolicy = 'delete' | 'unlink' | 'keep';

type Navs<S extends AnySchema, K extends EntityKey<S>> = {
  [
    R in keyof S['relations'][K] as S['relations'][K][R] extends Relation ? R : never
  ]: S['relations'][K][R];
};
type TargetOf<S extends AnySchema, Rel> =
  Rel extends One<infer T, any>
    ? T & EntityKey<S>
    : Rel extends Many<infer T>
      ? T & EntityKey<S>
      : never;

/** 一个导航怎么保存：再往下保存哪些导航、不在输入里的子项怎么处理、子项没给主键时按哪一列认原来的行 */
export interface SaveNode<S extends AnySchema, T extends EntityKey<S>> {
  readonly include?: SaveInclude<S, T>;
  readonly removed?: RemovedPolicy;
  readonly key?: keyof S['entities'][T]['fields'] & string;
}

/** 保存哪些导航（键由实体的关系推出） */
export type SaveInclude<S extends AnySchema, K extends EntityKey<S>> = {
  readonly [R in keyof Navs<S, K>]?: true | SaveNode<S, TargetOf<S, Navs<S, K>[R]>>;
};

type IncludeOf<X> = X extends { readonly include: infer N } ? N : {};

/** 保存的输入：本表的列（都可选）加上 include 里各导航的值（一对多是数组，多对一 / 一对一是对象或 null） */
export type SaveValue<S extends AnySchema, K extends EntityKey<S>, I> = UpdateOf<
  S['entities'][K]['fields']
> & {
  [R in keyof I & keyof Navs<S, K>]?: Navs<S, K>[R] extends Many<infer T>
    ? readonly SaveValue<S, T & EntityKey<S>, IncludeOf<I[R]>>[]
    : Navs<S, K>[R] extends One<infer T, any>
      ? SaveValue<S, T & EntityKey<S>, IncludeOf<I[R]>> | null
      : never;
};

type Row = Record<string, unknown>;
type Include = Readonly<
  Record<string, true | { include?: Include; removed?: RemovedPolicy; key?: string }>
>;

/** 一棵树的保存与删除（Db.save / Db.remove 在事务里调用） */
export class AggregateSaver {
  private readonly db: Db<AnySchema>;
  private readonly schema: AnySchema;

  constructor(db: Db<AnySchema>, schema: AnySchema) {
    this.db = db;
    this.schema = schema;
  }

  /** 保存一个节点，返回保存后的行（含主键）；before 是库里原来的这一行（按差异更新） */
  async save(key: string, input: Row, include: Include | undefined, before?: Row): Promise<Row> {
    const entity = this.entity(key);
    const relations = this.relations(key);
    const included = include ?? {};
    const values: Row = {};
    for (const [name, value] of Object.entries(input)) {
      if (!(name in relations)) values[name] = value;
      else if (!(name in included))
        throw new Error(
          `save: '${name}' of ${entity.name} is a navigation; list it in include to save it`,
        );
    }
    // 多对一（外键在本表）：先存目标，外键设成它的主键
    for (const [name, rel, node] of this.navigations(key, included)) {
      if (rel.kind !== 'one' || !this.foreignKeyOnSelf(key, rel)) continue;
      const value = input[name];
      if (value === undefined) continue;
      if (value === null) {
        for (const c of rel.from) values[c] = null;
        continue;
      }
      const target = await this.save(rel.target, value as Row, node.include);
      rel.from.forEach((c, i) => (values[c] = target[rel.to[i]!]));
    }
    const row = await this.upsert(entity, values, before);
    for (const [name, rel, node] of this.navigations(key, included)) {
      const value = input[name];
      if (value === undefined) continue;
      if (rel.kind === 'many' && rel.through)
        await this.links(row, rel, value as readonly Row[], node);
      else if (rel.kind === 'many') await this.children(row, rel, value as readonly Row[], node);
      else if (!this.foreignKeyOnSelf(key, rel))
        await this.children(row, rel, value === null ? [] : [value as Row], node);
    }
    return row;
  }

  /** 删掉这些行，沿 include 先删它们拥有的子项（一对多、一对一）与中间表的行 */
  async removeRows(key: string, rows: readonly Row[], include: Include | undefined): Promise<void> {
    if (rows.length === 0) return;
    const entity = this.entity(key);
    for (const [, rel, node] of this.navigations(key, include ?? {})) {
      if (rel.kind === 'one' && this.foreignKeyOnSelf(key, rel)) continue;
      for (const row of rows) {
        if (rel.kind === 'many' && rel.through) {
          await this.deleteLinks(row, rel, undefined);
          continue;
        }
        const owned = await this.loadChildren(row, rel);
        await this.removeRows(rel.target, owned, node.include);
      }
    }
    const pk = entity.primaryKey;
    await this.db
      .delete(entity)
      .where((r: any) => keyIn(r, pk, rows))
      .execute();
  }

  private async children(parent: Row, rel: Relation, list: readonly Row[], node: NodeOptions) {
    const target = this.entity(rel.target);
    const pk = target.primaryKey;
    const link = Object.fromEntries(rel.to.map((c, i) => [c, parent[rel.from[i]!]]));
    const existing = await this.loadChildren(parent, rel);
    const byPk = new Map(existing.map((r) => [keyText(r, pk), r]));
    const byKey = node.key ? new Map(existing.map((r) => [String(r[node.key!]), r])) : undefined;
    const kept = new Set<string>();
    for (const child of list) {
      const flat = flattenRow(target, child);
      const before = hasKey(flat, pk)
        ? byPk.get(keyText(flat, pk))
        : node.key && flat[node.key] !== undefined && flat[node.key] !== null
          ? byKey?.get(String(flat[node.key]))
          : undefined;
      const values: Row = { ...child, ...link };
      if (before) for (const k of pk) values[k] ??= before[k];
      const saved = await this.save(rel.target, values, node.include, before);
      kept.add(keyText(saved, pk));
    }
    const removed = existing.filter((r) => !kept.has(keyText(r, pk)));
    if (removed.length === 0) return;
    const policy =
      node.removed ??
      (rel.to.every((c) => target.columns[c]!.options.nullable) ? 'unlink' : undefined);
    if (policy === undefined)
      throw new Error(
        `save: ${removed.length} ${target.name} row(s) are no longer in the list but ${rel.to.join(', ')} cannot be null; set removed: 'delete' or 'keep'`,
      );
    if (policy === 'keep') return;
    if (policy === 'delete') return this.removeRows(rel.target, removed, node.include);
    await this.db
      .update(target)
      .set(Object.fromEntries(rel.to.map((c) => [c, null])))
      .where((r: any) => keyIn(r, pk, removed))
      .execute();
  }

  private async links(parent: Row, rel: Many, list: readonly Row[], node: NodeOptions) {
    const through = rel.through!;
    const middle = this.entity(through.entity);
    const wanted = new Map<string, readonly unknown[]>();
    for (const item of list) {
      // 只给了关联列：只维护中间表；带了别的字段：先保存目标
      const onlyKeys = Object.keys(item).every((k) => rel.to.includes(k));
      const saved = onlyKeys ? item : await this.save(rel.target, item, node.include);
      const values = rel.to.map((c) => saved[c]);
      if (values.some((v) => v === undefined || v === null))
        throw new Error(`save: a ${rel.target} item has no ${rel.to.join(', ')} to link with`);
      wanted.set(values.map(String).join('\u0001'), values);
    }
    const parentKey = rel.from.map((c) => parent[c]);
    const existing = await this.db
      .queryable(middle)
      .where((m: any) =>
        through.from.map((c, i) => (m[c] as Expr<unknown>).eq(parentKey[i] as never)),
      )
      .toList();
    const present = new Set(
      existing.map((m: Row) => through.to.map((c) => String(m[c])).join('\u0001')),
    );
    const added = [...wanted].filter(([id]) => !present.has(id));
    if (added.length > 0)
      await this.db
        .insert(middle)
        .values(
          added.map(([, values]) => ({
            ...Object.fromEntries(through.from.map((c, i) => [c, parentKey[i]])),
            ...Object.fromEntries(through.to.map((c, i) => [c, values[i]])),
          })) as never,
        )
        .execute();
    const policy = node.removed ?? 'unlink';
    if (policy === 'keep') return;
    const gone = existing.filter(
      (m: Row) => !wanted.has(through.to.map((c) => String(m[c])).join('\u0001')),
    );
    if (gone.length === 0) return;
    await this.deleteLinks(parent, rel, gone);
    if (policy === 'delete') {
      const target = this.entity(rel.target);
      const targets = gone.map((m: Row) =>
        Object.fromEntries(rel.to.map((c, i) => [c, m[through.to[i]!]])),
      );
      await this.db
        .delete(target)
        .where((r: any) => keyIn(r, rel.to, targets))
        .execute();
    }
  }

  /** 删父行在中间表里的行；only 给出时只删这些 */
  private async deleteLinks(parent: Row, rel: Many, only: readonly Row[] | undefined) {
    const through = rel.through!;
    const middle = this.entity(through.entity);
    const parentKey = rel.from.map((c) => parent[c]);
    await this.db
      .delete(middle)
      .where((m: any) => [
        ...through.from.map((c, i) => (m[c] as Expr<unknown>).eq(parentKey[i] as never)),
        only && keyIn(m, through.to, only),
      ])
      .execute();
  }

  /** 父行在这个导航上现有的子项（带上关系的固定条件） */
  private loadChildren(parent: Row, rel: Relation): Promise<Row[]> {
    const target = this.entity(rel.target);
    const fixed = rel.where;
    return this.db
      .queryable(target)
      .where((r: any) => [
        ...rel.to.map((c, i) => (r[c] as Expr<unknown>).eq(parent[rel.from[i]!] as never)),
        fixed && fixed(r),
      ])
      .toList() as Promise<Row[]>;
  }

  /**
   * 存一行：有 before 时按差异更新（没变就不发语句）；带完整主键时存在就只更新给出的列、不存在就插入；
   * 没有主键就插入并取回自增主键。先查再改而不是 upsert：INSERT … ON CONFLICT 会先校验新行的 NOT NULL，只给部分列时即使行已存在也会失败
   */
  private async upsert(entity: Entity, values: Row, before: Row | undefined): Promise<Row> {
    const pk = entity.primaryKey;
    if (pk.length === 0) throw new Error(`save needs a primary key on ${entity.table}`);
    if (before) {
      await this.db
        .update(entity)
        .changes(before as never, values as never)
        .execute();
      return { ...before, ...flattenRow(entity, values) };
    }
    const flat = flattenRow(entity, values);
    if (hasKey(flat, pk)) {
      const byKey = (r: any) => pk.map((k) => (r[k] as Expr<unknown>).eq(flat[k] as never));
      const exists = (await this.db.queryable(entity).where(byKey).count()) > 0;
      if (!exists)
        await this.db
          .insert(entity)
          .values(values as never)
          .execute();
      else {
        const changes = Object.fromEntries(
          Object.entries(values).filter(([p, v]) => !pk.includes(p) && v !== undefined),
        );
        if (Object.keys(changes).length > 0)
          await this.db
            .update(entity)
            .set(changes as never)
            .where(byKey)
            .execute();
      }
      return flat;
    }
    if (pk.length > 1)
      throw new Error(`save: composite primary key of ${entity.table} must be given completely`);
    const id = await this.db
      .insert(entity)
      .values(values as never)
      .returnId();
    return { ...flat, [pk[0]!]: id };
  }

  /** include 里的导航：名字、关系、选项 */
  private navigations(key: string, include: Include): [string, Relation, NodeOptions][] {
    const relations = this.relations(key);
    return Object.entries(include).map(([name, option]) => {
      const rel = relations[name];
      if (!rel || rel.kind === 'computed')
        throw new Error(`save: '${name}' is not a navigation of ${this.entity(key).name}`);
      if (
        (rel.kind === 'many' && (rel.hops || rel.on)) ||
        (rel.kind === 'one' && (rel.path || rel.on))
      )
        throw new Error(
          `save: '${name}' of ${this.entity(key).name} is a path / on relation and cannot be saved`,
        );
      return [name, rel, option === true ? {} : option];
    });
  }

  /** 多对一：外键在本表（to 是目标的主键）；否则是一对一、外键在对方。两边都是主键（共享主键的一对一）时目标是从属的一方 */
  private foreignKeyOnSelf(key: string, rel: One): boolean {
    const isKey = (columns: readonly string[], pk: readonly string[]) =>
      pk.length === columns.length && columns.every((c) => pk.includes(c));
    return (
      isKey(rel.to, this.entity(rel.target).primaryKey) &&
      !isKey(rel.from, this.entity(key).primaryKey)
    );
  }

  private entity(key: string): Entity {
    return this.schema.entities[key]!;
  }

  private relations(key: string): Readonly<Record<string, Member>> {
    return this.schema.relations[key] ?? {};
  }
}

interface NodeOptions {
  readonly include?: Include;
  readonly removed?: RemovedPolicy;
  readonly key?: string;
}

function hasKey(row: Row, pk: readonly string[]): boolean {
  return pk.length > 0 && pk.every((k) => row[k] !== undefined && row[k] !== null);
}

function keyText(row: Row, pk: readonly string[]): string {
  return pk.map((k) => String(row[k])).join('\u0001');
}

/** 这几列（键）等于 rows 里的某一行：单列用 IN，多列写成几组 AND 的 OR */
function keyIn(ref: any, columns: readonly string[], rows: readonly Row[]): Cond {
  if (columns.length === 1)
    return (ref[columns[0]!] as Expr<unknown>).in(rows.map((r) => r[columns[0]!]) as never);
  return or(
    ...rows.map((r) => and(...columns.map((c) => (ref[c] as Expr<unknown>).eq(r[c] as never)))),
  );
}
