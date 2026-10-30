/**
 * 由表生成实体（对应 Java 版的 plugin/table2entity）：读库里的表结构（`db.introspect()`），输出 `entity()` 与 `defineSchema` 的源码。
 * 方向与 createTables / syncTables 相反：已有的库（例如从 Java 迁过来的表）不用手写一遍实体。
 *
 * ```ts
 * const source = entitySource(await db.introspect(), { stripPrefix: 't_' })
 * ```
 * 命令行：`eqts pull --adapter ./db-adapter.ts --out src/schema.ts`，见 bin.ts。
 * 生成的实体与库再 planSync 一次是空计划（类型、可空、主键、自增、注释、索引、外键都写进去了）；认不得的类型用 `.dbType('…')` 原样保留。
 */
import type { DbColumn, DbTable } from '@zerodep-dev/easy-query-ts';

export interface EntitySourceOptions {
  /** 只生成这些表（默认全部） */
  readonly tables?: readonly string[];
  /** 实体名去掉的表名前缀，默认 't_'（t_order_item → OrderItem） */
  readonly stripPrefix?: string;
  /** 核心包的导入名，默认 '@zerodep-dev/easy-query-ts' */
  readonly importFrom?: string;
}

/** 生成一个 TS 模块的源码：每张表一个 `export const X = entity(…)`，最后 `export const schema = defineSchema(…)` 带上由外键推出的导航 */
export function entitySource(
  tables: readonly DbTable[],
  options: EntitySourceOptions = {},
): string {
  const prefix = options.stripPrefix ?? 't_';
  const picked = options.tables
    ? tables.filter((t) => options.tables!.some((n) => n.toLowerCase() === t.name.toLowerCase()))
    : tables;
  const names = new Map(picked.map((t) => [t.name, entityName(t.name, prefix)]));
  const lines = [
    '// 由 eqts pull 根据库里的表结构生成；改动表结构后可以重新生成，或改这里再用 db.planSync() 同步回库',
    `import { col, defineSchema, entity } from '${options.importFrom ?? '@zerodep-dev/easy-query-ts'}';`,
    '',
  ];
  for (const table of picked) lines.push(...entityLines(table, names.get(table.name)!), '');
  lines.push(...schemaLines(picked, names));
  return lines.join('\n') + '\n';
}

function entityLines(table: DbTable, name: string): string[] {
  const out: string[] = [];
  if (table.comment) out.push(`/** ${table.comment} */`);
  out.push(`export const ${name} = entity(${quote(table.name)}, {`);
  const props = new Map(table.columns.map((c) => [c.name, propertyName(c.name)]));
  for (const column of table.columns) {
    const prop = props.get(column.name)!;
    const { builder, note } = columnBuilder(column);
    let expr = builder;
    if (table.primaryKey.includes(column.name)) expr += '.primaryKey()';
    if (column.generated) expr += '.generated()';
    else if (column.nullable && !table.primaryKey.includes(column.name)) expr += '.nullable()';
    if (!column.generated && column.default !== null) expr += '.defaulted()';
    if (snakeName(prop) !== column.name) expr += `.named(${quote(column.name)})`;
    if (column.comment) expr += `.comment(${quote(column.comment)})`;
    const trailing = [
      note,
      !column.generated && column.default !== null ? `DEFAULT ${column.default}` : undefined,
    ]
      .filter(Boolean)
      .join('；');
    out.push(`  ${safeKey(prop)}: ${expr},${trailing ? ` // ${trailing}` : ''}`);
  }
  const options: string[] = [];
  if (table.comment) options.push(`comment: ${quote(table.comment)}`);
  if (table.indexes.length > 0) {
    const items = table.indexes.map((i) => {
      const columns = i.columns.map((c) => quote(props.get(c) ?? c)).join(', ');
      return `{ columns: [${columns}]${i.unique ? ', unique: true' : ''}, name: ${quote(i.name)} }`;
    });
    options.push(`indexes: [${items.join(', ')}]`);
  }
  out.push(options.length > 0 ? `}, { ${options.join(', ')} });` : '});');
  return out;
}

function schemaLines(tables: readonly DbTable[], names: ReadonlyMap<string, string>): string[] {
  // 外键 → 多对一导航（本表）与一对多导航（被引用的表）
  const relations = new Map<string, string[]>();
  // 每个实体已用的名字（列与导航）：重名时加序号
  const used = new Map(
    tables.map((t) => [names.get(t.name)!, new Set(t.columns.map((c) => propertyName(c.name)))]),
  );
  const add = (entity: string, wanted: string, body: string) => {
    const taken = used.get(entity)!;
    let name = wanted;
    for (let n = 2; taken.has(name); n++) name = `${wanted}${n}`;
    taken.add(name);
    relations.set(entity, [...(relations.get(entity) ?? []), `${safeKey(name)}: ${body}`]);
  };
  for (const table of tables) {
    const self = names.get(table.name)!;
    for (const fk of table.foreignKeys) {
      const target = [...names].find(([t]) => t.toLowerCase() === fk.references.toLowerCase())?.[1];
      if (!target) continue;
      const from = fk.columns.map(propertyName);
      const to = fk.referencedColumns.map(propertyName);
      // shelf_id → shelf；复合外键用目标实体名
      const one =
        (fk.columns.length === 1 ? propertyName(fk.columns[0]!.replace(/_?id$/i, '')) : '') ||
        lowerFirst(target);
      add(
        self,
        one,
        `r.one(${quote(target)}, { from: ${list(from)}, to: ${list(to)} }, { foreignKey: { name: ${quote(fk.name)} } })`,
      );
      add(
        target,
        plural(lowerFirst(self)),
        `r.many(${quote(self)}, { from: ${list(to)}, to: ${list(from)} })`,
      );
    }
  }
  const entities = [...names.values()].join(', ');
  if (relations.size === 0) return [`export const schema = defineSchema({ ${entities} });`];
  const out = [`export const schema = defineSchema(`, `  { ${entities} },`, '  {'];
  for (const [entity, lines] of relations) {
    out.push(`    ${entity}: (r) => ({`);
    for (const line of lines) out.push(`      ${line},`);
    out.push('    }),');
  }
  out.push('  },', ');');
  return out;
}

/** 库里的类型 → 列构造器；认不得的保留原类型 */
function columnBuilder(column: DbColumn): { builder: string; note?: string } {
  const raw = column.type.trim();
  const t = raw.toLowerCase();
  const args = /\(([^)]*)\)/
    .exec(t)?.[1]
    ?.split(',')
    // Oracle 的 VARCHAR2(50 CHAR)、Db2 的 VARCHAR(50 CODEUNITS32)：长度后面的单位不算
    .map((s) => Number(s.trim().replace(/\s+(char|byte|codeunits32|codeunits16|octets)$/, '')));
  const base = t
    .replace(/\(.*$/, '')
    .replace(/\s+(unsigned|without time zone)$/, '')
    .trim();
  if (/^(n?varchar|character varying|varchar2|nvarchar2)$/.test(base))
    return { builder: args?.[0] ? `col.string(${args[0]})` : 'col.string()' };
  if (/^(n?char|character|bpchar)$/.test(base))
    return { builder: `col.string(${args?.[0] ?? 1}).dbType(${quote(raw)})` };
  if (/^(text|mediumtext|longtext|tinytext|n?clob)$/.test(base))
    return { builder: `col.string().dbType(${quote(raw)})` };
  if (t === 'tinyint(1)' || /^(boolean|bool|bit)$/.test(base)) return { builder: 'col.boolean()' };
  if (/^(uuid|uniqueidentifier)$/.test(base)) return { builder: 'col.uuid()' };
  // MySQL 的 ENUM('a','b')：取值里的单引号写成两个
  if (base === 'enum') {
    const values = [...raw.matchAll(/'((?:[^']|'')*)'/g)].map((m) => m[1]!.replace(/''/g, "'"));
    return { builder: `col.enum(${JSON.stringify(values)}).native()` };
  }
  // MySQL 的 INT UNSIGNED 等
  const unsigned = /\bunsigned\b/.test(t) ? '.unsigned()' : '';
  if (/^(int|integer|int4|smallint|int2|mediumint|tinyint|serial)$/.test(base))
    return { builder: `col.int()${unsigned}` };
  if (/^(bigint|int8|bigserial)$/.test(base)) return { builder: `col.bigint()${unsigned}` };
  // Oracle 的整数是 NUMBER(p)：按精度分成 int / bigint，再大的按 decimal
  if (base === 'number' && args && (args.length === 1 || args[1] === 0)) {
    const precision = args[0]!;
    if (precision === 1) return { builder: `col.boolean().dbType(${quote(raw)})` };
    if (precision <= 10) return { builder: 'col.int()' };
    if (precision <= 19) return { builder: 'col.bigint()' };
    return { builder: `col.decimal(${precision}, 0)` };
  }
  if (/^(decimal|numeric|number)$/.test(base))
    return {
      builder: args && args.length === 2 ? `col.decimal(${args[0]}, ${args[1]})` : 'col.decimal()',
    };
  if (/^(binary_double|binary_float)$/.test(base)) return { builder: 'col.double()' };
  if (/^(double|double precision|float|float8|real|float4)$/.test(base))
    return { builder: 'col.double()' };
  if (base === 'date') return { builder: 'col.date()' };
  if (base === 'time') return { builder: 'col.time()' };
  if (/^(datetime|timestamp|seconddate)$/.test(base)) return { builder: 'col.datetime()' };
  if (/^(json|jsonb)$/.test(base))
    return { builder: 'col.json<unknown>()', note: '补上 JSON 的类型' };
  // MySQL 的 BINARY(16) 多半是 uuid（col.uuid() 存的就是它），但也可能是别的定长二进制：留给人判断
  if (base === 'binary' && args?.[0] === 16)
    return {
      builder: 'col.bytes().dbType("binary(16)")',
      note: 'BINARY(16) 存的是 uuid 时改成 col.uuid()',
    };
  if (/^(blob|bytea|varbinary|binary|longblob|mediumblob)$/.test(base))
    return { builder: 'col.bytes()' };
  return {
    builder: `col.string().dbType(${quote(raw)})`,
    note: `认不得的类型 ${raw}，先按字符串读写`,
  };
}

/** t_order_item → OrderItem（去掉前缀、schema 前缀） */
function entityName(table: string, prefix: string): string {
  const bare = table.split('.').pop()!;
  const trimmed =
    prefix && bare.toLowerCase().startsWith(prefix.toLowerCase())
      ? bare.slice(prefix.length)
      : bare;
  const name = propertyName(trimmed);
  return name.charAt(0).toUpperCase() + name.slice(1);
}

/** shelf_id → shelfId；全大写的列名（HANA、Oracle）先转小写 */
function propertyName(column: string): string {
  const lower = column === column.toUpperCase() ? column.toLowerCase() : column;
  return lower
    .replace(/[_\s-]+([a-zA-Z0-9])/g, (_, c: string) => c.toUpperCase())
    .replace(/^[_\s-]+/, '');
}

/** 与核心的默认列名规则一致：属性名转下划线 */
function snakeName(prop: string): string {
  return prop.replace(/[A-Z]/g, (c) => '_' + c.toLowerCase());
}

/** 一对多导航名：OrderItem → orderItems；已经是复数（Transfers）就不再加 */
function plural(name: string): string {
  if (/s$/i.test(name)) return name;
  if (/[^aeiou]y$/i.test(name)) return `${name.slice(0, -1)}ies`;
  if (/(x|ch|sh)$/i.test(name)) return `${name}es`;
  return `${name}s`;
}

function lowerFirst(name: string): string {
  return name.charAt(0).toLowerCase() + name.slice(1);
}

function safeKey(key: string): string {
  return /^[A-Za-z_$][\w$]*$/.test(key) ? key : quote(key);
}

function list(items: readonly string[]): string {
  return items.length === 1 ? quote(items[0]!) : `[${items.map(quote).join(', ')}]`;
}

function quote(text: string): string {
  return `'${text.replaceAll('\\', '\\\\').replaceAll("'", "\\'")}'`;
}
