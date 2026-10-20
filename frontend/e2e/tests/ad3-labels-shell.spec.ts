import { axeAvailable, axeViolations } from '../support/axe';
import { expect, test } from '../support/fixtures';
import { SIZES, noSideScroll, shot } from '../support/labels';

/**
 * WP-AD3 #593: the Labels page on the admin list shell: crumb Administration > Labels, title, one-line description per tab, counted tabs
 * Priorities (n) and Status labels (n) with the arrow keys, the "Skip to table" first Tab stop, one tab and no tab strip for a person with
 * one permission. Screenshots go to E2E_SCREENSHOTS (docs/ux/admin-pages-review/fixes/ad3-labels).
 */
test.describe('the Labels page on the admin list shell (#593)', () => {
  test('crumb, H1 and the one-line description do not wrap or clip at 1366 and 1920; the New priority action is the only header action', async ({
    page,
  }) => {
    for (const size of [SIZES[0], SIZES[1]]) {
      await page.setViewportSize(size);
      for (const url of ['/admin/priorities', '/admin/status-labels']) {
        await page.goto(url);
        const header = await page.locator('mf-page-header').evaluate((el) => {
          const lines = (sel: string) => {
            const node = el.querySelector<HTMLElement>(sel);
            if (!node) return 0;
            const style = getComputedStyle(node);
            const lh = parseFloat(style.lineHeight) || parseFloat(style.fontSize) * 1.25;
            return Math.round(node.getBoundingClientRect().height / lh);
          };
          const desc = el.querySelector<HTMLElement>('[data-page-description]')!;
          return {
            crumb: lines('nav ol'),
            title: lines('h1'),
            desc: lines('[data-page-description]'),
            clipped: desc.scrollWidth > desc.clientWidth,
          };
        });
        expect(header, `${url} at ${size.width}`).toEqual({
          crumb: 1,
          title: 1,
          desc: 1,
          clipped: false,
        });
        await expect(page.locator('nav[aria-label="Breadcrumb"] li')).toHaveText([
          'Administration',
          'Labels',
        ]);
        await expect(page.getByRole('heading', { level: 1 })).toHaveText('Labels');
      }
    }
  });

  test('the tabs carry the active counts, match the API and keep the arrow, Home and End keys', async ({
    page,
    admin,
  }) => {
    const priorities = await admin.get<{ isActive: boolean }[]>('/api/v1/priorities');
    const active = priorities.filter((p) => p.isActive).length;
    await page.setViewportSize(SIZES[1]);
    await page.goto('/admin/priorities');
    const tabs = page.getByRole('tab');
    await expect(tabs).toHaveText([
      new RegExp(`Priorities \\(${active}\\)$`),
      /Status labels \(5\)$/,
    ]);
    await expect(tabs.first()).toHaveAttribute('aria-label', `Priorities, ${active} active`);
    await expect(tabs.first()).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('[data-page-description]')).toHaveText(
      'Order priorities from most to least urgent. Exactly one is the default.',
    );

    await tabs.first().focus();
    await page.keyboard.press('ArrowRight');
    await expect(page).toHaveURL(/\/admin\/status-labels$/);
    await expect(page.getByRole('tab', { name: /^Status labels/ })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await expect(page.locator('[data-page-description]')).toHaveText(
      "Rename how the five statuses read. You can't add or remove statuses.",
    );
    await expect(page.getByRole('button', { name: 'New priority' })).toHaveCount(0);
    await expect(page).toHaveTitle('Labels - Status labels - MatterFlow');
    await page.keyboard.press('Home');
    await expect(page).toHaveURL(/\/admin\/priorities$/);
    await expect(page).toHaveTitle('Labels - Priorities - MatterFlow');
    await page.keyboard.press('End');
    await expect(page).toHaveURL(/\/admin\/status-labels$/);
    await expect(page.locator('[role="tabpanel"]')).toHaveAttribute(
      'aria-labelledby',
      'labels-tab-status-labels',
    );
  });

  test('"Skip to table" is the first Tab stop on both tabs, visible on focus, and moves focus into the table', async ({
    page,
  }) => {
    await page.setViewportSize(SIZES[1]);
    for (const url of ['/admin/priorities', '/admin/status-labels']) {
      await page.goto(url);
      await expect(page.locator('table.mf-grid tbody tr[data-row]').first()).toBeVisible();
      await page.keyboard.press('Tab');
      const skip = page.locator('a.mf-skip[data-skip-list]');
      await expect(skip, url).toBeFocused();
      await page.keyboard.press('Enter');
      expect(
        await page.evaluate(() => !!document.activeElement?.closest('#mf-main')),
        `${url}: focus is in the page`,
      ).toBe(true);
    }
  });

  test('a person with one Labels permission gets that tab and no tab strip', async ({
    asUser,
    personas,
  }) => {
    const onlyPriorities = await personas.create({
      permissions: ['Priority.Manage'],
      label: 'ad3-pr',
    });
    const priorities = await asUser(onlyPriorities.username);
    await priorities.goto('/admin/status-labels');
    await expect(priorities).toHaveURL(/\/admin\/priorities$/);
    await expect(priorities.getByRole('tab')).toHaveCount(0);
    await expect(priorities.locator('table.mf-grid tbody tr[data-row]').first()).toBeVisible();
    await expect(priorities.locator('[data-failure], [role="alert"]')).toHaveCount(0);

    const onlyStatuses = await personas.create({
      permissions: ['StatusLabel.Manage'],
      label: 'ad3-sl',
    });
    const statuses = await asUser(onlyStatuses.username);
    await statuses.goto('/admin/priorities');
    await expect(statuses).toHaveURL(/\/admin\/status-labels$/);
    await expect(statuses.getByRole('tab')).toHaveCount(0);
    await expect(statuses.locator('[data-page-description]')).toHaveText(
      "Rename how the five statuses read. You can't add or remove statuses.",
    );
    // Task.View only: the 403 page, not a half page.
    const viewer = await personas.create({ permissions: ['Task.View'], label: 'ad3-tv' });
    const denied = await asUser(viewer.username);
    await denied.goto('/admin/priorities');
    await expect(
      denied.getByRole('heading', { name: "You don't have permission to view this." }),
    ).toBeVisible();
  });

  for (const size of SIZES) {
    test(`${size.width}: axe 0 and no sideways scroll on both tabs`, async ({ page }) => {
      test.skip(!axeAvailable(), 'axe-core is not available');
      await page.setViewportSize(size);
      for (const [url, name] of [
        ['/admin/priorities', 'priorities'],
        ['/admin/status-labels', 'status-labels'],
      ] as const) {
        await page.goto(url);
        await expect(page.locator('tbody tr[data-row], li.rc').first()).toBeVisible();
        await noSideScroll(page, `${url} at ${size.width}`);
        expect(await axeViolations(page), `${url} at ${size.width}`).toEqual([]);
        await shot(page, `labels-shell-${name}`);
      }
    });
  }
});
