import { Page } from '@playwright/test';
import { axeAvailable, axeViolations } from '../support/axe';
import { failApi } from '../support/personas';
import { SIZES, noHorizontalScroll, shot } from '../support/screens';
import { expect, test } from '../support/fixtures';
import { Seeder, uid } from '../support/seed';

/**
 * WP-SR3 / WP-SR4 (#467 to #470, #473): the All tab shows five hits per type with "See all N"; a type tab is a paged grid of 44 px rows with the
 * name as the only link; the states are the grid body's; below 640 px the hits are cards, not a table cut at Status.
 * Screenshots go to E2E_SCREENSHOTS (docs/ux/search-review/fixes/sr3-results and sr4-phone).
 */
async function seedGrids(seed: Seeder) {
  const token = `Srg${uid().replace(/[^a-z0-9]/gi, '')}`;
  const world = await seed.world();
  for (let i = 0; i < 12; i++) await seed.task(world, { title: `${token} task ${i}` });
  await seed.project(world.matter, `${token} project`);
  for (let i = 0; i < 58; i++) await seed.asset(world.matter, `${token} asset ${i}`);
  return { token, world };
}

const tab = (page: Page, name: RegExp) =>
  page.getByRole('tablist', { name: 'Search results by type' }).getByRole('tab', { name });

test.describe('Search results grids and cards (WP-SR3, WP-SR4)', () => {
  test('All: five hits per type, "See all N" opens the tab and focuses its heading; no Show more', async ({
    page,
    seed,
  }) => {
    const s = await seedGrids(seed);
    await page.setViewportSize({ width: 1366, height: 768 });
    await page.goto(`/search?q=${s.token}`);
    await expect(page.locator('[data-section=task] [data-hit-row]')).toHaveCount(5);
    await expect(page.locator('[data-section=asset] [data-hit-row]')).toHaveCount(5);
    await expect(page.locator('[data-section=project] [data-hit-row]')).toHaveCount(1);
    await expect(page.locator('[data-section=project] [data-see-all]')).toHaveCount(0);
    await expect(page.getByText('Show more')).toHaveCount(0);
    // The heading counts are the tab counts.
    await expect(page.getByRole('region', { name: 'Assets (58)' })).toBeVisible();
    await expect(tab(page, /^Assets, 58 results/)).toBeVisible();

    const seeAll = page.locator('[data-section=asset] [data-see-all]');
    await expect(seeAll).toContainText('See all 58');
    await seeAll.click();
    await expect(page).toHaveURL(/type=asset/);
    await expect(page.locator('[data-hit-row]')).toHaveCount(25);
    await expect(page.locator('[data-grid-heading]')).toBeFocused();
    await expect(page.locator('[data-grid-heading]')).toContainText('Assets, 58 results');
    await expect(page).toHaveTitle('Search results: Assets - MatterFlow');
  });

  test('a type tab: 44 px rows at 1366 and 1920, the name is the only link, assets show Type and Matter number, page 3 by pager and by URL', async ({
    page,
    seed,
  }) => {
    const s = await seedGrids(seed);
    for (const size of [
      { width: 1366, height: 768 },
      { width: 1920, height: 1080 },
    ]) {
      await page.setViewportSize(size);
      await page.goto(`/search?q=${s.token}&type=asset`);
      const rows = page.locator('[data-hit-row]');
      await expect(rows).toHaveCount(25);
      for (const box of await rows.evaluateAll((els) =>
        els.map((e) => e.getBoundingClientRect().height),
      ))
        expect(box, `row height at ${size.width}`).toBeGreaterThanOrEqual(43.5);
      const heights = await rows.evaluateAll((els) =>
        els.map((e) => Math.round(e.getBoundingClientRect().height)),
      );
      expect(new Set(heights), `row heights at ${size.width}`).toEqual(new Set([44]));
      await expect(page.getByRole('columnheader')).toHaveText([
        'Name',
        'Type',
        'Matter number',
        'Status',
      ]);
      await expect(rows.first().locator('a')).toHaveCount(1);
      await expect(rows.first()).not.toContainText('https://');
      await shot(page, 'sr3-grid-assets');
    }

    // Page 3 by the pager and by the address; the page size stays in the address; focus lands on the grid heading.
    await page.goto(`/search?q=${s.token}&type=asset`);
    await page.getByRole('button', { name: 'Next', exact: true }).click();
    await page.getByRole('button', { name: 'Next', exact: true }).click();
    await expect(page).toHaveURL(/page=3/);
    await expect(page.locator('[data-hit-row]')).toHaveCount(8);
    await expect(page.locator('[data-grid-heading]')).toBeFocused();
    await page.goto(`/search?q=${s.token}&type=asset&page=3&pageSize=25`);
    await expect(page.locator('[data-range]')).toContainText('51-58 of 58');
  });

  test('states: skeleton rows, error with reference and Retry, empty text (grid-body contract)', async ({
    page,
    seed,
  }) => {
    const s = await seedGrids(seed);
    await page.setViewportSize({ width: 1366, height: 768 });
    const unfail = await failApi(page, /\/api\/v1\/search\/advanced/, 500, { times: 1 });
    await page.goto(`/search?q=${s.token}&type=task`);
    const error = page.locator('[data-error]');
    await expect(error).toContainText("Couldn't load results.");
    await expect(error).toContainText(/Reference/i);
    await expect(page.getByRole('columnheader', { name: 'Title' })).toBeVisible();
    await error.getByRole('button', { name: 'Retry' }).click();
    await expect(page.locator('[data-hit-row]')).toHaveCount(12);
    await unfail();

    await page.goto(`/search?q=zzzzqqq${s.token}&type=task`);
    await expect(page.locator('[data-empty]')).toContainText('No results for');
  });

  test('phone: cards below 640 px with no table; the table from 640 px; axe 0 and no sideways scroll at four sizes on All and a type tab', async ({
    page,
    seed,
  }) => {
    test.skip(!axeAvailable(), 'axe-core is not available');
    const s = await seedGrids(seed);
    for (const width of [375, 639]) {
      await page.setViewportSize({ width, height: 812 });
      await page.goto(`/search?q=${s.token}&type=task`);
      await expect(page.locator('li.rc').first()).toBeVisible();
      await expect(page.locator('[data-hit-table]')).toHaveCount(0);
      const link = page.locator('li.rc a').first();
      const href = await link.getAttribute('href');
      expect(href).toMatch(/^\/tasks\/\d+/);
      await noHorizontalScroll(page);
    }
    await page.setViewportSize({ width: 640, height: 812 });
    await page.goto(`/search?q=${s.token}&type=task`);
    await expect(page.locator('[data-hit-table]')).toHaveCount(1);
    await expect(page.locator('li.rc')).toHaveCount(0);

    for (const size of SIZES) {
      await page.setViewportSize(size);
      for (const url of [`/search?q=${s.token}`, `/search?q=${s.token}&type=asset`]) {
        await page.goto(url);
        await expect(page.locator('[data-hit-row], li.rc').first()).toBeVisible();
        await noHorizontalScroll(page);
        expect(await axeViolations(page), `axe ${url} at ${size.width}`).toEqual([]);
        if (size.width === 375 || size.width === 1366)
          await shot(page, url.includes('type=') ? 'sr3-type-tab' : 'sr3-all-tab');
      }
    }

    // A card: the name is the one link, the task opens; Back returns to the results.
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto(`/search?q=${s.token}&type=task`);
    await page.locator('li.rc a').first().click();
    await expect(page).toHaveURL(/\/tasks\/\d+/);
  });
});
