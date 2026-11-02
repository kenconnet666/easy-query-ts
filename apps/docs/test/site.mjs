/**
 * 构建产物上的整站检查：逐页打开预渲染的页面，水合没有不一致，每张代码卡片在两个 WASM 引擎上都真的跑得通。
 * 文档里的示例因此不会和实现脱节，也会替 ORM 多测一遍 PGlite 与 SQLite WASM。
 *
 * 要看到具体哪里不一致，构建时带上 EQTS_HYDRATION_DETAILS=1。
 * 用法：pnpm build && node test/site.mjs [只查的地址……]
 */
import { spawn } from 'node:child_process';
import { globSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const app = join(dirname(fileURLToPath(import.meta.url)), '..');
const port = 4176;
const base = `http://localhost:${port}`;
const only = process.argv.slice(2);
const pages = globSync('**/*.html', { cwd: join(app, 'dist') })
  .filter((file) => file !== 'spa.html')
  .map((file) =>
    file === 'index.html' ? '/' : `/${file.replaceAll('\\', '/').replace(/\.html$/, '')}`,
  )
  .filter((path) => only.length === 0 || only.includes(path))
  .sort();

const server = spawn(
  process.execPath,
  [
    join(app, 'node_modules/vite/bin/vite.js'),
    'preview',
    '--configLoader',
    'native',
    '--port',
    String(port),
    '--strictPort',
  ],
  { cwd: app, stdio: ['ignore', 'pipe', 'inherit'] },
);
await new Promise((resolve, reject) => {
  server.stdout.on('data', (chunk) => {
    if (String(chunk).includes(String(port))) resolve();
  });
  server.on('exit', (code) => reject(new Error(`预览服务器退出了（${code}）`)));
});

/** 演练场：运行之后标出改动，单击单元格行内编辑（数字、布尔），删行，重置放回示例数据 */
async function checkDataPanel(page, engine) {
  const code = 'await db.update(Post).set({ views: 1 }).where((p) => p.id.eq(1)).execute();';
  await page.goto(`${base}/guide/playground#code=${encodeURIComponent(code)}`, {
    waitUntil: 'networkidle',
  });
  await page.getByRole('combobox', { name: '数据库' }).click();
  await page.getByRole('option', { name: engine }).click();
  const tab = (name) => page.getByRole('tab', { name, exact: false });
  const seen = (text) => page.getByText(text).first().waitFor({ timeout: 30_000 });
  const editCell = async (cell, value) => {
    await cell.click();
    const input = page.locator('tbody input');
    await input.fill(value);
    await input.press('Enter');
  };

  await tab('t_company').waitFor({ timeout: 90_000 });
  await seen('和上次运行前比没有改动');
  await page.getByRole('button', { name: '运行', exact: true }).click();
  await seen('和上次运行前比：修改 1 行');

  await tab('t_post').first().click();
  await editCell(page.getByRole('gridcell', { name: '860', exact: true }), '861');
  await seen('和上次运行前比：修改 2 行');
  await page.getByRole('button', { name: '删除这一行' }).last().click();
  await seen('和上次运行前比：修改 2 行，删除 1 行');

  await tab('t_doc').click();
  const deleted = engine === 'SQLite' ? '0' : 'false';
  await editCell(page.getByRole('gridcell', { name: deleted, exact: true }).first(), 'true');
  await seen('和上次运行前比：修改 3 行，删除 1 行');

  await page.getByRole('button', { name: '重置数据' }).click();
  await seen('和上次运行前比没有改动');
  await tab('t_post').first().click();
  await page.getByRole('gridcell', { name: '1280', exact: true }).waitFor({ timeout: 30_000 });
}

/** 右上角的全屏：真实点击能进浏览器全屏，顶栏和左侧菜单不显示；退出后都回来 */
async function checkFullscreen(page) {
  await page.goto(`${base}/guide/model`, { waitUntil: 'networkidle' });
  const header = page.locator('header').first();
  await page.getByRole('button', { name: '全屏', exact: true }).click();
  await page.getByRole('button', { name: '退出全屏' }).waitFor({ timeout: 10_000 });
  await page.waitForFunction(() => !!document.fullscreenElement, null, { timeout: 10_000 });
  if (await header.isVisible()) throw new Error('全屏时顶栏还在');
  if (await page.getByRole('navigation', { name: '文档' }).isVisible())
    throw new Error('全屏时左侧菜单还在');
  await page.getByRole('button', { name: '退出全屏' }).click();
  await header.waitFor({ state: 'visible', timeout: 10_000 });
  await page.waitForFunction(() => !document.fullscreenElement, null, { timeout: 10_000 });
}

/** “示例模型”页：同样的表格，单击改一格，重置放回 */
async function checkModelTables(page) {
  await page.goto(`${base}/guide/model`, { waitUntil: 'networkidle' });
  const cell = page.getByRole('gridcell', { name: '星河科技', exact: true });
  await cell.waitFor({ timeout: 90_000 });
  await cell.click();
  const input = page.locator('tbody input');
  await input.fill('星河');
  await input.press('Enter');
  await page.getByText('和打开这一页时比：修改 1 行').waitFor({ timeout: 30_000 });
  await page.getByRole('button', { name: '重置数据' }).click();
  await cell.waitFor({ timeout: 30_000 });
}

/** 页面上显示系统滚动条的元素：全站都该是浮层滚动条（多行输入框没法换，除外） */
const nativeScrollbars = (page) =>
  page.evaluate(() =>
    [...document.querySelectorAll('body *')]
      .filter((element) => {
        if (element.tagName === 'TEXTAREA') return false;
        const style = getComputedStyle(element);
        if (style.scrollbarWidth === 'none') return false;
        return (
          (/auto|scroll/.test(style.overflowY) &&
            element.scrollHeight > element.clientHeight + 1) ||
          (/auto|scroll/.test(style.overflowX) && element.scrollWidth > element.clientWidth + 1)
        );
      })
      .map(
        (element) =>
          `${element.tagName.toLowerCase()} “${element.textContent?.trim().slice(0, 24)}”`,
      ),
  );

/** 手机宽度：页面不能横向滚动（调用后视口留在手机宽度） */
async function phoneOverflow(page) {
  await page.setViewportSize({ width: 375, height: 812 });
  const width = await page.evaluate(() => document.documentElement.scrollWidth);
  return width > 375 ? [`手机宽度下页面宽 ${width}px`] : [];
}

/** 手机宽度：水合后的页面点菜单按钮，抽屉里要有导航链接 */
async function phoneDrawerLinks(page) {
  await page.locator('button[aria-label="打开导航"]').click();
  await page.locator('dialog[open]').waitFor();
  return page.locator('dialog[open] a[href]').count();
}

const problems = [];
let runs = 0;
const browser = await chromium.launch();
try {
  const desktop = { width: 2000, height: 1100 };
  const page = await browser.newPage({ viewport: desktop });
  let current = '';
  page.on('console', (message) => {
    if (message.type() === 'error' || /hydrat/i.test(message.text()))
      problems.push(`${current}：${message.text().slice(0, 300)}`);
  });
  page.on('pageerror', (error) => problems.push(`${current}：${String(error).slice(0, 300)}`));

  for (const engine of ['pg', 'sqlite']) {
    // 方言记在浏览器里：下一页打开时读出来
    await page.goto(`${base}/`, { waitUntil: 'networkidle' });
    await page.evaluate((id) => localStorage.setItem('easy-query-ts-dialect', id), engine);
    for (const path of pages) {
      current = `${engine} ${path}`;
      await page.goto(`${base}${path}`, { waitUntil: 'networkidle' });
      for (const element of await nativeScrollbars(page))
        problems.push(`${path}：系统滚动条 ${element}`);
      const cards = page.locator('section:has(> div button:has-text("运行"))');
      const count = await cards.count();
      for (let index = 0; index < count; index++) {
        const card = cards.nth(index);
        await card.locator('button:has-text("运行")').click();
        const done = card.locator('small', { hasText: '刚刚在浏览器里' });
        const failed = card.getByText('运行失败');
        await done.or(failed).first().waitFor({ timeout: 90_000 });
        if (await failed.count()) problems.push(`${current} 第 ${index + 1} 张卡片运行失败`);
        else runs++;
      }
      for (const problem of await phoneOverflow(page)) problems.push(`${path}：${problem}`);
      await page.setViewportSize(desktop);
    }
  }

  current = '手机宽度的抽屉';
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto(`${base}${pages[0]}`, { waitUntil: 'networkidle' });
  if (!(await phoneDrawerLinks(page))) problems.push('手机宽度下抽屉里没有导航链接');
  await page.setViewportSize(desktop);

  if (pages.includes('/guide/model')) {
    current = '全屏';
    try {
      await checkFullscreen(page);
      runs++;
    } catch (error) {
      problems.push(`${current}：${String(error).slice(0, 300)}`);
    }
    current = '示例模型的表格';
    try {
      await checkModelTables(page);
      runs++;
    } catch (error) {
      problems.push(`${current}：${String(error).slice(0, 300)}`);
    }
  }

  if (pages.includes('/guide/playground')) {
    for (const engine of ['PostgreSQL', 'SQLite']) {
      current = `演练场的数据面板 ${engine}`;
      try {
        await checkDataPanel(page, engine);
        runs++;
      } catch (error) {
        problems.push(`${current}：${String(error).slice(0, 300)}`);
      }
    }
  }
} finally {
  await browser.close();
  server.kill();
}

for (const problem of [...new Set(problems)]) console.log(problem);
console.log(`${pages.length} 页，运行通过 ${runs} 次，${problems.length} 个问题`);
if (problems.length) process.exitCode = 1;
// 预览服务器的子进程在 Windows 上可能留着句柄
process.exit();
