/**
 * 文档站的示例在实库上跑：构建时只在 SQLite、PGlite 上真的执行（apps/docs/build/render-examples.ts），
 * 别的方言只回放出 SQL、没连过库。共用套件拿每种方言的连接把全部示例执行一遍，文档里的写法在哪种库上不能用就在这里报出来。
 *
 * 只看能不能执行，不比结果：没有 ORDER BY 的行序、小数与日期的读法各库本来就不一样。
 * 方言明确报“不支持”的写法不算失败（文档卡片上就是这么写的），发到库里才出错的算。
 */
import { globSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createDb, type Adapter, type Statement } from '@zerodep-dev/easy-query-ts';
import type { DialectOnly, ExampleBuild } from '../../../apps/docs/src/site/example.ts';
import { interceptors, schema, seed } from '../../../apps/docs/src/site/model.ts';

const DOCS = join(dirname(fileURLToPath(import.meta.url)), '../../../apps/docs');

/** 写明了方言的示例只在那种库上跑：标签 → Dialect.name */
const ONLY: Record<DialectOnly, string> = {
  pg: 'postgres',
  mysql: 'mysql',
  mssql: 'sqlserver',
  hana: 'hana',
};

interface DeclaredExample {
  readonly build: ExampleBuild;
  readonly only?: DialectOnly;
}

/** 全部示例：`页面文件#示例名` → 示例 */
async function examples(): Promise<Map<string, DeclaredExample>> {
  const found = new Map<string, DeclaredExample>();
  for (const path of globSync('src/**/*.examples.ts', { cwd: DOCS }).sort()) {
    const module = (await import(pathToFileURL(join(DOCS, path)).href)) as Record<string, unknown>;
    for (const [name, value] of Object.entries(module)) {
      const declared = value as DeclaredExample | undefined;
      if (typeof declared?.build === 'function')
        found.set(`${path.split('\\').join('/')}#${name}`, declared);
    }
  }
  return found;
}

/** 文档写明要先在库里做好的事（实体声明表达不了的）：哪些示例要它、在哪种库上、执行哪些语句 */
interface Prerequisite {
  readonly dialect: string;
  readonly needs: (key: string) => boolean;
  readonly statements: readonly string[];
}

/**
 * 只在要它的示例之前做（建全文索引慢，每次重放数据后都建，几百段示例就跑不完）；重放数据后要重新做。
 * MySQL 的 MATCH 要有列完全一致的 FULLTEXT 索引，中文要 ngram 解析器（见“方言函数”一页）
 */
const PREREQUISITES: readonly Prerequisite[] = [
  {
    dialect: 'mysql',
    needs: (key) => key.startsWith('src/pages/func/vendor.examples.ts#mysql'),
    statements: [
      'CREATE FULLTEXT INDEX ft_docs_post_title ON t_post (title) WITH PARSER ngram',
      'CREATE FULLTEXT INDEX ft_docs_profile_bio ON t_profile (bio, website) WITH PARSER ngram',
    ],
  },
  {
    // 表的 DDL 时间按秒记：刚重建完表、同一秒里开只读事务去读，报 ORA-01466（表定义已改变）
    dialect: 'oracle',
    needs: (key) => key === 'src/pages/write/write.examples.ts#readOnly',
    statements: ['BEGIN DBMS_SESSION.SLEEP(1.5); END;'],
  },
];

/** 把一组示例标成同一个原因 */
const because = (reason: string, ...keys: string[]) =>
  Object.fromEntries(keys.map((key) => [key, reason]));

const RAW = 'src/pages/query/raw.examples.ts#';
/** 原生 SQL 里不加引号的名字：Oracle、达梦、HANA、Db2 按大写找，createTables 建的是小写（“原生 SQL”一页写了） */
const UPPER_CASE_NAMES = because(
  '原生 SQL：名字没加引号（这个库按大写找），或者用了别的库的写法（LIMIT、CREATE TABLE … AS）',
  `${RAW}rawStatement`,
  `${RAW}rawArray`,
  `${RAW}rawIdent`,
  `${RAW}rawExecute`,
  `${RAW}rawInTransaction`,
  'src/pages/rules/rules.examples.ts#encryptedRaw',
  'src/pages/scale/scale.examples.ts#mapTableRun',
);
/** 分组键带参数（“分组”一页写了）：参数没法在 SELECT 与 GROUP BY 之间共用的库 */
const GROUP_KEY_PARAMS = because(
  '分组键带参数，这个库认不出 SELECT 与 GROUP BY 里是同一个表达式',
  'src/pages/func/functions.examples.ts#caseInAggregate',
  'src/pages/query/advanced.examples.ts#caseInGroup',
  'src/pages/query/extras.examples.ts#computedInGroup',
);

/**
 * 已知在某种库上跑不了的文档示例：方言名 → `页面文件#示例名` → 原因。都是文档里写明的限制；
 * 修好了要从这里删掉（用例会把不再失败的列出来）
 */
export const KNOWN_DOCS_FAILURES: Record<string, Record<string, string>> = {
  sqlserver: {
    ...because(
      '原生 SQL 是别的库的写法（LIMIT、CREATE TABLE … AS SELECT）',
      'src/pages/rules/rules.examples.ts#encryptedRaw',
      'src/pages/scale/scale.examples.ts#mapTableRun',
    ),
    ...because(
      '镜像里的 SQL Server 没装全文检索组件',
      'src/pages/func/vendor.examples.ts#mssqlContains',
      'src/pages/func/vendor.examples.ts#mssqlFreetext',
      'src/pages/func/vendor.examples.ts#mssqlInSelect',
    ),
  },
  hana: {
    ...UPPER_CASE_NAMES,
    ...GROUP_KEY_PARAMS,
    ...because(
      'at(i) 是带 TOP 的关联子查询，HANA 不允许（“对多导航”一页写了）',
      'src/pages/navigate/navigate.examples.ts#nthChild',
      'src/pages/navigate/navigate.examples.ts#nthInWhere',
    ),
    ...because(
      '原生 SQL 用了 % 取余，HANA 要写 MOD()',
      `${RAW}fragmentWhere`,
      'src/pages/query/join.examples.ts#rawAlias',
    ),
  },
  dameng: { ...UPPER_CASE_NAMES, ...GROUP_KEY_PARAMS },
  db2: { ...UPPER_CASE_NAMES, ...GROUP_KEY_PARAMS },
  oracle: {
    ...UPPER_CASE_NAMES,
    ...GROUP_KEY_PARAMS,
    ...because(
      '原生 SQL 用了 % 取余，Oracle 要写 MOD()',
      `${RAW}fragmentWhere`,
      'src/pages/query/join.examples.ts#rawAlias',
    ),
  },
};

/**
 * 方言明确不支持的写法：方言在发出语句之前就报 “… not supported by …”，文档卡片在这种方言下显示的也是这句话。
 * 这是写进文档的限制，不是示例的问题
 */
const isDeclaredUnsupported = (message: string) => /\bnot supported by\b/.test(message);

/** 只读的语句不弄脏示例数据；别的（写入、建表、加锁）执行过就重新放一遍数据 */
const readsOnly = (statements: readonly Statement[]) =>
  statements.every((s) => /^\s*(SELECT|WITH)\b/i.test(s.sql));

/**
 * 在这个连接上执行全部示例，返回执行了几段与失败的（`页面文件#示例名` → 错误消息）。
 * 表建在当前 schema 里，表名与共用套件的部分表相同：调用前把套件的表删掉，返回前删掉示例的表
 */
export async function runDocsExamples(
  adapter: Adapter,
): Promise<{ ran: number; failures: Map<string, string> }> {
  const setup = createDb({ schema, adapter });
  const pending = PREREQUISITES.filter((p) => p.dialect === adapter.dialect.name);
  /** 这一份数据上已经做过的前置条件 */
  const done = new Set<Prerequisite>();
  const reseed = async () => {
    await setup.dropTables();
    await setup.createTables();
    await seed(setup);
    done.clear();
  };
  const prepare = async (key: string) => {
    for (const prerequisite of pending) {
      if (done.has(prerequisite) || !prerequisite.needs(key)) continue;
      for (const statement of prerequisite.statements) await adapter.driver.execute(statement, []);
      done.add(prerequisite);
    }
  };
  const failures = new Map<string, string>();
  let ran = 0;
  try {
    await reseed();
    for (const [key, { build, only }] of await examples()) {
      if (only && ONLY[only] !== adapter.dialect.name) continue;
      ran++;
      await prepare(key);
      const statements: Statement[] = [];
      const db = createDb({ schema, interceptors, adapter, log: (s) => statements.push(s) });
      try {
        await build(db);
        if (readsOnly(statements)) continue;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (!isDeclaredUnsupported(message)) failures.set(key, message);
        // 失败的那条语句不在 log 里，可能已经改了一半：一律重放数据
      }
      await reseed();
    }
  } finally {
    await setup.dropTables();
  }
  return { ran, failures };
}
