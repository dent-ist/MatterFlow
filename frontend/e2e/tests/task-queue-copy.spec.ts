import fs from 'node:fs';
import path from 'node:path';
import { Page } from '@playwright/test';
import { TaskQueuePage } from '../pages/queues.pages';
import { axeAvailable, axeViolations } from '../support/axe';
import { expect, test } from '../support/fixtures';
import { ViewKey, chooseView, viewAvailable } from '../support/views';

/**
 * Task Queue copy (WP4: #225, #226, #227): chips and the restored notice never repeat themselves, an empty quick view says what is true
 * instead of "No tasks match these filters", and the title, caption and live region name the view with one message per change. Empty
 * answers are stubbed (the shared database is never empty), so nothing depends on global counts. Screenshots go to E2E_SCREENSHOTS when it
 * is set (docs/ux/task-queue-review/fixes/wp4).
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

/** Answers every Task Queue request with no rows (the rest of the answer is the real one). */
async function stubEmpty(page: Page): Promise<void> {
  await page.route('**/api/v1/task-queue**', async (route) => {
    const response = await route.fetch();
    const body = await response.json();
    await route.fulfill({
      response,
      json: { ...body, items: [], total: 0, page: 1 },
    });
  });
}

test.describe('Task Queue copy', () => {
  test('#225: the chip drops a label that repeats its value; the restored notice names the view', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1366, height: 768 });
    const queue = new TaskQueuePage(page);
    await queue.open();
    await queue.quickView('Overdue').click();
    // The pressed view owns its filter: no chip repeats it (WP16, #221).
    await expect(page.locator('[data-filter-chips] [data-chip]')).toHaveCount(0);
    // The same filter without the view (one status only) reads "Overdue only", never "Overdue: Overdue only".
    await page.goto('/tasks?overdue=true&status=NEW');
    const chips = page.locator('[data-filter-chips] [data-chip]');
    await expect(chips).toContainText(['Overdue only']);
    await expect(page.locator('[data-filter-chips]')).not.toContainText('Overdue: Overdue only');
    await queue.open();
    await queue.quickView('Overdue').click();
    // The view is remembered once its list has loaded.
    await expect(page).toHaveURL(/overdue=true/);
    await expect(page.locator('[data-view="overdue"]')).toHaveAttribute('aria-pressed', 'true');
    await page.waitForLoadState('networkidle');

    // Leave and come back to the plain list: the last view comes back, named once.
    await page.goto('/my-work');
    await page.getByRole('link', { name: 'Task Queue', exact: true }).first().click();
    const notice = page.locator('[data-restored-text]');
    await expect(notice).toHaveText(/^\s*Restored your last view: Overdue\.\s*$/);
    await shot(page, 'restored-notice-overdue-1366x768');

    // The drill-through chips (Dashboard Due soon) read in plain words too.
    await page.goto('/tasks?asap=false&overdue=false&status=NEW');
    const chipsList = page.locator('[data-filter-chips]');
    await expect(chipsList).toContainText('Has a due date');
    await expect(chipsList).toContainText('Not overdue');
    await expect(chipsList).not.toContainText('ASAP:');
    await expect(chipsList).not.toContainText('Overdue:');
  });

  test('#226: an empty view is good news without a dead-end Clear filters; other filters keep it', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1366, height: 768 });
    await stubEmpty(page);
    const queue = new TaskQueuePage(page);
    await queue.open();
    const empty = page.locator('td[data-empty], div[data-empty]');
    const cases: [ViewKey, string][] = [
      ['unassigned', 'Every open task has an owner.'],
      ['overdue', 'Nothing is overdue.'],
      ['dueSoon', 'Nothing is due in the next 2 days.'],
      ['asap', 'No ASAP tasks.'],
      ['onHold', 'Nothing is on hold.'],
      ['myPod', 'Your pod has no open tasks.'],
      ['createdByMe', 'You have no open tasks you created.'],
      ['recentlyCompleted', 'Nothing was completed in the last 30 days.'],
    ];
    for (const [view, text] of cases) {
      if (!(await viewAvailable(page, view))) continue; // My pod needs a primary Pod
      await chooseView(page, view);
      await expect(empty, view).toContainText(text);
      await expect(empty, view).not.toContainText('Clear filters');
      await expect(page.locator('thead th').first()).toBeVisible();
      if (view === 'overdue') await shot(page, 'empty-overdue-1366x768');
    }

    // Created by me offers Create task (Task.Create is held).
    await chooseView(page, 'createdByMe');
    await expect(empty.getByRole('button', { name: 'Create task' })).toBeVisible();

    // A view plus another filter is a search that found nothing.
    await page.goto('/tasks?overdue=true&q=zzz&status=NEW&status=IN_PROGRESS&status=ON_HOLD');
    await expect(empty).toContainText('No tasks match these filters');
    await expect(empty.getByRole('button', { name: 'Clear filters' })).toBeVisible();
    await shot(page, 'empty-no-match-1366x768');

    // Nothing at all.
    await page.goto('/tasks?sort=due');
    await expect(empty).toContainText('No tasks yet.');
    await expect(empty.getByRole('button', { name: 'Create task' })).toBeVisible();
  });

  test('#227: title, caption and one live message name the view', async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 768 });
    const queue = new TaskQueuePage(page);
    await queue.open();
    await expect(page).toHaveTitle('Task Queue - MatterFlow');
    await expect(page.locator('table caption')).toHaveText('Task Queue');

    await queue.quickView('Overdue').click();
    await expect(page).toHaveTitle('Task Queue: Overdue - MatterFlow');
    await expect(page.locator('table caption')).toHaveText('Task Queue: Overdue');
    const live = page.locator('.wl-sr');
    await expect(live).toHaveText(
      /^Overdue: (No tasks|1 task|\d+ tasks, (page 1 of \d+, )?showing 1 to \d+)$/,
    );
    // The filter bar's own region says nothing about the results: one message per change.
    await expect(page.locator('[data-filter-live]')).toHaveText('');
    const nonEmpty = await page
      .locator('[role="status"]')
      .evaluateAll((els) => els.filter((e) => (e.textContent ?? '').trim() !== '').length);
    expect(nonEmpty).toBe(1);

    // A hand-made filter: no view in the name.
    await page.goto('/tasks?q=zzz');
    await expect(page).toHaveTitle('Task Queue - MatterFlow');
    await expect(live).toHaveText(
      /^(No tasks|1 task|\d+ tasks, (page 1 of \d+, )?showing 1 to \d+)$/,
    );
  });

  test('axe: the empty states and the named view have no violations at four sizes', async ({
    page,
  }) => {
    test.skip(!axeAvailable(), 'axe-core not available');
    await stubEmpty(page);
    const queue = new TaskQueuePage(page);
    for (const [w, h] of SIZES) {
      await page.setViewportSize({ width: w, height: h });
      await queue.open('?overdue=true&status=NEW&status=IN_PROGRESS&status=ON_HOLD');
      await expect(page.locator('td[data-empty], div[data-empty]')).toContainText(
        'Nothing is overdue.',
      );
      expect(await axeViolations(page), `overdue empty at ${w}`).toEqual([]);
      await queue.open('?overdue=true&q=zzz');
      await expect(page.locator('td[data-empty], div[data-empty]')).toContainText('No tasks match');
      expect(await axeViolations(page), `no match at ${w}`).toEqual([]);
      if (w === 375) await shot(page, 'empty-overdue-375x812');
    }
  });
});
