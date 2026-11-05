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
  add('director','notifications-search-profile', async (page) => {
    await tryStep('profile toast', async () => { await go(page,'/profile',1600); await page.getByRole('button',{name:/^Sat/}).click({timeout:5000}); await sleep(400); await page.getByRole('button',{name:/save changes/i}).click({timeout:5000}); await sleep(900); await shot(page,'notifications-search-profile','profile-save-toast'); });
    await tryStep('profile revert', async () => { await go(page,'/profile',1600); await page.getByRole('button',{name:/^Sat/}).click({timeout:5000}); await sleep(300); await page.getByRole('button',{name:/save changes/i}).click({timeout:5000}); await sleep(700); });
    await tryStep('copy link', async () => { await go(page,'/tasks/200',1800); await page.locator('button.am__trigger').first().click({timeout:4000}); await sleep(500); await shot(page,'task-page','more-menu'); await page.getByRole('menuitem',{name:/copy/i}).first().click({timeout:3000}); await sleep(800); await shot(page,'task-page','copy-toast'); });
  });
  add('admin','admin-lookups', async (page) => {
    await tryStep('new priority toast', async () => { await go(page,'/admin/priorities',1300); await page.getByRole('button',{name:/New Priority/}).click({timeout:4000}); await sleep(700); await page.locator('input').last().fill('Review sample'); await page.getByRole('button',{name:/Add priority/i}).click({timeout:4000}); await sleep(900); await shot(page,'admin-lookups','save-toast'); });
    await tryStep('empty admin list', async () => { await go(page,'/admin/note-tags',1400); await shot(page,'admin-lookups','note-tags-empty'); });
    await tryStep('status labels', async () => { await go(page,'/admin/status-labels',1400); await shot(page,'admin-lookups','status-labels'); });
  });
  add('admin','admin-reports-audit-settings', async (page) => {
    await tryStep('dashboard settings toast', async () => { await go(page,'/admin/settings',1500); await click(page,/Dashboard/i,'tab'); await settle(page,1200); await page.getByLabel(/Level 1/).fill('2'); await sleep(300); await page.getByRole('button',{name:/save changes/i}).first().click({timeout:5000}); await sleep(900); await shot(page,'admin-reports-audit-settings','settings-dashboard-toast'); });
    await tryStep('audit filters', async () => { await go(page,'/admin/audit',1500); await shot(page,'admin-reports-audit-settings','audit'); });
    await tryStep('reports', async () => { await go(page,'/admin/reports',1500); await shot(page,'admin-reports-audit-settings','reports'); });
  });
  add('director','dashboard', async (page) => {
    await tryStep('trends', async () => { await go(page,'/dashboard',900); await click(page,/^\s*Trends/i,'tab'); await settle(page,1500); await shot(page,'dashboard','trends-2'); });
    await tryStep('calendar', async () => { await click(page,/^\s*Calendar/i,'tab'); await settle(page,1500); await shot(page,'dashboard','calendar-2'); });
    await tryStep('state dd open', async () => { await go(page,'/dashboard',900); await click(page,/^\s*Users/i,'tab'); await settle(page,1200); await click(page,/State:/i); await sleep(600); await shot(page,'dashboard','users-state-dropdown-2'); await esc(page); });
    await tryStep('scope dd', async () => { await go(page,'/dashboard',900); await page.locator('mf-dropdown').first().click({timeout:3000}); await sleep(600); await shot(page,'dashboard','scope-dropdown'); await esc(page); });
  });
  add('director','matters', async (page) => {
    await tryStep('empty filtered', async () => { await go(page,'/matters',1000); await page.getByPlaceholder(/Search matters/i).fill('zzzzqq'); await sleep(1800); await shot(page,'matters','empty-no-match'); });
    await tryStep('filters open', async () => { await go(page,'/matters',1000); await page.getByRole('button',{name:/^Filters/}).click(); await sleep(700); await shot(page,'matters','filters-open'); });
  });
  add('director','clients', async (page) => {
    await tryStep('empty filtered', async () => { await go(page,'/clients',1000); await page.locator('input.sb__input').fill('zzzzqq'); await sleep(1800); await shot(page,'clients','empty-no-match'); });
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
