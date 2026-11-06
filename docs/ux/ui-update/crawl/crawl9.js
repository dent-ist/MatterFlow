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
    await tryStep('calendar month', async () => { await go(page,'/dashboard',900); await click(page,/^\s*Calendar/i,'tab'); await settle(page,1800); await shot(page,'dashboard','calendar-month'); });
    await tryStep('calendar week', async () => { await click(page,/^Week$/i); await settle(page,1500); await shot(page,'dashboard','calendar-week'); });
    await tryStep('calendar day panel', async () => { await click(page,/^Month$/i); await settle(page,1200); await page.locator('[role=gridcell], td button').nth(11).click({timeout:3000}); await sleep(900); await shot(page,'dashboard','calendar-day'); });
    await tryStep('trends', async () => { await go(page,'/dashboard',900); await click(page,/^\s*Trends/i,'tab'); await settle(page,1800); await shot(page,'dashboard','trends'); });
    await tryStep('summary', async () => { await go(page,'/dashboard',900); await settle(page,1800); await shot(page,'dashboard','summary'); });
    await tryStep('breakdowns', async () => { await click(page,/^\s*Breakdowns/i,'tab'); await settle(page,1500); await shot(page,'dashboard','breakdowns'); });
    await tryStep('swimlane', async () => { await click(page,/^\s*Swimlane/i,'tab'); await settle(page,1500); await shot(page,'dashboard','swimlane'); });
    await tryStep('users', async () => { await click(page,/^\s*Users/i,'tab'); await settle(page,1500); await shot(page,'dashboard','users'); });
    await tryStep('users table', async () => { await page.getByRole('button',{name:/table/i}).first().click({timeout:3000}); await sleep(800); await shot(page,'dashboard','users-table'); });
    await tryStep('column menu', async () => { await go(page,'/dashboard',900); await settle(page,1500); await page.locator('th button.mf-colmenu, th [aria-haspopup]').first().click({timeout:3000}); await sleep(600); await shot(page,'dashboard','column-menu'); await esc(page); });
  });
  add('director','create-task', async (page) => {
    await tryStep('picker', async () => { await go(page,'/tasks/new',1500); await shot(page,'create-task','picker'); });
    await tryStep('selected strip', async () => { await page.locator('main button').filter({hasText:/Access Request/}).first().click({timeout:4000}); await settle(page,1500); await page.evaluate(()=>window.scrollTo(0,0)); await shot(page,'create-task','selected-strip'); });
  });
  add('director','matters', async (page) => {
    await tryStep('tasks tab', async () => { await go(page,`/matters/${I.matter}`,1400); await click(page,/^\s*Tasks/i,'tab'); await settle(page,1500); await shot(page,'matters','tasks-tab'); });
    await tryStep('notes new', async () => { await click(page,/^\s*Notes/i,'tab'); await settle(page,1000); await page.getByRole('button',{name:/new note/i}).first().click({timeout:4000}); await sleep(1500); await shot(page,'matters','note-editor'); });
    await tryStep('note link dialog', async () => { await page.getByRole('button',{name:/link/i}).first().click({timeout:3000}); await sleep(800); await shot(page,'matters','note-link-popover'); await esc(page); });
    await tryStep('summary', async () => { await go(page,`/matters/${I.matter}`,1200); await shot(page,'matters','summary'); });
  });
  add('director','projects', async (page) => { await go(page,'/projects/1',1600); await shot(page,'projects','record-tasks'); });
  add('director','task-queue', async (page) => { await go(page,'/tasks',1600); await shot(page,'task-queue','landing'); await tryStep('col menu', async () => { await page.locator('th button[aria-haspopup], th .wt-menu').first().click({timeout:3000}); await sleep(600); await shot(page,'task-queue','column-menu'); await esc(page); }); });
  add('podlead','pod-work', async (page) => { await go(page,'/pods/work',1600); await shot(page,'pod-work','unassigned'); });
  add('tech','my-work', async (page) => { await go(page,'/my-work',1600); await shot(page,'my-work','landing'); });
  add('pm','my-matters', async (page) => { await go(page,'/my-matters',1800); await shot(page,'my-matters','overview'); await tryStep('assets', async () => { await click(page,/^\s*Assets/i,'tab'); await settle(page,1200); await shot(page,'my-matters','assets'); }); await tryStep('metrics', async () => { await click(page,/^\s*Metrics/i,'tab'); await settle(page,1500); await shot(page,'my-matters','metrics'); }); await tryStep('calendar', async () => { await click(page,/^\s*Calendar/i,'tab'); await settle(page,1500); await shot(page,'my-matters','calendar'); await click(page,/Add event/i); await sleep(900); await shot(page,'my-matters','event-dialog'); await esc(page); }); });
  add('admin','admin-task-types', async (page) => {
    await tryStep('designer', async () => { await go(page,'/admin/task-types',1200); await page.locator('tbody a').first().click(); await settle(page,1500); await page.getByRole('tab',{name:/Form/i}).first().click({timeout:4000}); await settle(page,1800); await shot(page,'admin-task-types','form-designer'); });
    await tryStep('list', async () => { await go(page,'/admin/task-types',1400); await shot(page,'admin-task-types','list'); });
    await tryStep('workflow badge', async () => { await go(page,'/admin/task-types?tab=workflows',1300); await page.locator('tbody a').first().click(); await settle(page,1800); await shot(page,'admin-task-types','workflow-record'); });
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
