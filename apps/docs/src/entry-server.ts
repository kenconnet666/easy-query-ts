/**
 * 文档站的服务端渲染入口：构建时预渲染每一页（build/prerender.ts 调用）。
 * 与浏览器入口用同一套路由、组件库配置（site/ui.ts），渲染结果交给浏览器水合
 */
import { renderStyleTag } from '@zerodep-dev/vue-tsx-pro-tsx/styles';
import { builtinThemes } from '@zerodep-dev/vue-tsx-pro-ui';
import { createSSRApp } from 'vue';
import { renderToString } from 'vue/server-renderer';
import { createMemoryHistory } from 'vue-router';
import { App } from './App';
import { createDocsRouter } from './router';
import { allPages } from './site/nav';
import { createDocsUi } from './site/ui';

/** 要预渲染的地址：首页与导航里的每一页 */
export const prerenderPaths = (): string[] => ['/', ...allPages.map((page) => page.path)];

/**
 * 渲染一个地址：正文、Teleport 到 body 的内容、页面标题、<html> 与 <body> 的属性、用到的样式、
 * 换主题类的防闪烁脚本（底色那段由 vite.config.ts 写进模板）
 */
export async function render(url: string) {
  const router = createDocsRouter(createMemoryHistory(import.meta.env.BASE_URL));
  const ui = createDocsUi(router);
  const app = createSSRApp(App).use(router).use(ui);
  await router.push(url);
  await router.isReady();
  const context: { teleports?: Record<string, string> } = {};
  const body = await renderToString(app, context);
  const teleports = context.teleports?.['body'] ?? '';
  const attrs = ui.documentAttrs();
  const title = router.currentRoute.value.meta['title'] as string | undefined;
  const page = `<html class="${attrs.html.class ?? ''}"><body class="${attrs.body.class ?? ''}">${body}${teleports}</body></html>`;
  const themeBoot = ui.themeClassBoot(builtinThemes);
  return {
    body,
    teleports,
    title,
    attrs,
    styles: renderStyleTag(page, { include: themeBoot.classes }),
    themeBootScript: themeBoot.script,
  };
}
