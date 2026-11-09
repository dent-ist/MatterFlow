import { Api } from '../support/api';
import { expect, test } from '../support/fixtures';
import { toasts } from '../support/toasts';

/**
 * Issue #976 (owner decision 2026-11-07, not a Reports change): the Director role holds Matter.BeManager, so a Director opens My Matters (the
 * menu item and the route need Matter.BeManager, Matter.View and Task.View) and can be named as a matter's project manager. A Director who
 * manages no matter sees the shared empty block, not an empty grid and not an error.
 */
test.describe('The Director and My Matters (#976)', () => {
  test.setTimeout(180_000);

  test('the menu offers My Matters, the route opens, and with no matter managed it shows the empty state', async ({
    personas,
    asUser,
  }) => {
    const director = await personas.create({ label: 'ud-director', roles: ['Director'] });
    const page = await asUser(director.username);
    const refused: string[] = [];
    page.on('response', (r) => {
      if (r.url().includes('/api/v1/') && r.status() >= 400)
        refused.push(`${r.status()} ${r.url()}`);
    });

    // The Director's role default is the Dashboard (epic #1330); My Matters is one click away in the menu.
    await page.goto('/');
    await expect(page).toHaveURL(/\/dashboard/);
    await page.goto('/my-matters');
    await expect(page).toHaveURL(/\/my-matters/);
    const nav = page.getByRole('navigation').first();
    await expect(nav.getByRole('link', { name: 'My Matters' })).toHaveCount(1);
    await expect(page.getByRole('heading', { name: 'My Matters', level: 1 })).toBeVisible();
    await expect(
      page.getByRole('heading', { name: "You don't have access.", level: 1 }),
    ).toHaveCount(0);

    // An honest empty state (the shared block, D-51): the list sentence and one way on, no grid, no error banner, no toast.
    const empty = page.locator('[data-no-matters]');
    await expect(empty).toContainText('You do not manage any matter yet.');
    await expect(empty.locator('[data-state-block="empty"]')).toBeVisible();
    await expect(page.locator('[data-page-error]')).toHaveCount(0);
    await expect(page.locator('mf-mm-task-list')).toHaveCount(0);
    expect(await toasts(page).count()).toBe(0);

    // The way on leads to the Matters list, and the Dashboard stays in the menu.
    await expect(nav.getByRole('link', { name: 'Dashboard' })).toHaveCount(1);
    await empty.locator('[data-go-matters]').click();
    await expect(page).toHaveURL(/\/matters/);
    await expect(page.getByRole('heading', { name: 'Matters', level: 1 })).toBeVisible();

    // The route opens from the menu as well (the main menu: the Matters list now has a pager, which is a navigation landmark too).
    await page
      .getByRole('navigation', { name: 'Main' })
      .getByRole('link', { name: 'My Matters' })
      .click();
    await expect(page).toHaveURL(/\/my-matters/);
    expect(refused, 'refused requests').toEqual([]);
  });

  test('a Director is offered in the project manager lookup, and My Matters answers the Director (scope=all too)', async ({
    personas,
    seed,
  }) => {
    const name = `UD Director ${Date.now()}`;
    const director = await personas.create({
      label: 'ud-director-pick',
      roles: ['Director'],
      displayName: name,
    });
    const found = await seed.admin.get<{ userId: number }[]>(
      `/api/v1/users/matter-managers?q=${encodeURIComponent(name)}`,
    );
    expect(found.map((u) => u.userId)).toContain(director.userId);

    const api = await Api.as(director.username);
    try {
      expect((await api.raw('GET', '/api/v1/my-matters/summary')).status).toBe(200);
      expect((await api.raw('GET', '/api/v1/my-matters/summary?scope=all')).status).toBe(200);
    } finally {
      await api.dispose();
    }
  });
});
