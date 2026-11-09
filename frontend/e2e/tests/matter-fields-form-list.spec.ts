import { axeAvailable, axeViolations } from '../support/axe';
import { expect, test } from '../support/fixtures';
import { SIZES } from '../support/labels';
import { uid } from '../support/seed';

/**
 * Epic #1298 / #1301: the Edit Matter dialog (Matter Type, Current State, DMS and DFS paths with their messages; saving never clears them), the Matters list
 * columns and filters (off by default, Not Set), and the Administration > Matter Lists page.
 */
test.describe('Matter fields: dialog, list and Matter Lists (#1301)', () => {
  test('Edit Matter: path messages by field code, then a saved matter keeps its type, state and paths on the next edit', async ({
    page,
    seed,
  }) => {
    const token = uid();
    const admin = seed.admin;
    const type = await admin.post('/api/v1/matter-types', {
      name: `Type ${token}`,
      isActive: true,
    });
    const state = await admin.post('/api/v1/current-states', {
      name: `State ${token}`,
      isActive: true,
    });
    const client = await seed.client({ name: `Form Client ${token}` });
    const matter = await seed.matter({ client, number: '00001', name: `Form Matter ${token}` });
    await page.setViewportSize(SIZES[1]);
    await page.goto(`/matters/${matter.matterId}`);
    await page.getByRole('button', { name: 'Edit' }).first().click();
    const dialog = page.locator('.mf-formdlg');
    await expect(dialog.locator('[data-panel-title]')).toContainText('Edit Matter'); // the title carries the CM Number as its subtitle
    await expect(dialog.locator('#matter-type')).toContainText('Not Set');

    await dialog.locator('#matter-dms-path').fill('C:\\Matters\\1234');
    await dialog.locator('#matter-dms-path').blur();
    await expect(dialog).toContainText('Drive-letter paths such as C:\\ are not accepted.');
    await dialog.locator('#matter-dfs-path').fill('https://user:pw@host/x');
    await dialog.locator('#matter-dfs-path').blur();
    await expect(dialog).toContainText('Remove the user name and password from the web address.');
    await dialog.getByRole('button', { name: 'Save Changes' }).click();
    await expect(dialog.locator('[data-summary]')).toContainText('Fix the following to save:');

    await dialog.locator('#matter-dms-path').fill('\\\\fs01\\dms\\Matters\\1234');
    await dialog.locator('#matter-dfs-path').fill('https://dfs.example.com/m/1234');
    await dialog.locator('#matter-type').click();
    await page.getByRole('option', { name: `Type ${token}` }).click();
    await dialog.locator('#matter-state').click();
    await page.getByRole('option', { name: `State ${token}` }).click();
    if (axeAvailable()) expect(await axeViolations(page), 'Edit Matter dialog').toEqual([]);
    await dialog.getByRole('button', { name: 'Save Changes' }).click();
    await expect(page.locator('[data-summary-details] [data-matter-type]')).toHaveText(
      `Type ${token}`,
    );

    // A second edit that touches only the name must not clear the four fields (the API takes them as full values).
    await page.getByRole('button', { name: 'Edit' }).first().click();
    await dialog.locator('#matter-name').fill(`Form Matter ${token} renamed`);
    await dialog.getByRole('button', { name: 'Save Changes' }).click();
    const saved = await admin.get(`/api/v1/matters/${matter.matterId}`);
    expect(saved.matterType.id).toBe(type.id);
    expect(saved.currentState.id).toBe(state.id);
    expect(saved.dmsPath).toBe('\\\\fs01\\dms\\Matters\\1234');
    expect(saved.dfsPath).toBe('https://dfs.example.com/m/1234');
  });

  test('Matters list: the two columns are on by default (Primary PM, Open Tasks, Overdue off), and Not Set filters', async ({
    page,
    seed,
  }) => {
    const token = uid();
    const admin = seed.admin;
    const type = await admin.post('/api/v1/matter-types', {
      name: `Type ${token}`,
      isActive: true,
    });
    const client = await seed.client({ name: `List Client ${token}` });
    const typed = await seed.matter({ client, number: '00001', name: `Typed ${token}` });
    await seed.matter({ client, number: '00002', name: `Untyped ${token}` });
    const fresh = await admin.get(`/api/v1/matters/${typed.matterId}`);
    await admin.put(`/api/v1/matters/${typed.matterId}`, {
      name: fresh.name,
      isSensitive: false,
      rowVersion: fresh.rowVersion,
      matterTypeId: type.id,
    });
    await page.setViewportSize(SIZES[1]);
    await page.goto(`/matters?name=${token}`);
    const heads = page.locator('thead th');
    // Owner decision 2026-11-08 (spec 6.1): Matter Type and Current State on by default; the PM and count columns off.
    await expect(heads.filter({ hasText: 'Matter Type' })).toHaveCount(1);
    await expect(heads.filter({ hasText: 'Current State' })).toHaveCount(1);
    await expect(heads.filter({ hasText: 'Primary PM' })).toHaveCount(0);
    await expect(heads.filter({ hasText: 'Open Tasks' })).toHaveCount(0);
    await expect(heads.filter({ hasText: 'Overdue' })).toHaveCount(0);

    await page.goto(`/matters?name=${token}&matterTypeNone=true`);
    await expect(page.locator('tbody tr', { hasText: `Untyped ${token}` })).toHaveCount(1);
    // Case-sensitive: "Untyped" contains "typed" (hasText with a string ignores case).
    await expect(
      page.locator('tbody tr', { hasText: new RegExp(`\\bTyped ${token}`) }),
    ).toHaveCount(0);
    await page.goto(`/matters?name=${encodeURIComponent(`Type ${token}`)}`);
    await expect(page.locator('tbody tr', { hasText: `Typed ${token}` })).toHaveCount(1);
  });

  test('Matter group of Lists: three lists, add, rename, deactivate, delete an unused item', async ({
    page,
    seed,
  }) => {
    const token = uid();
    await page.setViewportSize(SIZES[1]);
    await page.goto('/admin/matter-types');
    await expect(page).toHaveURL(/\/admin\/lists\/matter-types$/);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Lists');
    await expect(
      page.getByRole('option').filter({ hasText: /Matter Types|Current States|Team Titles/ }),
    ).toHaveCount(3);
    await page.getByRole('button', { name: 'New Matter Type' }).click();
    await page.locator('#matter-list-name').fill(`Antitrust ${token}`);
    await page.getByRole('button', { name: 'Add Matter Type' }).click();
    await expect(page.getByText('Matter type added')).toBeVisible();
    const row = page.locator('tbody tr', { hasText: `Antitrust ${token}` });
    await expect(row).toHaveCount(1);
    await row.locator('[data-overflow]').click();
    await expect(page.getByRole('menuitem', { name: 'Delete' })).toBeVisible();
    await page.getByRole('menuitem', { name: 'Deactivate' }).click();
    await page.getByRole('button', { name: 'Deactivate Matter Type' }).click();
    await expect(page.getByText('Matter type deactivated')).toBeVisible();
    await expect(row).toContainText('Inactive'); // the list has reloaded; a menu opened earlier is closed by the re-render
    await row.locator('[data-overflow]').click();
    await page.getByRole('menuitem', { name: 'Delete' }).click();
    await page.getByRole('button', { name: 'Delete Matter Type' }).click();
    await expect(page.getByText('Matter type deleted')).toBeVisible();
    await expect(row).toHaveCount(0);
    for (const [url, name] of [
      ['/admin/current-states', 'Current States'],
      ['/admin/team-titles', 'Team Titles'],
    ]) {
      await page.goto(url);
      await expect(page.getByRole('heading', { level: 1 })).toHaveText('Lists');
      await expect(page.getByRole('heading', { level: 2 })).toHaveText(name);
    }
    if (axeAvailable()) expect(await axeViolations(page), 'Lists').toEqual([]);
    void seed;
  });
});
