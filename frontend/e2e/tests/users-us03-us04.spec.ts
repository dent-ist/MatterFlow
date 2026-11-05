import { expect, test } from '../support/fixtures';

/**
 * Dashboard > Users: the person drawer tabs (US-03, #1093) and the Skills view (US-04, #1094). They need only Dashboard.ViewUsers, so a Director (every Dashboard tab) opens them.
 * The history and skills figures come from completed tasks, which a fresh database may not have, so the checks are about structure: the tabs, the regions, the states.
 */
test.describe('Dashboard Users: person history and skills', () => {
  test('the drawer has Overview, Task types and Trend tabs and Esc closes it', async ({ page }) => {
    await page.goto('/dashboard?tab=users');
    const first = page.locator('[data-user-open]').first();
    await expect(first).toBeVisible({ timeout: 30_000 });
    await first.click();
    const drawer = page.locator('[data-users-drawer]');
    await expect(drawer).toBeVisible();
    const tabs = page.getByRole('tablist', { name: 'Person details' });
    await expect(tabs.getByRole('tab')).toHaveText([/Overview/, /Task types/, /Trend/]);
    await tabs.getByRole('tab', { name: 'Task Types' }).click();
    await expect(
      page.locator('[data-types-table], [data-types-empty], [data-history-missing]').first(),
    ).toBeVisible();
    await tabs.getByRole('tab', { name: 'Trend', exact: true }).click();
    await expect(page.locator('[data-trend-bars], [data-history-missing]').first()).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(drawer).toHaveCount(0);
  });

  test('Skills opens from the view switch, keeps the address, scrolls in its frame and a name opens the drawer', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1366, height: 768 });
    await page.goto('/dashboard?tab=users');
    await page
      .getByRole('group', { name: 'Users view' })
      .getByRole('button', { name: 'Skills' })
      .click();
    await expect(page).toHaveURL(/view=skills/);
    const region = page.getByRole('region', { name: 'Skills matrix, scrollable' });
    await expect(region).toBeVisible();
    expect(
      await page.evaluate(() => document.documentElement.scrollHeight <= window.innerHeight + 1),
    ).toBe(true);
    const name = page.locator('[data-skills-open]').first();
    if (await name.count()) {
      await name.click();
      await expect(page.locator('[data-users-drawer]')).toBeVisible();
    }
  });
});
