#!/usr/bin/env node
// Browser timings of the published build (Angular app served by the API, Dev auth), Lighthouse-style but dependency-free: cold and warm loads,
// SPA navigation to the Task queue with 25 and 100 rows, and the Task detail page with a long comment thread.
//   node frontend-timings.mjs --base http://127.0.0.1:5912 [--user perf.user040] [--runs 5] [--cpu 4] [--chromium /opt/pw-browsers/chromium-1194/chrome-linux/chrome]
// Uses playwright-core from frontend/node_modules (npm ci there first). --cpu N emulates a N-times slower CPU (4 is Lighthouse's mobile profile).
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(resolve(here, '../../frontend/package.json'));
const { chromium } = require('playwright-core');

const args = Object.fromEntries(
  process.argv.slice(2).flatMap((a, i, all) => (a.startsWith('--') ? [[a.slice(2), all[i + 1] && !all[i + 1].startsWith('--') ? all[i + 1] : 'true']] : [])),
);
const BASE = args.base ?? 'http://127.0.0.1:5912';
const USER = args.user ?? 'perf.user040';
const RUNS = Number(args.runs ?? 5);
const CPU = Number(args.cpu ?? 1);
const EXE = args.chromium ?? (process.env.E2E_CHROMIUM_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome');
const HOT_TASK = Number(args.hotTask ?? 1); // the Task with the longest comment thread of the dataset

const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
const fmt = (n) => (n === undefined || Number.isNaN(n) ? '-' : n.toFixed(0));

const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox', '--disable-gpu'] });

const INIT = () => {
  window.__paint = {};
  new PerformanceObserver((list) => {
    for (const e of list.getEntries()) if (e.name === 'first-contentful-paint') window.__paint.fcp = e.startTime;
  }).observe({ type: 'paint', buffered: true });
  new PerformanceObserver((list) => {
    for (const e of list.getEntries()) window.__paint.lcp = e.startTime;
  }).observe({ type: 'largest-contentful-paint', buffered: true });
};

function newContext() {
  return browser.newContext({
    viewport: { width: 1440, height: 900 },
    timezoneId: 'America/New_York',
    locale: 'en-US',
    extraHTTPHeaders: { 'X-Dev-User': USER },
  });
}

/** A page of the context with the paint observers installed, the CDP metrics on and the CPU slowdown applied. */
async function instrument(context) {
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  await cdp.send('Performance.enable');
  if (CPU > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: CPU });
  await page.addInitScript(INIT);
  return { page, cdp };
}

async function newPage() {
  const context = await newContext();
  return { context, ...(await instrument(context)) };
}

async function metricsOf(cdp) {
  const { metrics } = await cdp.send('Performance.getMetrics');
  const get = (name) => metrics.find((m) => m.name === name)?.value ?? 0;
  return { scriptMs: get('ScriptDuration') * 1000, taskMs: get('TaskDuration') * 1000, layoutMs: get('LayoutDuration') * 1000, heapMb: get('JSHeapUsedSize') / 1048576 };
}

/** A load of a URL until `ready` (a selector that proves the page is usable) is on screen; warm = a second visit with the browser cache filled. */
async function load(url, ready, { warm = false } = {}) {
  const context = await newContext();
  try {
    if (warm) {
      const first = await context.newPage();
      await first.goto(BASE + url, { waitUntil: 'networkidle' });
      await first.close();
    }
    const { page, cdp } = await instrument(context);
    const start = Date.now();
    await page.goto(BASE + url, { waitUntil: 'commit' });
    await page.waitForSelector(ready, { timeout: 60000 });
    const readyMs = Date.now() - start;
    await page.waitForLoadState('networkidle');
    const nav = await page.evaluate(() => {
      const n = performance.getEntriesByType('navigation')[0];
      const js = performance.getEntriesByType('resource').filter((r) => r.name.endsWith('.js'));
      return {
        ttfb: n.responseStart,
        dcl: n.domContentLoadedEventEnd,
        load: n.loadEventEnd,
        fcp: window.__paint.fcp,
        lcp: window.__paint.lcp,
        jsRequests: js.length,
        jsKb: js.reduce((s, r) => s + (r.transferSize || 0), 0) / 1024,
        jsRawKb: js.reduce((s, r) => s + (r.decodedBodySize || 0), 0) / 1024,
      };
    });
    return { ...nav, readyMs, ...(await metricsOf(cdp)) };
  } finally {
    await context.close();
  }
}

/** Opens `from`, then follows the nav link (SPA route change) and measures until `rows` rows are rendered. */
async function navigate(from, linkSelector, rowsSelector, rows) {
  const { context, page, cdp } = await newPage();
  try {
    await page.goto(BASE + from, { waitUntil: 'networkidle' });
    await page.waitForSelector('nav a, a[href]', { timeout: 30000 });
    const before = await metricsOf(cdp);
    const ms = await page.evaluate(
      async ({ linkSelector, rowsSelector, rows }) => {
        const link = document.querySelector(linkSelector);
        const target = new URL(link.href).pathname;
        if (!link) throw new Error('link not found: ' + linkSelector);
        const t0 = performance.now();
        link.click();
        await new Promise((resolve) => {
          const done = () => location.pathname.startsWith(target) && document.querySelectorAll(rowsSelector).length >= rows;
          if (done()) return resolve();
          const mo = new MutationObserver(() => {
            if (done()) {
              mo.disconnect();
              resolve();
            }
          });
          mo.observe(document.body, { childList: true, subtree: true });
        });
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
        return performance.now() - t0;
      },
      { linkSelector, rowsSelector, rows },
    );
    const after = await metricsOf(cdp);
    return { ms, scriptMs: after.scriptMs - before.scriptMs, layoutMs: after.layoutMs - before.layoutMs, heapMb: after.heapMb };
  } finally {
    await context.close();
  }
}

async function repeat(n, fn) {
  const out = [];
  for (let i = 0; i < n; i++) out.push(await fn());
  return out;
}
const med = (rows, key) => median(rows.map((r) => r[key]));

const lines = [];
const say = (s) => {
  lines.push(s);
  console.log(s);
};
say(`Browser timings against ${BASE} as ${USER}, ${RUNS} runs each (median), CPU slowdown x${CPU}, Chromium ${browser.version()}`);
say('');

say('| page load | TTFB | DOMContentLoaded | load | FCP | LCP | usable | script ms | JS files | JS KB (wire) | JS KB (raw) |');
say('|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|');
for (const [name, url, ready, warm] of [
  ['My Work, cold cache', '/my-work', 'tbody tr', false],
  ['My Work, warm cache', '/my-work', 'tbody tr', true],
  ['Task queue (25 rows), cold', '/tasks?pageSize=25', 'tbody tr', false],
  ['Task queue (100 rows), cold', '/tasks?pageSize=100', 'tbody tr:nth-child(100)', false],
  ['Dashboard, cold', '/dashboard', 'main', false],
  [`Task detail #${HOT_TASK}, cold`, `/tasks/${HOT_TASK}`, 'h1', false],
]) {
  const rows = await repeat(RUNS, () => load(url, ready, { warm }));
  say(
    `| ${name} | ${fmt(med(rows, 'ttfb'))} | ${fmt(med(rows, 'dcl'))} | ${fmt(med(rows, 'load'))} | ${fmt(med(rows, 'fcp'))} | ${fmt(med(rows, 'lcp'))} | ${fmt(med(rows, 'readyMs'))} | ${fmt(med(rows, 'scriptMs'))} | ${fmt(med(rows, 'jsRequests'))} | ${fmt(med(rows, 'jsKb'))} | ${fmt(med(rows, 'jsRawKb'))} |`,
  );
}

say('');
say('| SPA navigation (nav link click until the rows are rendered) | rows | ms | script ms | layout ms |');
say('|---|---:|---:|---:|---:|');
for (const [name, from, link, rowsSelector, rows] of [
  ['My Work to Task queue (25 rows)', '/my-work', 'a[href="/tasks"]', 'tbody tr', 25],
]) {
  const results = await repeat(RUNS, () => navigate(from, link, rowsSelector, rows));
  say(`| ${name} | ${rows} | ${fmt(med(results, 'ms'))} | ${fmt(med(results, 'scriptMs'))} | ${fmt(med(results, 'layoutMs'))} |`);
}

// The queue with 100 rows, reached by changing the page size on the page.
{
  const results = await repeat(RUNS, async () => {
    const { context, page } = await newPage();
    try {
      await page.goto(BASE + '/tasks?pageSize=25', { waitUntil: 'networkidle' });
      await page.waitForSelector('tbody tr');
      const ms = await page.evaluate(async () => {
        const t0 = performance.now();
        history.pushState({}, '', '/tasks?pageSize=100');
        window.dispatchEvent(new PopStateEvent('popstate'));
        await new Promise((resolve) => {
          const mo = new MutationObserver(() => {
            if (document.querySelectorAll('tbody tr').length >= 100) {
              mo.disconnect();
              resolve();
            }
          });
          mo.observe(document.body, { childList: true, subtree: true });
          setTimeout(resolve, 20000);
        });
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
        return performance.now() - t0;
      });
      const rows = await page.evaluate(() => document.querySelectorAll('tbody tr').length);
      return { ms, rows };
    } finally {
      await context.close();
    }
  });
  say(`| Task queue 25 to 100 rows (page-size change) | ${med(results, 'rows')} | ${fmt(med(results, 'ms'))} | - | - |`);
}

// The comments tab of a Task with a long thread: first page, then "Load more".
{
  const results = await repeat(RUNS, async () => {
    const { context, page } = await newPage();
    try {
      await page.goto(BASE + `/tasks/${HOT_TASK}`, { waitUntil: 'networkidle' });
      const first = await page.evaluate(async () => {
        const tab = Array.from(document.querySelectorAll('[role=tab]')).find((t) => /comments/i.test(t.textContent || ''));
        if (!tab) throw new Error('no comments tab');
        const t0 = performance.now();
        tab.click();
        await new Promise((resolve) => {
          const mo = new MutationObserver(() => {
            if (document.querySelectorAll('[data-comment-id]').length >= 100) {
              mo.disconnect();
              resolve();
            }
          });
          mo.observe(document.body, { childList: true, subtree: true });
        });
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
        return { ms: performance.now() - t0, shown: document.querySelectorAll('[data-comment-id]').length, hasMore: !!document.querySelector('[data-load-more]') };
      });
      const more = await page.evaluate(async () => {
        const button = document.querySelector('[data-load-more]');
        if (!button) return { ms: 0, shown: document.querySelectorAll('[data-comment-id]').length };
        const before = document.querySelectorAll('[data-comment-id]').length;
        const t0 = performance.now();
        button.click();
        await new Promise((resolve) => {
          const mo = new MutationObserver(() => {
            if (document.querySelectorAll('[data-comment-id]').length > before) {
              mo.disconnect();
              resolve();
            }
          });
          mo.observe(document.body, { childList: true, subtree: true });
        });
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
        return { ms: performance.now() - t0, shown: document.querySelectorAll('[data-comment-id]').length };
      });
      return { first: first.ms, shown: first.shown, hasMore: first.hasMore, more: more.ms, shownAfter: more.shown };
    } finally {
      await context.close();
    }
  });
  say('');
  say('| Task detail comments tab | comments shown | ms |');
  say('|---|---:|---:|');
  say(`| open the tab (first page) | ${med(results, 'shown')} | ${fmt(med(results, 'first'))} |`);
  say(`| Load more (next page) | ${med(results, 'shownAfter')} | ${fmt(med(results, 'more'))} |`);
}

await browser.close();
