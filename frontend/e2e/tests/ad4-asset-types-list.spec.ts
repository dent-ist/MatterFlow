import { Page } from '@playwright/test';
import { Api } from '../support/api';
import { ensureForm, manyFields } from '../support/designer';
import { expect, test } from '../support/fixtures';
import { axeAvailable, axeViolations } from '../support/axe';
import { SIZES, noHorizontalScroll, shot } from '../support/screens';
import { uid } from '../support/seed';

/**
 * WP-AD4 (AD-C): the Asset Types page on the admin list kit. Names, crumb, counted tabs, Filters and New asset type in the header (#633); the
 * list on the 44 px grid contract with the strip, the Fields cell, the asset count, one menu, the hidden-count line and phone cards (#634); Move
 * up and Move down in the menu (#637). Screenshots go to E2E_SCREENSHOTS (docs/ux/admin-pages-review/fixes/ad4-asset-types).
 */
const crumbs = (page: Page) => page.getByRole('navigation', { name: 'Breadcrumb' }).locator('li');
const row = (page: Page, name: string) => page.locator(`tr[data-row="${name}"]`);
const menuButton = (page: Page, name: string) =>
  page.getByRole('button', { name: `Actions for ${name}` });

interface Seeded {
  token: string;
  published: { id: number; name: string };
  draft: { id: number; name: string };
  none: { id: number; name: string };
  inactive: { id: number; name: string };
  long: { id: number; name: string };
}

/** Five types with a token in their names so the specs can filter to them: published, draft only, no form, inactive, and a 90-character name. */
async function seedTypes(admin: Api): Promise<Seeded> {
  const token = uid();
  const make = async (name: string, description: string | null = null, order?: number) => {
    const t = await admin.post('/api/v1/asset-types', { name, description, sortOrder: order });
    return { id: t.assetTypeId as number, name, rowVersion: t.rowVersion as string };
  };
  const published = await make(`Alpha ${token}`, 'First', 5000);
  await ensureForm(admin, 'AssetType', published.id, { published: true, fields: manyFields(8) });
  const draft = await make(`Beta ${token}`, null, 5010);
  await ensureForm(admin, 'AssetType', draft.id, { draft: true, fields: manyFields(3) });
  const none = await make(`Gamma ${token}`, null, 5020);
  const inactive = await make(`Delta ${token}`, null, 5030);
  await admin.put(`/api/v1/asset-types/${inactive.id}`, {
    name: inactive.name,
    description: null,
    sortOrder: 5030,
    isActive: false,
    rowVersion: inactive.rowVersion,
  });
  const long = await make(
    `Epsilon ${token} ${'long name '.repeat(8)}`.slice(0, 90),
    'D'.repeat(490),
    5040,
  );
  return { token, published, draft, none, inactive, long };
}

/**
 * One set of five types for the whole file (a firm has a handful, the Assets screens read only the first 100 types, and asset types are never deleted, so
 * a spec must not pile them up). The tests that change a type restore it, and the one that moves types runs last.
 */
let s: Seeded;
test.describe.configure({ mode: 'serial' });
test.beforeAll(async ({ admin }) => {
  s = await seedTypes(admin);
});

const filterToken = async (page: Page, token: string) => {
  await page.goto(`/admin/asset-types?name=${token}&status=all`);
  await expect(page.locator('[data-types] tbody tr[data-row]').first()).toBeVisible();
};

test.describe('Asset Types page chrome (#633)', () => {
  test('names, crumb, titles, counted tabs, Filters and the primary action in the header; the old address redirects', async ({
    page,
    admin,
  }) => {
    await page.setViewportSize({ width: 1366, height: 768 });
    await page.goto('/admin/asset-types');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Asset Types');
    await expect(page).toHaveTitle('Asset Types - MatterFlow');
    await expect(crumbs(page)).toHaveText([/Administration/, /Asset Types/]);
    await expect(
      page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Asset Types' }),
    ).toHaveAttribute('href', '/admin/asset-types');

    // The tabs name the active records: Asset Types (n), Link Roles (n).
    const activeTypes = (await admin.get('/api/v1/asset-types?isActive=true&pageSize=1')).total;
    const activeRoles = (await admin.get('/api/v1/asset-link-roles')).filter(
      (r: { isActive: boolean }) => r.isActive,
    ).length;
    const tabs = page.getByRole('tab');
    await expect(tabs.nth(0)).toHaveAccessibleName(`Asset Types, ${activeTypes} active`);
    await expect(tabs.nth(1)).toHaveAccessibleName(`Link Roles, ${activeRoles} active`);
    await expect(tabs.nth(0)).toContainText(`(${activeTypes})`);

    // The primary action and Filters are in the header, not on a row of their own.
    const header = page.locator('mf-page-header, [data-page-header]').first();
    await expect(header.getByRole('button', { name: 'New asset type' })).toBeVisible();
    await expect(header.getByRole('button', { name: /^Filters/ })).toBeVisible();
    await expect(header).toContainText('Each type has its own fields.');

    await page.goto('/admin/asset-link-roles');
    await expect(page).toHaveURL(/\/admin\/asset-types\?tab=link-roles$/);
    await expect(page).toHaveTitle('Asset Types - Link Roles - MatterFlow');
    await expect(page.getByRole('tab', { name: /^Link Roles/ })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    // Filters belong to the Asset Types tab: the Link Roles tab has none.
    await expect(
      page.locator('mf-page-header').getByRole('button', { name: /^Filters/ }),
    ).toHaveCount(0);
    await shot(page, 'asset-types-link-roles-tab');
  });

  test('"Skip to table" is the first Tab stop and moves focus to the table', async ({ page }) => {
    await page.goto('/admin/asset-types');
    await expect(page.locator('[data-types] tbody tr[data-row]').first()).toBeVisible();
    await page.keyboard.press('Tab');
    const skip = page.getByRole('link', { name: 'Skip to table' });
    await expect(skip).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.locator('#asset-types-table')).toBeFocused();
  });
});

test.describe('Asset Types list (#634, #637)', () => {
  test('rows are 44 px with a 90-character name and a 490-character description; the name is the link; the description is not in the list', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1366, height: 768 });
    await filterToken(page, s.token);
    for (const t of [s.published, s.draft, s.none, s.inactive, s.long]) {
      const r = row(page, t.name);
      await expect(r).toBeVisible();
      expect((await r.boundingBox())!.height).toBeLessThanOrEqual(45);
      await expect(r.getByRole('link')).toHaveCount(1);
    }
    await expect(row(page, s.long.name).getByRole('link')).toHaveAttribute(
      'href',
      `/admin/asset-types/${s.long.id}`,
    );
    await expect(page.locator('[data-types]')).not.toContainText('DDDDDDDDDD');
    // The columns: Name, Fields, Assets (Asset.View), Status, the menu.
    await expect(page.locator('[data-types] thead tr').first().locator('th')).toHaveText([
      'Name',
      'Fields',
      'Assets',
      'Status',
      'Actions',
    ]);
  });

  test('the Fields cell says published, draft and none, with the field count and the date', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1366, height: 768 });
    await filterToken(page, s.token);
    const published = row(page, s.published.name).locator('[data-fields]');
    await expect(published).toContainText('Published v1');
    await expect(published).toContainText('8 fields');
    await expect(published).toContainText(/Updated [A-Z][a-z]{2} \d{1,2}/);
    await expect(row(page, s.draft.name).locator('[data-fields]')).toContainText(
      'No published fields',
    );
    await expect(row(page, s.draft.name).locator('[data-fields]')).toContainText('Draft v1');
    await expect(row(page, s.none.name).locator('[data-fields]')).toContainText(
      'No published fields',
    );
    await expect(row(page, s.none.name).locator('[data-fields]')).not.toContainText('Draft');
  });

  test('the strip counts the whole list and its chips filter; the hidden-count line offers Show all', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1366, height: 768 });
    await page.goto(`/admin/asset-types?name=${s.token}`);
    await expect(row(page, s.published.name)).toBeVisible();
    // The default Status is Active: the inactive type is hidden, and the line says so.
    await expect(row(page, s.inactive.name)).toHaveCount(0);
    const hint = page.locator('[data-hidden-hint]');
    await expect(hint).toContainText('1 inactive hidden');
    await hint.getByRole('button', { name: 'Show all' }).click();
    await expect(row(page, s.inactive.name)).toBeVisible();
    await expect(page).toHaveURL(/status=all/);

    // The strip's chip puts the filter in the address and the row of the others goes.
    await page.goto(`/admin/asset-types?name=${s.token}`);
    const strip = page.locator('mf-work-strip');
    await expect(strip).toContainText('Active');
    await strip.getByRole('button', { name: /^No published fields/ }).click();
    await expect(page).toHaveURL(/fields=none/);
    await expect(row(page, s.published.name)).toHaveCount(0);
    await expect(row(page, s.none.name)).toBeVisible();
    await expect(row(page, s.draft.name)).toBeVisible();
    await strip.getByRole('button', { name: /^Inactive/ }).click();
    await expect(page).toHaveURL(/status=inactive/);
    await expect(row(page, s.inactive.name)).toBeVisible();
    await expect(row(page, s.none.name)).toHaveCount(0);
  });

  test('a filter with no match says so with Clear filters; the default Status can hide the only matches', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1366, height: 768 });
    await page.goto('/admin/asset-types?name=zzzz-nothing-' + uid());
    await expect(page.locator('td[data-empty="filtered"]')).toContainText('No asset types match');
    await page.getByRole('button', { name: 'Clear filters' }).first().click();
    await expect(page.locator('[data-types] tbody tr[data-row]').first()).toBeVisible();
  });

  test('the row menu: Edit, Edit fields, History (Audit.View), Move up, Move down, Deactivate; Esc returns focus to its button', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1366, height: 768 });
    await filterToken(page, s.token);
    const button = menuButton(page, s.none.name);
    await button.click();
    await expect(page.getByRole('menuitem')).toHaveText([
      /Edit$/,
      /Edit fields/,
      /History/,
      /Move up/,
      /Move down/,
      /Deactivate/,
    ]);
    await page.keyboard.press('Escape');
    await expect(button).toBeFocused();
  });

  test('Deactivate asks with the number of assets that keep the type; Activate does not ask; focus returns to the row menu', async ({
    page,
    admin,
  }) => {
    await page.setViewportSize({ width: 1366, height: 768 });
    await filterToken(page, s.token);
    await menuButton(page, s.none.name).click();
    await page.getByRole('menuitem', { name: /Deactivate/ }).click();
    const dialog = page.getByRole('dialog', { name: 'Deactivate asset type?' });
    await expect(dialog).toContainText('No asset has this type.');
    await expect(dialog).toContainText("It won't be offered for new assets.");
    await expect(dialog.getByRole('button', { name: 'Keep active' })).toBeFocused();
    await dialog.getByRole('button', { name: 'Deactivate asset type' }).click();
    await expect(dialog).toHaveCount(0);
    await expect(row(page, s.none.name).locator('mf-active-badge')).toContainText('Inactive');
    await expect(menuButton(page, s.none.name)).toBeFocused();
    expect((await admin.get(`/api/v1/asset-types/${s.none.id}`)).isActive).toBe(false);

    await menuButton(page, s.none.name).click();
    await page.getByRole('menuitem', { name: /Activate/ }).click();
    await expect(row(page, s.none.name).locator('mf-active-badge')).toContainText('Active');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    expect((await admin.get(`/api/v1/asset-types/${s.none.id}`)).isActive).toBe(true);
  });

  test('the Assets count is there for a person who may see assets and not for one who may only manage types', async ({
    page,
    admin,
    seed,
    asUser,
  }) => {
    await page.setViewportSize({ width: 1366, height: 768 });
    await filterToken(page, s.token);
    await expect(row(page, s.published.name).locator('[data-assets]')).toHaveText('0');

    const role = await seed.role(['AssetType.Manage'], 'Types only');
    const manager = await asUser((await seed.user([role.name], 'ad4-types')).username);
    await manager.goto(`/admin/asset-types?name=${s.token}&status=all`);
    await expect(row(manager, s.published.name)).toBeVisible();
    await expect(manager.locator('[data-types] thead th')).toHaveText([
      'Name',
      'Fields',
      'Status',
      'Actions',
    ]);
    await menuButton(manager, s.published.name).click();
    await expect(manager.getByRole('menuitem', { name: /History/ })).toHaveCount(0);
  });

  test('below 640 px the list is cards: 2 to 4 lines, the same menu, the name is the one link', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto(`/admin/asset-types?name=${s.token}&status=all`);
    const cards = page.locator('li.rc');
    await expect(cards.first()).toBeVisible();
    await expect(cards).toHaveCount(5);
    for (const card of await cards.all()) {
      const height = (await card.boundingBox())!.height;
      expect(height).toBeGreaterThanOrEqual(56);
      expect(height).toBeLessThanOrEqual(150);
    }
    const first = cards.filter({ hasText: s.published.name });
    await expect(first).toContainText('Published v1');
    await expect(first).toContainText('8 fields');
    await expect(first.getByRole('link')).toHaveAttribute(
      'href',
      `/admin/asset-types/${s.published.id}`,
    );
    await first.getByRole('button', { name: `Actions for ${s.published.name}` }).click();
    await expect(page.getByRole('menuitem', { name: /Edit fields/ })).toBeVisible();
    await noHorizontalScroll(page);
    await shot(page, 'asset-types-cards');
  });

  test('axe finds nothing at 375, 768, 1366 and 1920 with the list, the row menu and the Deactivate dialog open; no sideways scroll', async ({
    page,
  }) => {
    await page.goto(`/admin/asset-types?name=${s.token}&status=all`);
    await expect(page.locator('main').getByText(s.published.name).first()).toBeVisible();
    for (const size of SIZES) {
      await page.setViewportSize(size);
      await expect(page.locator('main').getByText(s.published.name).first()).toBeVisible();
      if (axeAvailable()) expect(await axeViolations(page), `list at ${size.width}`).toEqual([]);
      await noHorizontalScroll(page);
      if (size.width === 1366 || size.width === 375) await shot(page, 'asset-types-list');

      await menuButton(page, s.published.name).click();
      await expect(page.getByRole('menuitem', { name: /Deactivate/ })).toBeVisible();
      if (axeAvailable()) expect(await axeViolations(page), `menu at ${size.width}`).toEqual([]);
      await noHorizontalScroll(page);
      await page.getByRole('menuitem', { name: /Deactivate/ }).click();
      const dialog = page.getByRole('dialog', { name: 'Deactivate asset type?' });
      await expect(dialog).toBeVisible();
      if (axeAvailable()) expect(await axeViolations(page), `dialog at ${size.width}`).toEqual([]);
      await noHorizontalScroll(page);
      await dialog.getByRole('button', { name: 'Keep active' }).click();
      await expect(dialog).toHaveCount(0);
    }
  });

  test('Move down and Move up change the order, announce it, keep focus on the menu button and survive a reload; with Show all the inactive neighbour counts', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1366, height: 768 });
    await filterToken(page, s.token);
    const order = () =>
      page
        .locator('[data-types] tbody tr[data-row]')
        .evaluateAll((rows) => rows.map((r) => (r.getAttribute('data-row') ?? '').split(' ')[0]));
    expect(await order()).toEqual(['Alpha', 'Beta', 'Gamma', 'Delta', 'Epsilon']);

    await menuButton(page, s.published.name).click();
    await expect(page.getByRole('menuitem', { name: /Move up/ })).toBeDisabled();
    await expect(page.getByText('Already first.')).toBeVisible();
    await page.getByRole('menuitem', { name: /Move down/ }).click();
    await expect(page.locator('[data-announce]')).toContainText(
      `${s.published.name} moved to position 2 of 5.`,
    );
    await expect(menuButton(page, s.published.name)).toBeFocused();
    expect(await order()).toEqual(['Beta', 'Alpha', 'Gamma', 'Delta', 'Epsilon']);

    await page.reload();
    await expect(row(page, s.long.name)).toBeVisible();
    expect(await order()).toEqual(['Beta', 'Alpha', 'Gamma', 'Delta', 'Epsilon']);

    // With the default Status the inactive type is not a neighbour: Gamma moves below Epsilon past it in one step.
    await page.goto(`/admin/asset-types?name=${s.token}`);
    await expect(row(page, s.published.name)).toBeVisible();
    expect(await order()).toEqual(['Beta', 'Alpha', 'Gamma', 'Epsilon']);
    await menuButton(page, s.none.name).click();
    await page.getByRole('menuitem', { name: /Move down/ }).click();
    await expect(page.locator('[data-announce]')).toContainText('moved to position 4 of 4');
    await page.goto(`/admin/asset-types?name=${s.token}&status=all`);
    await expect(row(page, s.inactive.name)).toBeVisible();
    expect(await order()).toEqual(['Beta', 'Alpha', 'Epsilon', 'Delta', 'Gamma']);
  });
});
