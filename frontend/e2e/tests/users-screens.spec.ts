import fs from 'node:fs';
import path from 'node:path';
import { Page } from '@playwright/test';
import { expect, test } from '../support/fixtures';
import { seedCoverage, seedWorkload } from '../support/workload';

/**
 * Screenshot run for docs/ux/dashboard-users (not a test: skipped unless E2E_SCREENSHOTS is set to the output folder):
 *   E2E_SCREENSHOTS=docs/ux/dashboard-users frontend/e2e/run-local.sh -g "users screenshots"
 * Seeds twelve people with mixed loads (an idle one, an out of office one with tasks, one out of office and idle, one off hours) and a small
 * coverage history, then takes the Workload and Coverage views in their main states at 1366x768, 1024x768 and 375x812.
 */
const OUT = process.env['E2E_SCREENSHOTS'];

async function ready(page: Page): Promise<void> {
  await expect(page.locator('[data-user-card]').first()).toBeVisible();
  await expect(page.locator('[data-users-loading]')).toHaveCount(0);
}

test.describe('users screenshots', () => {
  test.skip(!OUT, 'set E2E_SCREENSHOTS to the output folder');

  test('capture', async ({ page, admin, seed }) => {
    test.setTimeout(900_000);
    fs.mkdirSync(OUT!, { recursive: true });
    const wl = await seedWorkload(admin, seed);
    const cov = await seedCoverage(admin, seed);
    const shot = async (name: string) => {
      await page.waitForTimeout(300);
      await page.screenshot({ path: path.join(OUT!, `${name}.png`) });
    };
    const base = `/dashboard?tab=users&uq=${wl.tag}`;

    for (const [w, h] of [
      [1366, 768],
      [1024, 768],
      [375, 812],
    ]) {
      await page.setViewportSize({ width: w, height: h });
      await page.goto(base);
      await ready(page);
      await shot(`01-cards-${w}`);
      await page.goto(`${base}&upod=${wl.podB.podId}`);
      await ready(page);
      await shot(`02-pod-filter-${w}`);
      await page.goto(`/dashboard?tab=users&view=coverage&uq=zcov${cov.tag}`);
      await expect(page.locator('[data-coverage-table]')).toBeVisible();
      await shot(`07-coverage-${w}`);
    }

    await page.setViewportSize({ width: 1366, height: 768 });
    await page.goto(base);
    await ready(page);
    await page.getByLabel('Density', { exact: true }).selectOption('compact');
    await shot('03-compact-1366');
    await page.getByLabel('Density', { exact: true }).selectOption('comfortable');
    await page.getByRole('button', { name: 'Table' }).click();
    await expect(page.locator('[data-users-table]')).toBeVisible();
    await shot('04-table-1366');
    await page.getByRole('button', { name: 'Cards' }).click();
    await page.getByRole('button', { name: 'Legend and help' }).click();
    await shot('05-legend-1366');
    await page.getByRole('button', { name: 'Legend and help' }).click();

    await page
      .locator(
        `[data-user="${wl.people['heavy'].displayName.replace(/\\/g, '\\\\')}"] [data-user-open]`,
      )
      .click();
    await expect(page.locator('[data-drawer-tasks] li').first()).toBeVisible();
    await shot('06-drawer-1366');
    await page.locator('[data-drawer-assign]').click();
    await expect(page.locator('[data-assign-row]').first()).toBeVisible();
    await shot('06b-assign-heavy-hint-1366');
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');

    await page.goto(`/dashboard?tab=users&view=coverage&uq=zcov${cov.tag}`);
    await expect(page.locator('[data-coverage-table]')).toBeVisible();
    await page.getByLabel('Colour scale').selectOption('absolute');
    await shot('08-coverage-absolute-1366');
    await page.getByRole('button', { name: 'Training gaps' }).click();
    await shot('09-coverage-gaps-1366');
    await page.getByRole('button', { name: 'Training gaps' }).click();
    await page.locator(`[data-cell="${cov.people.a.userId}:${cov.typeIds.production}"]`).click();
    await expect(page.locator('[data-coverage-tasks] li').first()).toBeVisible();
    await shot('10-coverage-drawer-1366');
    await page.keyboard.press('Escape');

    await page.route('**/api/v1/dashboard/workload**', (route) => route.abort());
    await page.goto(base);
    await expect(page.locator('[data-users-error]')).toBeVisible();
    await shot('11-error-1366');
  });
});
