import { Page } from '@playwright/test';
import { axeAvailable, axeViolations } from '../support/axe';
import { expect, test } from '../support/fixtures';
import { uid } from '../support/seed';

/**
 * Column filters on the administration lists (epic #75, Batch 4, issue #79): Users, Pods, Task Types, Workflows, Workflow Steps, Asset
 * Types and Audit Logs. The separate search boxes, status selects, tag popover and the Audit filter form are gone; the filter row is
 * closed by default, URLs carry the filters, the headers and the row stay in every empty state.
 */
const toggle = (page: Page) => page.getByRole('button', { name: /^Filters/ });
const text = (page: Page, column: string) =>
  page.getByRole('textbox', { name: `Filter by ${column}` });
const select = (page: Page, column: string) =>
  page.getByRole('combobox', { name: `Filter by ${column}` });
const multi = (page: Page, column: string) =>
  page.getByRole('button', { name: new RegExp(`^Filter by ${column},`) });
const grid = (page: Page, name: string) =>
  page.getByRole('region', { name: `${name}, scrollable` });
const sheet = (page: Page) => page.getByRole('dialog', { name: 'Filters' });
const chips = (page: Page) => page.getByRole('list', { name: 'Active filters' });

async function openRow(page: Page): Promise<void> {
  if ((await toggle(page).getAttribute('aria-pressed')) !== 'true') await toggle(page).click();
}

test.describe('Column filters on the administration lists', () => {
  test.describe('Users', () => {
    test('the row is closed by default; Name, Windows account, Roles, Availability and Status filter on the server', async ({
      page,
      seed,
    }) => {
      // 1600 px: the Users grid is borderline at 1366 (a person with pods fills its width and the filters then move into the sheet by design),
      // and these tests are about the filters, not about that fallback.
      await page.setViewportSize({ width: 1600, height: 900 });
      const token = uid();
      const tech = await seed.user(['Data Technician'], `tech-${token}`);
      const away = await seed.user(['Data Scientist'], `away-${token}`);
      const waiting = await seed.user([], `wait-${token}`);
      await seed.outOfOffice(away.userId, { note: 'Away' });

      await page.goto('/admin/users');
      const rows = grid(page, 'Users list').locator('tbody tr');
      await expect(rows.first()).toBeVisible();
      // No search box and no status or availability select: the filters are column filters, closed by default.
      await expect(page.getByRole('searchbox')).toHaveCount(0);
      await expect(page.locator('#users-search, #users-status, #users-availability')).toHaveCount(
        0,
      );
      await expect(toggle(page)).toHaveAttribute('aria-pressed', 'false');
      await page.goto('/admin/users?status=all');
      await expect(rows.first()).toBeVisible();

      await page.goto(`/admin/users?status=all&account=${token}`);
      await expect(text(page, 'Windows account')).toHaveValue(token); // the address opened the row
      await expect(rows).toHaveCount(3);

      // Status is a column now: the waiting person is Pending access.
      await expect(rows.filter({ hasText: waiting.username })).toContainText('Pending access');
      // Pending access is the default while someone waits (this stack has waiting people): shown, never written to the address.
      await select(page, 'Status').selectOption('pending');
      await expect(page).not.toHaveURL(/status=/);
      await expect(rows).toHaveCount(1);
      await expect(rows.first()).toContainText(waiting.username);
      await select(page, 'Status').selectOption('all');

      // Roles: a multi-select on the server (roleId=...).
      await multi(page, 'Roles').click();
      await page.getByRole('checkbox', { name: 'Data Technician' }).check();
      await page.getByRole('button', { name: 'Done' }).click();
      await expect(page).toHaveURL(/roleId=\d+/);
      await expect(rows).toHaveCount(1);
      await expect(rows.first()).toContainText(tech.username);
      await multi(page, 'Roles').click();
      const panel = page.getByRole('dialog', { name: 'Filter by Roles' });
      await panel.getByRole('button', { name: 'Clear', exact: true }).click();
      await panel.getByRole('button', { name: 'Done' }).click();
      await expect(rows).toHaveCount(3);

      // Availability: worked out by the server, so the page count follows it.
      await select(page, 'Availability').selectOption('OUT_OF_OFFICE');
      await expect(page).toHaveURL(/availability=OUT_OF_OFFICE/);
      await expect(rows).toHaveCount(1);
      await expect(rows.first()).toContainText(away.username);
      await expect(page.locator('[data-filter-live]')).toHaveText(/1 user/);

      // Name and Email narrow it further, with no match the headers and the row stay.
      await select(page, 'Availability').selectOption('');
      await text(page, 'Email').fill(`nobody-${token}`);
      await expect(page).toHaveURL(/email=/);
      await expect(grid(page, 'Users list').locator('td[data-empty="filtered"]')).toContainText(
        'No users match these filters',
      );
      await expect(grid(page, 'Users list').locator('thead th').first()).toBeVisible();
      await expect(text(page, 'Name')).toBeVisible();
      await grid(page, 'Users list').getByRole('button', { name: 'Clear filters' }).click();
      await expect(page).not.toHaveURL(/email=|account=/);
    });

    test('First seen takes a date range and presets in the viewer zone', async ({ page, seed }) => {
      // 1600 px: the Users grid is borderline at 1366 (a person with pods fills its width and the filters then move into the sheet by design),
      // and these tests are about the filters, not about that fallback.
      await page.setViewportSize({ width: 1600, height: 900 });
      const token = uid();
      await seed.user(['Data Technician'], `seen-${token}`);
      await page.goto(`/admin/users?status=all&account=${token}`);
      const rows = grid(page, 'Users list').locator('tbody tr');
      await expect(rows).toHaveCount(1);

      await page.getByRole('button', { name: /^Filter by First seen/ }).click();
      await page.getByRole('button', { name: 'Today' }).click();
      await expect(page).toHaveURL(/registeredFrom=\d{4}-\d{2}-\d{2}/);
      await expect(page).toHaveURL(/registeredTo=/);
      await expect(rows).toHaveCount(1);
      await page.keyboard.press('Escape');

      await page.goto(`/admin/users?status=all&account=${token}&registeredTo=2020-01-01`);
      await expect(grid(page, 'Users list').locator('td[data-empty="filtered"]')).toBeVisible();
    });

    test('the pending cue is a preset and the default Status is shown, not counted', async ({
      page,
      seed,
    }) => {
      // 1600 px: the Users grid is borderline at 1366 (a person with pods fills its width and the filters then move into the sheet by design),
      // and these tests are about the filters, not about that fallback.
      await page.setViewportSize({ width: 1600, height: 900 });
      await seed.user([], `cue-${uid()}`); // someone is waiting
      await page.goto('/admin/users');
      await expect(grid(page, 'Users list').locator('tbody tr').first()).toBeVisible();
      await toggle(page).click();
      await expect(select(page, 'Status')).toHaveValue('pending');
      await expect(toggle(page)).toHaveText(/^\s*Filters\s*$/);
      await select(page, 'Status').selectOption('active');
      await expect(page.getByRole('button', { name: /waiting for access/ })).toBeVisible();
      await page.getByRole('button', { name: /waiting for access/ }).click();
      await expect(select(page, 'Status')).toHaveValue('pending');
      await expect(page).not.toHaveURL(/status=/);
    });
  });

  test.describe('Pods', () => {
    test('Name and Status are column filters on the third tab of Users', async ({
      page,
      seed,
      admin,
    }) => {
      await page.setViewportSize({ width: 1366, height: 768 });
      const token = uid();
      const alpha = await seed.pod(`Alpha ${token}`, []);
      await seed.pod(`Beta ${token}`, []);
      await admin.put(`/api/v1/pods/${alpha.podId}`, {
        name: alpha.name,
        description: null,
        isActive: false,
        rowVersion: alpha.rowVersion,
      });

      await page.goto('/admin/pods');
      await expect(grid(page, 'Pods list').locator('tbody tr').first()).toBeVisible();
      await expect(page.locator('#pods-search, #pods-status')).toHaveCount(0);
      await expect(text(page, 'Name')).toHaveCount(0);
      await toggle(page).click();
      await expect(select(page, 'Status')).toHaveValue('active');

      await text(page, 'Name').fill(token);
      await expect(page).toHaveURL(new RegExp(`name=${token}`));
      const rows = grid(page, 'Pods list').locator('tbody tr');
      await expect(rows).toHaveCount(1); // Active only: Beta
      await expect(rows.first()).toContainText(`Beta ${token}`);
      await select(page, 'Status').selectOption('inactive');
      await expect(rows).toHaveCount(1);
      await expect(rows.first()).toContainText(`Alpha ${token}`);
      await select(page, 'Status').selectOption('all');
      await expect(rows).toHaveCount(2);

      await text(page, 'Name').fill(`zzz-${token}`);
      await expect(grid(page, 'Pods list').locator('td[data-empty="filtered"]')).toContainText(
        'No pods match these filters',
      );
      await expect(page.locator('mf-pager')).toHaveCount(0);
    });
  });

  test.describe('Task Types, Workflows and Workflow Steps', () => {
    test('Task Types: Name and Request form filter in the browser; a workflow link is a removable chip', async ({
      page,
      seed,
    }) => {
      await page.setViewportSize({ width: 1366, height: 768 });
      const token = uid();
      const flow = await seed.workflow({ name: `Flow ${token}`, stepCount: 1 });
      await seed.taskType({
        name: `With form ${token}`,
        workflows: [flow],
        fields: [{ key: 'note', label: 'Note', control: 'TEXT' }],
      });
      await seed.taskType({ name: `Without form ${token}`, workflows: [flow] });

      await page.goto('/admin/task-types');
      await expect(grid(page, 'Task types list').locator('tbody tr').first()).toBeVisible();
      await expect(page.locator('#task-type-search, #task-type-status')).toHaveCount(0);
      await toggle(page).click();
      await text(page, 'Name').fill(token);
      const rows = grid(page, 'Task types list').locator('tbody tr');
      await expect(rows).toHaveCount(2);
      await select(page, 'Request form').selectOption('published');
      await expect(page).toHaveURL(/form=published/);
      await expect(rows).toHaveCount(1);
      await expect(rows.first()).toContainText(`With form ${token}`);
      await select(page, 'Request form').selectOption('none');
      await expect(rows.first()).toContainText(`Without form ${token}`);

      // A link from a workflow: a chip with the workflow's name and the sentence above the grid.
      await page.goto(`/admin/task-types?workflow=${flow.workflowDefinitionId}`);
      await expect(rows).toHaveCount(2);
      await expect(page.locator('[data-filtered-by]')).toContainText(
        `Filtered by workflow ${flow.name}`,
      );
      await page.getByRole('button', { name: `Remove filter Workflow: ${flow.name}` }).click();
      await expect(page).not.toHaveURL(/workflow=/);
    });

    test('Workflows: Name, Latest published and Draft filter on the server', async ({
      page,
      seed,
      admin,
    }) => {
      await page.setViewportSize({ width: 1366, height: 768 });
      const token = uid();
      const published = await seed.workflow({ name: `Published ${token}`, stepCount: 1 });
      const both = await seed.workflow({ name: `Both ${token}`, stepCount: 1 });
      await admin.post(`/api/v1/workflows/${both.workflowDefinitionId}/versions`, {});
      await admin.post('/api/v1/workflows', { name: `Draft only ${token}`, isOrdered: true });

      await page.goto(`/admin/workflows?name=${token}`);
      const rows = grid(page, 'Workflows list').locator('tbody tr');
      await expect(rows).toHaveCount(3);
      await expect(page.locator('#wf-search, #wf-status')).toHaveCount(0);

      await select(page, 'Latest published').selectOption('false');
      await expect(page).toHaveURL(/hasPublished=false/);
      await expect(rows).toHaveCount(1);
      await expect(rows.first()).toContainText(`Draft only ${token}`);
      await select(page, 'Latest published').selectOption('true');
      await expect(rows).toHaveCount(2);
      await select(page, 'Draft').selectOption('true');
      await expect(page).toHaveURL(/hasDraft=true/);
      await expect(rows).toHaveCount(1);
      await expect(rows.first()).toContainText(`Both ${token}`);
      await select(page, 'Draft').selectOption('false');
      await expect(rows).toHaveCount(1);
      await expect(rows.first()).toContainText(`Published ${token}`);
      expect(published.name).toBe(`Published ${token}`);
      await text(page, 'Name').fill(`zzz-${token}`);
      await expect(grid(page, 'Workflows list').locator('td[data-empty="filtered"]')).toBeVisible();
    });

    test('Workflow Steps: Title, Description, Tags with Match all or any, and Used in', async ({
      page,
      seed,
    }) => {
      await page.setViewportSize({ width: 1366, height: 768 });
      const token = uid();
      const one = await seed.step({
        title: `Alpha ${token}`,
        tags: [`red-${token}`, `blue-${token}`],
      });
      await seed.step({ title: `Beta ${token}`, tags: [`red-${token}`] });
      await seed.workflow({
        name: `Uses ${token}`,
        steps: [{ stepDefinitionId: one.id, title: one.title }],
      });

      await page.goto(`/admin/steps?title=${token}`);
      const rows = grid(page, 'Steps list').locator('tbody tr');
      await expect(rows).toHaveCount(2);
      await expect(page.locator('#step-search, #step-status, #step-tags-button')).toHaveCount(0);

      // Tags: both steps carry red; only Alpha carries blue. All = every chosen tag, Any = at least one.
      await page.goto(`/admin/steps?title=${token}&tags=red-${token}&tags=blue-${token}`);
      await expect(rows).toHaveCount(1);
      await expect(rows.first()).toContainText(`Alpha ${token}`);
      await select(page, 'Tag match').selectOption('any');
      await expect(page).toHaveURL(/tagMatch=any/);
      await expect(rows).toHaveCount(2);
      await expect(multi(page, 'Tags')).toContainText('2 selected');

      // Used in: only Alpha is in a workflow.
      await page.goto(`/admin/steps?title=${token}`);
      await select(page, 'Used in').selectOption('true');
      await expect(page).toHaveURL(/used=true/);
      await expect(rows).toHaveCount(1);
      await expect(rows.first()).toContainText(`Alpha ${token}`);
      await select(page, 'Used in').selectOption('false');
      await expect(rows).toHaveCount(1);
      await expect(rows.first()).toContainText(`Beta ${token}`);

      // Description has its own box.
      await select(page, 'Used in').selectOption('');
      await text(page, 'Description').fill(`nothing-${token}`);
      await expect(grid(page, 'Steps list').locator('td[data-empty="filtered"]')).toBeVisible();
      await expect(text(page, 'Title')).toBeVisible();
    });
  });

  test.describe('Asset Types', () => {
    test('Active is the default; Name and Status are in the address; the other tab does not keep them', async ({
      page,
      admin,
    }) => {
      await page.setViewportSize({ width: 1366, height: 768 });
      const token = uid();
      const keep = await admin.post('/api/v1/asset-types', { name: `Keep ${token}`, sortOrder: 5 });
      const retired = await admin.post('/api/v1/asset-types', {
        name: `Retired ${token}`,
        sortOrder: 6,
      });
      await admin.put(`/api/v1/asset-types/${retired.assetTypeId}`, {
        name: retired.name,
        description: null,
        sortOrder: 6,
        isActive: false,
        rowVersion: retired.rowVersion,
      });
      expect(keep.name).toBe(`Keep ${token}`);

      await page.goto('/admin/asset-types');
      await expect(grid(page, 'Asset types list').locator('tbody tr').first()).toBeVisible();
      await expect(page.locator('#asset-type-search, #asset-type-status')).toHaveCount(0);
      await toggle(page).click();
      await expect(select(page, 'Status')).toHaveValue('active'); // was All before this change
      await expect(toggle(page)).toHaveText(/^\s*Filters\s*$/);

      await text(page, 'Name').fill(token);
      const rows = grid(page, 'Asset types list').locator('tbody tr');
      await expect(rows).toHaveCount(1);
      await expect(page).toHaveURL(new RegExp(`name=${token}`));
      await select(page, 'Status').selectOption('all');
      await expect(rows).toHaveCount(2);

      await page.getByRole('tab', { name: 'Asset Link Roles' }).click();
      await expect(page).toHaveURL(/tab=link-roles/);
      await expect(page).not.toHaveURL(/name=|status=/);
    });
  });

  test.describe('Audit Logs', () => {
    test('filters apply live and live in the address; the event, object and operation filters work together', async ({
      page,
      seed,
    }) => {
      await page.setViewportSize({ width: 1366, height: 768 });
      const client = await seed.client();
      await page.goto('/admin/audit');
      const rows = grid(page, 'Audit events list').locator(
        'tbody tr[data-event], tbody tr[data-group]',
      );
      await expect(rows.first()).toBeVisible();
      // No form, no Apply or Reset button: closed by default, and live.
      await expect(page.getByRole('button', { name: 'Apply filters' })).toHaveCount(0);
      await expect(page.getByRole('search', { name: 'Filter audit events' })).toHaveCount(0);
      await expect(toggle(page)).toHaveAttribute('aria-pressed', 'false');

      await toggle(page).click();
      await select(page, 'Event type').selectOption('CLIENT_CREATED');
      await expect(page).toHaveURL(/eventType=CLIENT_CREATED/);
      await text(page, 'Summary or field').fill(client.clientNumber);
      await expect(page).toHaveURL(new RegExp(`q=${client.clientNumber}`));
      await expect(rows).toHaveCount(1);
      await expect(rows.first()).toContainText(`Client ${client.clientNumber} created`);

      // Object type enables the object id.
      await select(page, 'Event type').selectOption('');
      await text(page, 'Summary or field').fill('');
      await expect(text(page, 'Object id')).toBeDisabled();
      await select(page, 'Object type').selectOption('Client');
      await expect(text(page, 'Object id')).toBeEnabled();
      await expect(page).toHaveURL(/objectType=Client/);

      // When: a preset in the viewer's zone writes absolute dates.
      await page.getByRole('button', { name: /^Filter by When/ }).click();
      await page.getByRole('button', { name: 'Today' }).click();
      await expect(page).toHaveURL(/from=\d{4}-\d{2}-\d{2}/);
      await expect(page).toHaveURL(/to=\d{4}-\d{2}-\d{2}/);
      await page.keyboard.press('Escape');

      // A filtered address restores the view; with no match the headers and the row stay.
      await page.goto('/admin/audit?q=zz-nothing-like-this');
      await expect(text(page, 'Summary or field')).toHaveValue('zz-nothing-like-this');
      await expect(
        grid(page, 'Audit events list').locator('td[data-empty="filtered"]'),
      ).toBeVisible();
      await expect(grid(page, 'Audit events list').locator('thead th').first()).toBeVisible();
      await grid(page, 'Audit events list').getByRole('button', { name: 'Clear filters' }).click();
      await expect(page).not.toHaveURL(/q=/);
    });

    test('an operation in the address is one removable chip with the banner', async ({
      page,
      seed,
      admin,
    }) => {
      await page.setViewportSize({ width: 1366, height: 768 });
      const client = await seed.client();
      const found = await admin.get<{ items: { correlationId: string }[] }>(
        `/api/v1/audit/search?q=${client.clientNumber}`,
      );
      const operation = found.items[0].correlationId;
      await page.goto(`/admin/audit?correlationId=${operation}`);
      await expect(page.locator('[data-operation-banner]')).toBeVisible();
      await expect(chips(page)).toContainText('Operation: One operation');
      await expect(grid(page, 'Audit events list').locator('tbody tr').first()).toBeVisible();
      await page.getByRole('button', { name: 'Remove filter Operation: One operation' }).click();
      await expect(page).not.toHaveURL(/correlationId=/);
      await expect(page.locator('[data-operation-banner]')).toHaveCount(0);
    });
  });

  test('axe: closed, open, filtered, empty at 1366 and the sheet at 375, on every administration list', async ({
    page,
    seed,
  }) => {
    test.skip(!axeAvailable(), 'axe-core not installed (set E2E_AXE_PATH to axe.min.js)');
    test.setTimeout(420_000);
    const token = uid();
    await seed.user([], `axe-${token}`);
    await seed.pod(`Axe Pod ${token}`, []);
    const flow = await seed.workflow({ name: `Axe Flow ${token}`, stepCount: 1 });
    await seed.taskType({ name: `Axe Type ${token}`, workflows: [flow] });
    await page.setViewportSize({ width: 1366, height: 768 });

    const screens = [
      ['/admin/users?status=all', 'Users list', 'Name'],
      ['/admin/pods', 'Pods list', 'Name'],
      ['/admin/task-types', 'Task types list', 'Name'],
      ['/admin/workflows', 'Workflows list', 'Name'],
      ['/admin/steps', 'Steps list', 'Title'],
      ['/admin/asset-types', 'Asset types list', 'Name'],
      ['/admin/audit', 'Audit events list', 'Summary or field'],
    ] as const;
    for (const [url, region, column] of screens) {
      await page.goto(url);
      await expect(grid(page, region).locator('tbody tr').first()).toBeVisible();
      expect(await axeViolations(page), `${url} closed`).toEqual([]);
      await openRow(page); // a link that carries filters opens the row by itself
      await expect(text(page, column)).toBeVisible();
      expect(await axeViolations(page), `${url} open`).toEqual([]);
      await text(page, column).fill(token);
      await text(page, column).press('Enter');
      expect(await axeViolations(page), `${url} filtered`).toEqual([]);
      await text(page, column).fill(`${token}-nothing`);
      await text(page, column).press('Enter');
      await expect(grid(page, region).locator('td[data-empty="filtered"]')).toBeVisible();
      expect(await axeViolations(page), `${url} empty`).toEqual([]);
    }

    await page.setViewportSize({ width: 375, height: 812 });
    for (const [url] of screens) {
      await page.goto(url);
      await toggle(page).click();
      await expect(sheet(page)).toBeVisible();
      expect(await axeViolations(page), `${url} sheet`).toEqual([]);
    }
  });
});
