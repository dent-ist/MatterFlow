import { Page } from '@playwright/test';
import { expect, test } from '../support/fixtures';
import { openRowMenu } from '../support/labels';
import { uid } from '../support/seed';

/**
 * WP-AD8 #657 (AD-E): one focus rule, applied by test across Priorities, Status labels, Link roles and Asset Types. Opening a dialog moves focus
 * into it; closing or saving returns it to the row's menu button (or the name link, or the New button that opened it); a failed submit focuses the
 * first invalid field; Move up and Move down keep focus on the menu button and announce the position; success is announced once. Measured with
 * `document.activeElement`: after no action does focus rest on the body. No keyboard shortcut is involved.
 */
async function notOnBody(page: Page, what: string): Promise<void> {
  const onBody = await page.evaluate(
    () => document.activeElement === document.body || document.activeElement === null,
  );
  expect(onBody, `${what}: focus must not rest on the body`).toBe(false);
}

const dialog = (page: Page, name: string | RegExp) => page.getByRole('dialog', { name });
const menu = (page: Page, name: string) =>
  page.getByRole('button', { name: `Actions for ${name}`, exact: true });
const leave = (page: Page) => page.getByRole('dialog', { name: 'Leave without saving?' });

test.describe('Focus rules: Priorities (#657)', () => {
  test('New priority: focus goes in, a failed submit focuses the first invalid field, Escape returns to the New button', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1366, height: 768 });
    await page.goto('/admin/priorities');
    const opener = page.getByRole('button', { name: 'New priority' });
    await opener.click();
    const field = page.locator('#priority-label');
    await expect(field).toBeFocused();
    await dialog(page, 'New priority').getByRole('button', { name: 'Add priority' }).click();
    await expect(field).toHaveAttribute('aria-invalid', 'true');
    await expect(field).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(dialog(page, 'New priority')).toBeHidden();
    await expect(opener).toBeFocused();
    await notOnBody(page, 'priority dialog closed');
  });

  test('Move down announces the position and keeps focus on the row menu; Deactivate and Cancel return to the menu button', async ({
    page,
    admin,
  }) => {
    const a = await admin.post('/api/v1/priorities', {
      label: `Focus A ${uid()}`,
      color: 'low',
      isActive: true,
    });
    await admin.post('/api/v1/priorities', {
      label: `Focus B ${uid()}`,
      color: 'low',
      isActive: true,
    });
    await page.setViewportSize({ width: 1366, height: 768 });
    await page.goto('/admin/priorities');
    await openRowMenu(page, menu(page, a.label));
    await page.getByRole('menuitem', { name: 'Move down' }).click();
    await expect(page.locator('[data-announce]')).toContainText(`${a.label} moved to position`);
    await expect(menu(page, a.label)).toBeFocused();

    await openRowMenu(page, menu(page, a.label));
    await page.getByRole('menuitem', { name: 'Deactivate' }).click();
    await expect(dialog(page, 'Deactivate priority?')).toBeVisible();
    await dialog(page, 'Deactivate priority?').getByRole('button', { name: 'Keep active' }).click();
    await expect(menu(page, a.label)).toBeFocused();

    await openRowMenu(page, menu(page, a.label));
    await page.getByRole('menuitem', { name: 'Deactivate' }).click();
    await dialog(page, 'Deactivate priority?')
      .getByRole('button', { name: 'Deactivate priority' })
      .click();
    await expect(page.locator(`tr[data-row="${a.label}"]`)).toContainText('Inactive');
    await expect(menu(page, a.label)).toBeFocused();
    await notOnBody(page, 'priority deactivated');
    await admin.raw('DELETE', `/api/v1/priorities/${a.id}`);
  });
});

test.describe('Focus rules: Status labels (#657)', () => {
  test('Rename: the name link opens the dialog, an empty name focuses the field, Escape with edits asks and Leave returns to the link', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1366, height: 768 });
    await page.goto('/admin/status-labels');
    const link = page.locator('tr[data-row="NEW"] [data-edit]');
    await link.click();
    const rename = dialog(page, 'Rename status label');
    const field = page.locator('#status-label-name');
    await expect(field).toBeFocused();
    await field.fill('');
    await rename.getByRole('button', { name: 'Save name' }).click();
    await expect(field).toHaveAttribute('aria-invalid', 'true');
    await expect(field).toBeFocused();
    await field.fill('Fresh');
    await page.keyboard.press('Escape');
    await expect(leave(page)).toBeVisible();
    await leave(page).getByRole('button', { name: 'Leave' }).click();
    await expect(rename).toBeHidden();
    await expect(link).toBeFocused();
    await notOnBody(page, 'status label rename cancelled');
  });
});

test.describe('Focus rules: Link roles (#657)', () => {
  test('New link role and the row menu follow the same rule', async ({ page, admin }) => {
    const name = `Focus ${uid()}`;
    await admin.post('/api/v1/asset-link-roles', { name, isActive: true });
    await page.setViewportSize({ width: 1366, height: 768 });
    await page.goto('/admin/asset-types?tab=link-roles');
    const opener = page.getByRole('button', { name: 'New link role' });
    await opener.click();
    const field = page.locator('#link-role-name');
    await expect(field).toBeFocused();
    await dialog(page, 'New link role').getByRole('button', { name: 'Add link role' }).click();
    await expect(field).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(opener).toBeFocused();

    await openRowMenu(page, menu(page, name));
    await page.getByRole('menuitem', { name: 'Move up' }).click();
    await expect(page.locator('[data-announce]')).toContainText(`${name} moved to position`);
    await expect(menu(page, name)).toBeFocused();

    await openRowMenu(page, menu(page, name));
    await page.getByRole('menuitem', { name: 'Deactivate' }).click();
    await dialog(page, 'Deactivate link role?')
      .getByRole('button', { name: 'Keep active' })
      .click();
    await expect(menu(page, name)).toBeFocused();
    await notOnBody(page, 'link role dialogs');
  });
});

test.describe('Focus rules: Asset Types (#657)', () => {
  test('Move up and the Deactivate dialog return to the row menu; the record page returns to the row link; a failed save focuses the first invalid field', async ({
    page,
    admin,
  }) => {
    const name = `Focus Type ${uid()}`;
    const type = await admin.post('/api/v1/asset-types', { name, description: null });
    await admin.post('/api/v1/asset-types', { name: `${name} 2`, description: null });
    await page.setViewportSize({ width: 1366, height: 768 });
    await page.goto(`/admin/asset-types?name=${encodeURIComponent(name)}`);
    await expect(page.locator(`tr[data-row="${name}"]`)).toBeVisible();

    await openRowMenu(page, menu(page, `${name} 2`));
    await page.getByRole('menuitem', { name: 'Move up' }).click();
    await expect(page.locator('[data-announce]')).toContainText('moved to position');
    await expect(menu(page, `${name} 2`)).toBeFocused();

    await openRowMenu(page, menu(page, name));
    await page.getByRole('menuitem', { name: 'Deactivate' }).click();
    await dialog(page, 'Deactivate asset type?')
      .getByRole('button', { name: 'Keep active' })
      .click();
    await expect(menu(page, name)).toBeFocused();

    const link = page.locator(`tr[data-row="${name}"] [data-open]`);
    await link.click();
    await expect(page).toHaveURL(new RegExp(`/admin/asset-types/${type.assetTypeId}$`));
    await page.goBack();
    await expect(link).toBeFocused();

    await page.goto('/admin/asset-types/new');
    const nameField = page.getByLabel('Name', { exact: false }).first();
    await page.getByRole('button', { name: 'Create asset type' }).click();
    await expect(nameField).toHaveAttribute('aria-invalid', 'true');
    await expect(nameField).toBeFocused();
    await notOnBody(page, 'asset type record, failed save');
  });
});
