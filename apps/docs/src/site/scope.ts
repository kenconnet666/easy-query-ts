/**
 * 演练场怎么执行一段代码：卡片的“改一改”把示例去掉类型后带过来，这里给它示例能 import 的所有名字。
 * 构建时 build/render-examples.ts 也用它跑一遍每段示例，少了名字当场报错，不用等到有人点“改一改”。
 */
import * as easyQuery from '@zerodep-dev/easy-query-ts';
import { Pg } from '@zerodep-dev/easy-query-ts-pg/pglite';
import type { ExampleBuild } from './example.ts';
import * as model from './model.ts';

/** 模型在后：实体 Order 盖过核心的同名类。方言入口只放能在浏览器里跑的 Pg */
const SCOPE: Readonly<Record<string, unknown>> = { ...easyQuery, ...model, Pg };

const AsyncFunction = (async () => {}).constructor as new (
  ...args: string[]
) => (...values: unknown[]) => Promise<unknown>;

/** source 是函数体，按 JS 执行。多包一层块：示例可以声明和 SCOPE 同名的变量（`const { sql } = ...`） */
export function compileSource(source: string): ExampleBuild {
  const body = new AsyncFunction('db', ...Object.keys(SCOPE), `{\n${source}\n}`);
  return (db) => body(db, ...Object.values(SCOPE));
}
