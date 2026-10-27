import { axeAvailable, axeViolations } from '../support/axe';
import { expect, test } from '../support/fixtures';
import { pvWorld } from '../support/pv-world';
import { SIZES, noHorizontalScroll, shot } from '../support/screens';

/**
 * PM v2, lane H page fixes (epic #851), Matters list columns (#881). Screenshots: E2E_SCREENSHOTS=docs/ux/pm-v2-review/fixes/pv-matters-list.
 */
test.describe('PM v2 page fixes: Matters list columns (#881)', () => {
  test.beforeEach(() => {
    expect(axeAvailable(), 'axe-core must be available (set E2E_AXE_PATH)').toBe(true);
  });

  test('Matters list: Name and Client keep their room, the optional columns appear on request and only for their permission (#881)', async ({
    seed,
    personas,
    asUser,
  }) => {
    const d = await pvWorld(seed, personas, 'pvh1');
    const page = await asUser(d.w.pm.username);
    await page.setViewportSize({ width: 1366, height: 768 });
    await page.goto('/matters?scope=mine');
    await expect(page.locator('tbody tr')).toHaveCount(2);
    // No truncation of the demo names at 1366: the name link shows all its text (two lines at most), the table does not scroll sideways.
    for (const link of await page.locator('tbody td.ml-name a.pg-name').all()) {
      const clipped = await link.evaluate((a) => a.scrollHeight > a.clientHeight + 1);
      expect(clipped, 'a matter name is cut').toBe(false);
    }
    // The reference filter keeps room for its words, and Name has more than the 150 px it was squeezed to.
    expect(
      (await page.getByLabel('Filter by Matter reference').boundingBox())!.width,
    ).toBeGreaterThanOrEqual(130);
    expect(
      (await page.locator('tbody td.ml-name').first().boundingBox())!.width,
    ).toBeGreaterThanOrEqual(200);
    const wide = await page
      .locator('.mf-scroll')
      .first()
      .evaluate((s) => s.scrollWidth - s.clientWidth);
    expect(wide).toBeLessThanOrEqual(0);
    await expect(page.locator('thead th', { hasText: 'On hold' })).toHaveCount(0);

    await page.locator('[data-matter-columns]').click();
    for (const key of ['onHold', 'atRisk', 'dataSize', 'pending']) {
      await page.locator(`[data-matter-columns-panel] [data-column="${key}"]`).check();
    }
    await page.keyboard.press('Escape');
    const rowA = page.locator('tbody tr', { hasText: d.matterA.matterRef });
    await expect(rowA.locator('[data-cell=onHold]')).toHaveText('2');
    await expect(rowA.locator('[data-cell=dataSize]')).toHaveText('15.5 GB');
    await expect(rowA.locator('[data-cell=pending] a')).toHaveText('1');
    const rowB = page.locator('tbody tr', { hasText: d.matterB.matterRef });
    await expect(rowB.locator('[data-cell=onHold]')).toHaveText('0');
    await expect(rowB.locator('[data-cell=pending]')).toHaveText('0');
    // The choice is remembered.
    await page.reload();
    await expect(page.locator('thead th', { hasText: 'On hold' })).toBeVisible();

    for (const size of SIZES) {
      await page.setViewportSize(size);
      await expect(page.locator('tbody tr, li[data-record-card]').first()).toBeVisible();
      expect(await axeViolations(page), `matters list at ${size.width}`).toEqual([]);
      await noHorizontalScroll(page);
      if (size.width === 1366 || size.width === 375) await shot(page, 'pv-matters-list');
    }

    // Without Task.View and Asset.View there is no Columns button at all.
    const observer = await personas.create({
      label: 'pvh1-obs',
      permissions: ['Client.View', 'Matter.View'],
    });
    const plain = await asUser(observer.username);
    await plain.setViewportSize({ width: 1366, height: 768 });
    await plain.goto('/matters');
    await expect(plain.locator('tbody tr').first()).toBeVisible();
    await expect(plain.locator('[data-matter-columns]')).toHaveCount(0);
  });
});
