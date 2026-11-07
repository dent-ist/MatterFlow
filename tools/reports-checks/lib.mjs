import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { install, serve } from './mock.mjs';

// The frontend folder whose node_modules hold playwright and axe-core (default: this repository's own frontend).
const FRONTEND = process.env.FRONTEND_DIR ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../frontend');
const require = createRequire(path.join(FRONTEND, 'package.json'));
export const { chromium } = require('playwright');
export const axeSrc = fs.readFileSync(path.join(FRONTEND, 'node_modules/axe-core/axe.min.js'), 'utf8');
export const SIZES = [{ width: 1366, height: 768 }, { width: 1920, height: 1080 }];
export const TAGS = ['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'];

export async function boot({ dist, port, state }) {
  const server = await serve(dist, port);
  const browser = await chromium.launch({ executablePath: process.env.E2E_CHROMIUM_PATH ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const ctx = await browser.newContext({ viewport: SIZES[0] });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text().slice(0, 200)}`); });
  await install(page, state);
  const base = `http://127.0.0.1:${port}`;
  return { server, browser, page, base, errors, close: async () => { await browser.close(); server.close(); } };
}

export async function axeNow(page) {
  await page.waitForFunction(() => !document.querySelector('table[aria-busy="true"], ul[aria-busy="true"]') && !document.getAnimations().some((a) => { const t = a.effect?.getComputedTiming(); return a.playState === 'running' && !!t && t.iterations !== Infinity; }), undefined, { timeout: 3000 }).catch(() => undefined);
  await page.evaluate(axeSrc);
  return page.evaluate(async (tags) => {
    const r = await window.axe.run(document, { runOnly: { type: 'tag', values: tags } });
    return r.violations.map((v) => ({ id: v.id, impact: v.impact, help: v.help, nodes: v.nodes.slice(0, 3).map((n) => ({ target: n.target, html: n.html.slice(0, 160), why: [...n.any, ...n.all, ...n.none].map((c) => c.message).join(' | ') })) }));
  }, TAGS);
}

export async function sideways(page) {
  return page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
}
