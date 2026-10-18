import fs from 'node:fs';
import path from 'node:path';
import { Page } from '@playwright/test';
import { TaskQueuePage } from '../pages/queues.pages';
import { axeAvailable, axeViolations } from '../support/axe';
import { expect, test } from '../support/fixtures';
import { uid } from '../support/seed';
import { TaskApi } from '../support/tasks';
import { dateInZone, FIRM_ZONE } from '../support/time';
import { chooseView, inStrip, isPressed, moreButton } from '../support/views';

/**
 * Quick views with counts, order and column overlay (WP11: #218, #219). Nothing here depends on global counts or order: counts are
 * compared with the same response's `views` block and `total`, and rows with the task numbers of this test's own tagged tasks.
 * Screenshots go to E2E_SCREENSHOTS when it is set (docs/ux/task-queue-review/fixes/wp-views).
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

type Key =
  | 'allOpen'
  | 'unassigned'
  | 'myPod'
  | 'createdByMe'
  | 'overdue'
  | 'dueSoon'
  | 'asap'
  | 'onHold'
  | 'recentlyCompleted';
const FIELD: Record<Key, string> = {
  allOpen: 'open',
  unassigned: 'unassigned',
  myPod: 'myPod',
  createdByMe: 'createdByMe',
  overdue: 'overdue',
  dueSoon: 'dueSoon',
  asap: 'asap',
  onHold: 'onHold',
  recentlyCompleted: 'recentlyCompleted',
};
const LABEL: Record<Key, string> = {
  allOpen: 'All open',
  unassigned: 'Unassigned',
  myPod: 'My pod',
  createdByMe: 'Created by me',
  overdue: 'Overdue',
  dueSoon: 'Due soon',
  asap: 'ASAP',
  onHold: 'On hold',
  recentlyCompleted: 'Recently completed',
};

const view = (page: Page, key: Key) => page.locator(`[data-view="${key}"]`);

/** The number a button shows, without the parentheses and commas. */
async function shown(page: Page, key: Key, button = view(page, key)): Promise<number> {
  const text = (await button.locator('.qv-n').textContent()) ?? '';
  return Number(text.replace(/[(),]/g, ''));
}

const isQueue = (url: string) => /\/api\/v1\/task-queue\?/.test(url);

async function rowNumbers(page: Page): Promise<string[]> {
  return page
    .locator('[data-task]')
    .evaluateAll((rows) => rows.map((r) => r.getAttribute('data-task') ?? ''));
}

test.describe('Quick view counts and order (WP11)', () => {
  test('#218: each button shows the count of its view, equal to the grid total, with an accessible name', async ({
    page,
  }) => {
    const queue = new TaskQueuePage(page);
    await page.setViewportSize({ width: 1366, height: 768 });
    await queue.open();
    for (const key of [
      'allOpen',
      'unassigned',
      'createdByMe',
      'overdue',
      'dueSoon',
      'asap',
      'onHold',
      'recentlyCompleted',
    ] as Key[]) {
      // A view that does not fit row 1 sits in the More menu (always Recently completed): it shows its count once chosen.
      const inRow = await inStrip(page, key);
      if (inRow) {
        await expect(view(page, key).locator('.qv-n:not([data-count-pending])')).toBeVisible();
      }
      const [response] = await Promise.all([
        page.waitForResponse((r) => isQueue(r.url()) && r.status() === 200),
        key === 'allOpen' && (await view(page, key).getAttribute('aria-pressed')) === 'true'
          ? page.reload()
          : chooseView(page, key),
      ]);
      const body = (await response.json()) as { total: number; views: Record<string, number> };
      const count = body.views[FIELD[key]];
      // The button's number is the view's count and the grid's total of the same query, in one response. The API reads the total and
      // the counts in two statements, and the other workers create and close tasks all the time, so a task may land in between: a
      // difference is only a failure when it persists on the same request asked again (the database is quiet for a moment).
      if (count !== body.total) {
        const request = response.request();
        const zone = (await request.allHeaders())['x-time-zone'];
        await expect
          .poll(
            async () => {
              const again = await page.request.get(request.url(), {
                headers: zone ? { 'X-Time-Zone': zone } : {},
              });
              const next = (await again.json()) as { total: number; views: Record<string, number> };
              return next.views[FIELD[key]] - next.total;
            },
            { message: `${key} total`, intervals: [100, 250, 500, 1000], timeout: 10_000 },
          )
          .toBe(0);
      }
      const pressedButton = (await inStrip(page, key)) ? view(page, key) : moreButton(page);
      await expect(pressedButton).toHaveAttribute('data-count', String(count));
      expect(await shown(page, key, pressedButton)).toBe(count);
      await expect(pressedButton).toHaveAccessibleName(
        `${LABEL[key]}, ${count.toLocaleString('en-US')} ${count === 1 ? 'task' : 'tasks'}`,
      );
    }
  });

  test('#218: counts are not narrowed by filters and show tagged data', async ({ page, seed }) => {
    const queue = new TaskQueuePage(page);
    await queue.open();
    await expect(view(page, 'overdue').locator('.qv-n:not([data-count-pending])')).toBeVisible();
    const before = await shown(page, 'overdue');
    const unassignedBefore = await shown(page, 'unassigned');

    const world = await seed.world();
    const token = uid();
    await seed.task(world, {
      title: `VC late ${token}`,
      dueDate: dateInZone(FIRM_ZONE, -3),
    });
    await queue.open(`?status=NEW&q=${token}`);
    await expect(page.locator('[data-task]')).toHaveCount(1);
    // A text filter that matches one task: the counts are those of the whole queue, including the new task.
    await expect(async () => {
      expect(await shown(page, 'overdue')).toBeGreaterThanOrEqual(before + 1);
      expect(await shown(page, 'unassigned')).toBeGreaterThanOrEqual(unassignedBefore + 1);
    }).toPass();
    const allOpen = await shown(page, 'allOpen');
    expect(allOpen).toBeGreaterThan(1);
  });

  test('#218: a button keeps its place while the counts load', async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 768 });
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    await page.route(/\/api\/v1\/task-queue\?/, async (route) => {
      const response = await route.fetch();
      await gate;
      await route.fulfill({ response });
    });
    const queue = new TaskQueuePage(page);
    await page.goto('/tasks');
    await expect(view(page, 'overdue').locator('[data-count-pending]')).toBeVisible();
    await expect(view(page, 'overdue')).toHaveAccessibleName('Overdue');
    const keys: Key[] = ['allOpen', 'unassigned', 'overdue'];
    const boxes = async () =>
      Promise.all(keys.map(async (k) => (await view(page, k).boundingBox())!));
    const loading = await boxes();
    await shot(page, 'quick-views-loading-1366x768');
    release();
    await expect(view(page, 'overdue').locator('.qv-n:not([data-count-pending])')).toBeVisible();
    const loaded = await boxes();
    keys.forEach((k, i) => {
      expect(loaded[i].x, `${k} x`).toBeCloseTo(loading[i].x, 0);
      expect(loaded[i].width, `${k} width`).toBeCloseTo(loading[i].width, 0);
    });
    void queue;
  });

  test('#219: Recently completed lists the newest Closed first and swaps Due for Closed without changing the saved columns', async ({
    page,
    seed,
    admin,
  }) => {
    const world = await seed.world();
    const token = uid();
    const closed: string[] = [];
    for (const name of ['A', 'B']) {
      const task = await seed.task(world, { title: `VC done ${name} ${token}` });
      const api = new TaskApi(admin, task.taskId);
      await api.completeSteps(1, 2, 3);
      expect((await api.complete()).status).toBeLessThan(300);
      closed.push(task.taskNumber as string);
    }
    const queue = new TaskQueuePage(page);
    await queue.open();
    const storedBefore = await page.evaluate(() =>
      Object.entries(localStorage).filter(([k]) => /column/i.test(k)),
    );
    await expect(page.locator('thead th[data-col="due"]')).toHaveCount(1);
    await chooseView(page, 'recentlyCompleted');
    await expect(page).toHaveURL(/sort=closed&dir=desc/);
    await expect(page.locator('thead th[data-col="closed"]')).toHaveAttribute(
      'aria-sort',
      'descending',
    );
    await expect(page.locator('thead th[data-col="due"]')).toHaveCount(0);
    await expect(page.locator('mf-sort-note, [data-sort-note]').first()).toContainText(
      'Sorted by Closed',
    );
    const rows = await rowNumbers(page);
    expect(rows).toContain(closed[0]);
    expect(rows.indexOf(closed[1]), 'B closed after A, so first').toBeLessThan(
      rows.indexOf(closed[0]),
    );
    await shot(page, 'recently-completed-1366x768');

    // The panel says so; the saved set is not touched.
    await page.getByRole('button', { name: /^Columns/ }).click();
    await expect(page.locator('[data-columns-view-note]')).toContainText('Modified by this view');
    await page.keyboard.press('Escape');
    expect(
      await page.evaluate(() => Object.entries(localStorage).filter(([k]) => /column/i.test(k))),
    ).toEqual(storedBefore);

    // Header click: still pressed (filters match), still no Due.
    await page.locator('thead th[data-col="priority"] button').click();
    expect(await isPressed(page, 'recentlyCompleted')).toBe(true);
    await expect(page.locator('thead th[data-col="closed"]')).toHaveCount(1);

    await view(page, 'allOpen').click();
    await expect(page.locator('thead th[data-col="due"]')).toHaveCount(1);
    await expect(page.locator('thead th[data-col="closed"]')).toHaveCount(0);
    await expect(page).not.toHaveURL(/sort=/);
    expect(
      await page.evaluate(() => Object.entries(localStorage).filter(([k]) => /column/i.test(k))),
    ).toEqual(storedBefore);
  });

  test('#219: Overdue from the quick view and from the Dashboard link, and Unassigned, use the same order', async ({
    page,
    seed,
  }) => {
    const world = await seed.world();
    await seed.task(world, { title: `VC overdue ${uid()}`, dueDate: dateInZone(FIRM_ZONE, -3) });
    await page.goto('/dashboard');
    await page
      .locator('[data-panel="overdue"]')
      .getByRole('link', { name: /View all overdue tasks/ })
      .click();
    await expect(page).toHaveURL(/sort=priority&dir=asc/);
    await expect(page.locator('[data-task]').first()).toBeVisible();
    const fromDashboard = await rowNumbers(page);

    const queue = new TaskQueuePage(page);
    await queue.open();
    await view(page, 'overdue').click();
    await expect(page).toHaveURL(/sort=priority&dir=asc/);
    await expect(page.locator('[data-task]').first()).toBeVisible();
    const fromView = await rowNumbers(page);
    expect(fromView.length).toBeGreaterThan(0);
    expect(fromView).toEqual(fromDashboard);

    await view(page, 'unassigned').click();
    await expect(page).toHaveURL(/sort=priorityAge&dir=asc/);
    await expect(page.locator('[data-sort-note]').first()).toContainText(
      'Sorted by Priority, then age',
    );
  });

  for (const [w, h] of SIZES) {
    test(`axe: the quick views with counts have no violations at ${w}x${h}`, async ({ page }) => {
      test.skip(!axeAvailable(), 'axe-core not available');
      await page.setViewportSize({ width: w, height: h });
      const queue = new TaskQueuePage(page);
      await queue.open();
      // Narrow windows keep fewer views in the row (the rest are in More): wait for the first count.
      await expect(page.locator('.qv .qv-n:not([data-count-pending])').first()).toBeVisible();
      if (w >= 1100) {
        const bar = (await page.locator('[data-grid-toolbar]').boundingBox())!;
        expect(bar.height, `row 1 at ${w}`).toBeLessThanOrEqual(40);
      }
      expect(await axeViolations(page), `default at ${w}`).toEqual([]);
      await shot(page, `quick-views-counts-${w}x${h}`);
      await chooseView(page, 'recentlyCompleted');
      await expect(page).toHaveURL(/sort=closed/);
      expect(await isPressed(page, 'recentlyCompleted')).toBe(true);
      if (w >= 1100) {
        const bar = (await page.locator('[data-grid-toolbar]').boundingBox())!;
        expect(bar.height, `row 1 pressed at ${w}`).toBeLessThanOrEqual(40);
      }
      expect(await axeViolations(page), `Recently completed at ${w}`).toEqual([]);
      await shot(page, `quick-views-recently-completed-${w}x${h}`);
    });
  }
});
