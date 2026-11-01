/** 文档站的组件库配置：浏览器入口（main.ts）与服务端渲染入口（entry-server.ts）共用，两边渲染出同样的东西 */
import { createUi, type UiPlugin } from '@zerodep-dev/vue-tsx-pro-ui';
import { createPinyinMatcher } from '@zerodep-dev/vue-tsx-pro-ui/pinyin';
import { createShikiHighlighter } from '@zerodep-dev/vue-tsx-pro-ui/shiki';
import { vueRouterAdapter } from '@zerodep-dev/vue-tsx-pro-ui/vue-router';
import type { Router } from 'vue-router';
import { preference } from './theme';

/** 创建文档站的 createUi 插件 */
export function createDocsUi(router: Router): UiPlugin {
  return createUi({
    theme: () => preference.theme,
    // 整页由主题管理：页面边缘、回弹滚动露出的地方也是主题的底色与字体
    paintDocument: true,
    // 只加载文档里用到的语言
    highlighter: createShikiHighlighter({
      languages: {
        ts: () => import('@shikijs/langs/typescript'),
        sql: () => import('@shikijs/langs/sql'),
        json: () => import('@shikijs/langs/json'),
        bash: () => import('@shikijs/langs/shellscript'),
      },
    }),
    // 站内搜索认拼音
    textMatcher: createPinyinMatcher(),
    router: vueRouterAdapter(router),
  });
}
