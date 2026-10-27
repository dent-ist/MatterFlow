// PM v2 final verification (epic #851, issue #889): the same walk as walkthrough.mjs, after the work is built. Every screen a Project Manager uses, plus the
// PM v2 screens (type badges and section toolbar, Focus, Breakdown, Data, report builder, Export and Views menus, disposition, on-hold reasons, task type
// colour and target), at four sizes, one screenshot each into after/<size>/<nn>-<screen>.png, and after/walkthrough-after.json with facts per shot
// (page overflow in px, title, heading, tabs) so the verification document can quote observed numbers.
//
//   npm run seed:demo -- --seed 7        (a fresh stack: the demo seeder also gives the PM v2 screens something to show, issue #868)
//   BASE=http://127.0.0.1:5391 PM_USER='KE\testuser03' ADMIN_USER='KE\kekim' OUT=docs/ux/pm-v2-review/after PW=frontend \
//     node docs/ux/pm-v2-review/walkthrough-after.mjs
//
// Dev authentication (`X-Dev-User`). Needs frontend/node_modules (Playwright) and Chromium: set CHROMIUM=/opt/pw-browsers/chromium-1194/chrome-linux/chrome
// when Playwright's own browser is not installed (the sandbox flag is then added).
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(path.resolve(process.env.PW ?? 'frontend') + '/');
const { chromium } = require('@playwright/test');

const BASE = process.env.BASE ?? 'http://127.0.0.1:5391';
const PM = process.env.PM_USER ?? 'KE\\testuser03';
const ADMIN = process.env.ADMIN_USER ?? 'KE\\kekim';
const OUT = path.resolve(process.env.OUT ?? 'docs/ux/pm-v2-review/after');
const SIZES = [
  { name: '1366x768', width: 1366, height: 768 },
  { name: '1920x1080', width: 1920, height: 1080 },
  { name: '768x1024', width: 768, height: 1024 },
  { name: '375x812', width: 375, height: 812 },
].filter((s) => !process.env.ONLY_SIZE || process.env.ONLY_SIZE.split(',').includes(s.name));

const facts = [];

async function settle(page) {
  await page.waitForLoadState('networkidle').catch(() => undefined);
  await page
    .waitForFunction(
      () =>
        !document.querySelector('[data-loading], [aria-busy="true"]') &&
        !/Loading /.test(document.body.innerText.slice(0, 600)),
      undefined,
      { timeout: 8000 },
    )
    .catch(() => undefined);
  await page.waitForTimeout(300);
}

async function shot(page, size, name, full = false) {
  const dir = path.join(OUT, size.name);
  fs.mkdirSync(dir, { recursive: true });
  await page.screenshot({ path: path.join(dir, `${name}.png`), fullPage: full });
  const info = await page.evaluate(() => ({
    overflowPx: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    title: document.title,
    h1: document.querySelector('h1')?.textContent?.trim() ?? null,
    tabs: [...document.querySelectorAll('[role="tab"]')].map((t) => t.textContent.trim().replace(/\s+/g, ' ')),
    scrollHeight: document.documentElement.scrollHeight,
  }));
  facts.push({ size: size.name, shot: name, url: page.url().replace(BASE, ''), ...info });
}

async function go(page, url) {
  await page.goto(BASE + url);
  await settle(page);
}

async function tryStep(label, fn) {
  try {
    await fn();
  } catch (e) {
    facts.push({ shot: label, error: String(e.message).split('\n')[0] });
  }
}

const launch = { args: process.env.CHROMIUM ? ['--no-sandbox'] : [] };
if (process.env.CHROMIUM) launch.executablePath = process.env.CHROMIUM;
const browser = await chromium.launch(launch);
for (const size of SIZES) {
  const mk = (user) =>
    browser.newContext({
      baseURL: BASE,
      viewport: { width: size.width, height: size.height },
      locale: 'en-US',
      timezoneId: 'America/New_York',
      extraHTTPHeaders: { 'X-Dev-User': user, 'X-MatterFlow-Client': 'web' },
    });
  const ctx = await mk(PM);
  const page = await ctx.newPage();

  // 01 My Matters: the Overview with type badges, the section toolbar open, Focus open
  await go(page, '/');
  await shot(page, size, '01-my-matters-overview');
  await shot(page, size, '01b-my-matters-overview-full', true);
  await tryStep('section-filter', async () => {
    await page.locator('[data-types-trigger]').first().click();
    await page.waitForTimeout(300);
    await shot(page, size, '01c-section-type-filter-open');
    await page.keyboard.press('Escape');
  });
  await tryStep('focus', async () => {
    await page.locator('[data-focus-trigger]').click();
    await page.waitForTimeout(300);
    await shot(page, size, '01d-focus-open');
    await page.keyboard.press('Escape');
  });
  for (const [n, tab, name] of [
    ['02', 'deadlines', 'deadlines'],
    ['03', 'breakdown', 'breakdown'],
    ['03c', 'data', 'data'],
    ['04', 'activity', 'activity'],
    ['05', 'trends', 'trends'],
  ]) {
    await tryStep(tab, async () => {
      await go(page, `/my-matters?tab=${tab}`);
      await shot(page, size, `${n}-my-matters-${name}`);
    });
  }
  await tryStep('breakdown-types', async () => {
    await go(page, '/my-matters?tab=breakdown&bview=types');
    await shot(page, size, '03b-my-matters-breakdown-per-type');
  });
  await tryStep('data-volume-table', async () => {
    await go(page, '/my-matters?tab=data');
    await page.locator('[data-show-table]').click();
    await page.waitForTimeout(300);
    await shot(page, size, '03d-my-matters-data-volume-table');
  });

  // 06 Matters list, matter record
  await go(page, '/matters');
  await shot(page, size, '06-matters-list');
  await tryStep('matter-record', async () => {
    await page.locator('a[href^="/matters/"]').first().click();
    await settle(page);
    await shot(page, size, '07-matter-overview');
    await shot(page, size, '07b-matter-overview-full', true);
    for (const [n, tab] of [
      ['08', 'Tasks'],
      ['09', 'Assets'],
      ['10', 'Projects'],
    ]) {
      await tryStep(tab, async () => {
        await page.getByRole('tab', { name: new RegExp(`^${tab}`) }).first().click();
        await settle(page);
        await shot(page, size, `${n}-matter-${tab.toLowerCase()}`);
      });
    }
  });

  // 11 Task Queue with Export and Views
  await go(page, '/tasks');
  await shot(page, size, '11-task-queue');
  await tryStep('export-menu', async () => {
    await page.locator('[data-export-menu] [data-overflow]').click();
    await page.waitForTimeout(300);
    await shot(page, size, '11b-task-queue-export-menu');
    await page.keyboard.press('Escape');
  });
  await tryStep('views-menu', async () => {
    await page.locator('[data-views-trigger]').click();
    await page.waitForTimeout(300);
    await shot(page, size, '11c-task-queue-views-menu');
    await page.keyboard.press('Escape');
  });
  await tryStep('task-queue-on-hold', async () => {
    await go(page, '/tasks?status=ON_HOLD');
    await shot(page, size, '11d-task-queue-on-hold-with-reason');
  });

  // 12 Assets list, 13 asset record, 13b disposition dialog
  await go(page, '/assets');
  await shot(page, size, '12-assets-list');
  await tryStep('asset-record', async () => {
    await page.locator('tbody a[href^="/assets/"], ul a[href^="/assets/"]').first().click();
    await settle(page);
    await shot(page, size, '13-asset-record');
    await page.getByRole('button', { name: 'More actions' }).click();
    await page.getByRole('menuitem', { name: 'Change disposition' }).click();
    await page.waitForTimeout(400);
    await shot(page, size, '13b-asset-disposition-dialog');
    await page.keyboard.press('Escape');
  });

  // 14 report builder: empty, table, pie
  await tryStep('report-builder', async () => {
    await go(page, '/assets/reports');
    await shot(page, size, '14-report-builder');
    await page.locator('[data-run]').click();
    await page.locator('[data-result-table], [data-result-empty]').first().waitFor();
    await page.waitForTimeout(300);
    await shot(page, size, '14b-report-result-table');
    await page.locator('[data-show-pie]').click();
    await page.waitForTimeout(500);
    await shot(page, size, '14c-report-pie');
  });

  // 15 to 20 the rest of the PM's day
  await go(page, '/clients');
  await shot(page, size, '15-clients-list');
  await go(page, '/projects');
  await shot(page, size, '16-projects-list');
  await tryStep('search', async () => {
    await go(page, '/search?q=review');
    await shot(page, size, '17-search-results');
  });
  await go(page, '/');
  await tryStep('bell', async () => {
    await page.getByRole('button', { name: /Notifications/i }).first().click();
    await page.waitForTimeout(500);
    await shot(page, size, '18-notification-bell');
    await page.keyboard.press('Escape');
  });
  await go(page, '/notifications');
  await shot(page, size, '19-notifications-page');
  await go(page, '/');
  await tryStep('menu', async () => {
    if (size.width < 640) {
      await page.getByRole('button', { name: 'Menu', exact: true }).click();
      await page.waitForTimeout(400);
    }
    await shot(page, size, '20-menu');
  });
  await ctx.close();

  // Administrator: Task Types (colour, target), On-hold reasons, Asset Types (size field)
  const actx = await mk(ADMIN);
  const apage = await actx.newPage();
  await tryStep('admin-task-types', async () => {
    await go(apage, '/admin/task-types');
    await shot(apage, size, '21-admin-task-types');
    await apage.locator('a[href^="/admin/task-types/"]').first().click();
    await settle(apage);
    await shot(apage, size, '22-admin-task-type-edit');
    await shot(apage, size, '22b-admin-task-type-edit-full', true);
  });
  await tryStep('admin-on-hold-reasons', async () => {
    await go(apage, '/admin/on-hold-reasons');
    await shot(apage, size, '23-admin-on-hold-reasons');
  });
  await tryStep('admin-asset-types', async () => {
    await go(apage, '/admin/asset-types');
    await shot(apage, size, '24-admin-asset-types');
  });
  await actx.close();
}
await browser.close();
fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, process.env.FACTS ?? 'walkthrough-after.json'), JSON.stringify(facts, null, 1));
console.log(`${facts.length} records; errors: ${facts.filter((f) => f.error).length}`);
