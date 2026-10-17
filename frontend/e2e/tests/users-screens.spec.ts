import fs from 'node:fs';
import path from 'node:path';
import { Page } from '@playwright/test';
import { expect, test } from '../support/fixtures';
import { crowdPlan, seedCoverage, seedWorkload } from '../support/workload';

/**
 * Screenshot run for docs/ux/dashboard-users (not a test: skipped unless E2E_SCREENSHOTS is set to the output folder):
 *   E2E_SCREENSHOTS=docs/ux/dashboard-users frontend/e2e/run-local.sh -g "users screenshots"
 * Seeds a department of 120 people with the mix of a real firm (about a fifth idle, most light or normal, a few heavy, some out of office or
 * off hours, in two pods) and a small coverage history, then takes the Workload and Coverage views in their main states at 1366x768, 1024x768
 * and 375x812. The accounts of the throwaway database have machine names, so the screenshot run replaces the display names in the workload
 * response with ordinary sample names (nothing else is changed).
 */
const OUT = process.env['E2E_SCREENSHOTS'];

const FIRST =
  'Ana Ben Cai Dev Eli Fay Gus Hal Ida Jon Kay Leo Mia Ned Ola Pat Quin Rae Sam Tia Uma Vic Wes Xia Yan Zoe Amir Bea Carl Dina Evan Faye Gil Hana Ivo Jade Kofi Lena Milo Nia'.split(
    ' ',
  );
const LAST =
  'Adams Baker Chen Diaz Evans Farah Gupta Hayes Ito Jones Khan Lopez Moore Nguyen Okafor Patel Quinn Rossi Singh Tanaka Usman Vega Walsh Xu Young Zhang Abbott Brandt Cole Dunn Ellis Frost Grant Holt Iyer Joshi Kerr Lowe Mills Nash'.split(
    ' ',
  );

/** Sample names instead of the account names of the throwaway database (screenshots only). */
async function sampleNames(page: Page): Promise<void> {
  await page.route('**/api/v1/dashboard/workload**', async (route) => {
    const response = await route.fetch();
    const body = await response.json();
    const ids = body.users
      .map((u: { userId: number }) => u.userId)
      .sort((a: number, b: number) => a - b);
    for (const u of body.users) {
      const i = ids.indexOf(u.userId);
      const first = FIRST[i % FIRST.length];
      const last = LAST[(i * 7 + 3 + Math.floor(i / FIRST.length) * 11) % LAST.length];
      u.displayName = `${first} ${last}`;
      u.initials = `${first[0]}${last[0]}`;
    }
    await route.fulfill({ response, json: body });
  });
}

async function ready(page: Page): Promise<void> {
  await expect(page.locator('[data-user-card]').first()).toBeVisible();
  await expect(page.locator('[data-users-loading]')).toHaveCount(0);
}

test.describe('users screenshots', () => {
  test.skip(!OUT, 'set E2E_SCREENSHOTS to the output folder');

  test('capture', async ({ page, admin, seed }) => {
    test.setTimeout(900_000);
    fs.mkdirSync(OUT!, { recursive: true });
    const wl = await seedWorkload(admin, seed, { plan: crowdPlan(120), width: 6 });
    const cov = await seedCoverage(admin, seed);
    const shot = async (name: string) => {
      await page.waitForTimeout(300);
      await page.screenshot({ path: path.join(OUT!, `${name}.png`) });
    };
    await sampleNames(page);
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
      await page.goto(`${base}&pod=${wl.podB.podId}`);
      await ready(page);
      await shot(`02-pod-filter-${w}`);
      await page.goto(`/dashboard?tab=users&view=coverage&cov=matrix&uq=zcov${cov.tag}`);
      await expect(page.locator('[data-coverage-table]')).toBeVisible();
      await page.locator(`[data-type-name="${cov.typeNames.production}"]`).scrollIntoViewIfNeeded();
      await shot(`07-coverage-${w}`);
      // The tab remembers the last view (Coverage, after the address above): the next width starts on the Workload again.
      await page.evaluate(() => window.localStorage.clear());
    }

    await page.setViewportSize({ width: 1366, height: 768 });
    await page.goto(base);
    await ready(page);
    const metrics = async (label: string) => {
      const m = await page.evaluate(() => {
        const items = Array.from(document.querySelectorAll('[data-users-grid] > li')).map((e) =>
          e.getBoundingClientRect(),
        );
        const grid = document.querySelector('[data-users-grid]')!.getBoundingClientRect();
        const top = items[0].top;
        return {
          tiles: items.length,
          width: Math.round(items[0].width),
          height: Math.round(items[0].height),
          perLine: items.filter((r) => Math.abs(r.top - top) < 2).length,
          gridHeight: Math.round(grid.height),
        };
      });
      console.log(`TILE-METRICS ${label} ${JSON.stringify(m)}`);
    };
    await metrics('standard');
    await page.locator('[data-density="compact"]').click();
    await metrics('dense');
    await shot('03-dense-1366');
    await page.locator('[data-density="comfortable"]').click();
    await page.locator('[data-chip="idle"]').click();
    await page.locator('[data-chip="heavy"]').click();
    await shot('12-filter-chips-1366');
    await page.locator('[data-chip="idle"]').click();
    await page.locator('[data-chip="heavy"]').click();
    await page.locator('[data-chip="out"]').click();
    await shot('13-out-of-office-1366');
    await page.locator('[data-chip="out"]').click();

    // A close-up of the tile anatomy: sorted by highest priority, the page zoomed to 200%.
    await page.getByLabel('Sort', { exact: true }).selectOption('priority');
    await page.evaluate(() => {
      const grid = document.querySelector<HTMLElement>('[data-users-grid]')!;
      grid.style.scrollMarginTop = '120px';
      grid.scrollIntoView({ block: 'start' });
      grid.style.transformOrigin = '0 0';
      grid.style.transform = 'scale(2)';
    });
    await page.waitForTimeout(300);
    const gridBox = (await page.locator('[data-users-grid]').boundingBox())!;
    await page.screenshot({
      path: path.join(OUT!, '00-tile-anatomy-2x.png'),
      clip: { x: gridBox.x, y: gridBox.y, width: Math.min(gridBox.width, 1000), height: 340 },
    });
    await page.evaluate(() => {
      document.querySelector<HTMLElement>('[data-users-grid]')!.style.transform = '';
    });
    await page.goto(base);
    await ready(page);
    await page.getByLabel('Sort', { exact: true }).selectOption('load');

    await page.getByRole('button', { name: 'Table' }).click();
    await expect(page.locator('[data-users-table]')).toBeVisible();
    await shot('04-table-1366');
    await page.getByRole('button', { name: 'Cards' }).click();
    await page.getByRole('button', { name: 'Legend and help' }).click();
    await shot('05-legend-1366');
    await page.getByRole('button', { name: 'Legend and help' }).click();

    await page
      .locator(`[data-user-card][data-state="busy"][data-load="HEAVY"] [data-user-open]`)
      .first()
      .click();
    await expect(page.locator('[data-drawer-tasks] li').first()).toBeVisible();
    await shot('06-drawer-1366');
    await page.locator('[data-drawer-assign]').click();
    // The picker lists the unassigned tasks of the person's pods; this run's own tasks have no pod, so ask for all pods and search for them.
    await page.locator('[data-assign-allpods]').check();
    await page
      .getByRole('searchbox', { name: 'Search unassigned tasks' })
      .fill(`Unassigned ${wl.tag}`);
    await expect(page.locator('[data-assign-row]').first()).toBeVisible();
    await shot('06b-assign-heavy-hint-1366');
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');

    await page.goto(`/dashboard?tab=users&view=coverage&cov=matrix&uq=zcov${cov.tag}`);
    await expect(page.locator('[data-coverage-table]')).toBeVisible();
    await page.getByLabel('Colour scale').selectOption('absolute');
    await page.locator(`[data-type-name="${cov.typeNames.production}"]`).scrollIntoViewIfNeeded();
    await shot('08-coverage-absolute-1366');
    await page.getByRole('button', { name: 'Training gaps' }).click();
    await shot('09-coverage-gaps-1366');
    await page.getByRole('button', { name: 'Training gaps' }).click();
    await page.locator(`[data-cell="${cov.people.a.userId}:${cov.typeIds.production}"]`).click();
    await expect(page.locator('[data-coverage-tasks] li').first()).toBeVisible();
    await shot('10-coverage-drawer-1366');
    await page.keyboard.press('Escape');

    await page.route('**/api/v1/dashboard/workload**', (route) => route.abort());
    // The tab remembers Coverage after the visits above; the error to photograph is the Workload's.
    await page.evaluate(() => window.localStorage.clear());
    await page.goto(base);
    await expect(page.locator('[data-dash-state="error"]')).toBeVisible();
    await shot('11-error-1366');
  });
});
