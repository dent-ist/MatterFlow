import fs from 'node:fs';
import path from 'node:path';
import { Locator, Page } from '@playwright/test';
import { MyWorkPage, TaskQueuePage } from '../pages/queues.pages';
import { axeAvailable, axeViolations } from '../support/axe';
import { expect, test } from '../support/fixtures';

/**
 * Task Queue toolbar (WP5: #216, #217): row 1 is one line (views, Columns, More filters, Filters) that never moves; row 2 exists only
 * when it has something to say (the restored-view notice, or chips with Clear filters, and Reset sort); "Sorted by" lives in the footer.
 * Nothing here depends on global counts or order: positions and heights only. Screenshots go to E2E_SCREENSHOTS when it is set
 * (docs/ux/task-queue-review/fixes/wp-toolbar).
 */
const OUT = process.env['E2E_SCREENSHOTS'];

async function shot(page: Page, name: string): Promise<void> {
  if (!OUT) return;
  fs.mkdirSync(OUT, { recursive: true });
  await page.screenshot({ path: path.join(OUT, `${name}.png`) });
}

const SIZES = [
  [1366, 768],
  [1920, 1080],
  [768, 1024],
  [375, 812],
] as const;

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

async function box(locator: Locator): Promise<Box> {
  const b = await locator.boundingBox();
  if (!b) throw new Error('not visible');
  return b;
}

/**
 * Where row 1 and its parts are: the same in every state of one window. The buttons are right aligned and "Filters (1)" is wider than
 * "Filters", so their right edges and rows are compared, not their left edges.
 */
async function row1(page: Page) {
  const bar = page.locator('[data-grid-toolbar]');
  const edge = async (l: Locator) => {
    const b = await box(l);
    return { right: Math.round(b.x + b.width), y: b.y, height: b.height };
  };
  return {
    bar: await box(bar),
    views: await box(page.getByRole('group', { name: 'Quick views' })),
    filters: await edge(page.locator('[data-filters-toggle]')),
    more: await edge(page.locator('[data-more-filters]')),
    columns: await edge(page.getByRole('button', { name: /^Columns/ })),
  };
}

const viewKey = (userId: number) => `mf.work-view.v1.queue.${userId}`;

test.describe('Task Queue toolbar (WP5)', () => {
  test('#216: row 1 is one line of at most 40 px and does not move in any state', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1366, height: 768 });
    const queue = new TaskQueuePage(page);
    await queue.open();
    await expect(page.locator('[data-toolbar-row2]')).toHaveCount(0);
    const base = await row1(page);
    expect(base.bar.height).toBeLessThanOrEqual(40);
    // The views, then the buttons, left to right on one line.
    expect(base.views.x + base.views.width).toBeLessThan(base.columns.right);
    expect(base.columns.right).toBeLessThan(base.more.right);
    expect(base.more.right).toBeLessThan(base.filters.right);
    for (const part of [base.views, base.columns, base.more, base.filters]) {
      expect(Math.abs(part.y + part.height / 2 - (base.bar.y + base.bar.height / 2))).toBeLessThan(
        base.bar.height / 2,
      );
    }
    await expect(page.locator('[data-sort-note]').first()).toContainText(
      'Sorted by Priority (default order)',
    );
    await expect(page.locator('.mf-pager [data-sort-note]')).toHaveCount(1);
    await expect(page.locator('[data-grid-toolbar] [data-sort-note]')).toHaveCount(0);
    const gridTop = (await box(page.locator('thead').first())).y;
    await shot(page, 'default-1366x768');

    // Sorted: Reset sort appears in row 2, row 1 stays, the header keeps its arrow and aria-sort.
    await page.locator('thead th[data-col="due"] button').click();
    await expect(page.locator('[data-toolbar-row2]')).toBeVisible();
    await expect(page.locator('[data-toolbar-row2] [data-reset-sort]')).toBeVisible();
    await expect(page.locator('.mf-pager [data-sort-note]')).toContainText('Sorted by Due date');
    await expect(page.locator('thead th[data-col="due"]')).toHaveAttribute(
      'aria-sort',
      /ascending|descending/,
    );
    expect(await row1(page)).toEqual(base);
    const row2 = await box(page.locator('[data-toolbar-row2]'));
    expect(row2.y).toBeGreaterThanOrEqual(base.bar.y + base.bar.height);
    await shot(page, 'sorted-due-1366x768');

    // A chip as well: still row 1 in the same place, Clear filters on the left in row 2, Reset sort on the right.
    await page.goto('/tasks?overdue=true&status=NEW&sort=due&dir=asc');
    await expect(page.locator('[data-toolbar-row2] [data-filter-chips]')).toBeVisible();
    await expect(page.locator('[data-toolbar-row2] [data-clear-filters]')).toBeVisible();
    expect(await row1(page)).toEqual(base);
    const clear = await box(page.locator('[data-clear-filters]'));
    const reset = await box(page.locator('[data-reset-sort]'));
    expect(clear.x).toBeLessThan(reset.x);
    await shot(page, 'chip-reset-sort-1366x768');

    // Reset sort removes only itself; with no chip and no sort row 2 is gone and the grid is back where it was.
    await page.locator('[data-reset-sort]').click();
    await page.locator('[data-clear-filters]').click();
    await expect(page.locator('[data-toolbar-row2]')).toHaveCount(0);
    expect(await row1(page)).toEqual(base);
    expect((await box(page.locator('thead').first())).y).toBeCloseTo(gridTop, 0);
  });

  test('#216: the same for a technician, and at 1920', async ({ seed, asUser }) => {
    const tech = await seed.user(['Data Technician'], 'toolbar');
    const page = await asUser(tech.username);
    for (const [w, h] of [
      [1366, 768],
      [1920, 1080],
    ] as const) {
      await page.setViewportSize({ width: w, height: h });
      const queue = new TaskQueuePage(page);
      await queue.open();
      const base = await row1(page);
      expect(base.bar.height, `row 1 at ${w}`).toBeLessThanOrEqual(40);
      await page.locator('thead th[data-col="priority"] button').click();
      await expect(page.locator('[data-reset-sort]')).toBeVisible();
      expect(await row1(page), `row 1 moved at ${w}`).toEqual(base);
      await shot(page, `technician-sorted-${w}x${h}`);
    }
  });

  test('#216: below 1100 px row 1 wraps views first, then the three buttons', async ({ page }) => {
    await page.setViewportSize({ width: 1000, height: 768 });
    const queue = new TaskQueuePage(page);
    await queue.open();
    const p = await row1(page);
    // No overlap and the order of the DOM: views, Columns, More filters, Filters.
    const order = [
      { y: p.views.y, left: p.views.x, right: p.views.x + p.views.width },
      ...[p.columns, p.more, p.filters].map((e) => ({ y: e.y, left: 0, right: e.right })),
    ];
    for (let i = 1; i < order.length; i++) {
      const a = order[i - 1];
      const b = order[i];
      const sameLine = Math.abs(a.y - b.y) < 8;
      expect(sameLine ? a.right <= b.right : a.y < b.y, `part ${i} out of order`).toBe(true);
    }
    await shot(page, 'default-1000x768');
  });

  test('#217: the restored notice takes the place of the chips line and goes with the first action', async ({
    seed,
    asUser,
  }) => {
    const me = await seed.user(['Data Technician'], 'restore');
    const page = await asUser(me.username);
    await page.setViewportSize({ width: 1366, height: 768 });
    const queue = new TaskQueuePage(page);
    await queue.open();
    await queue.quickView('Overdue').click();
    await expect
      .poll(() => page.evaluate((k) => localStorage.getItem(k), viewKey(me.userId)))
      .toContain('overdue');
    const chipsTop = (await box(page.locator('thead').first())).y;
    const base = await row1(page);

    await page.goto('/my-work');
    await page.getByRole('link', { name: 'Task Queue', exact: true }).first().click();
    const notice = page.locator('[data-toolbar-row2] [data-restored-notice]');
    await expect(notice).toHaveText(/Restored your last view: Overdue\./);
    await expect(page.locator('[data-restored-notice] [data-dismiss-notice]')).toHaveAccessibleName(
      'Dismiss',
    );
    // Row 2 is reserved by the notice: the grid starts where it does with chips in row 2 (or, within one row of text, the same).
    expect(await row1(page)).toEqual(base);
    const noticeTop = (await box(page.locator('thead').first())).y;
    expect(Math.abs(noticeTop - chipsTop)).toBeLessThanOrEqual(2);
    await shot(page, 'restored-notice-1366x768');
    if (axeAvailable()) expect(await axeViolations(page), 'notice').toEqual([]);

    // The first action (a sort) removes it; the grid moves at most once, by the height of row 2 at most.
    await page.locator('thead th[data-col="due"] button').click();
    await expect(page.locator('[data-restored-notice]')).toHaveCount(0);
    expect(await row1(page)).toEqual(base);

    // The x button works too, and does not forget the view: the next plain visit restores it again.
    await page.goto('/my-work');
    await page.getByRole('link', { name: 'Task Queue', exact: true }).first().click();
    await expect(page.locator('[data-restored-notice]')).toBeVisible();
    await page.getByRole('button', { name: 'Dismiss', exact: true }).click();
    await expect(page.locator('[data-restored-notice]')).toHaveCount(0);
    await expect(page.locator('[data-toolbar-row2]')).toHaveCount(0);
  });

  test('#217: My Work shares the notice and its behavior', async ({ seed, asUser }) => {
    const me = await seed.user(['Data Technician'], 'restorem');
    const page = await asUser(me.username);
    await page.setViewportSize({ width: 1366, height: 768 });
    const myWork = new MyWorkPage(page);
    await myWork.open('?view=dueSoon&priority=1&priority=2');
    await expect
      .poll(() =>
        page.evaluate((k) => localStorage.getItem(k), `mf.work-view.v1.my-work.${me.userId}`),
      )
      .toContain('dueSoon');
    await page.goto('/pods/work');
    await page.getByRole('link', { name: 'My Work', exact: true }).first().click();
    const notice = page.locator('[data-toolbar-row2] [data-restored-notice]');
    await expect(notice).toContainText('Restored your last view: Due soon and overdue');
    await shot(page, 'my-work-restored-notice-1366x768');
    // Switching tab is an action: the notice goes.
    await myWork.tab(/Active/).click();
    await expect(page.locator('[data-restored-notice]')).toHaveCount(0);
    // My Work keeps its own sorted-by note in the toolbar.
    await expect(page.locator('[data-grid-toolbar] [data-sort-note]')).toBeVisible();
  });

  test('axe: the toolbar in its states has no violations at four sizes', async ({ page }) => {
    test.skip(!axeAvailable(), 'axe-core not available');
    for (const [w, h] of SIZES) {
      await page.setViewportSize({ width: w, height: h });
      const queue = new TaskQueuePage(page);
      await queue.open();
      expect(await axeViolations(page), `default at ${w}`).toEqual([]);
      await shot(page, `default-${w}x${h}`);
      await page.goto('/tasks?overdue=true&status=NEW&sort=due&dir=asc');
      await expect(page.locator('[data-reset-sort]')).toBeVisible();
      expect(await axeViolations(page), `chip and sort at ${w}`).toEqual([]);
      await shot(page, `chip-sort-${w}x${h}`);
      // The info popover opens above the footer (the footer shows while the list has rows: the plain open list does).
      await queue.open();
      await page.getByRole('button', { name: 'How the default order works' }).click();
      await expect(page.locator('[data-sort-rule]')).toBeVisible();
      expect(await axeViolations(page), `info at ${w}`).toEqual([]);
      await shot(page, `info-${w}x${h}`);
    }
  });
});
