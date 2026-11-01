/**
 * 文档里的一段可运行示例。写在 `*.examples.ts` 里，全站共用 model.ts 的业务模型：
 *
 *   export const adults = example((db) => db.queryable(User).where((u) => u.age.ge(18)).toList());
 *
 * 页面 import 拿到的不是这个函数，是 build/examples.ts 构建时算好的结果：卡片上的代码、每种方言的 SQL、示例数据上的结果。
 * 函数本身留在 `?live` 模块里，点“运行”时才下载，连同 ORM 与 WASM 数据库在浏览器里真的执行一遍。
 */
import type { Db } from '@zerodep-dev/easy-query-ts';
import type { schema } from './model.ts';

/** 示例拿到的 db：全站共用的模型 */
export type DocsDb = Db<typeof schema>;

/** 写示例的函数：用 db 查询或写入，返回值显示成结果 */
export type ExampleBuild = (db: DocsDb) => unknown;

/** 一条语句：格式化过的 SQL 与写成文字的参数 */
export interface RenderedStatement {
  readonly sql: string;
  readonly params: string;
}

/** 一种方言下的渲染结果：语句，或这个方言不支持时的说明 */
export interface DialectRendering {
  readonly statements: readonly RenderedStatement[];
  readonly error?: string;
}

/** 构建时算好的示例 */
export interface Example {
  /** 卡片上显示的代码：函数体 */
  readonly code: string;
  /** 去掉类型的代码：带到演练场，按 JS 执行 */
  readonly js: string;
  /** 方言 → 这段代码在该方言下发出的语句 */
  readonly dialects: Readonly<Record<string, DialectRendering>>;
  /** 在示例数据上的结果（JSON 文字）；没有返回值时为空 */
  readonly result?: string;
  /** 加载示例函数：点“运行”时才下载 */
  readonly load: () => Promise<ExampleBuild>;
}

/** 声明一段示例。类型上返回构建好的 Example；运行时只把函数留给构建脚本与 `?live` 模块 */
export function example(build: ExampleBuild): Example {
  return { build } as unknown as Example;
}
