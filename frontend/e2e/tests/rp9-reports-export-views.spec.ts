import fs from 'node:fs';
import { Page } from '@playwright/test';
import { Json } from '../support/api';
import { expect, test } from '../support/fixtures';
import { atEverySize } from '../support/screens';
import { uid } from '../support/seed';
import { toasts } from '../support/toasts';

/**
 * WP-RP9 (epic #671; issues #721 CSV export and #722 saved views, with #1288 sort by position): the Export CSV button and the Saved Views menu of the
 * result grid. A report of 60 rows with one column of each type runs on the real stack (it needs the read-only report login like `rp8-reports-grid.spec.ts`
 * and skips itself when Reports are not ready). The cases that need a failure (410 on the export) answer the one request from the browser.
 */
const SQL = `SELECT CAST(a.x * 10 + b.y + 1 AS int) AS [Number],
  CONCAT('Row ', a.x * 10 + b.y + 1) AS [Label],
  CAST((a.x * 10 + b.y + 1) / 4.0 AS decimal(9, 2)) AS [Share],
  CAST((a.x * 10 + b.y) % 2 AS bit) AS [Even],
  CAST(DATEADD(day, a.x * 10 + b.y, '2026-01-01') AS date) AS [Day],
  CASE WHEN a.x * 10 + b.y = 0 THEN '=1+1' ELSE 'plain' END AS [Note, with comma]
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
    name: `Export ${token}`,
    sortOrder: 820,
    isActive: true,
  });
  reportName = `Sixty rows ${token}`;
  const created = await admin.post<Json>('/api/v1/report-admin/reports', {
    name: reportName,
    categoryId: category.categoryId,
    description: 'Sixty rows, one column of each type and a comma in a name',
    sortOrder: 1,
    sql: SQL,
    parameters: [],
  });
  reportId = created.reportId as number;
  if (ready) {
    await admin.post(`/api/v1/report-admin/reports/${reportId}/preview`, {});
    await admin.post(`/api/v1/report-admin/reports/${reportId}/activate`);
  }
  const runner = await personas.create({ label: 'rp9-role', permissions: ['Report.Run'] });
  roleName = runner.roleNames[0];
  const roleId = (await admin.get<Json[]>('/api/v1/roles')).find((r) => r.name === roleName)!
    .roleId as number;
  await admin.put(`/api/v1/report-admin/reports/${reportId}/roles`, { roleIds: [roleId] });
});

const rows = (page: Page) => page.locator('[data-result-slot] tbody tr[data-record-id]');
const headers = (page: Page) => page.locator('[data-result-slot] thead tr:first-child th');
const exportButton = (page: Page) => page.locator('[data-export-csv]');
const viewsButton = (page: Page) => page.locator('[data-views-trigger]');

async function openRun(page: Page): Promise<void> {
  await page.goto(`/reports/${reportId}`);
  await page.getByRole('button', { name: 'Run Report' }).click();
  await expect(rows(page).first()).toBeVisible();
}

async function download(page: Page): Promise<{ name: string; text: string }> {
  const [file] = await Promise.all([page.waitForEvent('download'), exportButton(page).click()]);
  const path = await file.path();
  return { name: file.suggestedFilename(), text: fs.readFileSync(path, 'utf8') };
}

test.describe('Export CSV (#721)', () => {
  test.beforeEach(() => test.skip(!ready, 'Reports are not ready on this stack'));

  test('downloads the filtered and sorted rows in the visible columns: BOM, CRLF, a file name with the report slug, a success toast', async ({
    personas,
    asUser,
  }) => {
    const page = await asUser(
      (await personas.create({ label: 'rp9-a', roles: [roleName] })).username,
    );
    await openRun(page);
    // Sort by Number, newest first (a column whose name has a comma is sorted by position, see the last test), hide Share and filter by Label.
    const number = page.locator('th[data-col="Number"] button');
    await number.click();
    await number.click();
    await page.getByRole('button', { name: 'Columns' }).click();
    await page.getByRole('checkbox', { name: 'Share' }).uncheck();
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: /^Filters/ }).click();
    await page.locator('[data-filter="c1"] input, input[data-filter="c1"]').first().fill('Row 1');
    await expect(page.locator('[data-range]')).toContainText('of 11');
    await exportButton(page).hover();
    await expect(page.locator('[role="tooltip"]')).toHaveText(
      'Exports the 11 filtered rows (of 60).',
    );
    const file = await download(page);
    expect(file.name).toMatch(/-\d{8}-\d{4}\.csv$/);
    expect(file.text.charCodeAt(0)).toBe(0xfeff);
    const lines = file.text.slice(1).split('\r\n');
    expect(lines.at(-1)).toBe('');
    expect(lines[0]).toBe('Number,Label,Even,Day,"Note, with comma"');
    expect(lines).toHaveLength(11 + 2);
    expect(lines[1].startsWith('19,Row 19,')).toBe(true);
    await expect(toasts(page).last()).toContainText('Exported 11 rows to CSV.');
  });

  test('is disabled with its reason when no row is left, and keeps the result while it exports (no drop request)', async ({
    personas,
    asUser,
  }) => {
    const page = await asUser(
      (await personas.create({ label: 'rp9-b', roles: [roleName] })).username,
    );
    const drops: string[] = [];
    page.on('request', (r) => {
      if (r.method() === 'DELETE' && /\/reports\/runs\/[0-9a-f-]{36}$/.test(r.url()))
        drops.push(r.url());
    });
    await openRun(page);
    await download(page);
    expect(drops).toHaveLength(0);
    await page.getByRole('button', { name: /^Filters/ }).click();
    await page
      .locator('[data-filter="c1"] input, input[data-filter="c1"]')
      .first()
      .fill('nothing like it');
    await expect(exportButton(page)).toHaveAttribute('aria-disabled', 'true');
    await exportButton(page).hover();
    await expect(page.locator('[role="tooltip"]')).toHaveText('There are no rows to export.');
  });

  test('guards a cell that starts with = (formula injection) and sorts a column with a comma in its name by position', async ({
    personas,
    asUser,
  }) => {
    const page = await asUser(
      (await personas.create({ label: 'rp9-c', roles: [roleName] })).username,
    );
    await openRun(page);
    const sorts: string[] = [];
    page.on('request', (r) => {
      if (r.url().includes('/rows?')) sorts.push(new URL(r.url()).searchParams.get('sort') ?? '');
    });
    await page.locator('th[data-col="Note, with comma"] button').click();
    await expect.poll(() => sorts.at(-1)).toBe('#5:asc');
    const file = await download(page);
    expect(file.text).toContain("'=1+1");
  });

  test('an export of an expired result (410) is the expired banner and the form opens again', async ({
    personas,
    asUser,
  }) => {
    const page = await asUser(
      (await personas.create({ label: 'rp9-d', roles: [roleName] })).username,
    );
    await openRun(page);
    await page.route('**/api/v1/reports/runs/*/export.csv*', (route) =>
      route.fulfill({
        status: 410,
        contentType: 'application/problem+json',
        body: JSON.stringify({ status: 410, code: 'RESULT_EXPIRED' }),
      }),
    );
    await exportButton(page).click();
    await expect(page.locator('[data-run-banner]')).toContainText(
      'This result has expired. Run the report again.',
    );
    await expect(page.locator('[data-result-slot]')).toHaveCount(0);
  });
});

test.describe('Saved Views (#722)', () => {
  test.beforeEach(() => test.skip(!ready, 'Reports are not ready on this stack'));

  test('saves a view from the grid, makes it the default, opens a new result on it, renames it and deletes it', async ({
    personas,
    asUser,
  }) => {
    const page = await asUser(
      (await personas.create({ label: 'rp9-e', roles: [roleName] })).username,
    );
    await openRun(page);
    await page.locator('th[data-col="Number"] button').click();
    await page.locator('th[data-col="Number"] button').click();
    await page.getByRole('button', { name: 'Columns' }).click();
    await page.getByRole('checkbox', { name: 'Share' }).uncheck();
    await page.keyboard.press('Escape');

    await viewsButton(page).click();
    await page.getByRole('button', { name: 'Save as New View...' }).click();
    const dialog = page.getByRole('dialog', { name: 'Save View' });
    await expect(dialog.getByLabel(/View name/)).toHaveValue(`${reportName} view`);
    await dialog.getByLabel(/View name/).fill('Newest first');
    await dialog.getByLabel('Use as my default view').check();
    await dialog.getByRole('button', { name: 'Save View' }).click();
    await expect(toasts(page).last()).toContainText('View saved.');
    await expect(viewsButton(page)).toContainText('Newest first');
    await expect(viewsButton(page)).not.toContainText('(modified)');

    // A new run of the report opens on the default view: sorted, without Share. Nothing runs by itself.
    await page.reload();
    await expect(page.locator('[data-result-slot]')).toHaveCount(0);
    await page.getByRole('button', { name: 'Run Report' }).click();
    await expect(rows(page).first()).toBeVisible();
    await expect(viewsButton(page)).toContainText('Newest first');
    await expect(headers(page)).toHaveText(['Number', 'Label', 'Even', 'Day', 'Note, with comma']);
    await expect(rows(page).first().locator('td').first()).toHaveText('60');

    // A change shows "(modified)"; Save View takes it.
    await page.locator('th[data-col="Label"] button').click();
    await expect(viewsButton(page)).toContainText('Newest first (modified)');
    await viewsButton(page).click();
    await page.getByRole('button', { name: 'Save View', exact: true }).click();
    await expect(toasts(page).last()).toContainText('View saved.');
    await expect(viewsButton(page)).not.toContainText('(modified)');

    await viewsButton(page).click();
    await page.getByRole('button', { name: 'Rename Newest first' }).click();
    const rename = page.getByRole('dialog', { name: 'Rename View' });
    await rename.getByLabel(/View name/).fill('Sorted by label');
    await rename.getByRole('button', { name: 'Rename' }).click();
    await expect(toasts(page).last()).toContainText('View renamed.');
    await expect(viewsButton(page)).toContainText('Sorted by label');

    await viewsButton(page).click();
    await page.getByRole('button', { name: 'Remove Default' }).click();
    await expect(toasts(page).last()).toContainText('Default view removed.');
    await viewsButton(page).click();
    await page.getByRole('button', { name: 'Delete Sorted by label' }).click();
    await page
      .getByRole('dialog', { name: 'Delete View' })
      .getByRole('button', { name: 'Delete View' })
      .click();
    await expect(toasts(page).last()).toContainText('View deleted.');
    await expect(viewsButton(page)).toContainText('Saved Views');
  });

  test('refuses a name another view has, in any case', async ({ personas, asUser }) => {
    const page = await asUser(
      (await personas.create({ label: 'rp9-f', roles: [roleName] })).username,
    );
    await openRun(page);
    for (const name of ['Twice', 'TWICE']) {
      await viewsButton(page).click();
      await page.getByRole('button', { name: 'Save as New View...' }).click();
      const dialog = page.getByRole('dialog', { name: 'Save View' });
      await dialog.getByLabel(/View name/).fill(name);
      await dialog.getByRole('button', { name: 'Save View' }).click();
      if (name === 'TWICE') {
        await expect(dialog).toContainText('You already have a view with this name.');
        await dialog.getByRole('button', { name: 'Cancel' }).click();
      }
    }
  });

  test('has no accessibility violation and no sideways page scroll at 1366 and 1920 with the Saved Views menu open', async ({
    personas,
    asUser,
  }) => {
    const page = await asUser(
      (await personas.create({ label: 'rp9-g', roles: [roleName] })).username,
    );
    await openRun(page);
    await viewsButton(page).click();
    await atEverySize(page, 'rp9-views-menu', async () => {
      await expect(page.locator('[data-views-panel]')).toBeVisible();
    });
    await page.getByRole('button', { name: 'Save as New View...' }).click();
    await atEverySize(page, 'rp9-views-dialog', async () => {
      await expect(page.getByRole('dialog', { name: 'Save View' })).toBeVisible();
    });
  });
});
