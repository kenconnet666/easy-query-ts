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

const problems = [];
let runs = 0;
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 2000, height: 1100 } });
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
