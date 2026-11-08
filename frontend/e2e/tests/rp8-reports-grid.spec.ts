import { Page } from '@playwright/test';
import { Json } from '../support/api';
import { expect, test } from '../support/fixtures';
import { atEverySize } from '../support/screens';
import { uid } from '../support/seed';

/**
 * WP-RP7 (epic #671; issue #720, and the fixes #1282, #1283): the result grid of the run page. A report of 60 rows with one column of each type runs
 * on the real stack (it needs the read-only report login like `rp7-reports-user.spec.ts` and skips itself when Reports are not ready); the cases that
 * need a failure (410 expired, 429 hourly limit, a refused client search) answer the one request from the browser. The grid is the shared record grid:
 * paging, the sort of the header, the typed filter row, the Columns chooser, the cell formats, and the rule that only leaving the page drops the result.
 */
const SQL = `SELECT CAST(a.x * 10 + b.y + 1 AS int) AS [Number],
  CONCAT('Row ', a.x * 10 + b.y + 1) AS [Label],
  CAST((a.x * 10 + b.y + 1) / 4.0 AS decimal(9, 2)) AS [Share],
  CAST((a.x * 10 + b.y) % 2 AS bit) AS [Even],
  CAST(DATEADD(day, a.x * 10 + b.y, '2026-01-01') AS date) AS [Day]
FROM (VALUES (0), (1), (2), (3), (4), (5)) AS a (x)
CROSS JOIN (VALUES (0), (1), (2), (3), (4), (5), (6), (7), (8), (9)) AS b (y)`;

let reportId = 0;
let reportName = '';
let roleName = '';
let ready = false;

test.beforeAll(async ({ admin, personas }) => {
  const token = uid();
  ready = (await admin.get<Json>('/api/v1/report-admin/status')).enabled === true;
  const category = await admin.post('/api/v1/report-admin/categories', {
    name: `Grid ${token}`,
    sortOrder: 810,
    isActive: true,
  });
  reportName = `Sixty rows ${token}`;
  const created = await admin.post<Json>('/api/v1/report-admin/reports', {
    name: reportName,
    categoryId: category.categoryId,
    description: 'Sixty rows, one column of each type',
    sortOrder: 1,
    sql: SQL,
    parameters: [],
  });
  reportId = created.reportId as number;
  if (ready) {
    await admin.post(`/api/v1/report-admin/reports/${reportId}/preview`, {});
    await admin.post(`/api/v1/report-admin/reports/${reportId}/activate`);
  }
  const runner = await personas.create({ label: 'rp8-role', permissions: ['Report.Run'] });
  roleName = runner.roleNames[0];
  const roleId = (await admin.get<Json[]>('/api/v1/roles')).find((r) => r.name === roleName)!
    .roleId as number;
  await admin.put(`/api/v1/report-admin/reports/${reportId}/roles`, { roleIds: [roleId] });
});

const rows = (page: Page) => page.locator('[data-result-slot] tbody tr[data-record-id]');
const headers = (page: Page) => page.locator('[data-result-slot] thead tr:first-child th');

async function openRun(page: Page): Promise<void> {
  await page.goto(`/reports/${reportId}`);
  await page.getByRole('button', { name: 'Run Report' }).click();
  await expect(rows(page).first()).toBeVisible();
}

test.describe('the result grid (#720)', () => {
  test.beforeEach(() => test.skip(!ready, 'Reports are not ready on this stack'));

  test('shows the columns of the run with the formats of their types, 50 rows a page, and the right numbers in the pager', async ({
    personas,
    asUser,
  }) => {
    const page = await asUser(
      (await personas.create({ label: 'rp8-a', roles: [roleName] })).username,
    );
    await openRun(page);
    await expect(headers(page)).toHaveText(['Number', 'Label', 'Share', 'Even', 'Day']);
    await expect(rows(page)).toHaveCount(50);
    const first = rows(page).first().locator('td');
    await expect(first).toHaveText(['1', 'Row 1', '0.25', 'No', '01/01/2026']);
    await expect(page.locator('[data-range]')).toContainText('Showing 1-50 of 60');
    await expect(page.locator('[data-page]')).toContainText('Page 1 of 2');
    await page.getByRole('button', { name: 'Next' }).click();
    await expect(rows(page)).toHaveCount(10);
    await expect(page.locator('[data-page]')).toContainText('Page 2 of 2');
  });

  test('sorts on the server by a header, says so, and Reset Sort goes back to the order of the report', async ({
    personas,
    asUser,
  }) => {
    const page = await asUser(
      (await personas.create({ label: 'rp8-b', roles: [roleName] })).username,
    );
    await openRun(page);
    const number = page.locator('th[data-col="Number"] button');
    await number.click();
    await number.click();
    await expect(rows(page).first().locator('td').first()).toHaveText('60');
    await expect(page.locator('mf-sorted-line')).toContainText('Sorted by Number');
    await page.getByRole('button', { name: 'Reset Sort' }).click();
    await expect(rows(page).first().locator('td').first()).toHaveText('1');
  });

  test('filters by type: text contains, a number range, Yes and No; the chips and the filtered count say what is left; Clear Filters brings it back', async ({
    personas,
    asUser,
  }) => {
    const page = await asUser(
      (await personas.create({ label: 'rp8-c', roles: [roleName] })).username,
    );
    await openRun(page);
    await page.getByRole('button', { name: /^Filters/ }).click();
    await page.locator('[data-filter="c1"] input, input[data-filter="c1"]').first().fill('Row 1');
    await expect(page.locator('[data-range]')).toContainText('of 11');
    await expect(page.locator('[data-filtered-note]')).toContainText('Filtered from 60 rows');
    await expect(page.locator('mf-filter-chips')).toContainText('Label: Row 1');
    await page.getByRole('button', { name: 'Clear Filters' }).click();
    await expect(page.locator('[data-range]')).toContainText('of 60');
    await page.getByRole('button', { name: 'Filter by Even: Any' }).click();
    await page.getByRole('option', { name: 'Yes' }).click();
    await expect(page.locator('[data-range]')).toContainText('of 30');
  });

  test('keeps the result while the person pages, sorts and changes parameters: no drop request until the page is left', async ({
    personas,
    asUser,
  }) => {
    const page = await asUser(
      (await personas.create({ label: 'rp8-d', roles: [roleName] })).username,
    );
    const drops: string[] = [];
    page.on('request', (r) => {
      if (r.method() === 'DELETE' && /\/reports\/runs\/[0-9a-f-]{36}$/.test(r.url()))
        drops.push(r.url());
    });
    await openRun(page);
    await page.getByRole('button', { name: 'Next' }).click();
    await page.locator('th[data-col="Label"] button').click();
    await page.getByRole('button', { name: 'Columns' }).click();
    await page.keyboard.press('Escape');
    expect(drops).toHaveLength(0);
    // Leaving inside the app (a full page load never runs the page's teardown; the server's idle sweep removes that result).
    await page
      .getByRole('navigation', { name: 'Breadcrumb' })
      .getByRole('link', { name: 'Reports' })
      .click();
    await expect.poll(() => drops.length).toBe(1);
  });

  test('the Columns chooser hides a column and the choice stays for this report after a reload and a new run', async ({
    personas,
    asUser,
  }) => {
    const page = await asUser(
      (await personas.create({ label: 'rp8-e', roles: [roleName] })).username,
    );
    await openRun(page);
    await page.getByRole('button', { name: 'Columns' }).click();
    await page.getByRole('checkbox', { name: 'Share' }).uncheck();
    await page.keyboard.press('Escape');
    await expect(headers(page)).toHaveText(['Number', 'Label', 'Even', 'Day']);
    await page.reload();
    await page.getByRole('button', { name: 'Run Report' }).click();
    await expect(headers(page)).toHaveText(['Number', 'Label', 'Even', 'Day']);
  });

  test('has no accessibility violation and no sideways page scroll at 1366 and 1920, with the filter row open', async ({
    personas,
    asUser,
  }) => {
    const page = await asUser(
      (await personas.create({ label: 'rp8-f', roles: [roleName] })).username,
    );
    await openRun(page);
    await page.getByRole('button', { name: /^Filters/ }).click();
    await atEverySize(page, 'rp8-grid', async () => {
      await expect(rows(page).first()).toBeVisible();
    });
  });
});

test.describe('failures the grid and the run page word (#1282, #1283, #720)', () => {
  test.beforeEach(() => test.skip(!ready, 'Reports are not ready on this stack'));

  test('an expired result (410) is the banner, the form opens again and nothing is left to drop', async ({
    personas,
    asUser,
  }) => {
    const page = await asUser(
      (await personas.create({ label: 'rp8-g', roles: [roleName] })).username,
    );
    await page.route('**/api/v1/reports/runs/*/rows*', (route) =>
      route.fulfill({
        status: 410,
        contentType: 'application/problem+json',
        body: JSON.stringify({ status: 410, code: 'RESULT_EXPIRED' }),
      }),
    );
    await page.goto(`/reports/${reportId}`);
    await page.getByRole('button', { name: 'Run Report' }).click();
    await expect(page.locator('[data-run-banner]')).toContainText(
      'This result has expired. Run the report again.',
    );
    await expect(page.locator('[data-result-slot]')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Run Report' })).toBeVisible();
  });

  test('the hourly limit (429) names no number (#1283)', async ({ personas, asUser }) => {
    const page = await asUser(
      (await personas.create({ label: 'rp8-h', roles: [roleName] })).username,
    );
    await page.route('**/api/v1/reports/*/runs', (route) =>
      route.fulfill({
        status: 429,
        contentType: 'application/problem+json',
        body: JSON.stringify({ status: 429, code: 'REPORT_RATE_LIMITED' }),
      }),
    );
    await page.goto(`/reports/${reportId}`);
    await page.getByRole('button', { name: 'Run Report' }).click();
    const banner = page.locator('[data-run-banner]');
    await expect(banner).toContainText(
      "You've reached the hourly limit for report runs. Try again later.",
    );
    await expect(banner).not.toContainText(/\d/);
  });
});
