// usage: node axe.mjs <dist> <port> [filter]   -- axe at 1366x768 and 1920x1080 for each Reports state, API fully mocked
import fs from 'node:fs';
import { axeNow, boot, SIZES, sideways } from './lib.mjs';
import { createState } from './mock.mjs';
const [dist, portArg, only] = process.argv.slice(2);
const state = createState();
const h = await boot({ dist, port: Number(portArg), state });
const { page, base } = h;
const shotDir = process.env.SHOTS;
if (shotDir) fs.mkdirSync(shotDir, { recursive: true });
const results = [];

async function check(name, { shots = false } = {}) {
  for (const size of SIZES) {
    await page.setViewportSize(size);
    await page.waitForTimeout(250);
    const v = await axeNow(page);
    const sw = await sideways(page);
    results.push({ name, size: `${size.width}x${size.height}`, violations: v, sideways: sw });
    console.log(`${v.length === 0 && sw <= 0 ? 'PASS' : 'FAIL'} ${name} ${size.width}x${size.height} violations=${v.length} sideways=${sw}`);
    for (const x of v) console.log('   ', x.id, x.impact, x.help, JSON.stringify(x.nodes.map((n) => [n.target, n.why]).slice(0, 2)));
    if (shotDir && shots && size.width === 1366) await page.screenshot({ path: `${shotDir}/${name}-1366.jpg`, type: 'jpeg', quality: 70 });
  }
}
const go = async (url) => { await page.setViewportSize(SIZES[0]); await page.goto(base + url); await page.waitForLoadState('networkidle'); };
const want = (n) => !only || n.includes(only);

if (want('list')) {
  await go('/reports');
  await page.locator('td[data-report]').first().waitFor();
  await check('list');
  await page.getByRole('searchbox', { name: /search reports/i }).fill('zzzz-nothing');
  await page.locator('[data-search-empty]').waitFor();
  await check('list-search-empty');
}

if (want('run')) {
  await go('/reports/5');
  await page.locator('[data-param="MAX"]').waitFor();
  await check('run-form', { shots: true });
  await page.getByRole('button', { name: 'Run Report' }).click();
  await page.locator('[data-param="CLIENT"] .mf-field__error').waitFor();
  await check('run-errors');
  // help panel
  const help = page.getByRole('button', { name: /about this report|information|help/i }).first();
  if (await help.count()) { await help.click().catch(() => {}); await page.waitForTimeout(300); await check('run-help'); await page.keyboard.press('Escape'); }
  // fill
  await page.locator('[data-param="CLIENT"] input[role="combobox"]').fill('acme');
  await page.getByRole('option', { name: /Acme/ }).click();
  state.runDelayMs = 4000;
  await page.getByRole('button', { name: 'Run Report' }).click();
  await page.locator('[data-running]').waitFor();
  await check('run-running', { shots: true });
  await page.locator('[data-summary-bar]').waitFor({ timeout: 15000 });
  await page.locator('tbody tr[data-record-id]').first().waitFor();
  state.runDelayMs = 0;
  await check('run-result', { shots: true });
  // Saved Views menu and dialogs
  await page.locator('[data-views-trigger]').click();
  await page.locator('[data-views-panel]').waitFor();
  await check('run-views-menu', { shots: true });
  await page.locator('[data-view-save-new]').click();
  await page.getByRole('dialog').waitFor();
  await check('run-dialog-save-view', { shots: true });
  await page.keyboard.press('Escape');
  await page.getByRole('dialog').waitFor({ state: 'detached' }).catch(() => {});
  await page.locator('[data-views-trigger]').click();
  await page.locator('[data-view-row]').first().hover();
  await page.locator('[data-view-rename]').first().click();
  await page.getByRole('dialog').waitFor();
  await check('run-dialog-rename');
  await page.keyboard.press('Escape');
  await page.getByRole('dialog').waitFor({ state: 'detached' }).catch(() => {});
  await page.locator('[data-views-trigger]').click();
  await page.locator('[data-view-row]').first().hover();
  await page.locator('[data-view-delete]').first().click();
  await page.getByRole('alertdialog').or(page.getByRole('dialog')).waitFor();
  await check('run-dialog-delete-view');
  await page.keyboard.press('Escape');
  await page.getByRole('dialog').waitFor({ state: 'detached' }).catch(() => {});
  // Columns chooser
  await page.getByRole('button', { name: /^Columns/ }).click();
  await page.waitForTimeout(300);
  await check('run-columns-chooser', { shots: true });
  await page.keyboard.press('Escape');
  // Filters row
  const filtersBtn = page.getByRole('button', { name: /^Filters/ });
  if (await filtersBtn.count()) { await filtersBtn.first().click(); await page.waitForTimeout(250); await check('run-filter-row'); }
  // Export in progress
  state.exportDelayMs = 5000;
  await page.locator('[data-export-csv]').click();
  await page.waitForSelector('[data-export-csv][aria-busy="true"]');
  await check('run-export-in-progress', { shots: true });
  state.exportDelayMs = 0;
  await page.waitForSelector('[data-export-csv]:not([aria-busy="true"])', { timeout: 15000 });
  // 409-like banner is covered by unit specs; expired result:
}

if (want('admin')) {
  await go('/admin/reports');
  await page.locator('[data-reports]').waitFor();
  await check('admin-list', { shots: true });
  for (const tab of ['categories', 'runs', 'assignments', 'health']) {
    await go(`/admin/reports?tab=${tab}`);
    await page.waitForTimeout(600);
    await check(`admin-${tab}`, { shots: tab === 'assignments' });
  }
  for (const tab of ['details', 'query', 'parameters', 'roles', 'history']) {
    await go(`/admin/reports/5?tab=${tab}`);
    await page.waitForTimeout(800);
    await check(`admin-editor-${tab}`, { shots: tab === 'roles' });
  }
  await go('/admin/reports/new');
  await page.waitForTimeout(600);
  await check('admin-editor-new');
}

if (want('roles')) {
  await go('/admin/roles');
  await page.waitForTimeout(800);
  await page.getByText('Pod Lead').first().click();
  await page.getByRole('tab', { name: /Reports/ }).click();
  await page.locator('[data-role-reports-tab]').waitFor();
  await check('admin-role-reports-tab', { shots: true });
}

fs.writeFileSync(process.env.OUT ?? 'axe-results.json', JSON.stringify({ results, unmatched: [...state.unmatched], errors: h.errors.slice(0, 40) }, null, 1));
console.log('unmatched API calls:', [...state.unmatched].join(' | '));
console.log('console/page errors:', h.errors.length, h.errors.slice(0, 8));
await h.close();
