/**
 * SQL 快照（ROADMAP 18.3.6）：把一组查询按各个方言渲染成稳定的文本，不连库。提交进仓库后，改了查询或升级了库，
 * 评审时直接看 SQL 的差异；CI 里 `eqts snapshot --check` 发现没更新的快照就失败：
 * ```ts
 * // src/queries.snap.ts
 * export default defineSnapshots({
 *   schema,
 *   dialects: { pg: new PostgresDialect(), mysql: new MySqlDialect({ version: '8.4' }) },
 *   queries: {
 *     adults: (db) => db.queryable(User).where((u) => u.age.ge(18)),
 *     renameUser: (db) => db.update(User).set({ name: 'x' }).where((u) => u.id.eq(1)),
 *   },
 * })
 * ```
 * 查询函数拿到的 db 只能渲染（toSQL），执行语句会报错。也可以在单测里 `renderSnapshots(def)` 自己比较
 */
import { createDb, type Db } from './db.ts';
import type { Dialect, Statement } from './dialect.ts';
import type { AnySchema } from './relations.ts';
import type { Driver } from './session.ts';

/** 能渲染出语句的东西：查询（一条）、写入构造器（一条或几条） */
interface Renderable {
  toSQL(): Statement | readonly Statement[];
}

export interface SnapshotDefinition<S extends AnySchema> {
  readonly schema: S;
  /** 标签 → 方言；标签用在快照的文件名里（同一个方言的不同版本给不同的标签） */
  readonly dialects: Readonly<Record<string, Dialect>>;
  /** 名字 → 用 db 构建语句 */
  readonly queries: Readonly<Record<string, (db: Db<S>) => Renderable>>;
}

/** 声明一组快照；原样返回，只为了让 queries 里的 db 有类型 */
export function defineSnapshots<S extends AnySchema>(
  definition: SnapshotDefinition<S>,
): SnapshotDefinition<S> {
  return definition;
}

/** 只渲染不执行的驱动 */
const renderOnly: Driver = {
  query: () => Promise.reject(new Error('snapshot: statements are rendered, not executed')),
  execute: () => Promise.reject(new Error('snapshot: statements are rendered, not executed')),
  transaction: () => Promise.reject(new Error('snapshot: statements are rendered, not executed')),
};

/** 参数写成 JSON；bigint 带 n 后缀，字节写成十六进制 */
function paramsText(params: readonly unknown[]): string {
  return JSON.stringify(params, (_, value: unknown) => {
    if (typeof value === 'bigint') return `${value}n`;
    if (value instanceof Uint8Array)
      return `0x${Array.from(value, (b) => b.toString(16).padStart(2, '0')).join('')}`;
    return value;
  });
}

/**
 * 按方言渲染：标签 → 快照文本（每个查询一段：名字、SQL、参数；渲染时报错的写成 error 一行），查询按名字排序，文本稳定
 */
export function renderSnapshots<S extends AnySchema>(
  definition: SnapshotDefinition<S>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [label, dialect] of Object.entries(definition.dialects)) {
    const db = createDb({ schema: definition.schema, adapter: { dialect, driver: renderOnly } });
    const parts = Object.keys(definition.queries)
      .sort()
      .map((name) => {
        let rendered: Statement | readonly Statement[];
        try {
          rendered = definition.queries[name]!(db as unknown as Db<S>).toSQL();
        } catch (error) {
          // 某个方言不支持的写法也是快照的一部分：报错信息写进去，变了照样能在差异里看到
          return `-- ${name}\n-- error: ${error instanceof Error ? error.message : String(error)}\n`;
        }
        const statements = Array.isArray(rendered) ? rendered : [rendered as Statement];
        const body = statements
          .map((s) => `${s.sql};\n-- params: ${paramsText(s.params)}`)
          .join('\n');
        return `-- ${name}\n${body}\n`;
      });
    out[label] = parts.join('\n');
  }
  return out;
}
