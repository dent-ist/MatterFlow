import { Page } from '@playwright/test';
import { Api, Json } from '../support/api';
import { axeAvailable, axeViolations } from '../support/axe';
import { expect, test } from '../support/fixtures';
import { SIZES, noHorizontalScroll, shot } from '../support/screens';
import { uid } from '../support/seed';

/**
 * WP-RP7 (epic #671; issues #718 and #719, and #775 for the menu item): the people-facing Reports pages. The list at `/reports` (grouped by
 * category on the record grid, search, Category filter, the states), the nav item for everybody with Report.Run, and the run page at
 * `/reports/:id` (a control per parameter type, validation, parameters in the address, Run Report and Cancel, the summary bar, the states).
 * The tests that run a report need the read-only report login (`e2e/run-local.sh` creates it) and skip themselves when Reports are not ready.
 * The result grid is issue #720 and has its own spec.
 */
const SQL = 'SELECT n FROM (VALUES (1),(2),(3)) v(n) WHERE n <= :MAX';

interface Seeded {
  token: string;
  category: { id: number; name: string };
  other: { id: number; name: string };
  reportId: number;
  reportName: string;
  hiddenId: number;
  roleName: string;
}

let s: Seeded;
let ready = false;

async function createReport(
  admin: Api,
  name: string,
  categoryId: number,
  sql: string,
  parameters: unknown[],
  description: string,
): Promise<number> {
  const created = await admin.post<Json>('/api/v1/report-admin/reports', {
    name,
    categoryId,
    description,
    sortOrder: 1,
    sql,
    parameters,
  });
  if (ready) {
    await admin.post(`/api/v1/report-admin/reports/${created.reportId}/preview`, {});
    await admin.post(`/api/v1/report-admin/reports/${created.reportId}/activate`);
  }
  return created.reportId as number;
}

test.beforeAll(async ({ admin, personas }) => {
  const token = uid();
  ready = (await admin.get<Json>('/api/v1/report-admin/status')).enabled === true;
  const make = async (name: string, sortOrder: number) => {
    const c = await admin.post('/api/v1/report-admin/categories', {
      name,
      sortOrder,
      isActive: true,
    });
    return { id: c.categoryId as number, name };
  };
  const category = await make(`Follow-up ${token}`, 800);
  const other = await make(`Finance ${token}`, 801);
  const reportName = `Counted rows ${token}`;
  const reportId = await createReport(
    admin,
    reportName,
    category.id,
    SQL,
    [
      {
        name: 'MAX',
        type: 'number',
        label: 'Highest Number',
        isRequired: true,
        min: 1,
        max: 3,
        integerOnly: true,
      },
    ],
    'Counts rows up to a number',
  );
  const hiddenId = await createReport(
    admin,
    `Hidden ${token}`,
    other.id,
    'SELECT 1 AS one',
    [],
    'Nobody has it',
  );
  const runner = await personas.create({ label: 'rp7-role', permissions: ['Report.Run'] });
  const roleId = (await admin.get<Json[]>('/api/v1/roles')).find(
    (r) => r.name === runner.roleNames[0],
  )!.roleId as number;
  await admin.put(`/api/v1/report-admin/reports/${reportId}/roles`, { roleIds: [roleId] });
  s = { token, category, other, reportId, reportName, hiddenId, roleName: runner.roleNames[0] };
});

const navItem = (page: Page, label: string) =>
  page.locator('nav a', { hasText: new RegExp(`^\\s*${label}\\s*$`) });

/** A person who holds the role the report was assigned to. */
async function runnerOf(personas: { create(spec: object): Promise<{ username: string }> }) {
  return personas.create({ label: 'rp7-assigned', roles: [s.roleName] });
}

test.describe('who sees Reports (#718, #775)', () => {
  test('Report.Run alone: the nav item is there, the page says nothing is assigned; no Report Setup', async ({
    personas,
    asUser,
  }) => {
    const p = await personas.create({ label: 'rp7-runonly', permissions: ['Report.Run'] });
    const page = await asUser(p.username);
    await page.goto('/reports');
    await expect(page.getByRole('heading', { level: 1, name: 'Reports' })).toBeVisible();
    await expect(navItem(page, 'Reports')).toBeVisible();
    await expect(navItem(page, 'Report Setup')).toHaveCount(0);
    await expect(page.locator('[data-none-assigned]')).toContainText(
      'No reports are assigned to you.',
    );
    await expect(page.locator('[data-none-assigned]')).toContainText(
      'Ask an administrator to assign reports to your role.',
    );
  });

  test('Run and assigned: the report is listed in its category, its name opens the run page, there is no Run button', async ({
    personas,
    asUser,
  }) => {
    const p = await runnerOf(personas);
    const page = await asUser(p.username);
    await page.goto('/reports');
    await expect(page.locator('tr.rg-group')).toContainText(s.category.name);
    const rowOfReport = page.locator(`tr:has(td[data-report="${s.reportName}"])`);
    await expect(rowOfReport).toContainText('1 parameter');
    await expect(rowOfReport).toContainText('Never');
    await expect(page.getByRole('button', { name: /run report/i })).toHaveCount(0);
    await page.getByRole('link', { name: s.reportName }).click();
    await expect(page).toHaveURL(new RegExp(`/reports/${s.reportId}$`));
    await expect(page.getByRole('heading', { level: 1, name: s.reportName })).toBeVisible();
  });

  test('Report.Assign only and Report.Manage only: no Reports item, the 403 page, no request to the reports API; Manage sees Report Setup', async ({
    personas,
    asUser,
  }) => {
    const people = {
      assign: await personas.create({ label: 'rp7-assign', permissions: ['Report.Assign'] }),
      manage: await personas.create({ label: 'rp7-manage', permissions: ['Report.Manage'] }),
      none: await personas.create({ label: 'rp7-none', permissions: ['Matter.View'] }),
    };
    for (const [key, person] of Object.entries(people)) {
      const page = await asUser(person.username);
      const calls: string[] = [];
      page.on('request', (r) => {
        if (/\/api\/v1\/reports(\/|$|\?)/.test(r.url())) calls.push(r.url());
      });
      await page.goto('/reports');
      await expect(
        page.getByRole('heading', { level: 1, name: "You don't have access." }),
        key,
      ).toBeVisible();
      expect(calls, `${key} made no request to the reports API`).toEqual([]);
      await expect(navItem(page, 'Reports'), key).toHaveCount(0);
      if (key === 'manage') await expect(navItem(page, 'Report Setup')).toBeVisible();
    }
  });

  test('the Project Manager menu lists Reports after Task Queue for a Project Manager who may run reports', async ({
    personas,
    asUser,
  }) => {
    const p = await personas.create({
      label: 'rp7-pm',
      roles: ['Project Manager'],
      permissions: ['Report.Run'],
    });
    const page = await asUser(p.username);
    await page.goto('/my-matters');
    const links = page.locator('nav[aria-label="Main"] a');
    await expect(links.last()).toHaveText(/Reports/);
    await expect(links.nth(-2)).toHaveText(/Task Queue/);
  });
});

test.describe('the list (#718)', () => {
  test('search narrows the loaded list, the empty search says what was searched, Clear Search brings it back', async ({
    personas,
    asUser,
  }) => {
    const p = await runnerOf(personas);
    const page = await asUser(p.username);
    await page.goto('/reports');
    await page.getByRole('searchbox', { name: /search reports/i }).fill('zzzz-nothing');
    await expect(page.locator('[data-search-empty]')).toContainText(
      'No results for "zzzz-nothing".',
    );
    await page.getByRole('button', { name: 'Clear Search' }).click();
    await expect(page.locator(`td[data-report="${s.reportName}"]`)).toBeVisible();
  });

  test("a failed load says Couldn't load reports. with Retry", async ({ personas, asUser }) => {
    const p = await runnerOf(personas);
    const page = await asUser(p.username);
    await page.route('**/api/v1/reports', (route) => route.fulfill({ status: 500, body: '{}' }));
    await page.goto('/reports');
    await expect(page.locator('[data-error]')).toContainText("Couldn't load reports.");
    await page.unroute('**/api/v1/reports');
    await page.getByRole('button', { name: 'Retry' }).click();
    await expect(page.locator(`td[data-report="${s.reportName}"]`)).toBeVisible();
  });
});

test.describe('the run page (#719)', () => {
  test('a report that is not assigned looks like one that does not exist: no access, Back to Reports', async ({
    personas,
    asUser,
  }) => {
    const p = await runnerOf(personas);
    const page = await asUser(p.username);
    for (const id of [s.hiddenId, 99999999]) {
      await page.goto(`/reports/${id}`);
      await expect(page.locator('[data-no-access]')).toContainText(
        "You don't have access to this report.",
      );
    }
    await page.getByRole('link', { name: 'Back to Reports' }).click();
    await expect(page).toHaveURL(/\/reports$/);
  });

  test('required and range errors stop the run with the fixed sentences; nothing runs by itself; the values travel in the address', async ({
    personas,
    asUser,
  }) => {
    test.skip(!ready, 'Reports are not ready on this stack');
    const p = await runnerOf(personas);
    const page = await asUser(p.username);
    let runs = 0;
    page.on('request', (r) => {
      if (r.method() === 'POST' && /\/reports\/\d+\/runs$/.test(r.url())) runs++;
    });
    await page.goto(`/reports/${s.reportId}`);
    await expect(page.locator('[data-before-run]')).toContainText('Run the report to see results.');
    await page.getByRole('button', { name: 'Run Report' }).click();
    await expect(page.locator('[data-param="MAX"] .mf-field__error')).toContainText(
      'Enter Highest Number.',
    );
    await page.locator('[data-param="MAX"] input').fill('9');
    await page.getByRole('button', { name: 'Run Report' }).click();
    await expect(page.locator('[data-param="MAX"] .mf-field__error')).toContainText(
      'Highest Number must be between 1 and 3.',
    );
    expect(runs).toBe(0);
    await page.locator('[data-param="MAX"] input').fill('2');
    await page.getByRole('button', { name: 'Run Report' }).click();
    await expect(page.locator('[data-summary-bar]')).toContainText('Highest Number 2');
    await expect(page.locator('[data-result-placeholder]')).toContainText('finished with 2 rows');
    await expect(page).toHaveURL(/MAX=2/);
    expect(runs).toBe(1);
    // The address fills the form and does not run.
    await page.reload();
    await expect(page.locator('[data-param="MAX"] input')).toHaveValue('2');
    await expect(page.locator('[data-before-run]')).toBeVisible();
    expect(runs).toBe(1);
    await page.getByRole('button', { name: 'Run Report' }).click();
    await page.getByRole('button', { name: 'Change Parameters' }).click();
    await expect(page.locator('[data-param="MAX"] input')).toBeVisible();
  });

  test('Cancel is the same button while the run is live, and a slow answer shows Running... and the skeleton', async ({
    personas,
    asUser,
  }) => {
    const p = await runnerOf(personas);
    const page = await asUser(p.username);
    await page.route(/\/api\/v1\/reports\/\d+\/runs$/, async (route) => {
      await new Promise((r) => setTimeout(r, 4000));
      await route.abort();
    });
    let cancels = 0;
    page.on('request', (r) => {
      if (r.method() === 'DELETE' && r.url().endsWith('/reports/runs/current')) cancels++;
    });
    await page.goto(`/reports/${s.reportId}?MAX=2`);
    await page.getByRole('button', { name: 'Run Report' }).click();
    await expect(page.locator('[data-running]')).toContainText('Running...');
    await expect(page.getByRole('button', { name: 'Run Report' })).toHaveCount(0);
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Run Report' })).toBeVisible();
    await expect(page.locator('[data-run-banner]')).toHaveCount(0);
    expect(cancels).toBe(1);
  });

  test('the limit messages are banners above the result, not toasts', async ({
    personas,
    asUser,
  }) => {
    const p = await runnerOf(personas);
    const page = await asUser(p.username);
    await page.route(/\/api\/v1\/reports\/\d+\/runs$/, (route) =>
      route.fulfill({
        status: 409,
        contentType: 'application/problem+json',
        body: JSON.stringify({ status: 409, code: 'REPORT_ALREADY_RUNNING', detail: 'busy' }),
      }),
    );
    await page.goto(`/reports/${s.reportId}?MAX=2`);
    await page.getByRole('button', { name: 'Run Report' }).click();
    await expect(page.locator('[data-run-banner]')).toContainText(
      'Another report is already running for you. Wait for it to finish or cancel it.',
    );
    await expect(page.getByRole('button', { name: 'Cancel Running Report' })).toBeVisible();
    await expect(page.locator('mf-toast-host [role="alert"], .mf-toast')).toHaveCount(0);
  });
});

test.describe('accessibility at both desktop sizes (#718, #719)', () => {
  test.skip(() => !axeAvailable(), 'axe-core is not available');

  async function check(page: Page, name: string): Promise<void> {
    for (const size of SIZES) {
      await page.setViewportSize(size);
      expect(await axeViolations(page), `${name} at ${size.width}x${size.height}`).toEqual([]);
      await noHorizontalScroll(page);
      if (size.width === 1366) await shot(page, name);
    }
  }

  test('the list, its empty state and the run page with the form, an error and a result', async ({
    personas,
    asUser,
  }) => {
    const p = await runnerOf(personas);
    const page = await asUser(p.username);
    await page.goto('/reports');
    await expect(page.locator(`td[data-report="${s.reportName}"]`)).toBeVisible();
    await check(page, 'rp7-list');

    await page.goto(`/reports/${s.reportId}`);
    await expect(page.locator('[data-param="MAX"]')).toBeVisible();
    await check(page, 'rp7-run-form');

    await page.getByRole('button', { name: 'Run Report' }).click();
    await expect(page.locator('[data-param="MAX"] .mf-field__error')).toBeVisible();
    await check(page, 'rp7-run-errors');

    if (ready) {
      await page.locator('[data-param="MAX"] input').fill('3');
      await page.getByRole('button', { name: 'Run Report' }).click();
      await expect(page.locator('[data-summary-bar]')).toBeVisible();
      await check(page, 'rp7-run-result');
    }

    const none = await personas.create({ label: 'rp7-empty', permissions: ['Report.Run'] });
    const empty = await asUser(none.username);
    await empty.goto('/reports');
    await expect(empty.locator('[data-none-assigned]')).toBeVisible();
    await check(empty, 'rp7-list-empty');
  });
});
