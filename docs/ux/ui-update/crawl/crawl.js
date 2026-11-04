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

// page recipes: each returns nothing; they take the page and ids
function recipes(I) {
  const R = [];
  const add = (persona, folder, fn) => R.push({ persona, folder, fn });
  // helper for tab walks
  const tabs = async (page, folder, names, prefix = '') => {
    for (const n of names) {
      await tryStep(`${folder} tab ${n}`, async () => {
        await click(page, new RegExp(`^\\s*${n}`, 'i'), 'tab');
        await settle(page, 700);
        await shot(page, folder, `${prefix}tab-${n.toLowerCase().replace(/[^a-z]+/g, '-')}`);
      });
    }
  };
  for (const p of ['director', 'podlead', 'tech']) {
    add(p, 'dashboard', async (page) => {
      await go(page, '/dashboard');
      await shot(page, 'dashboard', 'landing');
      const names = p === 'tech' ? [] : ['Summary', 'Breakdowns', 'Trends', 'Swimlane', 'Users', 'Calendar'];
      if (p === 'director' || p === 'podlead') await tabs(page, 'dashboard', names);
      if (p === 'director') {
        await tryStep('dash users cards drawer', async () => {
          await click(page, /^\s*Users/i, 'tab'); await settle(page, 900);
          await page.locator('[class*=card] button, button[class*=card]').first().click({ timeout: 3000 }); await sleep(900);
          await shot(page, 'dashboard', 'users-drawer'); await esc(page);
        });
        await tryStep('dash users state dd', async () => {
          await click(page, /State:/i); await sleep(400); await shot(page, 'dashboard', 'users-state-dropdown'); await esc(page);
        });
        await tryStep('dash users unassigned drawer', async () => {
          await click(page, /unassigned tasks/i); await sleep(900); await shot(page, 'dashboard', 'users-unassigned-drawer'); await esc(page);
        });
        await tryStep('dash users table', async () => {
          await page.getByRole('button', { name: /table/i }).first().click({ timeout: 2000 }); await sleep(700); await shot(page, 'dashboard', 'users-table');
        });
        await tryStep('dash users coverage', async () => {
          await click(page, /Coverage/i); await settle(page, 700); await shot(page, 'dashboard', 'users-coverage');
          await click(page, /Skills/i); await settle(page, 700); await shot(page, 'dashboard', 'users-skills');
        });
        await tryStep('dash summary dialogs', async () => {
          await go(page, '/dashboard');
          await click(page, /^\s*Summary/i, 'tab'); await settle(page, 700);
          await click(page, /People/i); await sleep(800); await shot(page, 'dashboard', 'summary-people-dialog'); await esc(page);
        });
        await tryStep('dash summary filters', async () => {
          await click(page, /^Filters/i); await sleep(500); await shot(page, 'dashboard', 'summary-filters-open'); await esc(page);
        });
        await tryStep('dash summary columns', async () => {
          await click(page, /Columns/i); await sleep(500); await shot(page, 'dashboard', 'summary-columns-menu'); await esc(page);
        });
        await tryStep('dash calendar day', async () => {
          await click(page, /^\s*Calendar/i, 'tab'); await settle(page, 900);
          await click(page, /^Week$/i); await settle(page, 700); await shot(page, 'dashboard', 'calendar-week');
        });
      }
    });
  }
  add('pm', 'my-matters', async (page) => {
    await go(page, '/my-matters', 1500);
    await shot(page, 'my-matters', 'landing');
    await tabs(page, 'my-matters', ['Overview', 'Calendar', 'Assets', 'Metrics', 'Activity']);
    await tryStep('mm new menu', async () => { await click(page, /^\+?\s*New/i); await sleep(500); await shot(page, 'my-matters', 'new-menu'); await esc(page); });
    await tryStep('mm event dialog', async () => {
      await click(page, /^\s*Calendar/i, 'tab'); await settle(page, 700);
      await click(page, /Add event/i); await sleep(800); await shot(page, 'my-matters', 'event-dialog'); await esc(page);
    });
  });
  for (const [p, route, folder] of [['tech', '/my-work', 'my-work'], ['podlead', '/pods/work', 'pod-work'], ['director', '/tasks', 'task-queue'], ['tech', '/tasks', 'task-queue']]) {
    add(p, folder, async (page) => {
      await go(page, route, 1200);
      await shot(page, folder, 'landing');
      if (folder !== 'task-queue') {
        const names = folder === 'my-work' ? ['Active', 'Due soon', 'Closed', 'Created by me'] : ['Unassigned', 'By member', 'All open'];
        await tabs(page, folder, names);
      }
      await tryStep(`${folder} columns`, async () => { await click(page, /Columns/i); await sleep(500); await shot(page, folder, 'columns-menu'); await esc(page); });
      await tryStep(`${folder} filters`, async () => { await click(page, /^Filters/i); await sleep(600); await shot(page, folder, 'filters-open'); await esc(page); });
      await tryStep(`${folder} row select (bulk)`, async () => {
        await page.locator('tbody tr input[type=checkbox], tbody tr [role=checkbox]').first().check({ timeout: 2500 });
        await sleep(500); await shot(page, folder, 'bulk-bar');
      });
      await tryStep(`${folder} row menu`, async () => {
        await go(page, route, 900);
        await page.locator('tbody tr button[aria-label*="ction" i], tbody tr button[aria-haspopup]').first().click({ timeout: 2500 }); await sleep(500);
        await shot(page, folder, 'row-menu'); await esc(page);
      });
    });
  }
  add('director', 'create-task', async (page) => {
    await go(page, '/tasks/new', 1200); await shot(page, 'create-task', 'form');
    await page.evaluate(() => window.scrollTo(0, 99999));
    await tryStep('create validate', async () => { await click(page, /^Create task/i); await sleep(700); await shot(page, 'create-task', 'validation'); });
  });
  add('director', 'task-page', async (page) => {
    await go(page, `/tasks/${I.task}`, 1500); await shot(page, 'task-page', 'overview');
    await tabs(page, 'task-page', ['Workflow', 'Assets', 'Comments']);
    await tryStep('task edit dialog', async () => { await click(page, /^Edit/i); await sleep(900); await shot(page, 'task-page', 'edit-dialog'); await esc(page); });
    await tryStep('task status actions', async () => {
      await page.locator('button:has-text("Hold"), button:has-text("Complete"), button:has-text("Start")').first().click({ timeout: 2500 }); await sleep(800);
      await shot(page, 'task-page', 'action-dialog'); await esc(page);
    });
  });
  add('director', 'clients', async (page) => {
    await go(page, '/clients', 1200); await shot(page, 'clients', 'list');
    await tryStep('clients new', async () => { await click(page, /new client/i); await settle(page, 900); await shot(page, 'clients', 'new-form'); });
    await go(page, `/clients/${I.client}`, 1200); await shot(page, 'clients', 'record');
    await tryStep('client activity', async () => { await click(page, /Activity/i); await sleep(900); await shot(page, 'clients', 'activity-drawer'); await esc(page); });
    await go(page, `/clients/${I.client}/edit`, 1000); await shot(page, 'clients', 'edit-form');
  });
  add('director', 'matters', async (page) => {
    await go(page, '/matters', 1200); await shot(page, 'matters', 'list');
    await tryStep('matters new dialog', async () => { await click(page, /new matter/i); await sleep(900); await shot(page, 'matters', 'new-dialog'); await esc(page); await sleep(400); });
    await tryStep('matters columns', async () => { await go(page, '/matters', 800); await click(page, /Columns/i); await sleep(500); await shot(page, 'matters', 'columns-menu'); await esc(page); });
    await tryStep('matters filters', async () => { await click(page, /^Filters/i); await sleep(600); await shot(page, 'matters', 'filters-open'); await esc(page); });
    await go(page, `/matters/${I.matter}`, 1300); await shot(page, 'matters', 'record-summary');
    await tabs(page, 'matters', ['Tasks', 'Projects', 'Assets', 'Productions', 'Notes', 'Activities'], 'record-');
    await tryStep('matter edit dialog', async () => { await go(page, `/matters/${I.matter}`, 900); await click(page, /^Edit/i); await sleep(900); await shot(page, 'matters', 'edit-dialog'); await esc(page); await sleep(400); });
    await tryStep('matter new menu', async () => { await click(page, /^\+?\s*New/i); await sleep(500); await shot(page, 'matters', 'header-new-menu'); await esc(page); });
    await tryStep('matter project panel', async () => {
      await click(page, /^\s*Projects/i, 'tab'); await settle(page, 700); await click(page, /new project/i); await sleep(900); await shot(page, 'matters', 'new-project-dialog'); await esc(page);
    });
    await tryStep('matter production new', async () => {
      await click(page, /^\s*Productions/i, 'tab'); await settle(page, 700); await click(page, /new production/i); await sleep(900); await shot(page, 'matters', 'new-production'); await esc(page);
    });
    await tryStep('matter notes new', async () => {
      await click(page, /^\s*Notes/i, 'tab'); await settle(page, 900); await click(page, /new note/i); await sleep(1200); await shot(page, 'matters', 'new-note');
    });
  });
  add('director', 'projects', async (page) => {
    await go(page, '/projects', 1200); await shot(page, 'projects', 'list');
    await tryStep('projects new', async () => { await click(page, /new project/i); await sleep(900); await shot(page, 'projects', 'new-dialog'); await esc(page); });
    await go(page, `/projects/${I.project}`, 1200); await shot(page, 'projects', 'record');
    await go(page, `/projects/${I.project}/edit`, 1000); await shot(page, 'projects', 'edit-form');
  });
  add('director', 'assets', async (page) => {
    await go(page, '/assets', 1200); await shot(page, 'assets', 'list');
    await go(page, `/assets/${I.asset}`, 1200); await shot(page, 'assets', 'record');
    await tryStep('asset disposition', async () => { await click(page, /Change Disposition/i); await sleep(900); await shot(page, 'assets', 'disposition-dialog'); await esc(page); });
    await go(page, '/assets/new', 1000); await shot(page, 'assets', 'new-form');
    await go(page, '/assets/reports', 1200); await shot(page, 'assets', 'reports');
  });
  add('director', 'notifications-search-profile', async (page) => {
    await go(page, '/notifications', 1000); await shot(page, 'notifications-search-profile', 'notifications');
    await go(page, `/search?q=${I.q}`, 1500); await shot(page, 'notifications-search-profile', 'search-results');
    await go(page, '/profile', 1300); await shot(page, 'notifications-search-profile', 'profile');
    await tryStep('profile ooo dialog', async () => {
      await click(page, /Set out of office|Add out of office|Add/i); await sleep(900); await shot(page, 'notifications-search-profile', 'profile-ooo-dialog'); await esc(page);
    });
  });
  add('tech', 'notifications-search-profile', async (page) => {
    await go(page, '/profile', 1300); await shot(page, 'notifications-search-profile', 'profile');
  });
  add('director', 'shell', async (page) => {
    await go(page, '/dashboard', 900);
    await tryStep('user menu', async () => { await page.locator('button[aria-haspopup], .mf-user-btn, [data-testid=user-menu]').last().click({ timeout: 2500 }); await sleep(500); await shot(page, 'shell', 'user-menu'); await esc(page); });
    await tryStep('bell', async () => { await click(page, /notifications/i); await sleep(800); await shot(page, 'shell', 'bell-panel'); await esc(page); });
    await tryStep('global search', async () => {
      await page.getByRole('combobox').or(page.getByPlaceholder(/Search/i)).first().fill('Demo'); await sleep(1200); await shot(page, 'shell', 'global-search'); await esc(page);
    });
    await tryStep('create task button', async () => { await click(page, /^\+?\s*(Create|New) task/i); await settle(page, 700); await shot(page, 'shell', 'create-task-from-shell'); });
  });
  add('tech', 'system-pages', async (page) => {
    await go(page, '/403', 600); await shot(page, 'system-pages', '403');
    await go(page, '/does-not-exist', 600); await shot(page, 'system-pages', '404');
    await go(page, '/admin/users', 800); await shot(page, 'system-pages', 'admin-denied');
    await go(page, '/error', 600); await shot(page, 'system-pages', 'error');
  });
  add('pending', 'system-pages', async (page) => {
    await go(page, '/', 1200); await shot(page, 'system-pages', 'access-pending');
  });
  // admin
  const A = [
    ['admin-users-roles-pods', '/admin/users', ['Users', 'Roles', 'Pods']],
    ['admin-task-types', '/admin/task-types', ['Task Types', 'Workflows', 'Workflow Steps']],
    ['admin-lookups', '/admin/priorities', ['Priorities', 'Status labels', 'On-hold reasons', 'Note tags']],
    ['admin-lookups', '/admin/asset-types', ['Asset Types', 'Link Roles'], 'asset-types-'],
    ['admin-lookups', '/admin/custom-fields', [], 'custom-fields-'],
    ['admin-reports-audit-settings', '/admin/reports', ['Reports', 'Categories', 'Run log', 'Assignments', 'Settings'], 'reports-'],
    ['admin-reports-audit-settings', '/admin/audit', [], 'audit-'],
    ['admin-reports-audit-settings', '/admin/settings', ['Branding', 'Dashboard', 'Holidays'], 'settings-'],
  ];
  for (const [folder, route, tabNames, prefix = ''] of A) {
    add('admin', folder, async (page) => {
      await go(page, route, 1200); await shot(page, folder, `${prefix}landing`);
      await tabs(page, folder, tabNames, prefix);
      await tryStep(`${folder} ${route} new`, async () => {
        await go(page, route, 800);
        await page.getByRole('button', { name: /^\+?\s*New /i }).first().click({ timeout: 2500 }); await settle(page, 900);
        await shot(page, folder, `${prefix}new-click`); await esc(page);
      });
    });
  }
  add('admin', 'admin-users-roles-pods', async (page) => {
    await go(page, '/admin/users', 1200);
    await tryStep('user drawer', async () => { await page.locator('tbody tr').first().click({ timeout: 2500 }); await sleep(1000); await shot(page, 'admin-users-roles-pods', 'user-drawer'); await esc(page); });
    await tryStep('roles detail', async () => { await go(page, '/admin/users?tab=roles', 1000); await page.locator('tbody tr, [role=row]').nth(1).click({ timeout: 2500 }); await sleep(900); await shot(page, 'admin-users-roles-pods', 'role-editor'); });
  });
  add('admin', 'admin-task-types', async (page) => {
    for (const [name, url] of [['task-type-record', '/admin/task-types'], ['step-new', '/admin/steps/new'], ['workflow-new', '/admin/workflows/new']]) {
      await tryStep(name, async () => {
        await go(page, url, 1000);
        if (name === 'task-type-record') await page.locator('tbody tr').first().click({ timeout: 2500 });
        await settle(page, 1000); await shot(page, 'admin-task-types', name);
      });
    }
  });
  add('admin', 'admin-reports-audit-settings', async (page) => {
    await tryStep('holiday dialogs', async () => {
      await go(page, '/admin/settings?tab=holidays', 1200);
      await click(page, /new calendar|add calendar/i).catch(() => {}); await sleep(900); await shot(page, 'admin-reports-audit-settings', 'settings-holidays-dialog'); await esc(page);
    });
    await tryStep('report editor', async () => { await go(page, '/admin/reports/new', 1500); await shot(page, 'admin-reports-audit-settings', 'report-editor'); });
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
