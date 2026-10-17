import fs from 'node:fs';
import path from 'node:path';
import { Page } from '@playwright/test';
import { expect, test } from '../support/fixtures';
import { seedBoard } from '../support/board';

/**
 * Screenshot run for docs/ux/dashboard-swimlane (not a test: skipped unless E2E_SCREENSHOTS is set to the output folder):
 *   E2E_SCREENSHOTS=docs/ux/dashboard-swimlane frontend/e2e/run-local.sh -g "swimlane screenshots"
 * Seeds 160 tasks across clients, matters, priorities, statuses and assignees, then takes the board in its main states at
 * 1366x768, 1024x768 and 375x812.
 */
const OUT = process.env['E2E_SCREENSHOTS'];

const lane = (page: Page, code: string) => page.locator(`[data-lane="${code}"]`);

async function ready(page: Page): Promise<void> {
  await expect(page.locator('[data-lane="NEW"] mf-swimlane-card').first()).toBeVisible();
  await expect(page.locator('[data-board][aria-busy="true"]')).toHaveCount(0);
}

test.describe('swimlane screenshots', () => {
  test.skip(!OUT, 'set E2E_SCREENSHOTS to the output folder');

  test('capture', async ({ page, admin, seed }) => {
    test.setTimeout(900_000);
    fs.mkdirSync(OUT!, { recursive: true });
    const board = await seedBoard(admin, seed);
    const shot = async (name: string) => {
      await page.waitForTimeout(250);
      await page.screenshot({ path: path.join(OUT!, `${name}.png`) });
    };
    const base = `/dashboard?tab=swimlane&q=${board.tag}`;

    for (const [w, h] of [
      [1366, 768],
      [1024, 768],
      [375, 812],
    ]) {
      await page.setViewportSize({ width: w, height: h });
      await page.goto(`${base}&group=none&sort=priority`);
      await ready(page);
      await shot(`01-board-${w}`);
      await page.goto(`${base}&group=priority`);
      await ready(page);
      await shot(`02-group-priority-${w}`);
      await page.goto(`${base}&group=assignee`);
      await ready(page);
      await shot(`03-group-assignee-${w}`);
      await page.goto(`${base}&group=clientMatter&sort=clientMatter`);
      await ready(page);
      await shot(`04-client-matter-tree-${w}`);
    }

    await page.setViewportSize({ width: 1366, height: 768 });
    await page.goto(`${base}&group=none`);
    await ready(page);
    await page.getByRole('button', { name: 'More options' }).click();
    await page.getByRole('menuitemradio', { name: 'Compact' }).click();
    await shot('05-compact-1366');
    await page.getByRole('button', { name: 'More options' }).click();
    await page.getByRole('menuitemradio', { name: 'Comfortable' }).click();

    await page.getByRole('button', { name: /^Filters/ }).click();
    await shot('06-filters-1366');
    await page.getByRole('button', { name: /^Filters/ }).click();

    await page.locator('[data-lane="NEW"] [data-inline-trigger]').first().click();
    await shot('07-inline-menu-1366');
    await page.keyboard.press('Escape');

    await page.locator('[data-lane="IN_PROGRESS"] [data-card-open]').first().click();
    await expect(page.locator('[data-peek]')).toBeVisible();
    await expect(page.locator('[data-peek-steps]')).toBeVisible();
    await shot('08-drawer-1366');
    await page.keyboard.press('Escape');

    // Loading skeletons, the capped-lane note and the error state, with the same data.
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    await page.route('**/api/v1/dashboard/swimlane**', async (route) => {
      await gate;
      await route.continue();
    });
    await page.goto(`${base}&group=none`);
    await expect(page.locator('[data-board][aria-busy="true"]')).toBeVisible();
    await shot('09-loading-1366');
    release();
    await ready(page);
    await page.unroute('**/api/v1/dashboard/swimlane**');

    await page.route('**/api/v1/dashboard/swimlane**', async (route) => {
      const response = await route.fetch();
      const body = await response.json();
      body.lanes[0].count = 230;
      body.lanes[0].total = 230;
      body.lanes[0].truncated = true;
      await route.fulfill({ response, json: body });
    });
    await page.goto(`${base}&group=none`);
    await ready(page);
    await lane(page, 'NEW')
      .locator('[data-lane-body]')
      .evaluate((el) => (el.scrollTop = el.scrollHeight));
    await page.locator('[data-truncated]').scrollIntoViewIfNeeded();
    await expect(page.locator('[data-truncated]')).toBeVisible();
    await shot('10-capped-lane-1366');
    await page.unroute('**/api/v1/dashboard/swimlane**');

    await page.route('**/api/v1/dashboard/swimlane**', (route) =>
      route.fulfill({ status: 500, json: { code: 'INTERNAL_ERROR', traceId: 'trace-0001' } }),
    );
    await page.goto(`${base}&group=none`);
    await expect(page.locator('[data-dash-state="error"]')).toBeVisible();
    await shot('11-error-1366');
    await page.unroute('**/api/v1/dashboard/swimlane**');

    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto(`${base}&group=none`);
    await ready(page);
    await page.locator('[data-lane="NEW"] [data-card-open]').first().click();
    await expect(page.locator('[data-peek]')).toBeVisible();
    await shot('12-drawer-375');
  });
});
