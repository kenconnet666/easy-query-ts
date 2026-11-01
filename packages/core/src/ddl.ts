/**
 * 代码优先的建表与同步（对应 Java 版的 code-first：createTableCommand、syncTableCommand）。
 * 这里是与库无关的部分：库里结构的模型（各方言的 introspect 读出来）、schema 声明的外键、建表语句的顺序、
 * 实体与库的比较。比较只做"安全"的事——建缺的表、加缺的列、按 renamedFrom 改名、建缺的索引与外键；
 * 类型、可空、默认值、注释不一致和多出来的列只列出来，由人决定怎么迁移（与官方 syncTableCommand 一致，永不删表删列）。
 */
import type { Dialect } from './dialect.ts';
import type { AnySchema, ReferentialAction } from './relations.ts';
import type { Entity } from './schema.ts';

/** 库里的一列 */
export interface DbColumn {
  readonly name: string;
  /** 库里的类型原文（如 'varchar(255)'、'character varying(255)'、'INTEGER'） */
  readonly type: string;
  readonly nullable: boolean;
  /** DEFAULT 表达式原文；没有时 null */
  readonly default: string | null;
  readonly comment: string | null;
  /** 自增 / 标识列 */
  readonly generated: boolean;
}

/** 库里的一个索引（不含主键） */
export interface DbIndex {
  readonly name: string;
  readonly columns: readonly string[];
  readonly unique: boolean;
}

/** 库里的一个外键 */
export interface DbForeignKey {
  readonly name: string;
  readonly columns: readonly string[];
  readonly references: string;
  readonly referencedColumns: readonly string[];
}

/** 库里的一张表（当前 schema） */
export interface DbTable {
  readonly name: string;
  readonly comment: string | null;
  readonly columns: readonly DbColumn[];
  readonly primaryKey: readonly string[];
  readonly indexes: readonly DbIndex[];
  readonly foreignKeys: readonly DbForeignKey[];
}

/** 读库的查询：方言的 introspect 用它执行系统表上的查询 */
export type QueryRunner = (
  sql: string,
  params?: readonly unknown[],
) => Promise<Record<string, unknown>[]>;

/** 一个要建的外键（列都是库里的名字） */
export interface ForeignKeySpec {
  readonly name: string;
  readonly table: string;
  readonly columns: readonly string[];
  readonly references: string;
  readonly referencedColumns: readonly string[];
  readonly onDelete?: ReferentialAction | undefined;
  readonly onUpdate?: ReferentialAction | undefined;
}

/** schema 里实体 key 的多对一导航上声明的外键 */
export function foreignKeysOf(schema: AnySchema, key: string): ForeignKeySpec[] {
  const entity = schema.entities[key]!;
  const out: ForeignKeySpec[] = [];
  for (const rel of Object.values(schema.relations[key] ?? {})) {
    if (rel.kind !== 'one' || !rel.foreignKey) continue;
    const target = schema.entities[rel.target]!;
    const columns = rel.from.map((c) => entity.columnNames[c]!);
    out.push({
      name: rel.foreignKey.name ?? `fk_${bareName(entity.table)}_${columns.join('_')}`,
      table: entity.table,
      columns,
      references: target.table,
      referencedColumns: rel.to.map((c) => target.columnNames[c]!),
      onDelete: rel.foreignKey.onDelete,
      onUpdate: rel.foreignKey.onUpdate,
    });
  }
  return out;
}

/** 建这些表的全部语句：先建表（含列注释），再表注释、索引，最后外键（要等被引用的表建好；SQLite 写进建表语句） */
export function createStatements(
  dialect: Dialect,
  schema: AnySchema,
  entities: readonly Entity[],
  ifNotExists: boolean,
  /** 连同列用到的自定义类型（PG 枚举）一起建；planSync 自己按库里已有的类型算，传 false */
  withTypes = true,
): string[] {
  const keyOf = (entity: Entity) =>
    Object.keys(schema.entities).find((k) => schema.entities[k] === entity);
  const fks = new Map(entities.map((e) => [e, keyOf(e) ? foreignKeysOf(schema, keyOf(e)!) : []]));
  const out = withTypes ? dialect.typeStatements(entities).statements : [];
  for (const e of entities)
    out.push(dialect.createTable(e, ifNotExists, dialect.inlineForeignKeys ? fks.get(e)! : []));
  for (const e of entities) {
    out.push(...dialect.commentStatements(e));
    for (const index of e.indexes ?? []) out.push(dialect.createIndex(e.table, index, ifNotExists));
  }
  if (!dialect.inlineForeignKeys)
    for (const e of entities) for (const fk of fks.get(e)!) out.push(dialect.addForeignKey(fk));
  return out;
}

/** 实体与库的比较结果：要执行的语句（只增不删）与不自动处理的差异 */
export interface SyncPlan {
  readonly statements: readonly string[];
  /** 不会自动改的差异（类型、可空、默认值、注释、库里多出来的列等），每条一句话 */
  readonly differences: readonly string[];
}

/** 比较实体与库里的表，得出同步计划 */
export function planSync(
  dialect: Dialect,
  schema: AnySchema,
  entities: readonly Entity[],
  tables: readonly DbTable[],
  /** 库里已有的自定义类型（Dialect.introspectTypes） */
  types: ReadonlyMap<string, readonly string[]> = new Map(),
): SyncPlan {
  // 类型排在最前面：新表、新列可能用到它
  const { statements: typeStatements, differences } = dialect.typeStatements(entities, types);
  const statements: string[] = [];
  const created: Entity[] = [];
  for (const entity of entities) {
    let table = findTable(tables, entity.table);
    if (!table && entity.renamedFrom) {
      table = findTable(tables, entity.renamedFrom);
      if (table) statements.push(dialect.renameTable(entity.renamedFrom, entity.table));
    }
    if (!table) {
      created.push(entity);
      continue;
    }
    diffTable(dialect, schema, entity, table, statements, differences);
  }
  // 新表一起建：外键排在所有建表之后
  return {
    statements: [
      ...typeStatements,
      ...createStatements(dialect, schema, created, false, false),
      ...statements,
    ],
    differences,
  };
}

function diffTable(
  dialect: Dialect,
  schema: AnySchema,
  entity: Entity,
  table: DbTable,
  statements: string[],
  differences: string[],
): void {
  const where = entity.table;
  const columnOf = (name: string) =>
    table.columns.find((c) => c.name === name) ??
    table.columns.find((c) => c.name.toLowerCase() === name.toLowerCase());
  const declared = new Set<string>();
  for (const [prop, column] of Object.entries(entity.columns)) {
    const name = entity.columnNames[prop]!;
    declared.add(name.toLowerCase());
    let existing = columnOf(name);
    const old = column.options.renamedFrom;
    if (!existing && old && columnOf(old)) {
      statements.push(dialect.renameColumn(entity.table, old, name));
      declared.add(old.toLowerCase());
      existing = columnOf(old);
    }
    if (!existing) {
      statements.push(dialect.addColumn(entity.table, name, column.codec.kind, column.options));
      if (column.options.unique)
        statements.push(
          dialect.createIndex(
            entity.table,
            { name: `${bareName(entity.table)}_${name}_uidx`, columns: [name], unique: true },
            false,
          ),
        );
      continue;
    }
    const type = dialect.columnType(column.codec.kind, column.options);
    if (!column.options.generated && !dialect.sameType(type, existing.type))
      differences.push(`${where}.${name}: type is ${existing.type}, declared ${type}`);
    if (!column.options.primaryKey && existing.nullable !== column.options.nullable)
      differences.push(
        `${where}.${name}: ${existing.nullable ? 'nullable' : 'NOT NULL'} in the database, declared ${column.options.nullable ? 'nullable' : 'NOT NULL'}`,
      );
    if (
      dialect.commentStyle !== 'none' &&
      (column.options.comment ?? null) !== (existing.comment || null)
    )
      differences.push(`${where}.${name}: comment differs`);
  }
  for (const column of table.columns)
    if (!declared.has(column.name.toLowerCase()))
      differences.push(`${where}.${column.name}: in the database but not in the entity`);
  if (dialect.commentStyle !== 'none' && (entity.comment ?? null) !== (table.comment || null))
    differences.push(`${where}: table comment differs`);
  const hasIndex = (name: string) =>
    table.indexes.some((i) => i.name.toLowerCase() === name.toLowerCase());
  for (const index of entity.indexes ?? [])
    if (!hasIndex(index.name)) statements.push(dialect.createIndex(entity.table, index, false));
  const key = Object.keys(schema.entities).find((k) => schema.entities[k] === entity);
  for (const fk of key ? foreignKeysOf(schema, key) : []) {
    const exists = table.foreignKeys.some(
      (f) => f.name.toLowerCase() === fk.name.toLowerCase() || sameList(f.columns, fk.columns),
    );
    if (exists) continue;
    if (dialect.inlineForeignKeys)
      differences.push(
        `${where}: foreign key ${fk.name} is missing; ${dialect.name} cannot add one to an existing table`,
      );
    else statements.push(dialect.addForeignKey(fk));
  }
}

function sameList(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((x, i) => x.toLowerCase() === b[i]!.toLowerCase());
}

/** 库里叫这个名字的表（去掉 schema 前缀；大小写不同也认，MySQL 在 Windows 上会把表名转成小写） */
export function findTable(tables: readonly DbTable[], name: string): DbTable | undefined {
  const bare = bareName(name);
  return (
    tables.find((t) => t.name === bare) ??
    tables.find((t) => t.name.toLowerCase() === bare.toLowerCase())
  );
}

/** 表名去掉跨库链接与 schema 前缀 */
export function bareName(table: string): string {
  return table.split('@')[0]!.split('.').pop()!;
}

/**
 * 把系统表查出来的几张平铺的结果拼成 DbTable（MySQL、PG、HANA 共用；列名按约定的别名）：
 * tables(table_name, comment)、columns(table_name, column_name, column_type, is_nullable, column_default, comment, is_generated, primary_key)、
 * indexes(table_name, index_name, is_unique, column_name)、foreignKeys(table_name, constraint_name, column_name, referenced_table, referenced_column)，
 * 各自已按表、位置排好序
 */
export function assembleTables(rows: {
  tables: readonly Record<string, unknown>[];
  columns: readonly Record<string, unknown>[];
  indexes: readonly Record<string, unknown>[];
  foreignKeys: readonly Record<string, unknown>[];
}): DbTable[] {
  const text = (v: unknown) =>
    v === null || v === undefined ? null : String(v as string | number);
  const flag = (v: unknown) =>
    v === true || v === 1 || v === '1' || v === 't' || v === 'YES' || v === 'TRUE' || v === 'true';
  const by = (list: readonly Record<string, unknown>[], name: string) =>
    list.filter((r) => String(r['table_name']) === name);
  return rows.tables.map((t) => {
    const name = String(t['table_name']);
    const columns = by(rows.columns, name);
    const group = (list: readonly Record<string, unknown>[], keyName: string) => {
      const groups = new Map<string, Record<string, unknown>[]>();
      for (const r of list) {
        const k = String(r[keyName]);
        groups.set(k, [...(groups.get(k) ?? []), r]);
      }
      return [...groups];
    };
    return {
      name,
      comment: text(t['comment']),
      columns: columns.map((c) => ({
        name: String(c['column_name']),
        type: String(c['column_type']),
        nullable: flag(c['is_nullable']),
        default: text(c['column_default']),
        comment: text(c['comment']),
        generated: flag(c['is_generated']),
      })),
      primaryKey: columns
        .filter((c) => flag(c['primary_key']))
        .map((c) => String(c['column_name'])),
      indexes: group(by(rows.indexes, name), 'index_name').map(([index, list]) => ({
        name: index,
        columns: list.map((r) => String(r['column_name'])),
        unique: flag(list[0]!['is_unique']),
      })),
      foreignKeys: group(by(rows.foreignKeys, name), 'constraint_name').map(([fk, list]) => ({
        name: fk,
        columns: list.map((r) => String(r['column_name'])),
        references: String(list[0]!['referenced_table']),
        referencedColumns: list.map((r) => String(r['referenced_column'])),
      })),
    };
  });
}
