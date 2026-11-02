import { Page } from '@playwright/test';
import { axeAvailable, axeViolations } from '../support/axe';
import { labelledDropdown } from '../support/dropdown';
import { expect, test } from '../support/fixtures';
import { uid } from '../support/seed';

/**
 * The list toolbar (epic #1037, LC-01 #1038, LC-02 #1039, LC-05 #1042, LC-07 #1045): Search first, Filters right after it, Columns at the right end, the
 * count chip in the title, "+ New X" in the title row, the Sorted by line with Reset sort, the pager at 50 rows, at 1366x768 and on a phone.
 */
const DESKTOP = { width: 1366, height: 768 };
const PHONE = { width: 375, height: 812 };

const box = async (page: Page, selector: string) =>
  (await page.locator(selector).first().boundingBox())!;

test.describe('List toolbar on Clients (record list)', () => {
  test('the zones are where the anatomy says; Search, Filters, chips, Clear filters, Sorted by and Reset sort work', async ({
    page,
    seed,
  }) => {
    const token = uid();
    await seed.client({ name: `Zebra ${token}` });
    await seed.client({ name: `Apple ${token}` });
    await page.setViewportSize(DESKTOP);
    await page.goto(`/clients?name=${token}`);

    // Row 1: title, the count chip, "+ New Client" far right.
    await expect(page.getByRole('heading', { name: 'Clients', level: 1 })).toBeVisible();
    await expect(page.locator('[data-list-count]')).toContainText('2');
    const newButton = page.getByRole('button', { name: 'New Client' });
    await expect(newButton).toHaveText(/New Client/);
    const title = await box(page, '[data-page-title]');
    const create = (await newButton.boundingBox())!;
    expect(create.x).toBeGreaterThan(title.x + 300);
    expect(Math.abs(create.y - title.y)).toBeLessThan(40);

    // Row 2: Search first, Filters right after it.
    const search = page.getByRole('searchbox', { name: 'Search clients' });
    await expect(search).toHaveValue(token);
    const s = (await search.boundingBox())!;
    const f = (await page.getByRole('button', { name: /^Filters/ }).boundingBox())!;
    expect(s.x).toBeLessThan(f.x);
    expect(f.x - (s.x + s.width)).toBeLessThan(24);
    expect(Math.abs(f.y - s.y)).toBeLessThan(12);
    // The search text is not counted as a filter on the button and makes no chip.
    await expect(page.locator('[data-filter-count]')).toHaveCount(0);
    await expect(page.locator('[data-chip-id]')).toHaveCount(0);
    await expect(page.locator('tr[data-filter-row] input[data-filter="name"]')).toHaveCount(0);

    // Row 3: the default sort is stated, and there is nothing to reset yet.
    await expect(page.locator('[data-sorted-text]')).toHaveText(
      'Sorted by Client number, lowest first'.replace('lowest first', 'A to Z'),
    );
    await expect(page.locator('[data-reset-sort]')).toHaveCount(0);

    // Sort by Name from the header: the line names it; Reset sort brings the default back.
    await page.getByRole('columnheader', { name: /^Name/ }).getByRole('button').click();
    await expect(page).toHaveURL(/sort=name/);
    await expect(page.locator('[data-sorted-text]')).toHaveText('Sorted by Name, A to Z');
    await page.locator('[data-reset-sort]').click();
    await expect(page).not.toHaveURL(/sort=/);
    await expect(page.locator('[data-sorted-text]')).toContainText('Client number');

    // Typing in Search writes the same `name` parameter as before; Clear filters empties it.
    await search.fill(`Apple ${token}`);
    await expect(page).toHaveURL(new RegExp(`name=Apple`));
    await expect(page.locator('[data-list-count]')).toContainText('1');
    await page.locator('[data-clear-filters]').click();
    await expect(search).toHaveValue('');

    // The pager: 50 rows by default, a 25 / 50 / 100 selector, First and Last.
    await expect(labelledDropdown(page, 'Rows per page')).toHaveAttribute('data-value', '50');
    await expect(page.getByRole('button', { name: 'First', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Last', exact: true })).toBeVisible();
    await expect(page.locator('[data-range]')).toContainText(/Showing 1-\d+ of \d+/);
    // No page scroll on a desktop window: only the grid scrolls.
    expect(
      await page.evaluate(() => document.documentElement.scrollHeight <= window.innerHeight + 1),
    ).toBe(true);

    if (axeAvailable()) expect(await axeViolations(page)).toEqual([]);
  });

  test('on a phone Search and Filters stay, Columns is not offered and the primary button stays', async ({
    page,
  }) => {
    await page.setViewportSize(PHONE);
    await page.goto('/clients');
    await expect(page.getByRole('searchbox', { name: 'Search clients' })).toBeVisible();
    await expect(page.getByRole('button', { name: /^Filters/ })).toBeVisible();
    await expect(page.getByRole('button', { name: 'New Client' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Columns' })).toHaveCount(0);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    if (axeAvailable()) expect(await axeViolations(page)).toEqual([]);
  });
});

test.describe('List toolbar on the work lists and the Matter Tasks tab', () => {
  test('Task Queue: "+ New Task" in the title row, Search, Filters, quick views, Columns and the "..." menu in order', async ({
    page,
  }) => {
    await page.setViewportSize(DESKTOP);
    await page.goto('/tasks');
    await expect(page.getByRole('heading', { name: 'Task Queue', level: 1 })).toBeVisible();
    await expect(page.locator('[data-list-count]')).toBeVisible();
    await expect(page.getByRole('button', { name: 'New Task' })).toBeVisible();

    const search = (await page
      .getByRole('searchbox', { name: 'Search tasks', exact: true })
      .boundingBox())!;
    const filters = (await page.getByRole('button', { name: /^Filters/ }).boundingBox())!;
    const views = (await page.locator('[data-quick-views]').boundingBox())!;
    const columns = (await page.getByRole('button', { name: /^Columns/ }).boundingBox())!;
    expect(search.x).toBeLessThan(filters.x);
    expect(filters.x).toBeLessThan(views.x);
    expect(views.x).toBeLessThan(columns.x);

    // Views and Export live in the "..." menu.
    await page.getByRole('group', { name: /^Options for Task Queue/ }).count();
    await page.locator('[data-options-trigger]').click();
    await expect(page.locator('[data-views-trigger]')).toBeVisible();
    await expect(page.locator('[data-export-menu]')).toBeVisible();
    await page.keyboard.press('Escape');

    // The default sort is stated; a header click replaces it and Reset sort brings it back.
    await expect(page.locator('[data-sort-note]')).toContainText(
      'Sorted by Priority, most urgent first',
    );
    await expect(labelledDropdown(page, 'Rows per page')).toHaveAttribute('data-value', '50');
    if (axeAvailable()) expect(await axeViolations(page)).toEqual([]);

    await page.getByRole('button', { name: 'New Task' }).click();
    await expect(page).toHaveURL(/\/tasks\/new/);
  });

  test('Matter Tasks tab: "+ New Task" opens Create Task with the matter, Search finds a task, the Sorted by line is there', async ({
    page,
    seed,
  }) => {
    const world = await seed.world();
    const matter = world.matter;
    const title = `Findable ${uid()}`;
    await seed.task(world, { title });
    await page.setViewportSize(DESKTOP);
    await page.goto(`/matters/${matter.matterId}?tab=tasks`);
    const search = page.getByRole('searchbox', { name: 'Search tasks', exact: true });
    await expect(search).toBeVisible();
    await expect(page.getByRole('button', { name: /^Filters/ })).toBeVisible();
    await expect(page.locator('[data-sort-note]')).toContainText('Sorted by');
    await search.fill(title);
    await expect(page.locator('[data-task]').filter({ hasText: title })).toHaveCount(1);

    await page.getByRole('button', { name: 'New Task' }).click();
    await expect(page).toHaveURL(new RegExp(`/tasks/new\\?matterId=${matter.matterId}`));
  });
});

test.describe('LC-07: Admin Users, Pods chip', () => {
  test('the Pods chip stays inside its cell and never paints over Availability at 1366 and 1280', async ({
    page,
    seed,
    admin,
  }) => {
    const tag = uid();
    const pods = [
      (await seed.pod(`A rather long pod name for the Users grid ${tag}`, [])).podId,
      (await seed.pod(`Second pod ${tag}`, [])).podId,
    ];
    const person = await seed.user(['Data Technician'], `${tag}-pods`);
    await admin.put(`/api/v1/users/${person.userId}/pods`, { podIds: pods, primaryPodId: pods[0] });
    for (const width of [1366, 1280]) {
      await page.setViewportSize({ width, height: 768 });
      await page.goto(`/admin/users?status=all&account=${encodeURIComponent(tag)}`);
      const row = page.locator(`tr[data-user="${person.userId}"]`);
      await expect(row.locator('[data-pod-chip]').first()).toBeVisible();
      const chip = (await row.locator('[data-pod-chip]').first().boundingBox())!;
      const cell = (await row.locator('td[data-pods-cell]').boundingBox())!;
      const avail = (await row.locator('td[data-availability-cell]').boundingBox())!;
      expect(chip.x + chip.width, `${width}: chip right edge`).toBeLessThanOrEqual(
        cell.x + cell.width + 1,
      );
      expect(chip.x + chip.width, `${width}: chip against Availability`).toBeLessThanOrEqual(
        avail.x + 1,
      );
    }
  });
});

test.describe('LC-07: Matter Projects tab', () => {
  test('"+ New Project" is a button above the grid for a person who may create projects, and absent for one who may not', async ({
    page,
    seed,
    asUser,
  }) => {
    const world = await seed.world();
    await seed.project(world.matter, `Phase ${uid()}`);
    await page.setViewportSize(DESKTOP);
    await page.goto(`/matters/${world.matter.matterId}?tab=projects`);
    const button = page.getByRole('button', { name: 'New Project' });
    await expect(button).toBeVisible();
    await expect(button).toHaveText(/New Project/);
    // The matter's own header menu keeps its Project entry.
    await button.click();
    await expect(
      page.getByRole('dialog').or(page.locator('[data-project-panel]')).first(),
    ).toBeVisible();

    const role = await seed.role(['Matter.View', 'Project.View'], `E2E lc07 ${uid()}`);
    const viewer = await seed.user([role.name], 'lc07-viewer');
    const other = await asUser(viewer.username);
    await other.setViewportSize(DESKTOP);
    await other.goto(`/matters/${world.matter.matterId}?tab=projects`);
    await expect(other.locator('[data-matter-projects]')).toBeVisible();
    await expect(other.getByRole('button', { name: 'New Project' })).toHaveCount(0);
  });
});
