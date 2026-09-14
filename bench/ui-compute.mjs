import { chromium } from '/tmp/claude-0/-home-user-souko/001807a6-8783-5dde-972c-bd6aa4014177/scratchpad/node_modules/playwright/index.mjs';

/** 一括実行の「計算中」にUIが操作できるかを測る。 */
const index = Number(process.argv[2] ?? 0);
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 950 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto('http://localhost:5178/', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('canvas');
await page.waitForFunction(() => document.querySelectorAll('.area-list .list-row-button').length > 0, { timeout: 30000 });
if (index > 0) {
  const values = await page.locator('.topbar select').first().locator('option').evaluateAll((e) => e.map((x) => x.value));
  await page.locator('.topbar select').first().selectOption(values[index]);
  await page.waitForTimeout(3000);
}
await page.locator('.inspector-tabs .tab', { hasText: 'シミュレーション' }).click();

const t0 = Date.now();
await page.locator('.inspector button.primary', { hasText: '一括実行' }).click();

// 計算中にパンしてフレーム時間を測る
await page.evaluate(() => {
  window.__f = []; let last = performance.now(); window.__on = true;
  const tick = (now) => { window.__f.push(now - last); last = now; if (window.__on) requestAnimationFrame(tick); };
  requestAnimationFrame(tick);
});
const box = await page.locator('canvas').first().boundingBox();
await page.locator('.tool', { hasText: '移動' }).click();
await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
await page.mouse.down();
for (let i = 1; i <= 30; i++) { await page.mouse.move(box.x + box.width / 2 - i * 4, box.y + box.height / 2 + i * 2); await page.waitForTimeout(12); }
await page.mouse.up();
const frames = await page.evaluate(() => {
  window.__on = false;
  const f = window.__f.slice(2).sort((a, b) => a - b);
  const avg = f.reduce((a, b) => a + b, 0) / f.length;
  return { frames: f.length, avgMs: +avg.toFixed(1), p95Ms: +f[Math.floor(f.length * 0.95)].toFixed(1), maxMs: +f.at(-1).toFixed(1), fps: +(1000 / avg).toFixed(1) };
});
const progressSeen = await page.locator('.progress-bar').count();

await page.waitForFunction(() => {
  const badge = [...document.querySelectorAll('.badge')].map((b) => b.textContent).join('|');
  return badge.includes('完了');
}, undefined, { timeout: 180000, polling: 300 });
const totalMs = Date.now() - t0;
const kpi = (await page.locator('.inspector .stat-grid dd').allTextContents()).slice(0, 8).map((t) => t.trim());
console.log(JSON.stringify({ computeMs: totalMs, duringCompute: frames, progressShown: progressSeen > 0, kpi, errors: errors.slice(0, 2) }, null, 1));
await browser.close();
