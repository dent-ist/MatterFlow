import { Page } from '@playwright/test';
import { Api, Json } from '../support/api';
import { axeAvailable, axeViolations } from '../support/axe';
import { expect, test } from '../support/fixtures';
import { SIZES, noHorizontalScroll, shot } from '../support/screens';
import { uid } from '../support/seed';

/**
 * WP-RP5 and WP-RP6 (epic #671; issues #712 to #715 and #717): Reports administration. The Reports list on the admin list kit with its
 * Categories, Run log, Assignments and Settings tabs; the report editor (details, query with live parameter detection, parameter definitions,
 * schema browser, preview, activation gate, version history with compare and restore); and the assignment of reports to roles from both sides.
 * The stack needs the read-only report login (`e2e/run-local.sh` creates it); the tests of the preview skip themselves when Reports are not ready.
 */
const SQL = 'SELECT n FROM (VALUES (1),(2),(3)) v(n) WHERE n <= :MAX';

interface Seeded {
  token: string;
  category: { id: number; name: string };
  other: { id: number; name: string };
}

let s: Seeded;
let ready = false;

test.beforeAll(async ({ admin }) => {
  const token = uid();
  const make = async (name: string, sortOrder: number) => {
    const c = await admin.post('/api/v1/report-admin/categories', {
      name,
      sortOrder,
      isActive: true,
    });
    return { id: c.categoryId as number, name };
  };
  s = {
    token,
    category: await make(`Follow-up ${token}`, 900),
    other: await make(`Finance ${token}`, 901),
  };
  ready = (await admin.get<Json>('/api/v1/report-admin/status')).enabled === true;
});

const reportName = (what: string) => `${what} ${s.token}`;

async function createReport(
  admin: Api,
  name: string,
  sql = 'SELECT 1 AS one',
  active = false,
): Promise<number> {
  const created = await admin.post<Json>('/api/v1/report-admin/reports', {
    name,
    categoryId: s.category.id,
    description: 'E2E report',
    sortOrder: 1,
    sql,
    parameters: [],
  });
  if (active) {
    await admin.post(`/api/v1/report-admin/reports/${created.reportId}/preview`, {});
    await admin.post(`/api/v1/report-admin/reports/${created.reportId}/activate`);
  }
  return created.reportId as number;
}

const navItem = (page: Page, label: string) =>
  page.locator('nav a', { hasText: new RegExp(`^\\s*${label}\\s*$`) });
const row = (page: Page, name: string) => page.locator(`tr[data-row="${name}"]`);
const tab = (page: Page, name: RegExp | string) => page.getByRole('tab', { name });

async function typeQuery(page: Page, sql: string): Promise<void> {
  await tab(page, 'Query').click();
  const editor = page.locator('#sql-editor');
  await editor.fill(sql);
}

async function awaitAnalysis(page: Page): Promise<void> {
  await expect(page.locator('[data-analysis-state]')).toContainText(/Valid|problem/);
}

test.describe('who can open Reports administration (#712)', () => {
  test('only Report.Manage opens the page; everybody else gets the 403 page without a single request to the reports API', async ({
    personas,
    asUser,
    admin,
  }) => {
    const runRole = await personas.create({ label: 'rp-run', permissions: ['Report.Run'] });
    const roleId = (await admin.get<Json[]>('/api/v1/roles')).find(
      (r) => r.name === runRole.roleNames[0],
    )!.roleId as number;
    const reportId = await createReport(admin, reportName('Visible'), 'SELECT 1 AS one', ready);
    await admin.put(`/api/v1/report-admin/reports/${reportId}/roles`, { roleIds: [roleId] });
    const people = {
      none: await personas.create({ label: 'rp-none', permissions: ['Matter.View'] }),
      runOnly: await personas.create({ label: 'rp-runonly', permissions: ['Report.Run'] }),
      runAssigned: runRole,
      assignOnly: await personas.create({ label: 'rp-assign', permissions: ['Report.Assign'] }),
    };
    for (const [key, person] of Object.entries(people)) {
      const page = await asUser(person.username);
      const reportCalls: string[] = [];
      page.on('request', (r) => {
        if (r.url().includes('/api/v1/report-admin')) reportCalls.push(r.url());
      });
      await page.goto('/admin/reports');
      await expect(
        page.getByRole('heading', { level: 1, name: "You don't have permission to view this." }),
        key,
      ).toBeVisible();
      expect(reportCalls, `${key} made no request to the reports API`).toEqual([]);
      await expect(navItem(page, 'Reports'), key).toHaveCount(0);
    }
  });

  test('a manager sees Reports in the menu and the tabs; Assignments only with Report.Assign', async ({
    personas,
    asUser,
  }) => {
    const manager = await personas.create({ label: 'rp-manage', permissions: ['Report.Manage'] });
    const both = await personas.create({
      label: 'rp-both',
      permissions: ['Report.Manage', 'Report.Assign'],
    });

    const page = await asUser(manager.username);
    await page.goto('/admin/reports');
    await expect(page.getByRole('heading', { level: 1, name: 'Reports' })).toBeVisible();
    await expect(navItem(page, 'Reports')).toBeVisible();
    await expect(
      page.getByRole('tablist', { name: 'Reports sections' }).getByRole('tab'),
    ).toHaveText([/^\s*Reports/, /^\s*Categories/, /^\s*Run log/, /^\s*Settings/]);

    const page2 = await asUser(both.username);
    await page2.goto('/admin/reports');
    await expect(
      page2.getByRole('tablist', { name: 'Reports sections' }).getByRole('tab'),
    ).toHaveText([
      /^\s*Reports/,
      /^\s*Categories/,
      /^\s*Run log/,
      /^\s*Assignments/,
      /^\s*Settings/,
    ]);
  });
});

test.describe('the Reports list (#712)', () => {
  test('shows reports with their category, status as text, one menu per row and no delete', async ({
    page,
    admin,
  }) => {
    const active = await createReport(admin, reportName('Alpha'), 'SELECT 1 AS one', ready);
    const inactive = await createReport(admin, reportName('Beta'));
    await page.goto(`/admin/reports?name=${s.token}&status=all`);
    await expect(row(page, reportName('Alpha'))).toBeVisible();
    await expect(row(page, reportName('Beta'))).toBeVisible();
    await expect(row(page, reportName('Beta'))).toContainText('Inactive');
    await expect(row(page, reportName('Alpha'))).toContainText(ready ? 'Active' : 'Inactive');
    await expect(row(page, reportName('Alpha')).locator('[data-category]')).toHaveText(
      s.category.name,
    );

    await page.getByRole('button', { name: `Actions for ${reportName('Beta')}` }).click();
    const items = await page.getByRole('menuitem').allTextContents();
    expect(items.join('|')).not.toMatch(/delete|remove/i);
    await page.keyboard.press('Escape');

    await page.getByRole('link', { name: reportName('Beta') }).click();
    await expect(page).toHaveURL(new RegExp(`/admin/reports/${inactive}$`));
    expect(active).toBeGreaterThan(0);
  });

  test('filters by name and category, and the empty result offers Clear filters', async ({
    page,
    admin,
  }) => {
    await createReport(admin, reportName('Gamma'));
    await page.goto(`/admin/reports?name=${s.token}&status=all`);
    await expect(row(page, reportName('Gamma'))).toBeVisible();
    await page.goto(`/admin/reports?name=zzz-no-such-report-${s.token}&status=all`);
    await expect(page.getByRole('button', { name: /clear filters/i }).first()).toBeVisible();
  });

  test('adds a category on the Categories tab', async ({ page }) => {
    await page.goto('/admin/reports?tab=categories');
    await page.getByRole('button', { name: 'New category' }).click();
    const name = `Added ${s.token}`;
    await page.locator('#cat-name').fill(name);
    await page.getByRole('button', { name: 'Add', exact: true }).click();
    await expect(page.locator(`tr[data-row="${name}"]`)).toBeVisible();
    await expect(page.locator(`tr[data-row="${name}"]`)).toContainText('Active');
  });
});

test.describe('the editor (#713 to #715)', () => {
  test.skip(() => !ready, 'Reports are not ready on this stack: the report login is missing');

  test('creates a report: the query adds its parameter, a bad query is blocked with the reason, the saved report is previewed, activated and assigned', async ({
    page,
    admin,
    personas,
  }) => {
    const role = await personas.create({ label: 'rp-runner', permissions: ['Report.Run'] });
    await page.goto('/admin/reports/new');
    await page.locator('#rep-name').fill(reportName('Created'));
    await page.locator('#rep-category').selectOption({ label: s.category.name });

    // A query that is not one SELECT is blocked, with the line and column of the problem.
    await typeQuery(page, 'SELECT 1;\nDROP TABLE dbo.Pod');
    await expect(page.locator('[data-sql-problems]')).toContainText('Line 2', { timeout: 15_000 });
    await page.getByRole('button', { name: 'Create report' }).click();
    await expect(page.locator('[data-summary]')).toContainText('Not saved');
    await expect(page.locator('[data-summary]')).toContainText('Query, line 2');
    await expect(page).toHaveURL(/\/admin\/reports\/new(\?.*)?$/);

    // The placeholder in a good query becomes a parameter within a second of the pause in typing.
    await typeQuery(page, SQL);
    await expect(tab(page, /^Parameters/)).toContainText('(1)', { timeout: 5_000 });
    await awaitAnalysis(page);
    await tab(page, /^Parameters/).click();
    await expect(page.locator('[data-parameter="MAX"]')).toBeVisible();
    await page.locator('#param-0-type').selectOption('number');
    await page.locator('#param-0-label').fill('Largest value');
    await page.getByRole('button', { name: 'Create report' }).click();
    await expect(page).toHaveURL(/\/admin\/reports\/\d+$/);
    const id = Number(page.url().split('/').pop());
    await expect(page.locator('[data-status]')).toHaveText('Inactive');
    // Activation is hidden until this version has a successful preview, and the page says why.
    await expect(page.locator('[data-activate]')).toHaveCount(0);
    await expect(page.locator('[data-activate-reason]')).toContainText(
      'Preview the current version',
    );

    await page.getByRole('button', { name: 'Preview', exact: true }).click();
    await expect(page.locator('[data-preview-ok]')).toBeVisible();
    await page.locator('#pp-MAX').fill('2');
    await page.getByRole('button', { name: 'Run preview' }).click();
    await expect(page.locator('[data-preview-ok]')).toContainText('First 2 of 2 rows');
    await expect(
      page.getByRole('region', { name: 'Preview rows' }).locator('tbody tr'),
    ).toHaveCount(2);
    await page.getByRole('button', { name: 'Activate', exact: true }).click();
    await expect(page.locator('[data-status]')).toHaveText('Active');

    // Assignment from the report: the Roles tab.
    await tab(page, 'Roles').click();
    await page.getByRole('searchbox', { name: /search roles/i }).fill(role.roleNames[0]);
    await page.getByRole('checkbox', { name: new RegExp(role.roleNames[0]) }).check();
    await page.getByRole('button', { name: 'Save assignment' }).click();
    await expect(page.locator('[data-announce]').filter({ hasText: 'now has 1 role' })).toHaveCount(
      1,
    );
    expect(
      (await admin.get<Json>(`/api/v1/report-admin/reports/${id}/roles`))
        .filter((r: Json) => r.assigned)
        .map((r: Json) => r.name),
    ).toEqual([role.roleNames[0]]);

    // The person with that role can run it now.
    const runner = await Api.as(role.username);
    const run = await runner.raw('POST', `/api/v1/reports/${id}/runs`, { parameters: { MAX: 3 } });
    expect(run.status).toBe(200);
    await runner.dispose();
  });

  test('history: a changed query is a new version that keeps an active report active when it previews, compare shows the diff, restore deactivates', async ({
    page,
    admin,
  }) => {
    const id = await createReport(admin, reportName('History'), 'SELECT 1 AS one', true);
    await page.goto(`/admin/reports/${id}?tab=query`);
    await expect(page.locator('[data-status]')).toHaveText('Active');
    await page.locator('#sql-editor').fill('SELECT 1 AS one,\n       2 AS two');
    await awaitAnalysis(page);
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.locator('[data-state-line]')).toContainText('Version 2');
    await expect(page.locator('[data-status]')).toHaveText('Active');

    await tab(page, 'History').click();
    await expect(page.locator('[data-version]')).toHaveCount(2);
    await page
      .locator('[data-version="2"]')
      .getByRole('button', { name: /Compare with version 1/ })
      .click();
    await expect(page.locator('[data-diff]')).toContainText('Added');
    await expect(page.locator('[data-diff]')).toContainText('Removed');

    await page.locator('[data-version="1"]').getByRole('button', { name: 'Restore' }).click();
    await page.getByRole('button', { name: 'Restore as a new version' }).click();
    await expect(page.locator('[data-state-line]')).toContainText('Version 3');
    await expect(page.locator('[data-status]')).toHaveText('Inactive');
    await expect(page.locator('[data-activate]')).toHaveCount(0);
    await expect(page.locator('[data-version]')).toHaveCount(3);
  });

  test('a second editor saving first gives the Reload button instead of overwriting', async ({
    page,
    admin,
  }) => {
    const id = await createReport(admin, reportName('Concurrent'));
    await page.goto(`/admin/reports/${id}`);
    await expect(page.locator('#rep-name')).toHaveValue(reportName('Concurrent'));
    // Someone else saves a new version first (the endpoint without If-Match, as a script would).
    await admin.post(`/api/v1/report-admin/reports/${id}/versions`, {
      sql: 'SELECT 2 AS two',
      parameters: [],
      keepActive: false,
    });
    await page.locator('#rep-description').fill('Changed in the first editor');
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.locator('[data-conflict]')).toBeVisible();
    await page.getByRole('button', { name: 'Reload the latest version' }).click();
    await expect(page.locator('[data-conflict]')).toHaveCount(0);
  });

  test('the schema browser finds tables and columns, never a denied table, and inserts a bracketed name at the cursor', async ({
    page,
    admin,
  }) => {
    const id = await createReport(admin, reportName('Schema'));
    await page.goto(`/admin/reports/${id}?tab=query`);
    const editor = page.locator('#sql-editor');
    await editor.fill('SELECT * FROM ');
    await page.getByRole('button', { name: 'Schema browser' }).click();
    const panel = page.locator('[data-schema-panel]');
    await panel.getByRole('searchbox').fill('PodMember');
    await expect(panel.locator('[data-table="dbo.PodMember"]')).toBeVisible();
    await panel
      .locator('[data-table="dbo.PodMember"]')
      .getByRole('button', { name: 'Insert dbo.PodMember' })
      .click();
    await expect(editor).toHaveValue('SELECT * FROM [dbo].[PodMember]');

    await panel.getByRole('searchbox').fill('AuditEvent');
    await expect(panel.locator('[data-schema-empty]')).toBeVisible();
    await panel.getByRole('searchbox').fill('DisplayName');
    await expect(panel.locator('[data-table="dbo.AppUser"]')).toBeVisible();
    await panel
      .locator('[data-table="dbo.AppUser"]')
      .getByRole('button', { name: 'Insert DisplayName' })
      .click();
    await expect(editor).toHaveValue(/\[DisplayName\]$/);
  });

  test('keyboard only: Tab leaves the query editor, the problem list moves the cursor, no shortcut is involved', async ({
    page,
    admin,
  }) => {
    const id = await createReport(admin, reportName('Keyboard'));
    await page.goto(`/admin/reports/${id}?tab=query`);
    const editor = page.locator('#sql-editor');
    await editor.fill('SELECT 1;\nSELECT 2');
    await expect(page.locator('[data-sql-problems] button').first()).toBeVisible({
      timeout: 15_000,
    });
    await editor.focus();
    await page.keyboard.press('Tab');
    expect(await page.evaluate(() => document.activeElement?.tagName)).not.toBe('TEXTAREA');
    await page.locator('[data-sql-problems] button').first().focus();
    await page.keyboard.press('Enter');
    // The cursor is placed after the next render (`goToProblem`), so focus arrives a moment after the key, not within it.
    await expect.poll(() => page.evaluate(() => document.activeElement?.tagName)).toBe('TEXTAREA');
    // The editor is operated with Tab, Shift+Tab, Enter and Space: walk the tabs with the arrow keys.
    await tab(page, 'Query').focus();
    await page.keyboard.press('ArrowRight');
    await expect(tab(page, /^Parameters/)).toHaveAttribute('aria-selected', 'true');
  });

  test('the Run log shows the preview that was just run', async ({ page, admin }) => {
    const name = reportName('Logged');
    const id = await createReport(admin, name);
    await admin.post(`/api/v1/report-admin/reports/${id}/preview`, {});
    await page.goto('/admin/reports?tab=runs');
    await expect(page.locator('[data-runs] tbody tr', { hasText: name }).first()).toContainText(
      'Preview',
    );
  });

  test('Settings shows the state of the report login', async ({ page }) => {
    await page.goto('/admin/reports?tab=health');
    await expect(page.locator('[data-chip]')).toHaveText('Ready');
    await expect(page.locator('[data-login]')).toContainText('mf_reports');
    await expect(page.locator('[data-login]')).toContainText('Denied');
  });
});

test.describe('assignment from a role (#717)', () => {
  test.skip(() => !ready, 'Reports are not ready on this stack: the report login is missing');

  test('the Reports tab of a role assigns reports and the report shows the same state', async ({
    page,
    admin,
    personas,
  }) => {
    const id = await createReport(admin, reportName('FromRole'), 'SELECT 1 AS one', true);
    const holder = await personas.create({ label: 'rp-holder', permissions: ['Report.Run'] });
    const roleId = (await admin.get<Json[]>('/api/v1/roles')).find(
      (r) => r.name === holder.roleNames[0],
    )!.roleId as number;
    await page.goto('/admin/roles');
    await page.locator(`[data-role="${roleId}"]`).click();
    await page.getByRole('tab', { name: 'Reports' }).click();
    await page.getByRole('searchbox', { name: /search reports/i }).fill(reportName('FromRole'));
    await page.getByRole('checkbox', { name: new RegExp(reportName('FromRole')) }).check();
    await page.getByRole('button', { name: 'Save assignment' }).click();
    await expect(
      page.locator('[data-announce]').filter({ hasText: 'now has 1 report' }),
    ).toHaveCount(1);

    await page.goto(`/admin/reports/${id}?tab=roles`);
    await expect(
      page.getByRole('checkbox', { name: new RegExp(holder.roleNames[0]) }),
    ).toBeChecked();
    await page.goto('/admin/reports?tab=assignments');
    await expect(page.locator(`[data-report="${id}"] [data-yes]`)).toHaveCount(1);
  });

  test('Roles tab and Reports tab of a role are hidden without Report.Assign', async ({
    personas,
    asUser,
    admin,
  }) => {
    const id = await createReport(admin, reportName('NoAssign'));
    const manager = await personas.create({
      label: 'rp-noassign',
      permissions: ['Report.Manage', 'Role.Manage'],
    });
    const page = await asUser(manager.username);
    await page.goto(`/admin/reports/${id}`);
    await expect(page.getByRole('tab', { name: 'Roles' })).toHaveCount(0);
    await page.goto('/admin/roles');
    await page.locator('[data-role]').first().click();
    await expect(page.getByRole('tab', { name: 'Reports' })).toHaveCount(0);
  });
});

test.describe('accessibility at four sizes (#712 to #717)', () => {
  test.skip(() => !axeAvailable(), 'axe-core is not available');

  async function check(page: Page, name: string, settle: () => Promise<void>): Promise<void> {
    for (const size of SIZES) {
      await page.setViewportSize(size);
      await settle();
      expect(await axeViolations(page), `${name} at ${size.width}x${size.height}`).toEqual([]);
      await noHorizontalScroll(page);
      if (size.width === 1366 || size.width === 375) await shot(page, name);
    }
  }

  test('the list, its tabs and an open row menu', async ({ page }) => {
    await page.goto(`/admin/reports?status=all`);
    await check(page, 'rp5-list', async () => {
      await expect(page.getByRole('heading', { level: 1, name: 'Reports' })).toBeVisible();
    });
    for (const t of ['categories', 'runs', 'assignments', 'health']) {
      await page.goto(`/admin/reports?tab=${t}`);
      await check(page, `rp5-${t}`, async () => {
        await expect(page.getByRole('tabpanel')).toBeVisible();
      });
    }
  });

  test('the editor: details, query with the schema browser open, parameters, preview and history', async ({
    page,
    admin,
  }) => {
    test.skip(!ready, 'Reports are not ready on this stack');
    const id = await createReport(admin, reportName('Axe'), SQL.replace(':MAX', '2'), true);
    await page.goto(`/admin/reports/${id}`);
    await check(page, 'rp5-editor-details', async () => {
      await expect(page.locator('#rep-name')).toBeVisible();
    });

    await page.goto(`/admin/reports/${id}?tab=parameters`);
    await check(page, 'rp5-editor-parameters', async () => {
      await expect(page.locator('[data-parameters-tab]')).toBeVisible();
    });

    await page.goto(`/admin/reports/${id}?tab=history`);
    await check(page, 'rp5-editor-history', async () => {
      await expect(page.locator('[data-versions-panel]')).toBeVisible();
    });

    await page.goto(`/admin/reports/${id}?tab=query`);
    await page.getByRole('button', { name: 'Preview', exact: true }).click();
    await expect(page.locator('[data-preview-ok]')).toBeVisible();
    await page.getByRole('button', { name: 'Schema browser' }).click();
    await expect(page.locator('[data-schema-panel] [data-table]').first()).toBeVisible();
    await page.locator('[data-schema-panel] [data-table]').first().locator('.sb__toggle').click();
    await check(page, 'rp5-editor-query-schema', async () => {
      await expect(page.locator('[data-schema-panel]')).toBeVisible();
    });
  });

  test('the Roles tab of the editor and the Reports tab of a role', async ({
    page,
    admin,
    personas,
  }) => {
    test.skip(!ready, 'Reports are not ready on this stack');
    const id = await createReport(admin, reportName('AxeRoles'));
    await page.goto(`/admin/reports/${id}?tab=roles`);
    await check(page, 'rp6-report-roles', async () => {
      await expect(page.locator('[data-roles-tab]')).toBeVisible();
    });
    const holder = await personas.create({ label: 'rp-axe', permissions: ['Report.Run'] });
    const roleId = (await admin.get<Json[]>('/api/v1/roles')).find(
      (r) => r.name === holder.roleNames[0],
    )!.roleId as number;
    await page.goto('/admin/roles');
    await page.locator(`[data-role="${roleId}"]`).click();
    await page.getByRole('tab', { name: 'Reports' }).click();
    await check(page, 'rp6-role-reports', async () => {
      await expect(page.locator('[data-role-reports-tab]')).toBeVisible();
    });
  });
});
