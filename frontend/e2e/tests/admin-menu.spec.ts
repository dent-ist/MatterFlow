import { expect, test } from '../support/fixtures';

test.describe('Administration menu and tabbed admin pages', () => {
  test('the menu is one flat list in the agreed order with the agreed names', async ({ page }) => {
    await page.goto('/dashboard');
    const items = page.getByRole('list', { name: 'Administration' }).getByRole('link');
    await expect(items).toHaveCount(8); // the menu renders once the permissions are loaded
    const names = (await items.allTextContents()).map((t) => t.replace(/\d+$/, '').trim());
    expect(names).toEqual([
      'Users',
      'Pods',
      'Task Types & Forms',
      'Workflows',
      'Labels',
      'Assets',
      'Custom Fields',
      'Audit Logs',
    ]);
  });

  test('Users and Roles are tabs of one page; both addresses work and follow the tab', async ({
    page,
  }) => {
    await page.goto('/admin/roles');
    await expect(page.getByRole('heading', { name: 'Users', level: 1 })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Roles' })).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByRole('button', { name: 'New role' })).toBeVisible();

    await page.getByRole('tab', { name: 'Roles' }).press('ArrowLeft');
    await expect(page).toHaveURL(/\/admin\/users$/);
    await expect(page.getByRole('tab', { name: 'Users' })).toBeFocused();
    await expect(page.getByRole('searchbox', { name: 'Search users' })).toBeVisible();
    // The status filter replaces the old tab strip and is remembered in the address.
    await page.getByLabel('Status').selectOption('all');
    await expect(page).toHaveURL(/status=all/);
  });

  test('Asset Types and Asset Link Roles are tabs; the old link roles address redirects', async ({
    page,
  }) => {
    await page.goto('/admin/asset-link-roles');
    await expect(page).toHaveURL(/\/admin\/asset-types\?tab=link-roles$/);
    await expect(
      page.getByRole('heading', { name: 'Asset Types & Link Roles', level: 1 }),
    ).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Asset Link Roles' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await page.getByRole('tab', { name: 'Asset Types' }).click();
    await expect(page.getByRole('button', { name: 'New asset type' })).toBeVisible();
  });

  test('the search box and the status filter line up on the Pods list', async ({ page }) => {
    await page.goto('/admin/pods');
    const search = await page.getByRole('searchbox', { name: 'Search' }).last().boundingBox();
    const status = await page.getByLabel('Status').boundingBox();
    expect(Math.abs(search!.y - status!.y)).toBeLessThan(1);
  });
});
