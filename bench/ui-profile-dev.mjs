import { chromium } from '/tmp/claude-0/-home-user-souko/001807a6-8783-5dde-972c-bd6aa4014177/scratchpad/node_modules/playwright/index.mjs';

/** ドラッグ中のJSプロファイルを取り、self time 上位を出す。 */
const index = Number(process.argv[2] ?? 0);
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 950 } });
await page.goto('http://localhost:5173/', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('canvas');
await page.waitForFunction(() => document.querySelectorAll('.area-list .list-row-button').length > 0, { timeout: 30000 });
if (index > 0) {
  const values = await page.locator('.topbar select').first().locator('option').evaluateAll((e) => e.map((x) => x.value));
  await page.locator('.topbar select').first().selectOption(values[index]);
  await page.waitForTimeout(3000);
}
const box = await page.locator('canvas').first().boundingBox();
let target = null;
outer: for (let ry = -0.35; ry <= 0.36; ry += 0.06) {
  for (let rx = -0.4; rx <= 0.41; rx += 0.08) {
    const px = box.x + box.width * (0.5 + rx), py = box.y + box.height * (0.5 + ry);
    await page.mouse.click(px, py);
    await page.waitForTimeout(100);
    const t = (await page.locator('.inspector .panel-title').first().textContent()) ?? '';
    if (t.includes('ラック')) { target = { px, py }; break outer; }
  }
}
if (!target) throw new Error('rack not found');

const client = await page.context().newCDPSession(page);
await client.send('Profiler.enable');
await client.send('Profiler.setSamplingInterval', { interval: 200 });
await client.send('Profiler.start');

const action = process.argv[3] ?? 'drag';
if (action === 'drag') {
  await page.mouse.move(target.px, target.py);
  await page.mouse.down();
  for (let i = 1; i <= 45; i++) { await page.mouse.move(target.px + i * 4, target.py + Math.sin(i / 5) * 40); await page.waitForTimeout(10); }
  await page.mouse.up();
} else if (action === 'zoom') {
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  for (let i = 0; i < 30; i++) { await page.mouse.wheel(0, i % 2 === 0 ? -240 : 240); await page.waitForTimeout(14); }
} else {
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  for (let i = 1; i <= 45; i++) { await page.mouse.move(box.x + box.width / 2 - i * 5, box.y + box.height / 2 + i * 2); await page.waitForTimeout(10); }
  await page.mouse.up();
}

const { profile } = await client.send('Profiler.stop');
const byId = new Map(profile.nodes.map((n) => [n.id, n]));
const self = new Map();
for (const s of profile.samples) self.set(s, (self.get(s) ?? 0) + 1);
const total = profile.samples.length;
const rows = [...self.entries()].map(([id, c]) => {
  const cf = byId.get(id)?.callFrame ?? {};
  return { name: cf.functionName || '(anonymous)', url: (cf.url || '').split('/').pop(), line: cf.lineNumber, pct: (c / total) * 100 };
}).sort((a, b) => b.pct - a.pct).slice(0, 18);
console.log('--- ' + action + ' 中 self time 上位 (サンプル ' + total + ') ---');
for (const r of rows) console.log(String(r.pct.toFixed(1)).padStart(5) + '%  ' + r.name.padEnd(26) + ' ' + (r.url ?? '') + ':' + r.line);
await browser.close();
