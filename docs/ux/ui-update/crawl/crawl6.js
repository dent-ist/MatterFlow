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
  const R=[]; const add=(p,f,fn)=>R.push({persona:p,folder:f,fn});
  add('director','dashboard', async (page) => {
    await tryStep('summary', async () => { await go(page,'/dashboard',1800); await shot(page,'dashboard','summary'); });
    await tryStep('breakdowns', async () => { await click(page,/^\s*Breakdowns/i,'tab'); await settle(page,1200); await shot(page,'dashboard','breakdowns'); });
    await tryStep('users', async () => { await go(page,'/dashboard',900); await click(page,/^\s*Users/i,'tab'); await settle(page,1200); await shot(page,'dashboard','users'); });
    await tryStep('assign dialog', async () => { await page.locator('button[aria-label*="Assign work"]').first().click({timeout:4000,force:true}); await sleep(1000); await shot(page,'dashboard','assign-work-dialog'); await esc(page); });
    await tryStep('trends period', async () => { await go(page,'/dashboard',900); await click(page,/^\s*Trends/i,'tab'); await settle(page,1500); await shot(page,'dashboard','trends'); });
  });
  add('podlead','pod-work', async (page) => {
    await tryStep('by member', async () => { await go(page,'/pods/work',1400); await click(page,/By member/i,'tab'); await settle(page,1200); await shot(page,'pod-work','by-member'); });
  });
  add('pm','my-matters', async (page) => { await go(page,'/my-matters',1800); await shot(page,'my-matters','landing'); });
  add('director','matters', async (page) => {
    await tryStep('activities', async () => { await go(page,`/matters/${I.matter}`,1400); await click(page,/^\s*Activities/i,'tab'); await settle(page,1300); await shot(page,'matters','activities'); });
    await tryStep('productions', async () => { await go(page,`/matters/${I.matter}`,1200); await click(page,/^\s*Productions/i,'tab'); await settle(page,1200); await shot(page,'matters','productions'); });
    await tryStep('new matter', async () => { await go(page,'/matters',1200); await page.getByRole('button',{name:/new matter/i}).first().click({timeout:5000}); await sleep(900); await shot(page,'matters','new-dialog'); await esc(page); });
    await tryStep('edit matter', async () => { await go(page,`/matters/${I.matter}`,1200); await page.getByRole('button',{name:/^Edit/}).first().click({timeout:5000}); await sleep(900); await shot(page,'matters','edit-dialog'); await esc(page); });
    await tryStep('list', async () => { await go(page,'/matters',1200); await shot(page,'matters','list'); });
  });
  add('director','assets', async (page) => { await go(page,'/assets/1',1500); await shot(page,'assets','record'); });
  add('director','notifications-search-profile', async (page) => {
    await tryStep('profile', async () => { await go(page,'/profile',1500); await shot(page,'notifications-search-profile','profile'); });
    await tryStep('search popover', async () => { await go(page,'/matters',900); await page.locator('input[placeholder*="Search clients"]').first().fill('Demo'); await sleep(1500); await shot(page,'notifications-search-profile','global-search'); });
  });
  add('admin','admin-users-roles-pods', async (page) => {
    await tryStep('users pods', async () => { await go(page,'/admin/users',1500); await page.getByRole('button',{name:/All/}).first().click(); await sleep(1000); await shot(page,'admin-users-roles-pods','users-all'); });
    await tryStep('pods popover', async () => { await go(page,'/admin/users',1500); await page.locator('button.upc-trigger').first().click({timeout:4000}); await sleep(700); await shot(page,'admin-users-roles-pods','pods-popover'); await esc(page); });
  });
  add('admin','admin-lookups', async (page) => {
    await tryStep('row menu', async () => { await go(page,'/admin/priorities',1300); await page.locator('button.am__trigger').first().click(); await sleep(600); await shot(page,'admin-lookups','row-menu'); await esc(page); });
    await tryStep('confirm', async () => { await go(page,'/admin/priorities',1100); await page.locator('button.am__trigger').nth(3).click(); await sleep(400); await page.getByRole('menuitem',{name:/deactivate/i}).first().click({timeout:3000}); await sleep(800); await shot(page,'admin-lookups','confirm-dialog'); await esc(page); });
  });
  add('admin','admin-task-types', async (page) => {
    await tryStep('task type edit', async () => { await go(page,'/admin/task-types',1100); await page.locator('tbody a').first().click(); await settle(page,1400); await shot(page,'admin-task-types','task-type-edit'); });
    await tryStep('icon picker', async () => { await page.getByRole('button',{name:/icon/i}).first().click({timeout:4000}); await sleep(900); await shot(page,'admin-task-types','icon-picker'); await esc(page); });
    await tryStep('form page', async () => { await page.getByRole('tab',{name:/Form/i}).first().click({timeout:4000}); await settle(page,1400); await shot(page,'admin-task-types','form-tab'); });
  });
  add('admin','admin-reports-audit-settings', async (page) => {
    await tryStep('holidays', async () => { await go(page,'/admin/settings?tab=holidays',1800); await shot(page,'admin-reports-audit-settings','holidays'); });
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
