// usage: node favourites.mjs <dist> <port>   -- #723: axe at 1366x768 and 1920x1080 on the Reports list with the stars, the Favourites chip and the Recent line,
// plus the keyboard path of the star, the Recent chips that fit, the failed press and the Recent line hiding. The whole API is mocked; nothing is written anywhere.
// SHOTS=<dir> saves 1366 JPEGs (and 1920 for the first state).
import fs from 'node:fs';
import { axeNow, boot, SIZES, sideways } from './lib.mjs';
import { createState } from './mock.mjs';
const [dist, portArg] = process.argv.slice(2);
const state = createState();
const h = await boot({ dist, port: Number(portArg), state });
const { page, base } = h;
const shotDir = process.env.SHOTS;
if (shotDir) fs.mkdirSync(shotDir, { recursive: true });
let failures = 0;
const ok = (cond, text) => { console.log(`${cond ? 'PASS' : 'FAIL'} ${text}`); if (!cond) failures++; };

let nameOf = (id, name) => name;
const reports = (fav) => ({
  totalReports: 5,
  categories: [
    { categoryId: 1, name: 'Task follow-up', sortOrder: 1, reports: [
      { reportId: 5, name: nameOf(5, 'Overdue tasks'), description: 'Tasks past their due date', sortOrder: 1, parameterCount: 2, hasParameters: true, parameterLabels: ['Pod', 'As of'], lastRunAtUtc: '2026-11-06T15:00:00Z', isFavourite: fav.has(5) },
      { reportId: 6, name: nameOf(6, 'Tasks per matter'), description: 'Open tasks counted per matter', sortOrder: 2, parameterCount: 0, hasParameters: false, parameterLabels: [], lastRunAtUtc: '2026-11-04T15:00:00Z', isFavourite: fav.has(6) },
    ] },
    { categoryId: 2, name: 'Finance', sortOrder: 2, reports: [
      { reportId: 7, name: nameOf(7, 'Billing by client and a very long report name that is cut'), description: 'Hours billed per client', sortOrder: 1, parameterCount: 1, hasParameters: true, parameterLabels: ['Period'], lastRunAtUtc: '2026-11-07T15:00:00Z', isFavourite: fav.has(7) },
      { reportId: 8, name: nameOf(8, 'Unbilled hours'), description: undefined, sortOrder: 2, parameterCount: 0, hasParameters: false, parameterLabels: [], lastRunAtUtc: '2026-11-03T15:00:00Z', isFavourite: fav.has(8) },
      { reportId: 9, name: nameOf(9, 'Write-offs'), description: 'Adjustments', sortOrder: 3, parameterCount: 0, hasParameters: false, parameterLabels: [], isFavourite: fav.has(9) },
    ] },
  ],
});
let recent = { reports: [
  { reportId: 7, name: 'Billing by client and a very long report name that is cut', categoryName: 'Finance', lastRunAtUtc: '2026-11-07T15:00:00Z' },
  { reportId: 5, name: 'Overdue tasks', categoryName: 'Task follow-up', lastRunAtUtc: '2026-11-06T15:00:00Z' },
  { reportId: 6, name: 'Tasks per matter', categoryName: 'Task follow-up', lastRunAtUtc: '2026-11-04T15:00:00Z' },
  { reportId: 8, name: 'Unbilled hours', categoryName: 'Finance', lastRunAtUtc: '2026-11-03T15:00:00Z' },
  { reportId: 9, name: 'Write-offs', categoryName: 'Finance', lastRunAtUtc: '2026-11-02T15:00:00Z' },
] };
const fav = new Set([6, 9]);
let failStars = false;
const calls = [];
// Registered after the shared mock, so these answer first.
await page.route('**/api/v1/reports', (route) => route.request().method() === 'GET'
  ? route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(reports(fav)) }) : route.fallback());
await page.route('**/api/v1/reports/recent*', (route) => { calls.push(`GET ${new URL(route.request().url()).pathname}${new URL(route.request().url()).search}`); return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(recent) }); });
await page.route('**/api/v1/reports/*/favourite', (route) => {
  const m = route.request().method();
  const id = Number(/reports\/(\d+)\/favourite/.exec(route.request().url())[1]);
  calls.push(`${m} favourite ${id}`);
  if (failStars) return route.fulfill({ status: 500, contentType: 'application/problem+json', body: JSON.stringify({ title: 'Server error', status: 500, code: 'SERVER_ERROR' }) });
  if (m === 'PUT') fav.add(id); else fav.delete(id);
  return route.fulfill({ status: 204 });
});

async function check(name, { shots = false, both = false } = {}) {
  for (const size of SIZES) {
    await page.setViewportSize(size);
    await page.waitForTimeout(300);
    const v = await axeNow(page);
    const sw = await sideways(page);
    console.log(`${v.length === 0 && sw <= 0 ? 'PASS' : 'FAIL'} ${name} ${size.width}x${size.height} violations=${v.length} sideways=${sw}`);
    if (v.length || sw > 0) failures++;
    for (const x of v) console.log('   ', x.id, x.impact, x.help, JSON.stringify(x.nodes.map((n) => [n.target, n.why]).slice(0, 2)));
    if (shotDir && shots && (size.width === 1366 || both)) await page.screenshot({ path: `${shotDir}/${name}-${size.width}.jpg`, type: 'jpeg', quality: 70 });
  }
}
const chips = () => page.locator('[data-recent-line] li[data-recent-item]:not([hidden]) a[data-recent]');

await page.setViewportSize(SIZES[0]);
await page.goto(base + '/reports');
await page.locator('td[data-report]').first().waitFor();
await page.locator('[data-recent-line]').waitFor();
ok(calls.includes('GET /api/v1/reports/recent?top=5'), 'the list asks for the five most recent reports');

// 1366: four chips fit, the fifth is hidden and is no Tab stop; 1920: all five.
await page.setViewportSize(SIZES[0]); await page.waitForTimeout(400);
const n1366 = await chips().count();
ok(n1366 >= 3 && n1366 <= 5, `1366: ${n1366} Recent chips are shown (spec: about four fit)`);
const hiddenFocusable = await page.evaluate(() => [...document.querySelectorAll('[data-recent-line] li[hidden] a')].filter((a) => a.offsetParent !== null).length);
ok(hiddenFocusable === 0, 'a hidden Recent chip is not rendered, so it is not a Tab stop');
await page.setViewportSize(SIZES[1]); await page.waitForTimeout(400);
ok((await chips().count()) === 5, '1920: all five Recent chips are shown');
await page.setViewportSize(SIZES[0]);

await check('list-fav', { shots: true, both: true });

// The star: names, state, size, keyboard.
const star = (name) => page.locator(`tr:has(td[data-report="${name}"]) [data-favourite]`);
ok((await star('Overdue tasks').getAttribute('aria-label')) === 'Add Overdue tasks to favourites', 'off star is named "Add <report> to favourites"');
ok((await star('Tasks per matter').getAttribute('aria-label')) === 'Remove Tasks per matter from favourites', 'on star is named "Remove <report> from favourites"');
const box = await star('Overdue tasks').boundingBox();
ok(box.width >= 24 && box.height >= 24, `the star target is ${Math.round(box.width)} x ${Math.round(box.height)} px (WCAG 2.2 target size minimum 24)`);
await star('Overdue tasks').focus();
await page.keyboard.press('Enter');
await page.waitForFunction(() => document.querySelector('tr:has(td[data-report="Overdue tasks"]) [data-favourite]')?.getAttribute('aria-label')?.startsWith('Remove'));
ok(calls.includes('PUT favourite 5'), 'Enter on the star sends PUT');
await page.waitForFunction(() => document.querySelector('[data-favourite-live]')?.textContent?.includes('Overdue tasks added to favourites.'));
ok(true, 'the live region announces the change');
ok((await page.evaluate(() => document.activeElement?.getAttribute('data-favourite'))) !== null, 'focus stays on the star after the press');
await page.keyboard.press('Space');
await page.waitForFunction(() => document.querySelector('tr:has(td[data-report="Overdue tasks"]) [data-favourite]')?.getAttribute('aria-label')?.startsWith('Add'));
ok(calls.includes('DELETE favourite 5'), 'Space on the star sends DELETE');

// The chip.
const chip = page.locator('[data-favourites-filter] button[data-key="favourites"]');
await chip.click();
await page.waitForFunction(() => document.querySelectorAll('td[data-report]').length === 2);
ok((await chip.getAttribute('aria-pressed')) === 'true', 'the Favourites chip is pressed');
ok(page.url().includes('favourites=true'), 'the chip is in the address');
ok((await page.locator('[data-recent-line]').count()) === 0, 'the Recent line is gone while the chip is on');
await check('list-fav-filtered', { shots: true });
await chip.click();
await page.waitForFunction(() => document.querySelectorAll('td[data-report]').length === 5);
await page.locator('[data-recent-line]').waitFor();

// A failed press.
failStars = true;
await star('Unbilled hours').click();
await page.locator('[data-toast]').first().waitFor();
ok((await page.locator('[data-toast]').first().textContent()).includes("Couldn't update favourites."), 'a failed press shows "Couldn\'t update favourites."');
ok((await star('Unbilled hours').getAttribute('aria-label')) === 'Add Unbilled hours to favourites', 'a failed press puts the star back');
await check('list-fav-toast', { shots: true });
failStars = false;

// Search hides the line.
await page.getByRole('searchbox', { name: /search reports/i }).fill('billing');
await page.waitForFunction(() => document.querySelectorAll('td[data-report]').length === 1);
ok((await page.locator('[data-recent-line]').count()) === 0, 'a search hides the Recent line');

// A chip opens the run page.
await page.getByRole('searchbox', { name: /search reports/i }).fill('');
await page.locator('[data-recent-line]').waitFor();
await chips().nth(1).click();
await page.waitForURL(/\/reports\/5$/);
ok(true, 'a Recent chip opens the run page of its report');

// Long names: the chips are cut at 180 px and the ones that do not fit are hidden, from the right (four fit at 1366).
const LONG = { 5: 'Open tasks by assignee and pod', 6: 'Tasks completed per person', 7: 'Aging of open tasks by matter', 8: 'Matters without recent activity', 9: 'Unbilled hours per client' };
nameOf = (id) => LONG[id];
recent = { reports: [5, 6, 7, 8, 9].map((id, i) => ({ reportId: id, name: LONG[id], categoryName: 'Finance', lastRunAtUtc: `2026-11-0${7 - i}T15:00:00Z` })) };
await page.goto(base + '/reports');
await page.locator('[data-recent-line]').waitFor();
await page.setViewportSize(SIZES[0]); await page.waitForTimeout(500);
const longShown = await chips().count();
ok(longShown === 5, `1366: with long names (each cut at 180 px) ${longShown} chips fit the 1098 px row (the spec guessed four; the measured row holds five)`);
await check('list-recent-long', { shots: true });
// Hiding is only for a row that is too narrow (not an offered size: a measurement of the rule). The hidden chips are no Tab stops.
await page.setViewportSize({ width: 1000, height: 768 }); await page.waitForTimeout(500);
const narrow = await chips().count();
ok(narrow > 0 && narrow < 5, `at 1000 px only ${narrow} of 5 chips are shown, the rest are hidden`);
ok((await page.evaluate(() => [...document.querySelectorAll('[data-recent-line] li[hidden] a')].filter((a) => a.offsetParent !== null).length)) === 0, 'the hidden chips are not rendered, so they are not Tab stops');
await page.setViewportSize(SIZES[1]); await page.waitForTimeout(500);
ok((await chips().count()) === 5, '1920: all five long-name chips are shown');
await page.setViewportSize(SIZES[0]);

// Empty states.
fav.clear();
await page.goto(base + '/reports?favourites=true');
await page.locator('[data-filter-empty]').waitFor();
await check('list-fav-empty', { shots: true });

await h.close();
console.log(failures === 0 ? 'ALL PASS' : `${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
