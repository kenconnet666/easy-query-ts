/**
 * 代码卡片能切换的方言与当前选中的方言（全站共用，切一处全部跟着变，记在浏览器里）。
 * 有 live 的方言有 WASM 版本，能在浏览器里真实运行；其余只显示构建时渲染的 SQL。标签与 build/render-examples.ts 一致
 */
import { shallowRef, watch } from 'vue';

/** 能在浏览器里运行的引擎 */
export type LiveEngine = 'pglite' | 'sqlite';

/** 一种方言 */
export interface DialectInfo {
  readonly id: string;
  readonly label: string;
  readonly live?: LiveEngine;
}

export const dialects: readonly DialectInfo[] = [
  { id: 'pg', label: 'PostgreSQL', live: 'pglite' },
  { id: 'sqlite', label: 'SQLite', live: 'sqlite' },
  { id: 'mysql', label: 'MySQL' },
  { id: 'mariadb', label: 'MariaDB' },
  { id: 'mssql', label: 'SQL Server' },
  { id: 'oracle', label: 'Oracle' },
  { id: 'dameng', label: '达梦' },
  { id: 'db2', label: 'Db2' },
  { id: 'hana', label: 'SAP HANA' },
  { id: 'clickhouse', label: 'ClickHouse' },
  { id: 'duckdb', label: 'DuckDB' },
];

const STORAGE_KEY = 'easy-query-ts-dialect';

/** 当前方言，默认 PostgreSQL。服务端渲染与水合都用默认值，挂载后才读记住的（见 restoreDialect） */
export const currentDialect = shallowRef<string | null>('pg');

/** 挂载之后换成访客记住的方言并开始记录：放在水合之前读，预渲染的 HTML 就对不上了 */
export function restoreDialect(): void {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved && dialects.some((dialect) => dialect.id === saved)) currentDialect.value = saved;
  } catch {
    // 隐私模式等读不了存储：用默认的
  }
  watch(currentDialect, (id) => {
    try {
      if (id) localStorage.setItem(STORAGE_KEY, id);
    } catch {
      // 记不住就算了
    }
  });
}

/** 按 id 取方言 */
export function dialectInfo(id: string | null): DialectInfo {
  return dialects.find((dialect) => dialect.id === id) ?? dialects[0]!;
}
