import fs from 'node:fs';
import path from 'node:path';
import { expect, test } from '../support/fixtures';
import { axeAvailable, axeViolations } from '../support/axe';
import { uid } from '../support/seed';

/**
 * Screenshot run for docs/ux/dashboard-v5 (not a test: skipped unless E2E_SCREENSHOTS is set to the output folder):
 *   E2E_SCREENSHOTS=docs/ux/dashboard-v5 frontend/e2e/run-local.sh -g "dashboard v5 screenshots"
 * Takes the icon-only Refresh in the tab row of every tab (as the System Admin), the technician's Summary (the unassigned queue alone) at
 * 1366x768 and 375x812, and the Dashboard group of the role editor with the new permission. With axe-core available every screen is also checked.
 */
const OUT = process.env['E2E_SCREENSHOTS'];

test.describe('dashboard v5 screenshots', () => {
  test.skip(!OUT, 'set E2E_SCREENSHOTS to the output folder');

  test('capture', async ({ page, seed, asUser }) => {
    test.setTimeout(300_000);
    fs.mkdirSync(OUT!, { recursive: true });
    const world = await seed.world();
    for (const n of [1, 2, 3]) await seed.task(world, { title: `Unassigned sample ${n} ${uid()}` });
    const problems: string[] = [];
    const shoot = async (target: typeof page, name: string) => {
      await target.waitForLoadState('networkidle');
      await target.waitForTimeout(300);
      await target.screenshot({ path: path.join(OUT!, `${name}.png`) });
      if (axeAvailable())
        for (const v of await axeViolations(target)) problems.push(`${name}: ${v}`);
    };

    await page.setViewportSize({ width: 1366, height: 768 });
    for (const [tab, name] of [
      ['summary', '01-summary-director-1366'],
      ['breakdowns', '02-breakdowns-1366'],
      ['trends', '03-trends-1366'],
      ['swimlane', '04-swimlane-1366'],
      ['users', '05-users-1366'],
    ]) {
      await page.goto(`/dashboard?tab=${tab}`);
      await expect(page.locator(`[data-tabpanel="${tab}"]`)).toBeVisible();
      await expect(page.getByRole('button', { name: 'Refresh', exact: true })).toBeVisible();
      await shoot(page, name);
    }

    const tech = await seed.user(['Data Technician'], 'v5tech');
    const techPage = await asUser(tech.username);
    for (const [w, h] of [
      [1366, 768],
      [375, 812],
    ]) {
      await techPage.setViewportSize({ width: w, height: h });
      await techPage.goto('/dashboard');
      await expect(techPage.locator('[data-panel="unassigned"] li').first()).toBeVisible();
      await shoot(techPage, `06-summary-technician-${w}`);
    }

    await page.setViewportSize({ width: 1366, height: 900 });
    const role = await seed.role(
      ['Task.View', 'Dashboard.View', 'Dashboard.ViewUnassigned'],
      'E2E queue',
    );
    await page.goto('/admin/roles');
    await page.locator('button.mf-role', { hasText: role.name }).click();
    await page.locator('[data-group="Dashboard"]').scrollIntoViewIfNeeded();
    await shoot(page, '07-role-editor-dashboard-group-1366');

    expect(problems).toEqual([]);
  });
});
