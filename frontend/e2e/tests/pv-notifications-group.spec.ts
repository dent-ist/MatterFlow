import { axeAvailable, axeViolations } from '../support/axe';
import { expect, test } from '../support/fixtures';
import { pvWorld } from '../support/pv-world';
import { SIZES, noHorizontalScroll, shot } from '../support/screens';
import { uid } from '../support/seed';

/**
 * PM v2, lane H page fixes (epic #851), Grouped overdue notices and the honest bell (#884). Screenshots: E2E_SCREENSHOTS=docs/ux/pm-v2-review/fixes/pv-notifications-group.
 */
test.describe('PM v2 page fixes: Grouped overdue notices and the honest bell (#884)', () => {
  test.beforeEach(() => {
    expect(axeAvailable(), 'axe-core must be available (set E2E_AXE_PATH)').toBe(true);
  });

  test('Notifications: the overdue notices of a day are one group and the bell counts it once (#884)', async ({
    seed,
    personas,
    asUser,
  }) => {
    test.setTimeout(240_000);
    const d = await pvWorld(seed, personas, 'pvh4');
    const type = d.w.world.taskType;
    expect(type).toBeTruthy();
    // Three more overdue tasks on the two matters; the scheduler (every minute on this stack) writes one notice per task for the matters' manager.
    for (const matter of [d.matterA, d.matterB]) {
      await d.w.task(matter, { title: `Overdue x ${uid().slice(0, 4)}`, dueDate: '2000-01-02' });
    }
    const page = await asUser(d.w.pm.username);
    const group = page.locator('[data-notification-group]').first();
    // The scheduler writes the notices within a tick (a minute on this stack); the page lists what was there when it opened.
    await expect(async () => {
      await page.goto('/notifications');
      await expect(group).toBeVisible({ timeout: 3_000 });
    }).toPass({ timeout: 170_000, intervals: [5_000] });
    await expect(group).toContainText('Overdue - 3 tasks on 2 matters');
    // One group in the bell: the badge counts entries, and says so in its tooltip.
    // Everything on the page is unread, so the number is the number of entries on it: the three overdue notices are ONE of them.
    const entries = await page.locator('[data-page-list] > li').count();
    await expect(page.locator('[data-notification-badge]')).toHaveText(String(entries));
    await expect(page.locator('[data-group-items]')).toHaveCount(0); // folded until "Show" is used
    await expect(page.locator('[data-testid="notification-bell"]')).toHaveAttribute(
      'title',
      /count once/,
    );
    await page.locator('[data-group-toggle]').first().click();
    const items = page.locator('[data-group-items] [data-notification-item]');
    await expect(items).toHaveCount(3);
    // Reason first, with the task type after the matter.
    await expect(items.first()).toContainText(/Overdue by \d+ days - TSK-\d+ ".*" on .* \(.+\)/);
    // The panel groups them too, and opening the group leads to the Task Queue of the overdue tasks and reads the whole group.
    await page.locator('[data-testid="notification-bell"]').click();
    const panelGroup = page.locator('[data-notification-panel] [data-notification-group]');
    await expect(panelGroup).toContainText('Overdue - 3 tasks on 2 matters');
    await panelGroup.click();
    await expect(page).toHaveURL(/\/tasks\?.*overdue=true.*scope=mine/);
    // The group is read as one: the number drops by one entry.
    await expect(page.locator('[data-notification-badge]')).toHaveText(String(entries - 1));
    for (const size of SIZES) {
      await page.setViewportSize(size);
      await page.goto('/notifications');
      await expect(page.locator('[data-notification-group]').first()).toBeVisible();
      expect(await axeViolations(page), `notifications at ${size.width}`).toEqual([]);
      await noHorizontalScroll(page);
      if (size.width === 1366 || size.width === 375) await shot(page, 'pv-notifications-group');
    }
  });
});
