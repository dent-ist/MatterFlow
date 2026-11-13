import { expect, test } from '../support/fixtures';

/**
 * An alignment detail of the Dashboard (owner feedback; the Summary part left with the v4 layout, epic #1063):
 *  Users: the Workload | Coverage switch stays where it is when the view changes (the Workload toolbar has labels over its selects).
 */
test('Users: the Workload | Coverage switch does not move between the views', async ({ page }) => {
  for (const width of [1366, 1920]) {
    await page.setViewportSize({ width, height: width === 1366 ? 768 : 1080 });
    await page.goto('/dashboard?tab=users');
    const views = page.locator('[data-users-views]');
    await expect(views).toBeVisible();
    await expect(page.locator('[data-users-loading]')).toHaveCount(0);
    const workload = (await views.boundingBox())!;
    await views.getByRole('button', { name: /Coverage/ }).click();
    await expect(page.locator('mf-coverage-view')).toBeVisible();
    const coverage = (await views.boundingBox())!;
    expect(Math.abs(coverage.y - workload.y)).toBeLessThanOrEqual(1);
    expect(Math.abs(coverage.x - workload.x)).toBeLessThanOrEqual(1);
    await views.getByRole('button', { name: /Workload/ }).click();
    // The switch is drawn again with the Workload toolbar (the Coverage one is gone): measure the new one, not the instant between the two.
    await expect(page.locator('mf-coverage-view')).toHaveCount(0);
    await expect(page.locator('mf-users-toolbar')).toBeVisible();
    await expect(views).toBeVisible();
    await expect(page.locator('[data-users-loading]')).toHaveCount(0);
    const back = (await views.boundingBox())!;
    expect(Math.abs(back.y - workload.y)).toBeLessThanOrEqual(1);
    expect(Math.abs(back.x - workload.x)).toBeLessThanOrEqual(1);
  }
});
