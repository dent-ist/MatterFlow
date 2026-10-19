import { Locator, Page } from '@playwright/test';
import { Bulk, seedBulk } from '../support/bulk';
import { expect, test } from '../support/fixtures';

/**
 * Fixed-header grid screens (docs/ux/fixed-header/README.md): on every list the page title, tabs, search and control buttons stay put and
 * ONLY the grid scrolls, with sticky column headers and the pager pinned underneath. Below 768 px wide, below 561 px high (and so at a
 * 200% zoom) the page scrolls normally instead.
 */

const box = async (locator: Locator) => {
  const b = await locator.boundingBox();
  if (!b) throw new Error('element has no box');
  return b;
};

/** Scrolls the grid region by setting scrollTop (a real wheel scroll behaves the same and is covered separately). */
const scrollRegion = (region: Locator, top: number) =>
  region.evaluate((el, t) => (el.scrollTop = t), top);
const scrollTopOf = (region: Locator) => region.evaluate((el) => el.scrollTop);

/** How far the document is taller than the window: 0 on a fixed page. */
const documentOverflow = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollHeight - window.innerHeight);

/** Body rows that are fully inside the scrolling region, under the sticky header. */
async function visibleRows(page: Page, region: Locator, rowSelector: string): Promise<number> {
  const area = await box(region);
  const head = await box(region.locator('thead').first()); // the header row and the filter row
  const rows = await page.locator(rowSelector).all();
  let count = 0;
  for (const row of rows) {
    const b = await row.boundingBox();
    if (b && b.y >= area.y + head.height - 1 && b.y + b.height <= area.y + area.height + 1) count++;
  }
  return count;
}

let bulk: Bulk;

test.describe.configure({ mode: 'serial' });

test.describe('Fixed-header screens at 1366x768', () => {
  test.beforeAll(async ({ admin, seed }) => {
    test.setTimeout(300_000);
    bulk = await seedBulk(admin, seed, {
      tasks: 64,
      clients: 30,
      matters: 30,
      projects: 0,
      assets: 0,
      workflows: 0,
      users: 0,
    });
  });

  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 768 });
  });

  test('Task Queue: title, Filters and the column headers and the filter row stay at the same place while the rows scroll', async ({
    page,
  }) => {
    await page.goto('/tasks');
    const heading = page.getByRole('heading', { name: 'Task Queue', level: 1 });
    await expect(heading).toBeVisible();
    const region = page.getByRole('region', { name: 'Task Queue list, scrollable' });
    await expect(region.locator('[data-task]').first()).toBeVisible();
    await expect(page.locator('mf-fixed-page')).toHaveAttribute('data-fixed-page', '');

    const filterRow = region.locator('tr[data-filter-row] td').first();
    await expect(filterRow).toBeVisible(); // open by default on the work lists
    const filters = page.getByRole('button', { name: /^Filters/ });
    const header = region.locator('thead th').first();
    const firstRow = region.locator('[data-task]').first();
    const pager = page.getByRole('navigation', { name: 'Pagination' });
    const before = {
      heading: await box(heading),
      filterRow: await box(filterRow),
      filters: await box(filters),
      header: await box(header),
      row: await box(firstRow),
      pager: await box(pager),
    };

    // The page itself does not scroll: the grid is taller than its region.
    expect(await documentOverflow(page)).toBeLessThanOrEqual(0);
    expect(await region.evaluate((el) => el.scrollHeight - el.clientHeight)).toBeGreaterThan(200);

    await page.mouse.move(before.row.x + 100, before.row.y + 20);
    await page.mouse.wheel(0, 700);
    await expect.poll(() => scrollTopOf(region)).toBeGreaterThan(300);

    expect(await box(heading)).toEqual(before.heading);
    expect(await box(filters)).toEqual(before.filters);
    expect(await box(filterRow)).toEqual(before.filterRow); // the filter row is sticky under the header row
    expect(await box(header)).toEqual(before.header); // sticky column header
    expect(await box(pager)).toEqual(before.pager); // pinned pager bar
    expect((await box(firstRow)).y).toBeLessThan(before.row.y - 200); // the rows moved
    expect(await page.evaluate(() => window.scrollY)).toBe(0);

    // A shadow shows under the sticky header once the rows have scrolled under it.
    await expect(region).toHaveAttribute('data-scrolled', '');
    await expect(page.locator('mf-fixed-page')).toHaveAttribute('data-scrolled', '');
    await scrollRegion(region, 0);
    await expect(region).not.toHaveAttribute('data-scrolled', '');
  });

  test('Task Queue shows at least 8 rows at 1366x768 and the pager is on screen', async ({
    page,
  }) => {
    await page.goto(`/tasks?q=${bulk.tag}`);
    const region = page.getByRole('region', { name: 'Task Queue list, scrollable' });
    await expect(region.locator('[data-task]').first()).toBeVisible();
    expect(await visibleRows(page, region, '[data-task]')).toBeGreaterThanOrEqual(8);
    const pager = await box(page.getByRole('navigation', { name: 'Pagination' }));
    expect(pager.y + pager.height).toBeLessThanOrEqual(768);
  });

  test('My Work and Pod Work: tabs, search and the header row stay put while the grid scrolls', async ({
    page,
  }) => {
    for (const [path, title, tablist] of [
      ['/my-work', 'My Work', 'My Work views'],
      [`/pods/work?podId=${bulk.podId}&view=all`, 'Pod Work', 'Pod Work views'],
    ] as const) {
      await page.goto(path);
      await expect(page.getByRole('heading', { name: title, level: 1 })).toBeVisible();
      const grid = page.locator('[role="region"][aria-label$="list, scrollable"]');
      await expect(grid.locator('[data-task]').first()).toBeVisible();
      const tabs = page.getByRole('tablist', { name: tablist });
      const before = {
        tabs: await box(tabs),
        header: await box(grid.locator('thead th').first()),
      };
      expect(await documentOverflow(page)).toBeLessThanOrEqual(0);
      await scrollRegion(grid, 500);
      expect(await box(tabs)).toEqual(before.tabs);
      expect(await box(grid.locator('thead th').first())).toEqual(before.header);
      expect(await scrollTopOf(grid)).toBeGreaterThan(100);
    }
  });

  test('Clients: the toolbar and the header row stay put; paging and sorting return the grid to the top', async ({
    page,
  }) => {
    await page.goto('/clients');
    await expect(page.getByRole('heading', { name: 'Clients', level: 1 })).toBeVisible();
    const region = page.getByRole('region', { name: 'Clients list, scrollable' });
    await expect(region.locator('tbody tr').first()).toBeVisible();
    const filters = page.getByRole('button', { name: /^Filters/ });
    const before = {
      filters: await box(filters),
      header: await box(region.locator('thead th').first()),
    };
    expect(await documentOverflow(page)).toBeLessThanOrEqual(0);

    await scrollRegion(region, 400);
    expect(await scrollTopOf(region)).toBeGreaterThan(100);
    expect(await box(filters)).toEqual(before.filters);
    expect(await box(region.locator('thead th').first())).toEqual(before.header);

    // Paging: Next is in the pinned bar and the new page starts at the top.
    await page.getByRole('button', { name: 'Next' }).click();
    await expect(page).toHaveURL(/page=2/);
    await expect.poll(() => scrollTopOf(region)).toBe(0);

    // Sorting resets it too.
    await scrollRegion(region, 200);
    await region.getByRole('button', { name: /Name/ }).click();
    await expect(page).toHaveURL(/sort=/);
    await expect.poll(() => scrollTopOf(region)).toBe(0);
  });

  test("Client page: the header and tabs stay put while the client's Matters grid scrolls", async ({
    page,
  }) => {
    await page.goto(`/clients/${bulk.mainClient.clientId}?tab=matters`);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    const region = page.getByRole('region', { name: 'Matters list, scrollable' });
    await expect(region.locator('tbody tr').first()).toBeVisible();
    const details = page.getByRole('tab', { name: 'Overview' });
    const title = page.getByRole('heading', { level: 1 });
    const before = { details: await box(details), title: await box(title) };
    expect(await documentOverflow(page)).toBeLessThanOrEqual(0);
    await scrollRegion(region, 300);
    expect(await scrollTopOf(region)).toBeGreaterThan(50);
    expect(await box(details)).toEqual(before.details);
    expect(await box(title)).toEqual(before.title);
  });

  test('Matter page: the Tasks grid scrolls under the pinned header and tabs', async ({ page }) => {
    await page.goto(`/matters/${bulk.mainMatter.matterId}?tab=tasks`);
    await expect(page.getByRole('tab', { name: /Tasks/ })).toBeVisible();
    const tab = page.getByRole('tab', { name: /Tasks/ });
    const before = await box(tab);
    expect(await documentOverflow(page)).toBeLessThanOrEqual(0);
    expect(await box(tab)).toEqual(before);
  });

  test('administration lists use the fixed layout too', async ({ page }) => {
    test.setTimeout(180_000);
    for (const [path, title, list] of [
      ['/admin/users', 'Users', 'Users list, scrollable'],
      ['/admin/pods', 'Users', 'Pods list, scrollable'],
      ['/admin/task-types', 'Task Types', 'Task types list, scrollable'],
      ['/admin/workflows', 'Task Types', 'Workflows list, scrollable'],
      ['/admin/steps', 'Task Types', 'Steps list, scrollable'],
      ['/admin/priorities', 'Labels', 'Priorities list, scrollable'],
      ['/admin/status-labels', 'Labels', 'Status labels list, scrollable'],
      ['/admin/asset-types', 'Asset Types & Link Roles', 'Asset types list, scrollable'],
      ['/admin/custom-fields', 'Custom Fields', 'Custom fields list, scrollable'],
      ['/admin/audit', 'Audit Logs', 'Audit events list, scrollable'],
    ] as const) {
      await page.goto(path);
      await expect(page.getByRole('heading', { name: title, level: 1 })).toBeVisible();
      const region = page.getByRole('region', { name: list });
      // Ten pages in one test: give each list time to arrive when the machine is busy (a long list of users is read first).
      await expect(region, path).toBeVisible({ timeout: 30_000 });
      await expect(page.locator('mf-fixed-page'), path).toHaveAttribute('data-fixed-page', '');
      expect(
        await documentOverflow(page),
        `${path}: the page itself must not scroll`,
      ).toBeLessThanOrEqual(0);
    }
  });

  test('the Audit Logs filters open inside the pinned area and do not push the grid out of view', async ({
    page,
  }) => {
    await page.goto('/admin/audit');
    const region = page.getByRole('region', { name: 'Audit events list, scrollable' });
    await expect(region.locator('tbody tr').first()).toBeVisible();
    const closed = await box(region);
    await page.getByRole('button', { name: /^Filters/ }).click();
    await expect(page.getByRole('textbox', { name: 'Filter by Summary or field' })).toBeVisible();
    const open = await box(region);
    // The filter row is one more sticky head row inside the grid: it costs the grid a few dozen pixels, not a form's height.
    expect(open.height).toBeGreaterThan(150);
    expect(open.height).toBeLessThanOrEqual(closed.height);
    expect(await documentOverflow(page)).toBeLessThanOrEqual(0);
  });

  test('the Task Queue filter row is one more sticky head row: it costs the grid a few dozen pixels, not a panel', async ({
    page,
  }) => {
    await page.goto('/tasks');
    const region = page.getByRole('region', { name: 'Task Queue list, scrollable' });
    await expect(region.locator('[data-task]').first()).toBeVisible();
    const toggle = page.getByRole('button', { name: /^Filters/ });
    const open = await box(region);
    await toggle.click(); // close it (open by default)
    await expect(page.locator('tr[data-filter-row]')).toHaveCount(0);
    const closed = await box(region);
    // Closed, the grid is taller by the filter row (40 px) at most, plus the chips line that takes its place.
    expect(closed.height - open.height).toBeGreaterThanOrEqual(0);
    expect(closed.height - open.height).toBeLessThanOrEqual(90);
    expect(open.height).toBeGreaterThan(300);
    expect(await documentOverflow(page)).toBeLessThanOrEqual(0);
    await toggle.click();
    await expect(page.locator('tr[data-filter-row]')).toBeVisible();
  });

  test('inline Status menu and the Columns chooser are not clipped by the scrolling grid', async ({
    page,
  }) => {
    await page.goto('/tasks');
    const region = page.getByRole('region', { name: 'Task Queue list, scrollable' });
    await expect(region.locator('[data-task]').first()).toBeVisible();

    // A status menu on a row near the bottom edge of the grid opens fully on screen and its items can be reached.
    const rows = region.locator('[data-task]');
    const last = rows.nth(7);
    await last.scrollIntoViewIfNeeded();
    const trigger = last.getByRole('button', { name: /status/i }).first();
    await trigger.click();
    const menu = page.getByRole('menu').or(page.getByRole('listbox')).first();
    await expect(menu).toBeVisible();
    const m = await box(menu);
    expect(m.y).toBeGreaterThanOrEqual(0);
    expect(m.y + m.height).toBeLessThanOrEqual(768 + 1);
    const centre = { x: m.x + m.width / 2, y: m.y + Math.min(m.height / 2, 20) };
    const onTop = await page.evaluate(({ x, y }) => {
      const el = document.elementFromPoint(x, y);
      return !!el?.closest('[role="menu"], [role="listbox"]');
    }, centre);
    expect(onTop).toBe(true);
    await page.keyboard.press('Escape');

    await page.getByRole('button', { name: /Columns/ }).click();
    const chooser = page
      .getByRole('group', { name: /Columns/ })
      .or(page.getByRole('dialog', { name: /Columns/ }))
      .first();
    await expect(chooser).toBeVisible();
    const c = await box(chooser);
    expect(c.y + c.height).toBeLessThanOrEqual(768 + 1);
  });

  test('keyboard: the grid is a focusable region that scrolls with the arrow and Page keys, and the skip link lands on main', async ({
    page,
  }) => {
    await page.goto('/clients');
    const region = page.getByRole('region', { name: 'Clients list, scrollable' });
    await expect(region.locator('tbody tr').first()).toBeVisible();
    await region.focus();
    await expect(region).toBeFocused();
    await page.keyboard.press('PageDown');
    await expect.poll(() => scrollTopOf(region)).toBeGreaterThan(100);
    await page.keyboard.press('Home');
    await expect.poll(() => scrollTopOf(region)).toBe(0);

    await page.goto('/clients');
    await expect(page.getByRole('heading', { name: 'Clients', level: 1 })).toBeVisible();
    await page.keyboard.press('Tab');
    await expect(page.getByRole('link', { name: 'Skip to main content' })).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.locator('#mf-main')).toBeFocused();
  });

  test('a focused link in the grid is never left under the sticky header', async ({ page }) => {
    await page.goto('/clients');
    const region = page.getByRole('region', { name: 'Clients list, scrollable' });
    await expect(region.locator('tbody tr').first()).toBeVisible();
    await scrollRegion(region, 300);
    // Tab from the last control of the (sticky) head (the filter row is open by default since WP8) to the first row, which is scrolled out of view above it.
    await region.locator('thead button, thead input, thead select').last().focus();
    await page.keyboard.press('Tab');
    const head = await box(region.locator('thead th').first());
    const focused = await box(page.locator(':focus'));
    expect(await page.locator(':focus').evaluate((el) => el.closest('tbody') !== null)).toBe(true);
    expect(focused.y).toBeGreaterThanOrEqual(head.y + head.height - 1);
  });

  test('Back restores the grid scroll position', async ({ page }) => {
    await page.goto('/tasks');
    const region = page.getByRole('region', { name: 'Task Queue list, scrollable' });
    await expect(region.locator('[data-task]').first()).toBeVisible();
    await scrollRegion(region, 900);
    const top = await scrollTopOf(region);
    expect(top).toBeGreaterThan(500);
    // A DOM click, so Playwright does not scroll the grid before it leaves.
    await region
      .locator('[data-task] a')
      .nth(14)
      .evaluate((el) => (el as HTMLElement).click());
    await expect(page).toHaveURL(/\/tasks\/\d+/);
    await page.goBack();
    const back = page.getByRole('region', { name: 'Task Queue list, scrollable' });
    await expect(back.locator('[data-task]').first()).toBeVisible();
    await expect.poll(() => scrollTopOf(back), { timeout: 8000 }).toBeGreaterThan(top - 80);
  });

  test('printing shows the whole grid, not the part that is on screen', async ({ page }) => {
    await page.goto('/clients');
    const region = page.getByRole('region', { name: 'Clients list, scrollable' });
    await expect(region.locator('tbody tr').first()).toBeVisible();
    await page.emulateMedia({ media: 'print' });
    const fits = await region.evaluate((el) => el.scrollHeight <= el.clientHeight + 1);
    expect(fits).toBe(true);
    // The grid is as tall as its rows (no inner vertical scrolling).
    expect(await region.evaluate((el) => el.scrollHeight - el.clientHeight)).toBeLessThanOrEqual(1);
  });

  test('the Create Task form keeps its action bar at the bottom of the window', async ({
    page,
  }) => {
    await page.goto('/tasks/new');
    await page.getByRole('radio').first().click();
    const create = page.getByRole('button', { name: 'Create task', exact: true }).last();
    await expect(create).toBeVisible();
    const b = await box(create);
    expect(b.y + b.height).toBeLessThanOrEqual(768);
    expect(b.y + b.height).toBeGreaterThan(768 - 90);
  });
});

test.describe('Fixed-header screens fall back to normal page scrolling', () => {
  test('at 375 px wide the page scrolls and the header is not pinned', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto('/clients');
    const heading = page.getByRole('heading', { name: 'Clients', level: 1 });
    await expect(heading).toBeVisible();
    // Below 640 px the list is cards (WP12), not a table: the cards are the rows this test needs.
    const cards = page.getByRole('list', { name: 'Clients' });
    await expect(cards.locator('[data-record-card]').first()).toBeVisible();
    await expect(page.locator('table.pg-table')).toHaveCount(0);
    expect(await documentOverflow(page)).toBeGreaterThan(100);
    const before = await box(heading);
    await page.mouse.move(180, 500);
    await page.mouse.wheel(0, 400);
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(100);
    expect((await box(heading)).y).toBeLessThan(before.y - 50); // it scrolled away with the page
    // The card list is not a scroll box: no inner vertical scrolling, the page does the scrolling.
    expect(await cards.evaluate((el) => getComputedStyle(el).overflowY)).toBe('visible');
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth - innerWidth),
    ).toBeLessThanOrEqual(0);
  });

  test('on a short window (under 561 px high) the page scrolls normally too', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 500 });
    await page.goto('/tasks');
    const region = page.getByRole('region', { name: 'Task Queue list, scrollable' });
    await expect(region.locator('[data-task]').first()).toBeVisible();
    expect(await documentOverflow(page)).toBeGreaterThan(100);
    await page.mouse.wheel(0, 500);
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(100);
  });

  test('at 768 px wide the fixed layout is on and the page does not scroll', async ({ page }) => {
    await page.setViewportSize({ width: 768, height: 900 });
    await page.goto('/clients');
    await expect(page.getByRole('heading', { name: 'Clients', level: 1 })).toBeVisible();
    await expect(
      page.getByRole('region', { name: 'Clients list, scrollable' }).locator('tbody tr').first(),
    ).toBeVisible();
    expect(await documentOverflow(page)).toBeLessThanOrEqual(0);
  });

  test('the Dashboard is a fixed page too (#137): the document does not scroll', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1366, height: 768 });
    await page.goto('/dashboard');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(page.locator('mf-fixed-page')).toHaveCount(1);
    expect(await documentOverflow(page)).toBeLessThanOrEqual(0);
  });
});
