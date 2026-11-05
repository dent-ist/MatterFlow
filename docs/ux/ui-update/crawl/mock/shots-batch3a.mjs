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
  { id: '1138-edit-task', persona: 'admin', route: '/tasks/1', open: async (p) => { await p.locator('[data-action="edit"]').first().click(); } },
  { id: '1138-complete-task', persona: 'admin', route: '/tasks/1', open: async (p) => { await p.getByRole('button', { name: 'Complete Task' }).first().click(); } },
  { id: '1138-bulk-tasks', persona: 'admin', route: '/matters/1', open: async (p) => {
    await p.getByRole('tab', { name: /Tasks/ }).click(); await wait(p, 1500);
    await p.getByRole('button', { name: 'Select', exact: true }).click(); await wait(p, 500);
    await p.locator('[data-select-all]').click(); await wait(p, 300);
    await p.getByRole('button', { name: /Re-assign/ }).first().click(); } },
  { id: '1138-add-comment', persona: 'admin', route: '/matters/1', open: async (p) => {
    await p.getByRole('button', { name: 'More actions' }).first().click(); await wait(p, 400);
    await p.getByRole('menuitem', { name: /Add Comment/i }).first().click(); } },
  { id: '1139-set-out-of-office', persona: 'director', route: '/my-work', open: async (p) => {
    await p.getByRole('button', { name: /account menu|Test User|Dana/i }).first().click(); await wait(p, 400);
    await p.getByRole('menuitem', { name: /Set out of office/i }).click(); } },
  { id: '1139-add-out-of-office', persona: 'director', route: '/profile', open: async (p) => { await p.getByRole('button', { name: /Add out of office/i }).first().click(); } },
  { id: '1139-add-event', persona: 'admin', route: '/my-matters', open: async (p) => {
    await p.locator('button', { hasText: /^\s*New\s*$/ }).first().click(); await wait(p, 400);
    await p.getByText('New Calendar Item').first().click(); } },
  { id: '1139-change-managers', persona: 'admin', route: '/matters/1', open: async (p) => { await p.locator('button', { hasText: /^\s*Change\s*$/ }).first().click(); } },
  { id: '1139-availability', persona: 'admin', route: '/admin/users', open: async (p) => {
    await p.getByRole('button', { name: /^Active/ }).click(); await wait(p, 1200);
    await p.getByRole('button', { name: /^Actions for/ }).first().click(); await wait(p, 400);
    await p.getByRole('menuitem', { name: /Edit availability/i }).first().click(); } },
  { id: '1140-new-priority', persona: 'admin', route: '/admin/priorities', open: async (p) => { await p.getByRole('button', { name: /New priority/i }).first().click(); } },
  { id: '1140-add-holiday', persona: 'admin', route: '/admin/settings', open: async (p) => {
    await p.getByRole('tab', { name: /Holidays/i }).click(); await wait(p, 1200); await p.getByRole('button', { name: /^Add holiday/i }).first().click(); } },
  { id: '1140-import-holidays', persona: 'admin', route: '/admin/settings', open: async (p) => {
    await p.getByRole('tab', { name: /Holidays/i }).click(); await wait(p, 1200); await p.getByRole('button', { name: /Import/i }).first().click(); } },
  { id: '1140-edit-calendar', persona: 'admin', route: '/admin/settings', open: async (p) => {
    await p.getByRole('tab', { name: /Holidays/i }).click(); await wait(p, 1200); await p.getByRole('button', { name: /^Edit calendar/i }).first().click(); } },
  { id: '1140-change-disposition', persona: 'admin', route: '/assets/1', open: async (p) => {
    await p.getByRole('button', { name: 'More actions' }).first().click(); await wait(p, 400);
    await p.getByRole('menuitem', { name: /Change disposition/i }).first().click(); } },
  { id: '1140-assign-work', persona: 'admin', route: '/dashboard', open: async (p) => {
    await p.getByRole('tab', { name: /Users/ }).click(); await wait(p, 1800);
    await p.getByRole('button', { name: /^Assign work to/ }).first().click(); } },
  { id: '1138-skip-step', persona: 'admin', route: '/tasks/1', open: async (p) => { await p.getByRole('button', { name: 'Skip step' }).first().click(); } },
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
