import { Page } from '@playwright/test';
import { Json } from '../support/api';
import { axeAvailable } from '../support/axe';
import { expect, test } from '../support/fixtures';
import { atEverySize } from '../support/screens';
import { uid } from '../support/seed';

/**
 * WP-RP7 / R2 (epic #671; issue #723): favourites and recent reports on the Reports list. The star column (a text-less toggle button named by the
 * action and the report), the Favourites chip, the Recent line (up to five chips, newest first, hidden while a search or a filter is active), the
 * person-by-person isolation of both, and what happens when an assignment is taken away. The tests that run a report need the read-only report
 * login (`e2e/run-local.sh` creates it) and skip themselves when Reports are not ready. The favourites are not part of a saved view.
 */
const SQL = 'SELECT 1 AS one';

let token = '';
let roleName = '';
let roleId = 0;
let categoryName = '';
let alpha = { id: 0, name: '' };
let bravo = { id: 0, name: '' };
let charlie = { id: 0, name: '' };
let ready = false;

test.beforeAll(async ({ admin, personas }) => {
  token = uid();
  ready = (await admin.get<Json>('/api/v1/report-admin/status')).enabled === true;
  categoryName = `Stars ${token}`;
  const category = await admin.post('/api/v1/report-admin/categories', {
    name: categoryName,
    sortOrder: 830,
    isActive: true,
  });
  const make = async (name: string, sortOrder: number) => {
    const created = await admin.post<Json>('/api/v1/report-admin/reports', {
      name,
      categoryId: category.categoryId,
      description: `About ${name}`,
      sortOrder,
      sql: SQL,
      parameters: [],
    });
    if (ready) {
      await admin.post(`/api/v1/report-admin/reports/${created.reportId}/preview`, {});
      await admin.post(`/api/v1/report-admin/reports/${created.reportId}/activate`);
    }
    return { id: created.reportId as number, name };
  };
  alpha = await make(`Alpha ${token}`, 1);
  bravo = await make(`Bravo ${token}`, 2);
  charlie = await make(`Charlie ${token}`, 3);
  const role = await personas.create({ label: 'rp10-role', permissions: ['Report.Run'] });
  roleName = role.roleNames[0];
  roleId = (await admin.get<Json[]>('/api/v1/roles')).find((r) => r.name === roleName)!
    .roleId as number;
  for (const r of [alpha, bravo, charlie]) {
    await admin.put(`/api/v1/report-admin/reports/${r.id}/roles`, { roleIds: [roleId] });
  }
});

const rowOf = (page: Page, name: string) => page.locator(`tr:has(td[data-report="${name}"])`);
const starOf = (page: Page, name: string) => rowOf(page, name).locator('[data-favourite]');
const favouritesChip = (page: Page) =>
  page.locator('[data-favourites-filter] button[data-key="favourites"]');
const recentChips = (page: Page) => page.locator('[data-recent-line] a[data-recent]');
const visibleNames = (page: Page) => page.locator('td[data-report] a[data-open]');

/** Runs a report as the person of the page (the request carries the same sign-in as the page). */
async function runReport(page: Page, reportId: number): Promise<void> {
  const response = await page.request.post(`/api/v1/reports/${reportId}/runs`, {
    headers: { 'X-LptHub-Client': 'web' },
    data: { parameters: {} },
  });
  expect(response.ok(), await response.text()).toBe(true);
}

test.describe('favourites on the Reports list (#723)', () => {
  test.beforeEach(() => {
    test.skip(!ready, 'Reports are not ready on this stack');
  });

  test('the star is a keyboard operable toggle named by the action and the report; the state survives a reload and is the person’s own', async ({
    personas,
    asUser,
  }) => {
    const ann = await personas.create({ label: 'rp10-ann', roles: [roleName] });
    const bo = await personas.create({ label: 'rp10-bo', roles: [roleName] });
    const page = await asUser(ann.username);
    await page.goto('/reports');
    await expect(visibleNames(page)).toHaveCount(3);

    // Text-less icon button with an accessible name, first cell of the row, not a Tab stop of its own header.
    const star = starOf(page, alpha.name);
    await expect(star).toHaveAccessibleName(`Add ${alpha.name} to favourites`);
    await expect(star).toHaveText('');
    await expect(star.locator('i.pi-star')).toHaveCount(1);

    // The keyboard: focus the star, Enter turns it on, the name says what the next press does, the grid does not reorder.
    await star.focus();
    await page.keyboard.press('Enter');
    await expect(star).toHaveAccessibleName(`Remove ${alpha.name} from favourites`);
    await expect(star.locator('i.pi-star-fill')).toHaveCount(1);
    await expect(page.locator('[data-favourite-live]')).toContainText(
      `${alpha.name} added to favourites.`,
    );
    await expect(visibleNames(page)).toHaveText([alpha.name, bravo.name, charlie.name]);

    // It is stored on the server: a reload keeps it, another person does not see it.
    await page.reload();
    await expect(starOf(page, alpha.name)).toHaveAccessibleName(
      `Remove ${alpha.name} from favourites`,
    );
    const other = await asUser(bo.username);
    await other.goto('/reports');
    await expect(starOf(other, alpha.name)).toHaveAccessibleName(`Add ${alpha.name} to favourites`);

    // Space turns it off again.
    await starOf(page, alpha.name).focus();
    await page.keyboard.press('Space');
    await expect(starOf(page, alpha.name)).toHaveAccessibleName(`Add ${alpha.name} to favourites`);
    await page.reload();
    await expect(starOf(page, alpha.name)).toHaveAccessibleName(`Add ${alpha.name} to favourites`);
  });

  test('the Favourites chip keeps only the favourites in the address, Clear Filters brings the others back, the empty state has its words', async ({
    personas,
    asUser,
  }) => {
    const p = await personas.create({ label: 'rp10-chip', roles: [roleName] });
    const page = await asUser(p.username);
    await page.goto('/reports');
    await expect(favouritesChip(page)).toHaveAttribute('aria-pressed', 'false');

    // No favourite yet: the chip says so with the filter sentence.
    await favouritesChip(page).click();
    await expect(favouritesChip(page)).toHaveAttribute('aria-pressed', 'true');
    await expect(page).toHaveURL(/favourites=true/);
    // The pressed chip is the filter: no second removable "Favourites" chip under the toolbar (#1325).
    await expect(page.locator('[data-filter-chips] [data-chip="favourites"]')).toHaveCount(0);
    await expect(page.locator('[data-filter-empty]')).toContainText(
      'No reports match these filters.',
    );
    await page.getByRole('button', { name: 'Clear Filters' }).first().click();
    await expect(visibleNames(page)).toHaveCount(3);
    await expect(favouritesChip(page)).toHaveAttribute('aria-pressed', 'false');

    await starOf(page, bravo.name).click();
    await expect(starOf(page, bravo.name)).toHaveAccessibleName(
      `Remove ${bravo.name} from favourites`,
    );
    await favouritesChip(page).click();
    await expect(visibleNames(page)).toHaveText([bravo.name]);
    // The row appears once, in its category (no second copy above the groups).
    await expect(page.locator(`td[data-report="${bravo.name}"]`)).toHaveCount(1);
    await expect(page.locator('tr.rg-group')).toHaveCount(1);
    // Unfavouriting inside the filtered view takes the row out once the chip is pressed again.
    await favouritesChip(page).click();
    await expect(visibleNames(page)).toHaveCount(3);
  });

  test('the Recent line shows the last distinct reports run, newest first, as links to the run page; it hides while a search or the chip is active', async ({
    personas,
    asUser,
  }) => {
    const p = await personas.create({ label: 'rp10-recent', roles: [roleName] });
    const page = await asUser(p.username);
    await page.goto('/reports');
    // Nothing run yet: no line, no empty placeholder.
    await expect(page.locator('[data-recent-line]')).toHaveCount(0);

    await runReport(page, alpha.id);
    await runReport(page, bravo.id);
    await runReport(page, alpha.id);
    await page.reload();
    await expect(recentChips(page)).toHaveText([alpha.name, bravo.name]);
    await expect(page.locator('[data-recent-line]')).toContainText('Recent');
    await expect(recentChips(page).first()).toHaveAttribute('href', `/reports/${alpha.id}`);
    // The Last Run column of the same report shows the date, not Never.
    await expect(rowOf(page, alpha.name)).not.toContainText('Never');
    await expect(rowOf(page, charlie.name)).toContainText('Never');

    // A search or the chip hides the line.
    await page.getByPlaceholder('Search reports...').fill('Bravo');
    await expect(visibleNames(page)).toHaveText([bravo.name]);
    await expect(page.locator('[data-recent-line]')).toHaveCount(0);
    await page.getByPlaceholder('Search reports...').fill('');
    await expect(page.locator('[data-recent-line]')).toBeVisible();
    await favouritesChip(page).click();
    await expect(page.locator('[data-recent-line]')).toHaveCount(0);
    await favouritesChip(page).click();

    // A chip opens the run page of that report.
    await recentChips(page).nth(1).click();
    await expect(page).toHaveURL(new RegExp(`/reports/${bravo.id}$`));

    // Nobody else sees the person's line.
    const other = await personas.create({ label: 'rp10-recent-other', roles: [roleName] });
    const otherPage = await asUser(other.username);
    await otherPage.goto('/reports');
    await expect(visibleNames(otherPage)).toHaveCount(3);
    await expect(otherPage.locator('[data-recent-line]')).toHaveCount(0);
  });

  test('taking the assignment away removes the report from the stars and the Recent line without an error; assigning it again brings both back', async ({
    admin,
    personas,
    asUser,
  }) => {
    const solo = await personas.create({ label: 'rp10-solo-role', permissions: ['Report.Run'] });
    const soloRole = (await admin.get<Json[]>('/api/v1/roles')).find(
      (r) => r.name === solo.roleNames[0],
    )!.roleId as number;
    const sole = await admin.post<Json>('/api/v1/report-admin/reports', {
      name: `Solo ${token}`,
      categoryId: (await admin.get<Json[]>('/api/v1/report-admin/categories')).find(
        (c) => c.name === categoryName,
      )!.categoryId,
      description: 'Assigned to one role only',
      sortOrder: 9,
      sql: SQL,
      parameters: [],
    });
    await admin.post(`/api/v1/report-admin/reports/${sole.reportId}/preview`, {});
    await admin.post(`/api/v1/report-admin/reports/${sole.reportId}/activate`);
    await admin.put(`/api/v1/report-admin/reports/${sole.reportId}/roles`, { roleIds: [soloRole] });
    const name = `Solo ${token}`;

    const page = await asUser(solo.username);
    await page.goto('/reports');
    await starOf(page, name).click();
    await expect(starOf(page, name)).toHaveAccessibleName(`Remove ${name} from favourites`);
    await runReport(page, sole.reportId as number);
    await page.reload();
    await expect(recentChips(page)).toHaveText([name]);

    await admin.put(`/api/v1/report-admin/reports/${sole.reportId}/roles`, { roleIds: [] });
    await page.reload();
    await expect(page.locator('[data-none-assigned]')).toBeVisible();
    await expect(page.locator('[data-recent-line]')).toHaveCount(0);
    await expect(page.locator('[data-toast]')).toHaveCount(0);

    await admin.put(`/api/v1/report-admin/reports/${sole.reportId}/roles`, { roleIds: [soloRole] });
    await page.reload();
    await expect(starOf(page, name)).toHaveAccessibleName(`Remove ${name} from favourites`);
    await expect(recentChips(page)).toHaveText([name]);
  });

  test('a failed star press puts the star back and shows Couldn’t update favourites.', async ({
    personas,
    asUser,
  }) => {
    const p = await personas.create({ label: 'rp10-fail', roles: [roleName] });
    const page = await asUser(p.username);
    await page.route('**/api/v1/reports/*/favourite', (route) =>
      route.fulfill({
        status: 500,
        contentType: 'application/problem+json',
        body: JSON.stringify({ title: 'Boom', status: 500, code: 'SERVER_ERROR' }),
      }),
    );
    await page.goto('/reports');
    await starOf(page, charlie.name).click();
    await expect(page.locator('[data-toast]').last()).toContainText("Couldn't update favourites.");
    await expect(starOf(page, charlie.name)).toHaveAccessibleName(
      `Add ${charlie.name} to favourites`,
    );
  });

  test('the list with stars, the chip and the Recent line has no axe violation and no sideways scroll at 1366 and 1920', async ({
    personas,
    asUser,
  }) => {
    test.skip(!axeAvailable(), 'axe-core is not available');
    const p = await personas.create({ label: 'rp10-axe', roles: [roleName] });
    const page = await asUser(p.username);
    await page.goto('/reports');
    await starOf(page, alpha.name).click();
    await expect(starOf(page, alpha.name)).toHaveAccessibleName(
      `Remove ${alpha.name} from favourites`,
    );
    await runReport(page, bravo.id);
    await page.reload();
    await expect(recentChips(page)).toHaveCount(1);
    await atEverySize(page, 'reports-favourites', async () => {
      await expect(visibleNames(page)).toHaveCount(3);
    });
    await favouritesChip(page).click();
    await atEverySize(page, 'reports-favourites-filtered', async () => {
      await expect(visibleNames(page)).toHaveCount(1);
    });
  });
});

test.describe('favourites and recent: the API refuses what the person may not run (#723)', () => {
  test('a person who holds Report.Run but no assignment gets 404, and a person with Report.Manage only gets 403', async ({
    personas,
    asUser,
  }) => {
    const none = await personas.create({ label: 'rp10-none', permissions: ['Report.Run'] });
    const manage = await personas.create({ label: 'rp10-manage', permissions: ['Report.Manage'] });
    const headers = { 'X-LptHub-Client': 'web' };

    const runner = await asUser(none.username);
    expect(
      (await runner.request.put(`/api/v1/reports/${alpha.id}/favourite`, { headers })).status(),
    ).toBe(404);
    expect(
      (await runner.request.delete(`/api/v1/reports/${alpha.id}/favourite`, { headers })).status(),
    ).toBe(404);
    const recent = await runner.request.get('/api/v1/reports/recent');
    expect(recent.status()).toBe(200);
    expect((await recent.json()).reports).toEqual([]);

    const manager = await asUser(manage.username);
    expect(
      (await manager.request.put(`/api/v1/reports/${alpha.id}/favourite`, { headers })).status(),
    ).toBe(403);
    expect((await manager.request.get('/api/v1/reports/recent')).status()).toBe(403);
  });
});
