import { existsSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import { defineConfig, type Plugin } from 'vite';
import { vueTsxPro } from '@zerodep-dev/vue-tsx-pro-tsx/vite';
import { builtinThemeBootColors, themeBootScript } from '@zerodep-dev/vue-tsx-pro-ui/theme-boot';
import { examples } from './build/examples.ts';

/** 应用加载前按记住的主题设好页面底色，不先闪一下亮色 */
function themeBoot(): Plugin {
  return {
    name: 'docs:theme-boot',
    transformIndexHtml: () => [
      {
        tag: 'script',
        children: themeBootScript({ themes: builtinThemeBootColors }),
        injectTo: 'head-prepend',
      },
    ],
  };
}

/**
 * 预览（vite preview）与线上一致：没有预渲染的地址（找不到的页面）回到 spa.html 由浏览器渲染。
 * vite preview 默认回到 index.html，那是预渲染的首页，拿它去水合别的页面处处对不上
 */
function spaFallback(): Plugin {
  return {
    name: 'docs:spa-fallback',
    configurePreviewServer(server) {
      const dist = resolve(server.config.root, server.config.build.outDir);
      server.middlewares.use((request, _response, next) => {
        const path = decodeURIComponent((request.url ?? '/').split('?')[0]!);
        if (path !== '/' && !extname(path) && !existsSync(join(dist, `${path}.html`))) {
          request.url = '/spa.html';
        }
        next();
      });
    },
  };
}

// 仓库内的 ORM 包按源码解析：改了实现，示例里的 SQL 跟着变，不用先构建
const conditions = ['@easy-query-ts/source'];

export default defineConfig({
  // 水合检查（test/site.mjs）要看到具体哪里不一致时，构建时打开
  define: process.env.EQTS_HYDRATION_DETAILS
    ? { __VUE_PROD_HYDRATION_MISMATCH_DETAILS__: 'true' }
    : {},
  plugins: [examples(), ...vueTsxPro(), themeBoot(), spaFallback()],
  resolve: { conditions: [...conditions, 'module', 'browser', 'development|production'] },
  ssr: { resolve: { conditions: [...conditions, 'module', 'node', 'development|production'] } },
  server: { port: 5175, strictPort: true },
  optimizeDeps: {
    include: [
      '@shikijs/langs/typescript',
      '@shikijs/langs/sql',
      '@shikijs/langs/json',
      '@shikijs/langs/shellscript',
    ],
    // 这两个 WASM 数据库按自己的相对路径找 .wasm 文件，预构建后路径就不对了
    exclude: ['@electric-sql/pglite', '@sqlite.org/sqlite-wasm'],
  },
  build: {
    chunkSizeWarningLimit: 1000,
    rolldownOptions: { experimental: { lazyBarrel: true } },
  },
});
