import { expect, test } from '../support/fixtures';

test.describe('Administration menu and tabbed admin pages', () => {
  test('the menu is one flat list in the agreed order with the agreed names', async ({ page }) => {
    await page.goto('/dashboard');
    const items = page.getByRole('list', { name: 'Administration' }).getByRole('link');
    await expect(items).toHaveCount(6); // the menu renders once the permissions are loaded
    const names = (await items.allTextContents()).map((t) => t.replace(/\d+$/, '').trim());
    expect(names).toEqual([
      'Users',
      'Task Types',
      'Labels',
      'Asset Types',
      'Custom Fields',
      'Audit Logs',
    ]);
  });

  test('Users, Roles and Pods are tabs of one page; the addresses work and follow the tab', async ({
    page,
  }) => {
    await page.goto('/admin/roles');
    await expect(page.getByRole('heading', { name: 'Users', level: 1 })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Roles' })).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByRole('button', { name: 'New role' })).toBeVisible();

    await page.getByRole('tab', { name: 'Roles' }).press('ArrowLeft');
    await expect(page).toHaveURL(/\/admin\/users(\?status=\w+)?$/); // the Users tab writes its status segment into the address (#429)
    await expect(page.getByRole('tab', { name: 'Users' })).toBeFocused();
    await expect(page.getByRole('button', { name: /^Filters/ })).toBeVisible();
    await expect(page.getByRole('searchbox')).toHaveCount(0);
    // The status is the segment above the grid (#429): it is remembered in the address.
    await page.locator('[data-strip-item="all"]').click();
    await expect(page).toHaveURL(/status=all/);
  });

  test('Asset Types and Link Roles are counted tabs; the old link roles address redirects', async ({
    page,
  }) => {
    await page.goto('/admin/asset-link-roles');
    await expect(page).toHaveURL(/\/admin\/asset-types\?tab=link-roles$/);
    await expect(page.getByRole('heading', { name: 'Asset Types', level: 1 })).toBeVisible();
    await expect(page.getByRole('tab', { name: /^Link Roles/ })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await page.getByRole('tab', { name: /^Asset Types/ }).click();
    await expect(page.getByRole('button', { name: 'New asset type' })).toBeVisible();
  });

  test('the Name and Status filters line up in the filter row of the Pods tab', async ({
    page,
  }) => {
    await page.goto('/admin/pods');
    await expect(page.getByRole('tab', { name: 'Pods' })).toHaveAttribute('aria-selected', 'true');
    // The filter row is open by default (#450).
    const name = await page.getByRole('textbox', { name: 'Filter by Name' }).boundingBox();
    const status = await page.getByRole('combobox', { name: 'Filter by Status' }).boundingBox();
    expect(Math.abs(name!.y - status!.y)).toBeLessThan(1);
  });
});
