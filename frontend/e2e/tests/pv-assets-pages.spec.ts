import { axeAvailable, axeViolations } from '../support/axe';
import { expect, test } from '../support/fixtures';
import { pvWorld } from '../support/pv-world';
import { SIZES, noHorizontalScroll, shot } from '../support/screens';
import { filterDropdown } from '../support/dropdown';

/**
 * PM v2, lane H page fixes (epic #851), Assets tab and list (#883). Screenshots: E2E_SCREENSHOTS=docs/ux/pm-v2-review/fixes/pv-assets-pages.
 */
test.describe('PM v2 page fixes: Assets tab and list (#883)', () => {
  test.beforeEach(() => {
    expect(axeAvailable(), 'axe-core must be available (set E2E_AXE_PATH)').toBe(true);
  });

  test('Assets: the Disposition filter keeps its width, Linked tasks reads open / all, the matter tab shows size and disposition (#883)', async ({
    seed,
    personas,
    asUser,
  }) => {
    const d = await pvWorld(seed, personas, 'pvh3');
    const page = await asUser(d.w.pm.username);
    await page.setViewportSize({ width: 1366, height: 768 });
    await page.goto(`/assets?matterId=${d.matterA.matterId}&status=all`);
    await expect(page.locator('tbody tr[data-record-id]')).toHaveCount(2);
    const select = filterDropdown(page, 'Disposition');
    const box = (await select.boundingBox())!;
    expect(box.width, 'the Disposition select is not squeezed').toBeGreaterThanOrEqual(100);
    await expect(page.locator('tr[data-record-id] td[data-linked]').first()).toContainText('0 / 0');
    await expect(page.locator('tr[data-record-id] td[data-size]').first()).toContainText('GB');
    if (await page.locator('thead th[data-drop]').count()) {
      await noHorizontalScroll(page);
    }

    // The matter's Assets tab: Size and Disposition columns, sortable by size.
    await page.goto(`/matters/${d.matterA.matterId}?tab=assets&status=all`);
    const rows = page.locator('tbody tr');
    await expect(rows).toHaveCount(2);
    await expect(page.locator('thead th', { hasText: 'Size' })).toBeVisible();
    await expect(page.locator('thead th', { hasText: 'Disposition' })).toBeVisible();
    await expect(rows.filter({ hasText: 'Pending' }).locator('td[data-status]')).toContainText(
      'Pending Disposition',
    );
    await expect(rows.filter({ hasText: `Big ${d.token}` }).locator('td[data-size]')).toContainText(
      '10 GB',
    );
    await page.locator('thead').getByRole('button', { name: 'Size', exact: true }).click();
    await expect(page).toHaveURL(/sort=-?size/);

    for (const size of SIZES) {
      await page.setViewportSize(size);
      await expect(rows.first()).toBeVisible();
      expect(await axeViolations(page), `matter assets at ${size.width}`).toEqual([]);
      await noHorizontalScroll(page);
      if (size.width === 1366) await shot(page, 'pv-matter-assets');
    }
    for (const size of SIZES) {
      await page.setViewportSize(size);
      await page.goto(`/assets?matterId=${d.matterA.matterId}&status=all`);
      await expect(
        page.locator('tbody tr[data-record-id], [data-card-name]').first(),
      ).toBeVisible();
      expect(await axeViolations(page), `assets list at ${size.width}`).toEqual([]);
      await noHorizontalScroll(page);
      if (size.width === 1366) await shot(page, 'pv-assets-list');
    }
  });
});
