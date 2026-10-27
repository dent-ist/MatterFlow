import { axeAvailable, axeViolations } from '../support/axe';
import { expect, test } from '../support/fixtures';
import { pvWorld } from '../support/pv-world';
import { SIZES, noHorizontalScroll, shot } from '../support/screens';

/**
 * PM v2, lane H page fixes (epic #851), Search hits (#885). Screenshots: E2E_SCREENSHOTS=docs/ux/pm-v2-review/fixes/pv-search-hits.
 */
test.describe('PM v2 page fixes: Search hits (#885)', () => {
  test.beforeEach(() => {
    expect(axeAvailable(), 'axe-core must be available (set E2E_AXE_PATH)').toBe(true);
  });

  test('Search: a task hit shows its type and due date, an asset hit its size and disposition, the other-matter label stays (#885)', async ({
    seed,
    personas,
    asUser,
  }) => {
    const d = await pvWorld(seed, personas, 'pvh5');
    const page = await asUser(d.w.pm.username);
    await page.setViewportSize({ width: 1366, height: 768 });
    await page.goto(`/search?q=${encodeURIComponent(`Late ${d.token}`)}&type=task`);
    const row = page.locator('[data-hit-row]').first();
    await expect(row).toBeVisible();
    await expect(row.locator('[data-cell="taskType"] [data-type-badge]')).toHaveAttribute(
      'aria-label',
      /Task type: /,
    );
    await expect(row.locator('[data-cell="due"]')).toContainText('Overdue Jan 1, 2000');
    await page.goto(`/search?q=${encodeURIComponent(`Pending ${d.token}`)}&type=asset`);
    const asset = page.locator('[data-hit-row]').first();
    await expect(asset.locator('[data-cell="size"]')).toContainText('5.5 GB');
    await expect(asset.locator('[data-cell="disposition"]')).toContainText('Pending disposition');
    for (const size of SIZES) {
      await page.setViewportSize(size);
      await expect(page.locator('[data-hit-row], mf-search-hit-card').first()).toBeVisible();
      expect(await axeViolations(page), `search at ${size.width}`).toEqual([]);
      await noHorizontalScroll(page);
      if (size.width === 1366 || size.width === 375) await shot(page, 'pv-search-hits');
    }
  });
});
