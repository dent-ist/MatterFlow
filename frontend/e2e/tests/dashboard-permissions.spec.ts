import { expect, test } from '../support/fixtures';

/**
 * "The Dashboard is not for everyone": Dashboard.View opens it, every tab has its own permission, the server redacts what a person may not see,
 * the menu item and the route follow Dashboard.View, and the role editor keeps the dependency between them.
 */
test.describe('Dashboard permissions', () => {
  test('without Dashboard.View the menu item is hidden, the route is a 403 and the landing page is My Work', async ({
    seed,
    asUser,
  }) => {
    const role = await seed.role(
      ['Task.View', 'Matter.View', 'Dashboard.ViewSummary'],
      'E2E no dash',
    );
    const user = await seed.user([role.name], 'nodash');
    const page = await asUser(user.username);

    await page.goto('/');
    await expect(page).toHaveURL(/\/(my-work|tasks)/);
    await expect(page.getByRole('navigation').getByRole('link', { name: 'Dashboard' })).toHaveCount(
      0,
    );

    // A tab permission without Dashboard.View has no effect, in the UI or on the server.
    await page.goto('/dashboard');
    await expect(
      page.getByRole('heading', { name: "You don't have permission to view this." }),
    ).toBeVisible();
    expect((await page.request.get('/api/v1/dashboard')).status()).toBe(403);
  });

  test('only the permitted tabs show, a link to another tab falls back to the first, and the server redacts the rest', async ({
    seed,
    asUser,
  }) => {
    const role = await seed.role(
      ['Task.View', 'Dashboard.View', 'Dashboard.ViewTrends', 'Dashboard.ViewBreakdowns'],
      'E2E dash trends',
    );
    const user = await seed.user([role.name], 'dashtrends');
    const page = await asUser(user.username);

    await page.goto('/dashboard?tab=swimlane');
    await expect(
      page.getByRole('navigation').getByRole('link', { name: 'Dashboard' }),
    ).toBeVisible();
    await expect(page.getByRole('tab')).toHaveText(['Breakdowns', 'Trends']);
    await expect(page).toHaveURL(/tab=breakdowns/);
    await expect(page.getByRole('tab', { name: 'Breakdowns' })).toHaveAttribute(
      'aria-selected',
      'true',
    );

    // Server side: no Summary permission means no headline counts and no swimlane or workload.
    const body = await (await page.request.get('/api/v1/dashboard')).json();
    expect(body.open.count).toBe(0);
    expect(body.created.count).toBe(0);
    expect(body.byStatus.length).toBe(3);
    // The trend is its own endpoint (Dashboard.ViewTrends), not part of the summary payload.
    expect(body.trend).toBeUndefined();
    const trend = await (await page.request.get('/api/v1/dashboard/trend')).json();
    expect(trend.all.length).toBe(30);
    expect((await page.request.get('/api/v1/dashboard/swimlane')).status()).toBe(403);
    expect((await page.request.get('/api/v1/dashboard/workload')).status()).toBe(403);
  });

  test('a person who only has Summary gets the counts but no charts or trend', async ({
    seed,
    asUser,
  }) => {
    const role = await seed.role(
      ['Task.View', 'Dashboard.View', 'Dashboard.ViewSummary'],
      'E2E dash summary',
    );
    const user = await seed.user([role.name], 'dashsummary');
    const world = await seed.world();
    await seed.task(world, { title: 'Dash summary task' });
    const page = await asUser(user.username);

    await page.goto('/dashboard');
    await expect(page.getByRole('tab')).toHaveText(['Summary']);
    const body = await (await page.request.get('/api/v1/dashboard?fresh=true')).json();
    expect(body.open.count).toBeGreaterThan(0);
    expect(body.byStatus).toEqual([]);
    expect(body.byPriority).toEqual([]);
    expect(body.aging).toEqual([]);
    expect(body.trend).toBeUndefined();
    expect((await page.request.get('/api/v1/dashboard/trend')).status()).toBe(403);
  });

  test('the role editor has a Dashboard section: a tab permission selects Dashboard.View, clearing View clears the tabs with a note', async ({
    page,
    seed,
  }) => {
    const role = await seed.role(['Task.View'], 'E2E dash editor');
    await page.goto('/admin/roles');
    await page.locator('button.mf-role', { hasText: role.name }).click();
    const group = page.locator('[data-group="Dashboard"]');
    await expect(group.locator('legend')).toHaveText('Dashboard');
    await expect(group.locator('[data-perm]')).toHaveCount(6);

    await group.locator('[data-perm="Dashboard.ViewSwimlane"]').check();
    await expect(group.locator('[data-perm="Dashboard.View"]')).toBeChecked();
    await expect(page.locator('[data-note]')).toContainText('Dashboard.View was also selected');

    await group.locator('[data-perm="Dashboard.ViewUsers"]').check();
    await group.locator('[data-perm="Dashboard.View"]').uncheck();
    await expect(group.locator('[data-perm="Dashboard.ViewSwimlane"]')).not.toBeChecked();
    await expect(group.locator('[data-perm="Dashboard.ViewUsers"]')).not.toBeChecked();
    await expect(page.locator('[data-note]')).toContainText(
      'were also cleared because they need Dashboard.View',
    );
  });

  for (const [width, height] of [
    [1366, 768],
    [1024, 768],
    [375, 812],
  ]) {
    test(`the role editor form lines up at ${width}x${height}`, async ({ page, seed }) => {
      const role = await seed.role(['Task.View'], `E2E align ${width}`);
      await page.setViewportSize({ width, height });
      await page.goto('/admin/roles');
      await page.locator('button.mf-role', { hasText: role.name }).click();
      const box = async (sel: string) => (await page.locator(sel).boundingBox())!;
      const name = await box('#role-name');
      const description = await box('#role-description');
      const search = await box('#role-permission-search');
      const copy = await box('#role-copy');

      // One column: the same left edge, the same width, the same control height, never wider than the 640 px form card.
      expect(Math.abs(name.x - description.x)).toBeLessThan(1);
      expect(Math.abs(name.width - description.width)).toBeLessThan(1);
      expect(Math.abs(name.x - search.x)).toBeLessThan(1);
      expect(name.width).toBeLessThanOrEqual(640);
      for (const b of [name, description, search, copy])
        expect(Math.abs(b.height - name.height)).toBeLessThan(1);
      // Search and Copy from role share a row when there is room, and the row fits inside the name field's column.
      if (width > 640) {
        expect(Math.abs(search.y - copy.y)).toBeLessThan(1);
        expect(copy.x + copy.width).toBeLessThanOrEqual(name.x + name.width + 1);
      } else {
        expect(Math.abs(search.x - copy.x)).toBeLessThan(1);
        expect(Math.abs(search.width - copy.width)).toBeLessThan(1);
      }
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
        ),
      ).toBe(true);
    });
  }
});
