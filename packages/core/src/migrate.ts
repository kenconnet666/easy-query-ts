/**
 * 迁移历史（ROADMAP 18.2.3）：生产环境用有记录、能审查的迁移代替 syncTables。
 * 一条迁移是 `{ id, up }`：up 是 SQL 语句的列表（`eqts migrate generate` 由 planSync 生成，可以手改：改名、拆列、补数据），
 * 或一个拿到 Db 的函数（数据迁移）。`db.migrate(migrations)` 按 id 的顺序执行还没执行过的，记进历史表：
 * ```ts
 * import m1 from './migrations/20261030083000_init.ts'
 * await db.migrate([m1, m2])   // 返回这次执行的 id
 * ```
 * 历史表记着每条迁移的校验和：已经执行过的迁移被改了，migrate 直接报错，免得库与代码对不上
 */
import type { SyncPlan } from './ddl.ts';
import { col, entity } from './schema.ts';

/** 一条迁移 */
export interface Migration {
  /** 唯一、按字典序就是执行顺序（生成时用时间戳开头：20261030083000_add_orders） */
  readonly id: string;
  /** SQL 语句（按顺序执行），或数据迁移的函数 */
  readonly up: readonly string[] | ((db: MigrationDb) => Promise<void>);
}

/** 数据迁移的函数拿到的 Db（与调用 migrate 的 Db 同一个连接与事务） */
export interface MigrationDb {
  readonly sql: {
    <T = Record<string, unknown>>(
      strings: TemplateStringsArray,
      ...values: unknown[]
    ): Promise<T[]>;
    execute: (strings: TemplateStringsArray, ...values: unknown[]) => Promise<number>;
  };
}

/** 声明一条迁移（只做校验，原样返回） */
export function defineMigration(migration: Migration): Migration {
  if (!/^[\w.-]+$/.test(migration.id))
    throw new Error(`migration id '${migration.id}' may only contain letters, digits, _ . -`);
  return migration;
}

/** 历史表 */
export function historyEntity(table: string) {
  return entity(table, {
    id: col.string(200).primaryKey(),
    checksum: col.string(16),
    appliedAt: col.datetime(),
  });
}

/** 迁移内容的校验和（FNV-1a 64 位，十六进制）：语句列表或函数的源码 */
export function checksum(migration: Migration): string {
  const text =
    typeof migration.up === 'function' ? migration.up.toString() : migration.up.join(';\n');
  let hash = 0xcbf29ce484222325n;
  for (const byte of new TextEncoder().encode(text)) {
    hash ^= BigInt(byte);
    hash = (hash * 0x100000001b3n) & 0xffffffffffffffffn;
  }
  return hash.toString(16).padStart(16, '0');
}

/** 迁移按 id 排好；id 重复报错 */
export function ordered(migrations: readonly Migration[]): Migration[] {
  const sorted = [...migrations].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  for (let i = 1; i < sorted.length; i++)
    if (sorted[i]!.id === sorted[i - 1]!.id)
      throw new Error(`migration '${sorted[i]!.id}' is listed twice`);
  return sorted;
}

/**
 * 生成迁移文件的源码（eqts migrate generate 用）：语句写成字符串字面量，不会自动改的差异写成注释
 */
export function migrationSource(
  id: string,
  plan: SyncPlan,
  importFrom = '@zerodep-dev/easy-query-ts',
): string {
  const lines = [
    `// 由 eqts migrate generate 生成；可以手改（改名、拆列、补数据）。已经执行过的迁移不要再改：migrate 会按校验和拒绝`,
    `import { defineMigration } from '${importFrom}';`,
    '',
    'export default defineMigration({',
    `  id: ${JSON.stringify(id)},`,
    '  up: [',
    ...plan.statements.map((s) => `    ${JSON.stringify(s)},`),
    '  ],',
    '});',
  ];
  if (plan.differences.length > 0)
    lines.push(
      '',
      '// 不会自动改的差异（需要的话把对应的语句写进 up）：',
      ...plan.differences.map((d) => `// - ${d}`),
    );
  return lines.join('\n') + '\n';
}
