// Batch 3b screenshots (UI update 2): confirm dialogs (#1141), drawers (#1142), menus (#1143). Usage:
//   node shots-batch3b.mjs <outDir> <filter-regex> [baseUrl=http://localhost:4294]
// Saves <out>/<id>-<w>x<h>.png and prints measurements as JSON lines. A scenario that cannot open (the mock has generic data) prints MISS and is skipped.
import { launch, openApp, SIZES } from './shot.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';

const out = process.argv[2];
const filter = process.argv[3] ? new RegExp(process.argv[3]) : null;
const base = process.argv[4] ?? 'http://localhost:4294';
mkdirSync(out, { recursive: true });
const wait = (p, ms = 900) => p.waitForTimeout(ms);
const openRowMenu = async (p, item, n = 0) => {
  await p.getByRole('button', { name: /actions|more|options/i }).nth(n).click();
  await wait(p, 400);
  await p.getByRole('menuitem', { name: item }).first().click();
};
const tab = async (p, name) => { await p.getByRole('tab', { name }).click(); await wait(p, 1500); };
const userMenu = async (p) => { await p.locator('[data-testid="user-menu"]').click(); await wait(p, 400); };

const CONFIRMS = [
  { id: '1141-priority-deactivate', persona: 'admin', route: '/admin/priorities', open: (p) => openRowMenu(p, /^Deactivate/i) },
  { id: '1141-priority-default', persona: 'admin', route: '/admin/priorities', open: (p) => openRowMenu(p, /default/i, 1) },
  { id: '1141-link-role-deactivate', persona: 'admin', route: '/admin/asset-link-roles', open: (p) => openRowMenu(p, /^Deactivate/i) },
  { id: '1141-asset-type-deactivate', persona: 'admin', route: '/admin/asset-types', open: (p) => openRowMenu(p, /^Deactivate/i) },
  { id: '1141-pod-deactivate', persona: 'admin', route: '/admin/pods', open: async (p) => { await p.locator('tbody tr a, tbody tr button').first().click(); await wait(p, 1200); await openRowMenu(p, /^Deactivate/i); } },
  { id: '1141-step-deactivate', persona: 'admin', route: '/admin/steps', open: (p) => openRowMenu(p, /^Deactivate/i) },
  { id: '1141-workflow-deactivate', persona: 'admin', route: '/admin/workflows', open: (p) => openRowMenu(p, /^Deactivate/i) },
  { id: '1141-task-type-deactivate', persona: 'admin', route: '/admin/task-types', open: (p) => openRowMenu(p, /^Deactivate/i) },
  { id: '1141-report-deactivate', persona: 'admin', route: '/admin/reports', open: (p) => openRowMenu(p, /^Deactivate/i) },
  { id: '1141-on-hold-reason-deactivate', persona: 'admin', route: '/admin/on-hold-reasons', open: (p) => openRowMenu(p, /^Deactivate/i) },
  { id: '1141-user-deactivate', persona: 'admin', route: '/admin/users', open: async (p) => {
    await p.getByRole('button', { name: /^Active/ }).click(); await wait(p, 1200);
    await p.getByRole('button', { name: /^Actions for/ }).first().click(); await wait(p, 400);
    await p.getByRole('menuitem', { name: /^Deactivate/ }).first().click(); } },
  { id: '1141-client-inactive', persona: 'admin', route: '/clients/1', open: (p) => openRowMenu(p, /^Set Inactive/i) },
  { id: '1141-matter-inactive', persona: 'admin', route: '/matters/1', open: (p) => openRowMenu(p, /^Set Inactive/i) },
  { id: '1141-project-archive', persona: 'admin', route: '/projects/1', open: (p) => openRowMenu(p, /^Archive/i) },
  { id: '1141-asset-inactive', persona: 'admin', route: '/assets/1', open: (p) => openRowMenu(p, /^Set Inactive/i) },
  { id: '1141-task-hold', persona: 'admin', route: '/tasks/1', open: async (p) => {
    await p.locator('[data-status] [data-inline-trigger]').first().click(); await wait(p, 400);
    await p.locator('[data-option=HOLD]').click(); } },
  { id: '1141-task-cancel', persona: 'admin', route: '/tasks/1', open: async (p) => {
    await p.locator('[data-status] [data-inline-trigger]').first().click(); await wait(p, 400);
    await p.locator('[data-option=CANCEL]').click(); } },
  { id: '1141-shortcuts', persona: 'director', route: '/my-work', open: async (p) => { await userMenu(p); await p.getByRole('menuitem', { name: /Keyboard/i }).click(); } },
  { id: '1141-leave', persona: 'admin', route: '/clients/1/edit', open: async (p) => {
    await p.locator('input').first().fill('Changed name'); await wait(p, 300);
    await p.locator('nav[aria-label="Breadcrumb"] a').first().click(); } },
];

const MENUS = [
  { id: '1143-user-menu', persona: 'director', route: '/my-work', open: userMenu, sel: '.um-pop' },
  { id: '1143-bell-panel', persona: 'director', route: '/my-work', open: async (p) => { await p.getByRole('button', { name: /Notifications/i }).first().click(); }, sel: '.np' },
  { id: '1143-row-menu', persona: 'admin', route: '/tasks', open: async (p) => { await p.getByRole('button', { name: /actions|more/i }).first().click(); }, sel: '.am__menu' },
  { id: '1143-header-menu', persona: 'admin', route: '/matters/1', open: async (p) => { await p.getByRole('button', { name: 'More actions' }).first().click(); }, sel: '.am__menu' },
  { id: '1143-more-views', persona: 'admin', route: '/tasks', open: async (p) => { await p.getByRole('button', { name: /^More/ }).first().click(); }, sel: '[role=menu], .qv__more, .qv-pop' },
  { id: '1143-options-menu', persona: 'admin', route: '/matters', open: async (p) => { await p.locator('[data-options-trigger]').first().click(); }, sel: '.om__panel' },
  { id: '1143-columns-menu', persona: 'admin', route: '/matters', open: async (p) => { await p.getByRole('button', { name: /^Columns/ }).first().click(); }, sel: '[role=dialog], .gc__panel, .cm__panel' },
  { id: '1143-filter-popover', persona: 'admin', route: '/tasks', open: async (p) => { await p.getByRole('button', { name: /^Filters/ }).first().click(); await wait(p, 500); }, sel: 'mf-filter-popover, [role=dialog]' },
  { id: '1143-new-menu', persona: 'admin', route: '/my-matters', open: async (p) => { await p.locator('button', { hasText: /^\s*New\s*$/ }).first().click(); }, sel: '[role=menu]' },
];

const DRAWERS = [
  { id: '1142-activity', persona: 'admin', route: '/clients/1', open: async (p) => { await p.getByRole('button', { name: /^Activity/ }).first().click(); } },
  { id: '1142-user-drawer', persona: 'admin', route: '/admin/users', open: async (p) => {
    await p.getByRole('button', { name: /^Active/ }).click(); await wait(p, 1200);
    await p.locator('[data-user-open], tbody tr button').first().click(); } },
  { id: '1142-person', persona: 'admin', route: '/dashboard', open: async (p) => { await tab(p, /Users/); await p.locator('[data-user-card], article button, .card button').first().click(); } },
  { id: '1142-unassigned', persona: 'admin', route: '/dashboard', open: async (p) => { await tab(p, /Users/); await p.getByRole('button', { name: /unassigned/i }).first().click(); } },
  { id: '1142-coverage', persona: 'admin', route: '/dashboard', open: async (p) => { await tab(p, /Users/); await p.getByRole('button', { name: /^Coverage/ }).first().click(); await wait(p, 1500); await p.locator('[data-coverage-cell] button, td button').first().click(); } },
  { id: '1142-swimlane', persona: 'admin', route: '/dashboard', open: async (p) => { await tab(p, /Swimlane/); await p.locator('[data-card], [data-swimlane-card]').first().click(); } },
];

const ALL = [...CONFIRMS.map((s) => ({ ...s, kind: 'dlg' })), ...MENUS.map((s) => ({ ...s, kind: 'menu' })), ...DRAWERS.map((s) => ({ ...s, kind: 'drawer' }))];

const browser = await launch();
const report = {};
for (const s of ALL) {
  if (filter && !filter.test(s.id)) continue;
  for (const [w, h] of SIZES) {
    const { ctx, page } = await openApp(browser, w, h);
    await ctx.addInitScript((persona) => localStorage.setItem('mf.stubScenario', persona), s.persona);
    try {
      await page.goto(base + s.route);
      await wait(page, 2500);
      await s.open(page);
      await wait(page, 1200);
      const m = await page.evaluate(({ kind, sel }) => {
        const r = (el) => (el ? el.getBoundingClientRect() : null);
        const px = (el) => (el ? { w: Math.round(r(el).width * 10) / 10, h: Math.round(r(el).height * 10) / 10 } : null);
        if (kind === 'menu') {
          const el = sel ? document.querySelector(sel) : null;
          if (!el) return null;
          const cs = getComputedStyle(el);
          const item = el.querySelector('button[role=menuitem], .am__item, .um-item, [role=menuitem], a[role=menuitem]');
          const ics = item?.querySelector('.pi');
          return { box: px(el), radius: cs.borderRadius, border: cs.borderTopWidth + ' ' + cs.borderTopColor, shadow: cs.boxShadow.slice(0, 60), padding: cs.padding,
            item: px(item), itemFont: item ? getComputedStyle(item).fontSize : null, icon: ics ? getComputedStyle(ics).fontSize : null, bottom: Math.round(r(el).bottom), winH: innerHeight };
        }
        const d = [...document.querySelectorAll('.p-dialog')].pop();
        if (!d) return null;
        const title = d.querySelector('.p-dialog-title, [data-panel-title]');
        return { dialog: px(d), header: px(d.querySelector('.p-dialog-header')), footer: px(d.querySelector('.p-dialog-footer')), close: px(d.querySelector('.mf-dlg__x, .p-dialog-close-button')),
          closeBg: getComputedStyle(d.querySelector('.mf-dlg__x, .p-dialog-close-button') ?? d).backgroundColor, closeColor: getComputedStyle(d.querySelector('.mf-dlg__x, .p-dialog-close-button') ?? d).color,
          title: title?.textContent.trim().slice(0, 80), titleSize: title ? getComputedStyle(title).fontSize : null, buttons: [...d.querySelectorAll('.p-dialog-footer button')].map((b) => b.textContent.trim()),
          overflowX: document.documentElement.scrollWidth > innerWidth };
      }, { kind: s.kind, sel: s.sel });
      if (!m) { console.log('MISS', s.id, w); await ctx.close(); continue; }
      await page.screenshot({ path: `${out}/${s.id}-${w}x${h}.png` });
      report[`${s.id}-${w}`] = m;
      console.log(JSON.stringify({ id: s.id, w, ...m }));
    } catch (e) {
      console.log('MISS', s.id, w, String(e.message).split('\n')[0].slice(0, 120));
    }
    await ctx.close();
  }
}
writeFileSync(`${out}/measurements-3b-${filter ? filter.source.replace(/\W+/g, '_') : 'all'}.json`, JSON.stringify(report, null, 1));
await browser.close();
