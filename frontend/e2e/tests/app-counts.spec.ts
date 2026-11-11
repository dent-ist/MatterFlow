import { expect, test } from '../support/fixtures';
import {
  ASSETS_LIST_COLUMN_COUNT,
  MATTER_TAB_COUNT,
  MATTER_TAB_LABELS,
} from '../support/app-counts';

/**
 * Guard for support/app-counts.ts (E2E #1359): the counts the specs share must be the ones the application shows. When this fails the application changed (a
 * tab or a column was added or removed): change the constant in support/app-counts.ts and nothing else.
 */
test.describe('Counts shared by the specs', () => {
  test('the Matter page shows the tabs of the registry, in order, for the System Admin', async ({
    page,
    seed,
  }) => {
    const world = await seed.world();
    await page.goto(`/matters/${world.matter.matterId}`);
    const tabs = page.getByRole('tab');
    await expect(tabs.first()).toBeVisible();
    await expect(tabs).toHaveCount(MATTER_TAB_COUNT);
    const names = (await tabs.allTextContents()).map((t) => t.trim());
    MATTER_TAB_LABELS.forEach((label, i) => expect(names[i]).toContain(label));
  });

  test('the Assets list has the header cells of ASSETS_LIST_COLUMN_COUNT for the System Admin', async ({
    page,
    seed,
  }) => {
    const world = await seed.world();
    await seed.asset(world.matter, `Counts Asset ${world.matter.matterId}`);
    await page.goto('/assets');
    const grid = page.getByRole('region', { name: 'Assets list, scrollable' });
    await expect(grid.locator('tbody tr').first()).toBeVisible();
    await expect(grid.locator('thead tr:first-child th')).toHaveCount(ASSETS_LIST_COLUMN_COUNT);
  });
});
