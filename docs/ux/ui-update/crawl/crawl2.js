// UI update 2 crawl (desktop only). Usage: node crawl.js <outDir> <persona|all> <WxH|all> [pageFilter]
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const OUT = process.argv[2];
const PERS = process.argv[3] || 'all';
const SIZES = (process.argv[4] || 'all') === 'all' ? ['1366x768', '1920x1080'] : [process.argv[4]];
const FILTER = process.argv[5] ? new RegExp(process.argv[5]) : null;
const BASE = 'http://localhost:4200';
const USERS = {
  director: 'KE\\testuser02', podlead: 'KE\\testuser06', tech: 'KE\\testuser01',
  admin: 'KE\\kekim', pm: 'KE\\testuser35', pending: 'KE\\newhire',
};
const log = [];
const meas = {};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function ids() {
  const get = async (p) => (await fetch(`http://localhost:5080/api/v1/${p}`, { headers: { 'X-Dev-User': USERS.admin } })).json();
  const out = {};
  out.matter = (await get('matters')).items[0].matterId;
  out.client = (await get('clients')).items[0].clientId;
  out.project = (await get('projects')).items[0].projectId;
  out.asset = (await get('assets')).items[0].assetId;
  const t = (await get('tasks?pageSize=20')).items;
  out.task = (t.find((x) => x.status === 'IN_PROGRESS') || t[0]).taskId;
  out.q = 'Demo';
  return out;
}

async function settle(page, ms = 900) { ms += 1100;
  try { await page.waitForLoadState('networkidle', { timeout: 8000 }); } catch {}
  await sleep(ms);
}

async function measure(page, key) {
  try {
    meas[key] = await page.evaluate(() => {
      const sels = {
        button: '.mf-btn, .p-button, button.mf-seg__btn', input: 'input:not([type=checkbox]):not([type=radio]):not([type=hidden]), textarea, select',
        dropdown: 'mf-dropdown', tab: '[role=tab]', th: 'th', row: 'tbody tr', chip: '[class*=chip], mf-status-chip, mf-priority-pill, mf-badge',
        h1: 'h1', card: '[class*=card]', dialog: '.p-dialog', link: 'a:not([class])',
      };
      const out = {};
      for (const [k, s] of Object.entries(sels)) {
        const vals = {};
        document.querySelectorAll(s).forEach((e) => {
          const r = e.getBoundingClientRect();
          if (r.width < 2 || r.height < 2) return;
          const cs = getComputedStyle(e);
          const kk = `${Math.round(r.height)}h/${cs.fontSize}/${cs.fontWeight}/r${cs.borderTopLeftRadius}` + (k === 'dialog' ? `/w${Math.round(r.width)}` : '');
          vals[kk] = (vals[kk] || 0) + 1;
        });
        out[k] = vals;
      }
      return out;
    });
  } catch (e) { /* ignore */ }
}

let ctxInfo;
async function shot(page, folder, name) {
  const dir = path.join(OUT, folder);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${ctxInfo.persona}-${name}-${ctxInfo.size}.png`);
  await page.screenshot({ path: file });
  await measure(page, `${folder}/${ctxInfo.persona}-${name}-${ctxInfo.size}`);
  log.push(`OK ${file}`);
}

async function go(page, url, wait = 900) {
  await page.goto(BASE + url, { waitUntil: 'domcontentloaded' });
  await settle(page, wait);
}
async function click(page, rx, role = 'button', { nth = 0, timeout = 2500 } = {}) {
  const loc = page.getByRole(role, { name: rx }).nth(nth);
  await loc.click({ timeout });
  await sleep(500);
}
async function tryStep(label, fn) {
  try { await fn(); } catch (e) { log.push(`FAIL ${ctxInfo.persona} ${ctxInfo.size} ${label}: ${String(e.message).split('\n')[0].slice(0, 120)}`); }
}
async function esc(page) { await page.keyboard.press('Escape'); await sleep(400); }


const byText = (page, rx, sel='button, a') => page.locator(sel).filter({ hasText: rx });
async function clickT(page, rx, sel) { await byText(page, rx, sel).first().click({ timeout: 3000 }); await sleep(700); }
function recipes(I) {
  const R = []; const add = (persona, folder, fn) => R.push({ persona, folder, fn });
  add('director', 'shell', async (page) => {
    await go(page, '/dashboard', 900);
    await tryStep('user menu', async () => { await page.locator('button.um-trigger').click(); await sleep(600); await shot(page, 'shell', 'user-menu'); await esc(page); });
    await tryStep('bell', async () => { await page.locator('button.nb__button').click(); await sleep(800); await shot(page, 'shell', 'bell-panel'); await esc(page); });
    await tryStep('search box focus', async () => { await go(page, '/matters', 700); await page.locator('input[type=search], input[placeholder*="Search clients"]').first().fill('Demo'); await sleep(1500); await shot(page, 'shell', 'global-search-results'); await esc(page); });
    await tryStep('nav collapsed hover', async () => { await go(page, '/tasks', 700); await page.locator('button.mf-menu-btn').click({ timeout: 1500 }).catch(()=>{}); });
  });
  add('director', 'create-task', async (page) => {
    await go(page, '/tasks/new', 1200);
    await tryStep('pick type', async () => { await page.locator('main [class*=card], main button').filter({ hasText: /General \/ Ad Hoc/ }).first().click({ timeout: 3000 }); await settle(page, 1200); await shot(page, 'create-task', 'form-after-type'); });
    await tryStep('validate', async () => { await page.evaluate(() => document.querySelector('main')?.scrollTo?.(0, 99999)); await clickT(page, /^\s*Create task/i, 'button'); await sleep(800); await shot(page, 'create-task', 'validation'); });
    await tryStep('email intake', async () => { await go(page, '/tasks/new', 900); await clickT(page, /Fill from email/i, 'button'); await sleep(900); await shot(page, 'create-task', 'email-intake'); });
  });
  add('director', 'matters', async (page) => {
    await go(page, `/matters/${I.matter}`, 1300);
    await tryStep('header New menu', async () => { await page.locator('button:has-text("New")').filter({ hasNotText: /Task|Matter|Project/ }).first().click({ timeout: 3000 }); await sleep(600); await shot(page, 'matters', 'header-new-menu'); await esc(page); });
    await tryStep('header ... menu', async () => { await page.locator('[aria-label*="ore" i], button:has-text("...")').last().click({ timeout: 3000 }); await sleep(600); await shot(page, 'matters', 'header-more-menu'); });
    await go(page, '/matters', 1000);
    await tryStep('select mode', async () => { await clickT(page, /^\s*Select/i, 'button'); await sleep(600); await page.locator('tbody tr input[type=checkbox], tbody tr [role=checkbox]').first().click({ timeout: 2500 }); await sleep(600); await shot(page, 'matters', 'bulk-select'); });
    await tryStep('empty search', async () => { await go(page, '/matters', 900); await page.getByPlaceholder(/Search matters/i).fill('zzzzqq'); await sleep(1800); await shot(page, 'matters', 'empty-no-match'); });
    await tryStep('error state', async () => { await page.route('**/api/v1/matters?*', (r) => r.abort()); await page.route('**/api/v1/matters', (r) => r.abort()); await go(page, '/matters', 1500); await shot(page, 'matters', 'error-state'); await page.unroute('**/api/v1/matters?*'); await page.unroute('**/api/v1/matters'); });
    await tryStep('matter inactive confirm', async () => {
      await go(page, `/matters/${I.matter}`, 1200); await page.locator('button[aria-label*="ore" i], button:has-text("...")').last().click({ timeout: 3000 }); await sleep(500);
      await page.getByRole('menuitem').first().click({ timeout: 2000 }); await sleep(900); await shot(page, 'matters', 'menu-action-dialog'); await esc(page);
    });
  });
  add('director', 'task-queue', async (page) => {
    await go(page, '/tasks', 1200);
    await tryStep('search empty', async () => { await page.getByPlaceholder(/Search tasks/i).fill('zzzzqq'); await sleep(1800); await shot(page, 'task-queue', 'empty-no-match'); });
    await tryStep('more views', async () => { await go(page, '/tasks', 900); await page.locator('button.qv-more').click(); await sleep(500); await shot(page, 'task-queue', 'more-views-menu'); await esc(page); });
    await tryStep('dots menu', async () => { await go(page, '/tasks', 900); await page.locator('main button').filter({ hasText: /^\s*\.\.\.\s*$|^$/ }).filter({ has: page.locator('.pi-ellipsis-h') }).first().click({ timeout: 2500 }); await sleep(500); await shot(page, 'task-queue', 'dots-menu'); await esc(page); });
    await tryStep('assignee menu', async () => { await go(page, '/tasks', 900); await page.locator('tbody tr').nth(1).locator('button').filter({ hasText: /Unassigned|Test User/ }).first().click({ timeout: 2500 }); await sleep(900); await shot(page, 'task-queue', 'assignee-menu'); await esc(page); });
    await tryStep('priority menu', async () => { await go(page, '/tasks', 900); await page.locator('tbody tr').nth(1).locator('button').filter({ hasText: /Critical|High|Normal|Low/ }).first().click({ timeout: 2500 }); await sleep(700); await shot(page, 'task-queue', 'priority-menu'); await esc(page); });
    await tryStep('error', async () => { await page.route('**/api/v1/tasks**', (r) => r.abort()); await go(page, '/tasks', 1500); await shot(page, 'task-queue', 'error-state'); });
  });
  add('director', 'clients', async (page) => {
    await tryStep('empty', async () => { await go(page, '/clients', 900); await page.getByPlaceholder(/Search clients/i).fill('zzzzqq'); await sleep(1800); await shot(page, 'clients', 'empty-no-match'); });
    await tryStep('error', async () => { await page.route('**/api/v1/clients**', (r) => r.abort()); await go(page, '/clients', 1500); await shot(page, 'clients', 'error-state'); });
  });
  add('director', 'assets', async (page) => {
    await go(page, `/assets/${I.asset}`, 1300);
    await tryStep('more menu', async () => { await page.locator('button[aria-label*="ore" i], button:has(.pi-ellipsis-h)').last().click({ timeout: 3000 }); await sleep(500); await shot(page, 'assets', 'record-more-menu'); });
    await tryStep('disp', async () => { await go(page, `/assets/${I.asset}`, 1000); await clickT(page, /Disposition/i, 'button'); await sleep(900); await shot(page, 'assets', 'disposition-dialog'); await esc(page); });
  });
  add('director', 'task-page', async (page) => {
    await go(page, `/tasks/${I.task}`, 1500);
    await tryStep('status dropdown', async () => { await page.locator('mf-task-facts button, [class*=facts] button').first().click({ timeout: 3000 }); await sleep(700); await shot(page, 'task-page', 'status-menu'); await esc(page); });
    await tryStep('more menu', async () => { await page.locator('button:has(.pi-ellipsis-h)').first().click({ timeout: 3000 }); await sleep(600); await shot(page, 'task-page', 'more-menu'); await esc(page); });
    await tryStep('copy link toast', async () => { await page.locator('button:has(.pi-ellipsis-h)').first().click(); await sleep(500); await page.getByRole('menuitem', { name: /copy/i }).first().click({ timeout: 2000 }); await sleep(700); await shot(page, 'task-page', 'toast'); });
    await tryStep('activity', async () => { await go(page, `/tasks/${I.task}`, 1000); await clickT(page, /^\s*Activity/i, 'button'); await sleep(900); await shot(page, 'task-page', 'activity-drawer'); await esc(page); });
    await tryStep('hold dialog', async () => { await go(page, `/tasks/${I.task}`, 1000); await page.locator('button:has-text("Hold")').first().click({ timeout: 2500 }); await sleep(800); await shot(page, 'task-page', 'hold-dialog'); await esc(page); });
    await tryStep('complete', async () => { await go(page, `/tasks/${I.task}`, 1000); await clickT(page, /^\s*Complete task/i, 'button'); await sleep(900); await shot(page, 'task-page', 'complete-dialog'); await esc(page); });
  });
  add('admin', 'admin-lookups', async (page) => {
    await tryStep('note tags tab', async () => { await go(page, '/admin/note-tags', 1200); await shot(page, 'admin-lookups', 'admin-tab-note-tags'); });
    for (const [n, url, rx] of [['priorities', '/admin/priorities', /^\s*New Priority/], ['asset-types', '/admin/asset-types', /^\s*New /], ['custom-fields', '/admin/custom-fields', /^\s*New /], ['link-roles', '/admin/asset-link-roles', /^\s*New /], ['status-labels', '/admin/status-labels', /^\s*New /], ['hold-reasons', '/admin/on-hold-reasons', /^\s*New /], ['note-tags', '/admin/note-tags', /^\s*New /]]) {
      await tryStep(`new ${n}`, async () => { await go(page, url, 1100); await clickT(page, rx, 'button'); await settle(page, 700); await shot(page, 'admin-lookups', `admin-new-${n}`); await esc(page); });
    }
    await tryStep('priority row menu', async () => { await go(page, '/admin/priorities', 900); await page.locator('button.am__trigger').first().click(); await sleep(500); await shot(page, 'admin-lookups', 'admin-row-menu'); await esc(page); });
    await tryStep('asset type record', async () => { await go(page, '/admin/asset-types', 1000); await page.locator('tbody a').first().click(); await settle(page, 1200); await shot(page, 'admin-lookups', 'admin-asset-type-record'); });
    await tryStep('custom fields form', async () => { await go(page, '/admin/custom-fields', 1000); await page.locator('tbody a, tbody button').first().click(); await settle(page, 1500); await shot(page, 'admin-lookups', 'admin-custom-fields-form'); });
    await tryStep('delete confirm', async () => { await go(page, '/admin/priorities', 900); await page.locator('button.am__trigger').nth(3).click(); await sleep(400); await page.getByRole('menuitem', { name: /delete|deactivate|retire/i }).first().click({ timeout: 2000 }); await sleep(800); await shot(page, 'admin-lookups', 'admin-confirm-dialog'); await esc(page); });
  });
  add('admin', 'admin-users-roles-pods', async (page) => {
    await tryStep('roles list', async () => { await go(page, '/admin/users?tab=roles', 1300); await page.locator('button:has-text("New Role"), button:has-text("New role")').first().click({ timeout: 3000 }); await settle(page, 900); await shot(page, 'admin-users-roles-pods', 'admin-new-role'); });
    await tryStep('role editor', async () => { await go(page, '/admin/users?tab=roles', 1300); await page.locator('main tbody tr, main [role=row], main li').nth(1).click({ timeout: 3000 }); await settle(page, 1000); await shot(page, 'admin-users-roles-pods', 'admin-role-editor'); });
    await tryStep('pods new', async () => { await go(page, '/admin/users?tab=pods', 1300); await page.locator('button:has-text("New Pod"), button:has-text("New pod")').first().click({ timeout: 3000 }); await settle(page, 900); await shot(page, 'admin-users-roles-pods', 'admin-new-pod'); });
    await tryStep('pod editor', async () => { await go(page, '/admin/users?tab=pods', 1300); await page.locator('main tbody tr').first().click({ timeout: 3000 }); await settle(page, 1000); await shot(page, 'admin-users-roles-pods', 'admin-pod-editor'); });
    await tryStep('users all', async () => { await go(page, '/admin/users', 1000); await page.getByRole('button', { name: /^All/ }).first().click(); await settle(page, 900); await shot(page, 'admin-users-roles-pods', 'admin-users-all'); });
    await tryStep('users other filters', async () => { await clickT(page, /Other filters/i, 'button'); await sleep(700); await shot(page, 'admin-users-roles-pods', 'admin-users-other-filters'); await esc(page); });
  });
  add('admin', 'admin-task-types', async (page) => {
    await tryStep('new task type', async () => { await go(page, '/admin/task-types', 1100); await clickT(page, /^\s*New Task Type/i, 'button'); await settle(page, 1200); await shot(page, 'admin-task-types', 'admin-new-task-type'); });
    await tryStep('task type form designer', async () => { await go(page, '/admin/task-types', 1100); await page.locator('tbody a').first().click(); await settle(page, 1300); await shot(page, 'admin-task-types', 'admin-task-type-edit'); await clickT(page, /Form/i, 'button, [role=tab]').catch(()=>{}); await settle(page, 1200); await shot(page, 'admin-task-types', 'admin-task-type-form-tab'); });
    await tryStep('workflows', async () => { await go(page, '/admin/task-types?tab=workflows', 1100); await page.locator('tbody a').first().click(); await settle(page, 1400); await shot(page, 'admin-task-types', 'admin-workflow-record'); });
    await tryStep('steps', async () => { await go(page, '/admin/task-types?tab=steps', 1100); await page.locator('tbody a').first().click(); await settle(page, 1400); await shot(page, 'admin-task-types', 'admin-step-record'); });
    await tryStep('new workflow btn', async () => { await go(page, '/admin/task-types?tab=workflows', 1100); await clickT(page, /^\s*New /i, 'button'); await settle(page, 1000); await shot(page, 'admin-task-types', 'admin-new-workflow-click'); });
  });
  add('admin', 'admin-reports-audit-settings', async (page) => {
    await tryStep('settings save toast', async () => { await go(page, '/admin/settings?tab=dashboard', 1300); await page.locator('input[type=number]').first().fill('2'); await sleep(300); await clickT(page, /^\s*Save/i, 'button'); await sleep(800); await shot(page, 'admin-reports-audit-settings', 'settings-save-toast'); });
    await tryStep('holiday calendar', async () => { await go(page, '/admin/settings?tab=holidays', 1300); await page.locator('tbody a, tbody button, [class*=cal] button').first().click({ timeout: 3000 }); await settle(page, 900); await shot(page, 'admin-reports-audit-settings', 'settings-holidays-detail'); });
    await tryStep('new report', async () => { await go(page, '/admin/reports', 1200); await clickT(page, /New Report/i, 'button'); await settle(page, 1500); await shot(page, 'admin-reports-audit-settings', 'report-new'); });
    await tryStep('audit filter', async () => { await go(page, '/admin/audit', 1200); await clickT(page, /Filters/i, 'button'); await sleep(700); await shot(page, 'admin-reports-audit-settings', 'audit-filters'); });
  });
  add('director', 'dashboard', async (page) => {
    await tryStep('swimlane select', async () => { await go(page, '/dashboard', 900); await click(page, /^\s*Swimlane/i, 'tab'); await settle(page, 900); await page.locator('select').first().focus(); await shot(page, 'dashboard', 'swimlane-native-select'); });
    await tryStep('swimlane drawer', async () => { await page.locator('a, button').filter({ hasText: /^TSK-/ }).first().click({ timeout: 3000 }).catch(() => {}); await page.locator('[class*=card]').first().click({ timeout: 3000 }); await sleep(900); await shot(page, 'dashboard', 'swimlane-drawer'); await esc(page); });
    await tryStep('summary assign picker', async () => { await go(page, '/dashboard', 900); await click(page, /^\s*Summary/i, 'tab'); await settle(page, 900); await click(page, /Unassigned/i); await sleep(900); await page.locator('tbody tr button').filter({ hasText: /Unassigned/ }).first().click({ timeout: 3000 }); await sleep(900); await shot(page, 'dashboard', 'summary-assign-picker'); await esc(page); });
    await tryStep('summary unassigned card', async () => { await go(page, '/dashboard', 900); await click(page, /Unassigned/i); await sleep(1200); await shot(page, 'dashboard', 'summary-card-unassigned-on'); });
    await tryStep('summary battery people', async () => { await go(page, '/dashboard', 900); await page.locator('button[aria-label="People"]').click({ timeout: 3000 }); await sleep(900); await shot(page, 'dashboard', 'summary-people-dialog'); await esc(page); });
    await tryStep('users legend info', async () => { await go(page, '/dashboard', 900); await click(page, /^\s*Users/i, 'tab'); await settle(page, 900); await page.locator('button[aria-label*="states" i], button[aria-label*="counted" i]').first().click({ timeout: 3000 }); await sleep(700); await shot(page, 'dashboard', 'users-info-popover'); await esc(page); });
    await tryStep('users assign', async () => { await go(page, '/dashboard', 900); await click(page, /^\s*Users/i, 'tab'); await settle(page, 900); await page.locator('button[aria-label*="Assign work"]').first().click({ timeout: 3000, force: true }); await sleep(900); await shot(page, 'dashboard', 'users-assign-dialog'); await esc(page); });
    await tryStep('calendar day', async () => { await go(page, '/dashboard', 900); await click(page, /^\s*Calendar/i, 'tab'); await settle(page, 1200); await page.locator('[role=gridcell], td button').nth(10).click({ timeout: 3000 }); await sleep(900); await shot(page, 'dashboard', 'calendar-day-panel'); });
    await tryStep('trends controls', async () => { await go(page, '/dashboard', 900); await click(page, /^\s*Trends/i, 'tab'); await settle(page, 1500); await page.locator('select').first().focus(); await shot(page, 'dashboard', 'trends-controls'); });
  });
  add('tech', 'dashboard', async (page) => { await go(page, '/dashboard', 1800); await shot(page, 'dashboard', 'technician-queue'); });
  add('pm', 'my-matters', async (page) => {
    await go(page, '/my-matters', 1500);
    await tryStep('options', async () => { await clickT(page, /^\s*Options/i, 'button'); await sleep(600); await shot(page, 'my-matters', 'options-menu'); await esc(page); });
    await tryStep('show dd', async () => { await clickT(page, /Show:/i, 'button'); await sleep(600); await shot(page, 'my-matters', 'show-dropdown'); await esc(page); });
    await tryStep('filters', async () => { await clickT(page, /^\s*Filters/i, 'button'); await sleep(700); await shot(page, 'my-matters', 'filters-open'); await esc(page); });
  });
  add('director', 'notifications-search-profile', async (page) => {
    await tryStep('search no results', async () => { await go(page, '/search?q=zzzzqq', 1500); await shot(page, 'notifications-search-profile', 'search-empty'); });
    await tryStep('search tab tasks', async () => { await go(page, '/search?q=Demo', 1300); await click(page, /^\s*Tasks/i, 'tab'); await settle(page, 1000); await shot(page, 'notifications-search-profile', 'search-tab-tasks'); });
    await tryStep('profile bottom', async () => { await go(page, '/profile', 1300); await page.mouse.wheel(0, 2000); await sleep(600); await shot(page, 'notifications-search-profile', 'profile-scrolled'); });
  });
  return R;
}

(async () => {
  const I = await ids();
  const browser = await chromium.launch();
  const recs = recipes(I);
  for (const size of SIZES) {
    const [w, h] = size.split('x').map(Number);
    const byPersona = {};
    for (const r of recs) (byPersona[r.persona] ||= []).push(r);
    for (const [persona, list] of Object.entries(byPersona)) {
      if (PERS !== 'all' && PERS !== persona) continue;
      const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1, extraHTTPHeaders: { 'X-Dev-User': USERS[persona] } });
      const page = await ctx.newPage();
      ctxInfo = { persona, size };
      for (const r of list) {
        if (FILTER && !FILTER.test(r.folder)) continue;
        try { await r.fn(page); } catch (e) { log.push(`FAIL ${persona} ${size} ${r.folder}: ${String(e.message).split('\n')[0].slice(0, 150)}`); }
      }
      await ctx.close();
    }
  }
  await browser.close();
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, `crawl-log-${Date.now()}.txt`), log.join('\n'));
  fs.writeFileSync(path.join(OUT, `measurements-${Date.now()}.json`), JSON.stringify(meas, null, 1));
  console.log(log.filter((l) => l.startsWith('FAIL')).join('\n'));
  console.log('shots', log.filter((l) => l.startsWith('OK')).length);
})();
