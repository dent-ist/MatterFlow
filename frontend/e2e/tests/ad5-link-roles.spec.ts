import { Page } from '@playwright/test';
import { axeAvailable, axeViolations } from '../support/axe';
import { expect, test } from '../support/fixtures';
import { SIZES, noHorizontalScroll, shot } from '../support/screens';
import { uid } from '../support/seed';
import { openRowMenu } from '../support/labels';
import { toasts } from '../support/toasts';

/**
 * WP-AD5 (AD-E): the Link Roles tab on the same chrome as Asset Types. New link role and Rename in the lookup dialog (#640), the Links column and
 * Delete only for an unused role (#641), the one-line description, the clamped name and the counter (#642). Screenshots go to E2E_SCREENSHOTS
 * (docs/ux/admin-pages-review/fixes/ad5-link-roles). The axe checks FAIL when axe-core is missing (set E2E_AXE_PATH to axe.min.js).
 */
const TAB_URL = '/admin/asset-types?tab=link-roles';
const dialog = (page: Page) => page.getByRole('dialog', { name: /link role/i });
const field = (page: Page) => page.locator('#link-role-name');
const ask = (page: Page) => page.getByRole('dialog', { name: 'Leave without saving?' });
const menu = (page: Page, name: string) =>
  page.getByRole('button', { name: `Actions for ${name}`, exact: true });
const row = (page: Page, name: string) => page.locator(`tr[data-row="${name}"]`);

function requireAxe(): void {
  expect(axeAvailable(), 'axe-core is required: set E2E_AXE_PATH to the path of axe.min.js').toBe(
    true,
  );
}

test.describe('Link Roles tab chrome and list (#640)', () => {
  test('the header names the tab: crumb, title, counted tabs, New link role, one-line description', async ({
    page,
    admin,
  }) => {
    await page.setViewportSize({ width: 1366, height: 768 });
    await page.goto(TAB_URL);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Asset Types');
    await expect(page).toHaveTitle('Asset Types - Link Roles - MatterFlow');
    await expect(page.getByRole('navigation', { name: 'Breadcrumb' }).locator('li')).toHaveText([
      /Administration/,
      /Asset Types/,
    ]);
    const active = (await admin.get('/api/v1/asset-link-roles')).filter(
      (r: { isActive: boolean }) => r.isActive,
    ).length;
    await expect(page.getByRole('tab', { name: /^Link Roles/ })).toHaveAccessibleName(
      `Link Roles, ${active} active`,
    );
    const header = page.locator('mf-page-header');
    await expect(header.getByRole('button', { name: 'New link role' })).toBeVisible();
    await expect(header.getByRole('button', { name: 'New asset type' })).toHaveCount(0);
    const description = page.locator('[data-page-description]');
    await expect(description).toHaveText(
      'The roles an asset can have on a task, such as Source, Destination or Result.',
    );
    expect(
      await description.evaluate((el) => (el as HTMLElement).scrollWidth <= el.clientWidth),
    ).toBe(true);
    // No Add form under the table and no paragraph of hints.
    await expect(page.getByRole('heading', { name: 'Add asset link role' })).toHaveCount(0);
    await shot(page, 'link-roles-list');
  });

  test('rows are 44 px with the columns Order, Name, Links, Status and one menu; Order leaves at 768; cards below 640', async ({
    page,
    admin,
  }) => {
    // 50 characters at most; the API trims a name, so the cut must not end in a space (where it falls depends on the length of the token).
    const name = `Wide ${uid()} ${'wide name '.repeat(8)}`.slice(0, 50).trim();
    await admin.post('/api/v1/asset-link-roles', { name, isActive: true });
    await page.setViewportSize({ width: 1366, height: 768 });
    await page.goto(TAB_URL);
    await expect(row(page, name)).toBeVisible();
    await expect(page.locator('[data-roles] thead th')).toHaveText([
      'Order',
      'Name',
      'Links',
      'Status',
      'Actions',
    ]);
    // This test's own rows only: on a database that has already run the suite the table also holds the roles of other specs, whose names and
    // states this test does not control (a row being renamed or deleted by an earlier run, a name that is longer than it was meant to be).
    const shortName = `Short ${uid()}`;
    await admin.post('/api/v1/asset-link-roles', { name: shortName, isActive: true });
    await page.reload();
    await expect(row(page, shortName)).toBeVisible();
    for (const r of [row(page, name), row(page, shortName)]) {
      await expect(r).toHaveCount(1);
      expect((await r.boundingBox())!.height).toBeLessThanOrEqual(45);
      await expect(r.getByRole('button')).toHaveCount(1); // the overflow menu is the only control
    }
    await expect(row(page, name).locator('.mf-name')).toHaveAttribute('title', name);

    await page.setViewportSize({ width: 700, height: 1024 });
    await expect(page.locator('[data-roles] thead th:visible')).toHaveText([
      'Name',
      'Links',
      'Status',
      'Actions',
    ]);
    await noHorizontalScroll(page);

    await page.setViewportSize({ width: 375, height: 812 });
    await expect(page.locator('[data-roles]')).toHaveCount(0);
    const card = page.locator('li.rc', { hasText: name });
    await expect(card).toBeVisible();
    expect((await card.boundingBox())!.height).toBeLessThan(130); // the 50-character name is two lines at most
    await noHorizontalScroll(page);
    await shot(page, 'link-roles-long-name');
  });

  test('"Skip to table" is the first Tab stop and moves focus to the table', async ({ page }) => {
    await page.goto(TAB_URL);
    await expect(page.locator('[data-roles] tbody tr[data-row]').first()).toBeVisible();
    await page.keyboard.press('Tab');
    await expect(page.getByRole('link', { name: 'Skip to table' })).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.locator('#link-roles-table')).toBeFocused();
  });
});

test.describe('New link role and Rename (#640, #642)', () => {
  test('New link role: a counter of 50, an empty name is explained and focused, a duplicate is explained with the field, then it is added', async ({
    page,
    admin,
  }) => {
    const taken = `Taken ${uid()}`;
    await admin.post('/api/v1/asset-link-roles', { name: taken, isActive: true });
    await page.setViewportSize({ width: 1366, height: 768 });
    await page.goto(TAB_URL);
    const opener = page.getByRole('button', { name: 'New link role' });
    await opener.click();
    await expect(dialog(page)).toBeVisible();
    await expect(field(page)).toBeFocused();
    await expect(dialog(page)).toContainText('0 / 50');

    await dialog(page).getByRole('button', { name: 'Add link role' }).click();
    await expect(dialog(page).getByRole('alert').first()).toContainText('Enter a name.');
    await expect(field(page)).toHaveAttribute('aria-invalid', 'true');
    await expect(field(page)).toBeFocused();

    await field(page).fill(taken.toLowerCase());
    await dialog(page).getByRole('button', { name: 'Add link role' }).click();
    await expect(dialog(page)).toContainText(`A link role named '${taken.toLowerCase()}' exists.`);
    await expect(field(page)).toBeFocused();
    await shot(page, 'link-roles-duplicate');

    const name = `Evidence ${uid()}`;
    await field(page).fill(name);
    await expect(dialog(page)).toContainText(`${name.length} / 50`);
    await dialog(page).getByRole('button', { name: 'Add link role' }).click();
    await expect(dialog(page)).toBeHidden();
    await expect(row(page, name)).toBeVisible();
    await expect(row(page, name).locator('[data-links]')).toHaveText('0');
    await expect(opener).toBeFocused();
    await expect(page).not.toHaveURL(/edit=/);
  });

  test('Rename opens the same dialog from the name link or the menu, and an unsaved name asks before it is lost', async ({
    page,
    admin,
  }) => {
    const name = `Rename ${uid()}`;
    const role = await admin.post('/api/v1/asset-link-roles', { name, isActive: true });
    await page.setViewportSize({ width: 1366, height: 768 });
    await page.goto(TAB_URL);
    const link = row(page, name).locator('[data-edit]');
    await link.focus();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(new RegExp(`edit=${role.id}`));
    await expect(dialog(page)).toContainText('Rename link role');
    await expect(field(page)).toHaveValue(name);

    // Unsaved: Escape asks, Stay keeps the text, Leave closes it and focus returns to the link.
    await field(page).fill(`${name} changed`);
    await page.keyboard.press('Escape');
    await expect(ask(page)).toBeVisible();
    await expect(ask(page).getByRole('button', { name: 'Stay' })).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(ask(page)).toBeHidden();
    await expect(field(page)).toHaveValue(`${name} changed`);
    await dialog(page).getByRole('button', { name: 'Cancel' }).click();
    await ask(page).getByRole('button', { name: 'Leave' }).click();
    await expect(dialog(page)).toBeHidden();
    await expect(link).toBeFocused();
    await expect(row(page, name)).toBeVisible();

    // The menu entry opens the same dialog; saving renames the row and returns focus to the menu button.
    await openRowMenu(page, menu(page, name));
    await page.getByRole('menuitem', { name: 'Rename' }).click();
    await field(page).fill(`${name} v2`);
    await dialog(page).getByRole('button', { name: 'Save name' }).click();
    await expect(dialog(page)).toBeHidden();
    await expect(row(page, `${name} v2`)).toBeVisible();
    await expect(menu(page, `${name} v2`)).toBeFocused();
    await expect(toasts(page)).toHaveCount(1);
  });
});

test.describe('Links, Delete only when unused, Move, Deactivate (#641, #640)', () => {
  test('the Links column counts the links; a used role offers Deactivate with the impact line, an unused role offers Delete', async ({
    page,
    admin,
    seed,
  }) => {
    const used = `Used ${uid()}`;
    const unused = `Unused ${uid()}`;
    const usedRole = await admin.post('/api/v1/asset-link-roles', { name: used, isActive: true });
    await admin.post('/api/v1/asset-link-roles', { name: unused, isActive: true });
    const world = await seed.world();
    const task = await seed.task(world);
    for (let i = 0; i < 2; i++) {
      const asset = await seed.asset(world.matter);
      await admin.post(`/api/v1/tasks/${task.taskId}/assets`, {
        assetId: asset.assetId,
        assetLinkRoleId: usedRole.id,
      });
    }
    await page.setViewportSize({ width: 1366, height: 768 });
    await page.goto(TAB_URL);
    await expect(row(page, used).locator('[data-links]')).toHaveText('2');
    await expect(row(page, unused).locator('[data-links]')).toHaveText('0');

    await openRowMenu(page, menu(page, used));
    await expect(page.getByRole('menuitem')).toHaveText([
      /Rename/,
      /Move up/,
      /Move down/,
      /Deactivate/,
    ]);
    await page.keyboard.press('Escape');
    await openRowMenu(page, menu(page, unused));
    await expect(page.getByRole('menuitem', { name: 'Delete' })).toBeVisible();
    await page.keyboard.press('Escape');

    // Deactivate says how many links keep the role; Activate is one click.
    await openRowMenu(page, menu(page, used));
    await page.getByRole('menuitem', { name: 'Deactivate' }).click();
    const confirm = page.getByRole('dialog', { name: 'Deactivate link role?' });
    await expect(confirm).toContainText('2 links keep this role.');
    await confirm.getByRole('button', { name: 'Deactivate link role' }).click();
    await expect(row(page, used)).toContainText('Inactive');
    await expect(menu(page, used)).toBeFocused();
    await openRowMenu(page, menu(page, used));
    await page.getByRole('menuitem', { name: 'Activate' }).click();
    await expect(row(page, used)).toContainText('Active');
    await expect(row(page, used)).not.toContainText('Inactive');

    // Delete an unused role: one question, then it is gone.
    await openRowMenu(page, menu(page, unused));
    await page.getByRole('menuitem', { name: 'Delete' }).click();
    const del = page.getByRole('dialog', { name: 'Delete link role?' });
    await expect(del).toContainText('No link uses this role.');
    await del.getByRole('button', { name: 'Delete link role' }).click();
    await expect(row(page, unused)).toHaveCount(0);
  });

  test('Move up and Move down in the menu reorder the roles and keep focus on the menu button', async ({
    page,
    admin,
  }) => {
    const a = `Order A ${uid()}`;
    const b = `Order B ${uid()}`;
    await admin.post('/api/v1/asset-link-roles', { name: a, isActive: true });
    await admin.post('/api/v1/asset-link-roles', { name: b, isActive: true });
    await page.setViewportSize({ width: 1366, height: 768 });
    await page.goto(TAB_URL);
    const names = () =>
      page
        .locator('[data-roles] tbody tr[data-row]')
        .evaluateAll((rs) => rs.map((r) => r.getAttribute('data-row') ?? ''));
    await expect(row(page, b)).toBeVisible();
    const before = await names();
    await openRowMenu(page, menu(page, b));
    await page.getByRole('menuitem', { name: 'Move up' }).click();
    await expect(menu(page, b)).toBeFocused();
    const after = await names();
    expect(after.indexOf(b)).toBe(before.indexOf(b) - 1);
    expect(after.indexOf(a)).toBe(before.indexOf(a) + 1); // the role it passed moves down one
    await openRowMenu(page, menu(page, b));
    await page.getByRole('menuitem', { name: 'Move down' }).click();
    await expect.poll(names).toEqual(before);
    await expect(menu(page, b)).toBeFocused();
    await page.reload();
    await expect(row(page, b)).toBeVisible();
    expect(await names()).toEqual(before);
  });
});

test.describe('Permissions and accessibility', () => {
  test.setTimeout(180_000);
  test('with AssetType.Manage alone there is no Links column and no Delete (the count is not known)', async ({
    personas,
    asUser,
    admin,
  }) => {
    const name = `Quiet ${uid()}`;
    await admin.post('/api/v1/asset-link-roles', { name, isActive: true });
    const manager = await personas.create({
      label: 'link-roles-only',
      permissions: ['AssetType.Manage'],
    });
    const page = await asUser(manager.username);
    await page.setViewportSize({ width: 1366, height: 768 });
    await page.goto(TAB_URL);
    await expect(row(page, name)).toBeVisible();
    await expect(page.locator('[data-roles] thead th')).toHaveText([
      'Order',
      'Name',
      'Status',
      'Actions',
    ]);
    await openRowMenu(page, menu(page, name));
    await expect(page.getByRole('menuitem', { name: 'Delete' })).toHaveCount(0);
    await expect(page.getByRole('menuitem', { name: 'Deactivate' })).toBeVisible();
  });

  test('axe finds nothing at 375, 768, 1366 and 1920 with the list, a row menu and the New and Deactivate dialogs open; no sideways scroll', async ({
    page,
    admin,
  }) => {
    requireAxe();
    const name = `Axe ${uid()}`;
    await admin.post('/api/v1/asset-link-roles', { name, isActive: true });
    for (const size of SIZES) {
      await page.setViewportSize(size);
      await page.goto(TAB_URL);
      await expect(
        page.getByRole('button', { name: `Actions for ${name}`, exact: true }),
      ).toBeVisible();
      expect(await axeViolations(page), `list at ${size.width}`).toEqual([]);
      await noHorizontalScroll(page);

      await openRowMenu(page, menu(page, name));
      expect(await axeViolations(page), `menu at ${size.width}`).toEqual([]);
      await page.keyboard.press('Escape');

      await page.getByRole('button', { name: 'New link role' }).click();
      await expect(dialog(page)).toBeVisible();
      expect(await axeViolations(page), `dialog at ${size.width}`).toEqual([]);
      await noHorizontalScroll(page);
      if (size.width === 375 || size.width === 1366) await shot(page, 'link-roles-dialog');
      await page.keyboard.press('Escape');
      await expect(dialog(page)).toBeHidden();

      await openRowMenu(page, menu(page, name));
      await page.getByRole('menuitem', { name: 'Deactivate' }).click();
      await expect(page.getByRole('dialog', { name: 'Deactivate link role?' })).toBeVisible();
      expect(await axeViolations(page), `deactivate at ${size.width}`).toEqual([]);
      await page.getByRole('button', { name: 'Keep active' }).click();
    }
  });
});
