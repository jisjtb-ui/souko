import { chromium } from '/tmp/claude-0/-home-user-souko/001807a6-8783-5dde-972c-bd6aa4014177/scratchpad/node_modules/playwright/index.mjs';

/**
 * ブラウザ実測: 初期ロード・FCP・操作時のフレーム時間・メモリ。
 * 同じ手順を変更前後で実行して比較する。
 */
const label = process.argv[2] ?? 'run';
const warehouseIndex = Number(process.argv[3] ?? 0);
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 950 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));

// --- 初期ロード ---
const t0 = Date.now();
await page.goto('http://localhost:5178/', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('canvas', { timeout: 30000 });
await page.waitForFunction(() => document.querySelectorAll('.area-list .list-row-button').length > 0, { timeout: 30000 });
const loadMs = Date.now() - t0;
const paint = await page.evaluate(() => {
  const fcp = performance.getEntriesByName('first-contentful-paint')[0];
  return { fcp: fcp ? Math.round(fcp.startTime) : null };
});

// 対象の倉庫へ切り替え
const options = await page.locator('.topbar select').first().locator('option').allTextContents();
if (warehouseIndex > 0) {
  const values = await page.locator('.topbar select').first().locator('option').evaluateAll((els) => els.map((e) => e.value));
  await page.locator('.topbar select').first().selectOption(values[warehouseIndex]);
  await page.waitForTimeout(3000);
}
const stats = await page.locator('.inspector .stat-grid dd').allTextContents();

/** 操作中のフレーム時間を rAF で計測する */
async function startFrameProbe() {
  await page.evaluate(() => {
    window.__frames = [];
    let last = performance.now();
    window.__probe = true;
    const tick = (now) => {
      window.__frames.push(now - last);
      last = now;
      if (window.__probe) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}
async function stopFrameProbe() {
  return page.evaluate(() => {
    window.__probe = false;
    const f = window.__frames.slice(2);
    if (f.length === 0) return { frames: 0 };
    const sorted = [...f].sort((a, b) => a - b);
    const avg = f.reduce((a, b) => a + b, 0) / f.length;
    return {
      frames: f.length,
      avgMs: +avg.toFixed(1),
      medianMs: +sorted[Math.floor(sorted.length / 2)].toFixed(1),
      p95Ms: +sorted[Math.floor(sorted.length * 0.95)].toFixed(1),
      maxMs: +sorted.at(-1).toFixed(1),
      fps: +(1000 / avg).toFixed(1),
    };
  });
}

const box = await page.locator('canvas').first().boundingBox();
const cx = box.x + box.width / 2;
const cy = box.y + box.height / 2;

// --- ラックを確実に選択してからドラッグ ---
async function selectRack() {
  for (let ry = -0.35; ry <= 0.36; ry += 0.06) {
    for (let rx = -0.4; rx <= 0.41; rx += 0.08) {
      const px = box.x + box.width * (0.5 + rx);
      const py = box.y + box.height * (0.5 + ry);
      await page.mouse.click(px, py);
      await page.waitForTimeout(120);
      const title = (await page.locator('.inspector .panel-title').first().textContent()) ?? '';
      if (title.includes('ラック')) return { px, py, title: title.trim() };
    }
  }
  return null;
}
const rack = await selectRack();
if (!rack) throw new Error('ラックを選択できませんでした');
const selected = rack.title;
const dragX = rack.px;
const dragY = rack.py;
await startFrameProbe();
await page.mouse.move(dragX, dragY);
await page.mouse.down();
for (let i = 1; i <= 40; i++) {
  await page.mouse.move(dragX + i * 3, dragY + Math.sin(i / 4) * 30);
  await page.waitForTimeout(8);
}
await page.mouse.up();
const drag = await stopFrameProbe();

// --- パン ---
await page.locator('.tool', { hasText: '移動' }).click();
await startFrameProbe();
await page.mouse.move(cx, cy);
await page.mouse.down();
for (let i = 1; i <= 40; i++) {
  await page.mouse.move(cx - i * 4, cy + i * 2);
  await page.waitForTimeout(8);
}
await page.mouse.up();
const pan = await stopFrameProbe();
await page.locator('.tool', { hasText: '選択' }).first().click();

// --- ズーム ---
await startFrameProbe();
await page.mouse.move(cx, cy);
for (let i = 0; i < 25; i++) {
  await page.mouse.wheel(0, i % 2 === 0 ? -240 : 240);
  await page.waitForTimeout(12);
}
const zoom = await stopFrameProbe();

// --- メモリ ---
const memory = await page.evaluate(() => {
  const m = performance.memory;
  return m ? { usedMB: +(m.usedJSHeapSize / 1048576).toFixed(1), totalMB: +(m.totalJSHeapSize / 1048576).toFixed(1) } : null;
});
const domNodes = await page.evaluate(() => document.querySelectorAll('*').length);

console.log(JSON.stringify({
  label, warehouse: options[warehouseIndex], loadMs, fcpMs: paint.fcp,
  locations: stats[3] ?? stats[1], selected: selected?.trim(),
  drag, pan, zoom, memory, domNodes, errors: errors.slice(0, 2),
}, null, 2));
await browser.close();
