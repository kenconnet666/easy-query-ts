/**
 * `*.examples.ts` 的加载：页面 import 拿到的是算好的数据（代码、各方言的 SQL、结果），不把 ORM 打进页面；
 * 示例函数留在同一个文件的 `?live` 模块里，点“运行”时才下载。
 *
 * 所有示例由 build/render-examples.ts 在一个子进程里一起算（要加载各方言包），结果缓存到示例或模型改动。
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import type { Plugin } from 'vite';

const run = promisify(execFile);
const script = fileURLToPath(new URL('./render-examples.ts', import.meta.url));

type Rendered = Record<string, Record<string, unknown>>;

/** 改了这些文件要重新算 */
const isSource = (file: string) =>
  /\.examples\.ts$|render-examples\.ts$|[\\/]site[\\/]model\.ts$|[\\/]site[\\/]format-sql\.ts$|[\\/]packages[\\/]\w+[\\/]src[\\/]/.test(
    file,
  );

export function examples(): Plugin {
  let root = process.cwd();
  let rendering: Promise<Rendered> | undefined;

  const render = () => {
    rendering ??= run(process.execPath, ['--conditions=@easy-query-ts/source', script], {
      cwd: root,
      maxBuffer: 256 * 1024 * 1024,
    }).then(({ stdout, stderr }) => {
      if (stderr) console.warn(stderr);
      return JSON.parse(stdout) as Rendered;
    });
    // 失败了不缓存（示例写错、正在编辑）：下一次请求重新算
    rendering.catch(() => {
      rendering = undefined;
    });
    return rendering;
  };

  return {
    name: 'docs:examples',
    enforce: 'pre',
    configResolved(config) {
      root = config.root;
    },
    async load(id) {
      if (!id.endsWith('.examples.ts')) return;
      const key = id.slice(root.split('\\').join('/').length + 1);
      const rendered = (await render())[key];
      if (!rendered) throw new Error(`${key} 没有渲染结果`);
      const live = `const live = () => import(${JSON.stringify(`${id}?live`)});`;
      const exports = Object.entries(rendered).map(
        ([name, value]) =>
          `export const ${name} = { ...${JSON.stringify(value)}, load: () => live().then((module) => module.${name}.build) };`,
      );
      return [live, ...exports].join('\n');
    },
    handleHotUpdate({ file, server }) {
      if (!isSource(file)) return;
      rendering = undefined;
      for (const module of server.moduleGraph.idToModuleMap.values()) {
        if (module.id?.endsWith('.examples.ts')) server.moduleGraph.invalidateModule(module);
      }
      server.ws.send({ type: 'full-reload' });
      return [];
    },
  };
}
