import { useRouteLoadingBar } from '@zerodep-dev/vue-tsx-pro-ui/vue-router';
import { createApp, createSSRApp } from 'vue';
import { App } from './App';
import { createDocsRouter } from './router';
import { restoreDialect } from './site/dialects';
import { loadingBar } from './site/loading-bar';
import { createDocsUi } from './site/ui';

const router = createDocsRouter();
// 换页要加载页面的代码块：慢的时候顶部有加载条
useRouteLoadingBar(router, loadingBar);

// 构建时预渲染过的页面（build/prerender.ts）接管已有的 HTML；开发服务器与没预渲染的地址照常挂载
const root = document.getElementById('app')!;
const app = (root.hasChildNodes() ? createSSRApp : createApp)(App)
  .use(router)
  .use(createDocsUi(router));

// 水合要等路由解析完，页面的组件到位；水合之后才换成访客记住的方言
void router.isReady().finally(() => {
  app.mount(root);
  restoreDialect();
});
