import { axeAvailable, axeViolations } from '../support/axe';
import { expect, test } from '../support/fixtures';
import { pvWorld } from '../support/pv-world';
import { SIZES, noHorizontalScroll, shot } from '../support/screens';

/**
 * PM v2, lane H page fixes (epic #851), Matter Overview (#882). Screenshots: E2E_SCREENSHOTS=docs/ux/pm-v2-review/fixes/pv-matter-overview.
 */
test.describe('PM v2 page fixes: Matter Overview (#882)', () => {
  test.beforeEach(() => {
    expect(axeAvailable(), 'axe-core must be available (set E2E_AXE_PATH)').toBe(true);
  });

  test('Matter Overview: task types, on hold by reason, the Data block with a small chart, a compact summary with a Details disclosure (#882)', async ({
    seed,
    personas,
    asUser,
  }) => {
    const d = await pvWorld(seed, personas, 'pvh2');
    const page = await asUser(d.w.pm.username);
    await page.setViewportSize({ width: 1366, height: 768 });
    await page.goto(`/matters/${d.matterA.matterId}`);
    const types = page.locator('[data-section="types"]');
    await expect(types).toBeVisible();
    await expect(types.locator('[data-type-row]').first()).toContainText('open');
    await expect(types.locator('a.mo__over').first()).toContainText('1 overdue');
    const holds = page.locator('[data-section="holds"]');
    await expect(holds).toContainText('No reason given');
    await expect(holds.locator('[data-hold-reason]').first()).toContainText('2 tasks');
    const data = page.locator('[data-section="data"]');
    await expect(data.locator('[data-data-assets]')).toContainText('2 assets');
    await expect(data.locator('[data-data-size]')).toContainText('15.5 GB');
    await expect(data.locator('[data-data-pending]')).toContainText('1 pending disposition');
    await data.locator('[data-data-pending]').click();
    await expect(page).toHaveURL(/\/assets\?.*status=pending/);
    await page.goBack();

    // Details: a compact summary above the sections, the rest behind a disclosure; the manager line has its space.
    const toggle = page.locator('[data-details-toggle]');
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await expect(page.locator('[data-details-block]')).toHaveCount(0);
    await toggle.click();
    await expect(page.locator('[data-details-block] dl')).toContainText('Client');
    const managers = (await page.locator('[data-managers]').innerText()).replace(/\s+/g, ' ');
    expect(managers).toContain(`${d.w.pm.displayName} (primary)`);

    for (const size of SIZES) {
      await page.setViewportSize(size);
      await expect(page.locator('[data-section="data"]')).toBeVisible();
      expect(await axeViolations(page), `matter overview at ${size.width}`).toEqual([]);
      await noHorizontalScroll(page);
      if (size.width === 1366 || size.width === 375) await shot(page, 'pv-matter-overview');
    }

    // The block needs Asset.View: a viewer without it sees no Data block and no request for it goes out.
    const noAssets = await personas.create({
      label: 'pvh2-na',
      permissions: ['Client.View', 'Matter.View', 'Task.View'],
    });
    const other = await asUser(noAssets.username);
    const calls: string[] = [];
    other.on('request', (r) => {
      if (r.url().includes('/my-matters/data')) calls.push(r.url());
    });
    await other.goto(`/matters/${d.matterB.matterId}`);
    await expect(other.locator('[data-section="status"]')).toBeVisible();
    await expect(other.locator('[data-section="data"]')).toHaveCount(0);
    expect(calls).toEqual([]);
  });
});
