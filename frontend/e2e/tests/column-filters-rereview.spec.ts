import { Page } from '@playwright/test';
import { axeAvailable, axeViolations } from '../support/axe';
import { expect, test } from '../support/fixtures';
import { uid } from '../support/seed';

/**
 * Regression tests of the UX re-review of the inline column filters (epic #75, docs/ux/column-filters/re-review-2026-10-20.md):
 * no Angular error in the console of the Task Queue (RR-01), one Clear filters at a time on every filtered empty list (RR-02),
 * the Users list rows and row actions at 1366 px (RR-03), an empty filtered list that says what the default Status hides (RR-04).
 */
const clearButtons = (page: Page) => page.getByRole('button', { name: 'Clear filters' });

test.describe('Column filters re-review', () => {
  test('the Task Queue opens without an Angular error in the console (RR-01)', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(m.text());
    });
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.setViewportSize({ width: 1366, height: 768 });
    await page.goto('/tasks');
    await expect(page.getByRole('toolbar', { name: 'Quick views' })).toBeVisible();
    await expect(page.locator('tbody tr').first()).toBeVisible();
    await page.waitForLoadState('networkidle');
    expect(errors.filter((e) => /NG0\d+/.test(e))).toEqual([]);
  });

  test('an empty filtered list shows one Clear filters, never two (RR-02)', async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 768 });
    const none = `${uid()}-none`;
    for (const url of [
      `/tasks?q=${none}`,
      `/my-work?q=${none}`,
      `/assets?name=${none}`,
      `/admin/task-types?name=${none}`,
      `/admin/asset-types?name=${none}`,
      `/admin/audit?q=${none}`,
      `/clients?name=${none}`,
      `/admin/pods?name=${none}`,
    ]) {
      await page.goto(url);
      await expect(page.getByText(/match these filters/), url).toBeVisible();
      await expect(clearButtons(page), url).toHaveCount(1);
    }
    // The count comes back with the bar's button when the list is not empty: Clear filters is the bar's then.
    await page.goto(`/assets?status=all`);
    await expect(page.locator('tbody tr').first()).toBeVisible();
    await expect(clearButtons(page)).toHaveCount(1);
  });

  test('a person row of the Users list is one or two lines high and Open stays in view at 1366 px (RR-03)', async ({
    page,
    seed,
  }) => {
    await page.setViewportSize({ width: 1366, height: 768 });
    const token = uid();
    const a = await seed.user(['Data Technician'], `rr-a-${token}`);
    await seed.user(['Data Scientist'], `rr-b-${token}`);
    await page.goto(`/admin/users?status=all&account=${token}`);
    const region = page.getByRole('region', { name: 'Users list, scrollable' });
    const rows = region.locator('tbody tr');
    await expect(rows).toHaveCount(2);
    for (const box of await rows.evaluateAll((trs) =>
      trs.map((tr) => tr.getBoundingClientRect().height),
    )) {
      expect(box).toBeLessThan(100); // the First seen time wrapped to five lines: 119 px
    }
    await expect(rows.first().locator('td.us-seen')).toHaveText(
      /^\s*[A-Z][a-z]{2} \d{1,2}, \d{4}\s*$/,
    );
    // The grid scrolls sideways at this width (the filters are in the sheet), yet the row actions are never out of sight.
    const open = rows.filter({ hasText: a.username }).getByRole('button', { name: /^Open / });
    await expect(open).toBeVisible();
    const regionBox = (await region.boundingBox())!;
    const openBox = (await open.boundingBox())!;
    expect(openBox.x).toBeGreaterThanOrEqual(regionBox.x);
    expect(openBox.x + openBox.width).toBeLessThanOrEqual(regionBox.x + regionBox.width + 1);
    if (axeAvailable()) expect(await axeViolations(page)).toEqual([]);
  });

  test('an empty filtered list says what the default Status hides and Show all reaches it (RR-04)', async ({
    page,
    seed,
  }) => {
    await page.setViewportSize({ width: 1366, height: 768 });
    const matter = await seed.matter();
    const name = `Old ${uid()}`;
    const project = await seed.project(matter, name);
    await seed.admin.post(`/api/v1/projects/${project.projectId}/active`, {
      isActive: false,
      rowVersion: project.rowVersion,
    });
    await page.goto(`/projects?name=${name}`);
    const empty = page.locator('td[data-empty="filtered"]');
    await expect(empty).toContainText('No projects match these filters');
    await expect(empty.locator('[data-hidden-hint]')).toContainText('1 archived hidden');
    if (axeAvailable()) expect(await axeViolations(page)).toEqual([]);
    await empty.getByRole('button', { name: 'Show all' }).click();
    await expect(page).toHaveURL(/status=all/);
    await expect(page.locator('tbody tr').filter({ hasText: name })).toHaveCount(1);
    await expect(page.locator('[data-hidden-hint]')).toHaveCount(0);

    // A phone shows the same sentence in the card list.
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto(`/projects?name=${name}`);
    const cards = page.locator('[data-empty="filtered"]');
    await expect(cards).toContainText('1 archived hidden');
    await cards.getByRole('button', { name: 'Show all' }).click();
    await expect(page.locator('[data-record-card]').filter({ hasText: name })).toHaveCount(1);
  });
});
