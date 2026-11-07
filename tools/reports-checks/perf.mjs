// usage: node perf.mjs <dist> <port>  -- 50,000-row result: how fast do the first rows and a page change appear, how much does the browser hold
import { boot, SIZES } from './lib.mjs';
import { createState } from './mock.mjs';
const [dist, portArg] = process.argv.slice(2);
const state = createState();
const h = await boot({ dist, port: Number(portArg), state });
const { page, base } = h;
const cdp = await page.context().newCDPSession(page);
await cdp.send('Performance.enable');
const heap = async () => Math.round((await cdp.send('Performance.getMetrics')).metrics.find((m) => m.name === 'JSHeapUsedSize').value / 1024 / 1024 * 10) / 10;
const stats = (a) => { const s = [...a].sort((x, y) => x - y); return { n: s.length, min: Math.round(s[0]), median: Math.round(s[Math.floor(s.length / 2)]), p90: Math.round(s[Math.floor(s.length * 0.9)]), max: Math.round(s[s.length - 1]) }; };
const out = {};
await page.addInitScript(() => {
  window.__long = [];
  try { new PerformanceObserver((l) => l.getEntries().forEach((e) => window.__long.push(Math.round(e.duration)))).observe({ entryTypes: ['longtask'] }); } catch {}
  window.__gaps = [];
  let last = performance.now();
  const tick = (t) => { window.__gaps.push(t - last); last = t; requestAnimationFrame(tick); };
  requestAnimationFrame(tick);
});

for (const size of SIZES) {
  state.rowsRequests.length = 0;
  await page.setViewportSize(size);
  await page.goto(base + '/reports/7');
  await page.getByRole('button', { name: 'Run Report' }).waitFor();
  await page.waitForLoadState('networkidle');
  const heap0 = await heap();
  // time to first rows: click Run Report -> first data row in the DOM
  const first = [];
  for (let k = 0; k < 3; k++) {
    if (k > 0) { await page.goto(base + '/reports/7'); await page.getByRole('button', { name: 'Run Report' }).waitFor(); await page.waitForLoadState('networkidle'); }
    const t = await page.evaluate(async () => {
      const t0 = performance.now();
      [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Run Report').click();
      while (!document.querySelector('tbody tr[data-record-id]')) await new Promise((r) => requestAnimationFrame(r));
      return performance.now() - t0;
    });
    first.push(t);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(300);
  }
  const heap1 = await heap();
  const domRows = await page.locator('tbody tr[data-record-id]').count();
  const totalText = await page.locator('mf-pager, [data-pager]').first().textContent().catch(() => '');
  // page change: Next x10 ; time until the first row id changes
  const timePageChange = async (label) => {
    return page.evaluate(async (label) => {
      const firstCell = () => document.querySelector('tbody tr[data-record-id] td')?.textContent;
      const before = firstCell();
      const btn = [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === label || b.getAttribute('aria-label') === label);
      const t0 = performance.now();
      btn.click();
      let guard = 0;
      while (firstCell() === before && guard++ < 600) await new Promise((r) => requestAnimationFrame(r));
      return performance.now() - t0;
    }, label);
  };
  const pageTimes = [];
  for (let k = 0; k < 10; k++) { pageTimes.push(await timePageChange('Next')); await page.waitForTimeout(80); }
  const heap2 = await heap();
  // sort the 50,000 rows by a column (server sorts) and filter
  const sortT = await page.evaluate(async () => {
    const firstCell = () => document.querySelector('tbody tr[data-record-id] td')?.textContent;
    const before = firstCell();
    const t0 = performance.now();
    document.querySelectorAll('thead tr:first-child th')[3].querySelector('button').click();
    let g = 0; while (firstCell() === before && g++ < 600) await new Promise((r) => requestAnimationFrame(r));
    return performance.now() - t0;
  });
  await page.waitForTimeout(300);
  // 250 rows a page: DOM size and a page change
  const pageSizeDd = page.getByRole('button', { name: /rows per page|page size|50/i }).first();
  let big = null;
  try {
    await page.locator('mf-pager').getByRole('button').filter({ hasText: /^50$|50 /}).first().click({ timeout: 2000 });
    await page.getByRole('option', { name: '250' }).click({ timeout: 2000 });
    await page.waitForFunction(() => document.querySelectorAll('tbody tr[data-record-id]').length === 250, undefined, { timeout: 5000 });
    const rows250 = await page.locator('tbody tr[data-record-id]').count();
    const t250 = [];
    for (let k = 0; k < 5; k++) { t250.push(await timePageChange('Next')); await page.waitForTimeout(80); }
    big = { rows250, pageChange250: stats(t250), heapAfter250: await heap() };
  } catch (e) { big = { error: String(e).slice(0, 120) }; }
  const long = await page.evaluate(() => window.__long);
  const gaps = await page.evaluate(() => window.__gaps.filter((g) => g > 34));
  out[`${size.width}x${size.height}`] = {
    firstRowsMs: stats(first), domRowsAfterRun: domRows, pageChangeMs: stats(pageTimes), sortMs: Math.round(sortT),
    heapMB: { beforeRun: heap0, afterRun: heap1, after10Pages: heap2 }, size250: big,
    longTasksOver50ms: { count: long.length, max: Math.max(0, ...long) }, framesSlowerThan34ms: { count: gaps.length, max: Math.round(Math.max(0, ...gaps)) },
    rowsRequests: { count: state.rowsRequests.length, maxRowsInOneAnswer: Math.max(...state.rowsRequests.map((r) => r.rowsSent)), maxBytes: Math.max(...state.rowsRequests.map((r) => r.bytes)), totalBytes: state.rowsRequests.reduce((a, r) => a + r.bytes, 0), serverMsMedian: stats(state.rowsRequests.map((r) => r.serverMs)).median },
    pagerText: (totalText ?? '').replace(/\s+/g, ' ').trim().slice(0, 120),
  };
}
console.log(JSON.stringify(out, null, 1));
console.log('errors:', h.errors.slice(0, 5));
await h.close();
