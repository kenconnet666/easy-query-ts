/**
 * 构建时预渲染：客户端构建（dist/）与服务端构建（dist-ssr/）之后运行，按首页与导航里的每一页
 * 调用 src/entry-server.ts 的 render，把正文、页面标题、<html> 与 <body> 的属性、正文用到的样式写进 dist/<地址>.html。
 * 原来的入口页存成 dist/spa.html：没有预渲染的地址（找不到的页面）回到它，由浏览器渲染，
 * 不会拿首页的 HTML 去水合别的页面。
 *
 * 用法：node build/prerender.ts（pnpm build 的最后一步）
 */
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const dist = join(here, '../dist');
const serverBuild = join(here, '../dist-ssr');

interface Rendered {
  body: string;
  /** Teleport 到 body 的内容，放在 body 的末尾 */
  teleports: string;
  title: string | undefined;
  attrs: { html: Record<string, string>; body: Record<string, string> };
  styles: string;
  /** 换主题类的防闪烁脚本：要在模板里写底色的那段之后执行 */
  themeBootScript: string;
}
interface ServerEntry {
  render(url: string): Promise<Rendered>;
  prerenderPaths(): string[];
}

const entry = (await import(
  pathToFileURL(join(serverBuild, 'entry-server.js')).href
)) as ServerEntry;
const template = readFileSync(join(dist, 'index.html'), 'utf8');
writeFileSync(join(dist, 'spa.html'), template);

const escape = (value: string) =>
  value.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;');
const attributes = (record: Record<string, string>) =>
  Object.entries(record)
    .map(([name, value]) => ` ${name}="${escape(value)}"`)
    .join('');

/**
 * 把一页的渲染结果填进入口页的模板。替换一律用函数：页面内容里的 $'、$& 之类在字符串替换里是替换模式，
 * 会把模板的别处拼进页面（例如示例代码里的正则 'v[0-9]$'），服务端输出与客户端对不上
 */
function page({ body, teleports, title, attrs, styles, themeBootScript }: Rendered): string {
  const html = { lang: 'zh-CN', ...attrs.html };
  return (
    template
      .replace(/<html[^>]*>/, () => `<html${attributes(html)}>`)
      .replace('<head>', () => `<head>\n    ${styles}`)
      .replace('</head>', () => `<script>${themeBootScript}</script>\n  </head>`)
      .replace(
        /<title>[^<]*<\/title>/,
        () => `<title>${escape(title ? `${title} · easy-query-ts` : 'easy-query-ts')}</title>`,
      )
      // Teleport 到 body 的内容紧挨着 <body> 放在最前：Vue 水合时从 body 的第一个子节点开始找它（中间不能有空白文字）
      .replace(
        /<body>\s*<div id="app"><\/div>/,
        () => `<body${attributes(attrs.body)}>${teleports}<div id="app">${body}</div>`,
      )
  );
}

let count = 0;
for (const path of entry.prerenderPaths()) {
  const rendered = await entry.render(path);
  // 写成 <地址>.html 而不是 <地址>/index.html：后者要带斜杠访问，浏览器里的路由地址就和服务端渲染时差一个斜杠
  const file = path === '/' ? join(dist, 'index.html') : join(dist, `${path}.html`);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, page(rendered));
  count++;
}
rmSync(serverBuild, { recursive: true, force: true });
console.log(`预渲染了 ${count} 页`);
// 服务端包里的模块会留下定时器、监听（加载条、主题偏好等浏览器里常驻的东西），进程不会自己退出
process.exit(0);
