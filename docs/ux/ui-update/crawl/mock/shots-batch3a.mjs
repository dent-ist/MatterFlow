// Batch 3a screenshots: opens each migrated dialog and saves <out>/<id>-<name>-<w>x<h>.png and measurements. Usage: node shots-batch3a.mjs <outDir> [filter-regex]
// The mock API answers generic sample data, so lists show "Sample Alpha" rows; the dialogs themselves are what the shots are for.
import { launch, openApp, SIZES } from './shot.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';

const out = process.argv[2];
const filter = process.argv[3] ? new RegExp(process.argv[3]) : null;
mkdirSync(out, { recursive: true });
const wait = (p, ms = 900) => p.waitForTimeout(ms);

/** id, persona, route, and the steps that open the dialog. */
const SCENARIOS = [
  { id: '1137-new-matter', persona: 'director', route: '/matters', open: async (p) => { await p.getByRole('button', { name: /New matter/i }).first().click(); } },
  { id: '1137-new-priority', persona: 'admin', route: '/admin/priorities', open: async (p) => { await p.getByRole('button', { name: /New priority/i }).first().click(); } },
  { id: '1137-confirm', persona: 'admin', route: '/admin/priorities', open: async (p) => {
    await p.getByRole('button', { name: /actions|more|options/i }).first().click(); await wait(p, 400);
    await p.getByRole('menuitem', { name: /Deactivate|Delete/i }).first().click(); } },
  ...(globalThis.EXTRA ?? []),
];

const browser = await launch();
const report = {};
for (const s of SCENARIOS) {
  if (filter && !filter.test(s.id)) continue;
  for (const [w, h] of SIZES) {
    const { ctx, page, base } = await openApp(browser, w, h);
    await ctx.addInitScript((persona) => localStorage.setItem('mf.stubScenario', persona), s.persona);
    page.on('pageerror', (e) => console.log('PAGEERR', s.id, e.message.slice(0, 160)));
    try {
      await page.goto(base + s.route);
      await wait(page, 2500);
      await s.open(page);
      await wait(page, 1200);
      const m = await page.evaluate(() => {
        const d = document.querySelector('.p-dialog.mf-dlg') ?? document.querySelector('.p-dialog');
        if (!d) return null;
        const r = (el) => (el ? el.getBoundingClientRect() : null);
        const px = (el) => (el ? `${Math.round(r(el).width)}x${Math.round(r(el).height)}` : null);
        const cs = getComputedStyle(d);
        const body = d.querySelector('.p-dialog-content');
        return {
          dialog: px(d), radius: cs.borderRadius, header: px(d.querySelector('.p-dialog-header')), footer: px(d.querySelector('.p-dialog-footer')),
          close: px(d.querySelector('.mf-dlg__x, .p-dialog-close-button')), titleSize: getComputedStyle(d.querySelector('.mf-dlg__title, .p-dialog-title')).fontSize,
          footerBorder: getComputedStyle(d.querySelector('.p-dialog-footer')).borderTopWidth,
          buttons: [...d.querySelectorAll('.p-dialog-footer button')].map((b) => b.textContent.trim()),
          bodyScrollsSideways: body ? body.scrollWidth > body.clientWidth : null,
          pageOverflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
          viewportFit: r(d).bottom <= window.innerHeight && r(d).right <= window.innerWidth,
        };
      });
      report[`${s.id}-${w}x${h}`] = m;
      await page.screenshot({ path: `${out}/${s.id}-${w}x${h}.png` });
    } catch (e) {
      report[`${s.id}-${w}x${h}`] = `FAILED: ${String(e).split('\n')[0]}`;
    }
    await ctx.close();
  }
}
writeFileSync(`${out}/measurements-${process.argv[3] ?? "all"}.json`, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 1));
await browser.close();
