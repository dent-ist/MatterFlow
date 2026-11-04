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



function recipes(I) {
  const R=[]; const add=(p,f,fn)=>R.push({persona:p,folder:f,fn});
  const errPage = (page, pat) => page.route(pat, (r) => r.abort());
  const cases = [
    ['matters','/matters','**/api/v1/matters**'],
    ['task-queue','/tasks','**/api/v1/tasks?**'],
    ['clients','/clients','**/api/v1/clients**'],
    ['projects','/projects','**/api/v1/projects**'],
    ['assets','/assets','**/api/v1/assets**'],
    ['dashboard','/dashboard','**/api/v1/dashboard/**'],
    ['admin-users-roles-pods','/admin/users','**/api/v1/users**'],
  ];
  for (const [folder,url,pat] of cases) {
    add(folder.startsWith('admin')?'admin':'director', folder, async (page) => {
      await tryStep(`error ${folder}`, async () => { await errPage(page, pat); await go(page, url, 1500); await shot(page, folder, 'error-state-2'); await page.unroute(pat); });
      await tryStep(`loading ${folder}`, async () => { await page.route(pat, async (r) => { await sleep(6000); r.continue().catch(()=>{}); }); await page.goto(BASE+url,{waitUntil:'domcontentloaded'}); await sleep(2500); await shot(page, folder, 'loading-state'); await page.unroute(pat); });
    });
  }
  add('director','task-page', async (page) => {
    await go(page,'/tasks/999999',1200); await shot(page,'task-page','not-found-record');
    await go(page,'/matters/999999',1200); await shot(page,'matters','not-found-record');
  });
  add('director','notifications-search-profile', async (page) => {
    await go(page,'/notifications',1000);
  });
  add('director','my-work', async (page) => { await go(page,'/my-work',1200); await shot(page,'my-work','director-view'); });
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
