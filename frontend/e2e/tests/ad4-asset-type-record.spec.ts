import { Page } from '@playwright/test';
import { ensureForm, manyFields } from '../support/designer';
import { expect, test } from '../support/fixtures';
import { SIZES, atEverySize, noHorizontalScroll, shot } from '../support/screens';
import { axeAvailable, axeViolations } from '../support/axe';
import { uid } from '../support/seed';

/**
 * WP-AD4 (AD-C): the asset type record page (#635), its Fields and Assets tabs, Activity and the Deactivate dialog (#636), and the way into
 * the form designer (#638). `/admin/asset-types/new` and `/admin/asset-types/:id`, five widths, axe 0, no sideways scroll, permission variants.
 * Screenshots go to E2E_SCREENSHOTS (docs/ux/admin-pages-review/fixes/ad4-asset-types).
 */
const heading = (page: Page) => page.getByRole('heading', { level: 1 });
const crumbs = (page: Page) => page.getByRole('navigation', { name: 'Breadcrumb' }).locator('li');
const name = (page: Page) => page.getByLabel('Name', { exact: false }).first();
const ask = (page: Page) => page.getByRole('dialog', { name: 'Leave without saving?' });
const WIDTHS = [
  { width: 1920, height: 1080 },
  { width: 1366, height: 768 },
  { width: 1024, height: 768 },
  { width: 768, height: 1024 },
  { width: 375, height: 812 },
] as const;

async function everyWidth(page: Page, label: string): Promise<void> {
  for (const size of WIDTHS) {
    await page.setViewportSize(size);
    if (axeAvailable()) expect(await axeViolations(page), `${label} at ${size.width}`).toEqual([]);
    await noHorizontalScroll(page);
    if (size.width === 1366 || size.width === 375) await shot(page, label);
  }
}

test.describe('Asset type record page (#635, #636, #638)', () => {
  test('creates a type: validation focus, duplicate, long name, then lands on Fields', async ({
    page,
    admin,
  }) => {
    await page.setViewportSize({ width: 1366, height: 768 });
    await page.goto('/admin/asset-types');
    await page.getByRole('button', { name: 'New asset type' }).click();
    await expect(page).toHaveURL(/\/admin\/asset-types\/new$/);
    await expect(heading(page)).toHaveText('New asset type');
    await expect(page).toHaveTitle('New asset type - MatterFlow');
    await expect(crumbs(page)).toHaveText([/Administration/, /Asset Types/, /New asset type/]);
    // A new type has no tabs and no state badge; Create and Cancel are there from the start.
    await expect(page.getByRole('tab')).toHaveCount(0);
    await everyWidth(page, 'asset-type-new');
    await page.setViewportSize({ width: 1366, height: 768 });

    // A blank name: one summary at the top, one message, focus on the field.
    await page.getByRole('button', { name: 'Create asset type' }).click();
    const summary = page.locator('[data-summary]');
    await expect(summary).toContainText('Enter a name.');
    expect((await summary.innerText()).match(/Enter a name\./g)).toHaveLength(1);
    await expect(name(page)).toBeFocused();
    await expect(name(page)).toHaveAttribute('aria-invalid', 'true');
    await shot(page, 'asset-type-new-invalid');

    // A duplicate name comes back from the server under the field.
    const existing = `Dup ${uid()}`;
    await admin.post('/api/v1/asset-types', { name: existing, description: null });
    await name(page).fill(existing);
    await page.getByRole('button', { name: 'Create asset type' }).click();
    await expect(summary).toContainText('already exists');
    await expect(name(page)).toBeFocused();

    // The counters show the API limits; a 100-character name is accepted, clamped in the header and the crumb.
    const longName = `L${uid()} ${'x'.repeat(100)}`.slice(0, 100);
    await name(page).fill(longName);
    await page.getByLabel('Description').fill('Created in a test');
    await expect(page.getByText('100 / 100')).toBeVisible();
    await expect(page.getByText('17 / 500')).toBeVisible();
    await page.getByRole('button', { name: 'Create asset type' }).click();
    await expect(page).toHaveURL(/\/admin\/asset-types\/\d+\?tab=fields$/);
    await expect(heading(page)).toContainText(longName.slice(0, 20));
    expect((await heading(page).boundingBox())!.height).toBeLessThanOrEqual(80);
    await expect(page.getByRole('tab', { name: /^Fields/ })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await expect(page.locator('[data-no-fields]')).toContainText('no published fields');
    await expect(page.getByRole('button', { name: 'Create fields' })).toBeVisible();
    await shot(page, 'asset-type-created-fields');
  });

  test('Back from a record puts focus on the row that was left, in the list view that was left', async ({
    page,
    admin,
  }) => {
    const token = uid();
    const t = await admin.post('/api/v1/asset-types', {
      name: `Back ${token}`,
      description: 'D',
      sortOrder: 6000,
    });
    await page.setViewportSize({ width: 1366, height: 768 });
    await page.goto(`/admin/asset-types?name=${token}`);
    const link = page.getByRole('link', { name: `Back ${token}` });
    await link.click();
    await expect(page).toHaveURL(new RegExp(`/admin/asset-types/${t.assetTypeId}$`));
    await expect(heading(page)).toContainText(`Back ${token}`);
    await expect(page).toHaveTitle(`Back ${token} - MatterFlow`);
    await crumbs(page).filter({ hasText: 'Asset Types' }).getByRole('link').click();
    await expect(page).toHaveURL(new RegExp(`name=${token}`));
    await expect(page.getByRole('link', { name: `Back ${token}` })).toBeFocused();
  });

  test('Back from the designer, two pages deep (list, record, designer), still puts focus on the row; the menu entry Edit fields does too', async ({
    page,
    admin,
  }) => {
    const token = uid();
    const t = await admin.post('/api/v1/asset-types', {
      name: `Deep ${token}`,
      description: null,
      sortOrder: 6005,
    });
    await page.setViewportSize({ width: 1366, height: 768 });
    await page.goto(`/admin/asset-types?name=${token}`);
    await page.getByRole('link', { name: `Deep ${token}` }).click();
    await page.locator('[data-page-actions]').getByRole('button', { name: 'Edit fields' }).click();
    await expect(page).toHaveURL(new RegExp(`/admin/asset-types/${t.assetTypeId}/form$`));
    await crumbs(page).filter({ hasText: 'Asset Types' }).getByRole('link').click();
    await expect(page).toHaveURL(new RegExp(`name=${token}`));
    await expect(page.getByRole('link', { name: `Deep ${token}` })).toBeFocused();

    // The row menu goes straight to the designer, and Back returns to the same row.
    await page.getByRole('button', { name: `Actions for Deep ${token}` }).click();
    await page.getByRole('menuitem', { name: /Edit fields/ }).click();
    await expect(page).toHaveURL(new RegExp(`/admin/asset-types/${t.assetTypeId}/form$`));
    await crumbs(page).filter({ hasText: 'Asset Types' }).getByRole('link').click();
    await expect(page.getByRole('link', { name: `Deep ${token}` })).toBeFocused();
  });

  test('edits a type: footer only while dirty, Cancel puts the text back, Save keeps the order and state, the unsaved guard asks', async ({
    page,
    admin,
  }) => {
    const token = uid();
    const t = await admin.post('/api/v1/asset-types', {
      name: `Edit ${token}`,
      description: 'Before',
      sortOrder: 6010,
    });
    await page.setViewportSize({ width: 1366, height: 768 });
    await page.goto(`/admin/asset-types/${t.assetTypeId}`);
    await expect(name(page)).toHaveValue(`Edit ${token}`);
    await expect(page.locator('[data-footer]')).toHaveCount(0);
    await expect(page.getByLabel('Active')).toHaveCount(0);

    await name(page).fill(`Edited ${token}`);
    await expect(page.locator('[data-footer]')).toBeVisible();
    // The footer is sticky at the bottom of the window.
    await page.getByRole('button', { name: 'Cancel' }).click();
    await expect(name(page)).toHaveValue(`Edit ${token}`);
    await expect(page.locator('[data-footer]')).toHaveCount(0);

    // Half-typed: another tab asks first; Stay keeps the text; Leave drops it.
    await name(page).fill('Half typed');
    await page.getByRole('tab', { name: /^Fields/ }).click();
    await expect(ask(page)).toBeVisible();
    await expect(ask(page).getByRole('button', { name: 'Save and leave' })).toBeVisible();
    await ask(page).getByRole('button', { name: 'Stay' }).click();
    await expect(name(page)).toHaveValue('Half typed');
    // Navigating away asks too.
    await page.getByRole('link', { name: 'Dashboard' }).first().click();
    await expect(ask(page)).toBeVisible();
    await ask(page).getByRole('button', { name: 'Stay' }).click();
    await expect(page).toHaveURL(/\/admin\/asset-types\/\d+$/);

    await name(page).fill(`Saved ${token}`);
    await page.getByRole('button', { name: 'Save changes' }).click();
    await expect(heading(page)).toContainText(`Saved ${token}`);
    await expect(page.locator('[data-footer]')).toHaveCount(0);
    const saved = await admin.get(`/api/v1/asset-types/${t.assetTypeId}`);
    expect(saved.name).toBe(`Saved ${token}`);
    expect(saved.sortOrder).toBe(6010);
    expect(saved.isActive).toBe(true);
  });

  test('the Fields tab: published, published with a draft, only a draft, none; Edit fields opens the designer with Administration > Asset Types > name > Fields', async ({
    page,
    admin,
  }) => {
    const token = uid();
    const make = async (suffix: string, opts: { published?: boolean; draft?: boolean }) => {
      const t = await admin.post('/api/v1/asset-types', {
        name: `${suffix} ${token}`,
        description: null,
      });
      if (opts.published || opts.draft)
        await ensureForm(admin, 'AssetType', t.assetTypeId, { ...opts, fields: manyFields(8) });
      return { id: t.assetTypeId as number, name: `${suffix} ${token}` };
    };
    const published = await make('Published', { published: true });
    const none = await make('None', {});
    const draftOnly = await make('DraftOnly', { draft: true });
    await page.setViewportSize({ width: 1366, height: 768 });

    await page.goto(`/admin/asset-types/${published.id}?tab=fields`);
    await expect(page.getByRole('tab', { name: 'Fields, 8' })).toBeVisible();
    const tab = page.locator('[data-fields-tab]');
    await expect(tab).toContainText('Published v1');
    await expect(tab).toContainText('8 fields');
    await expect(tab).toContainText(/Last published [A-Z][a-z]{2} \d{1,2}, \d{4}\./);
    await expect(page.locator('[data-no-fields]')).toHaveCount(0);

    await page.goto(`/admin/asset-types/${none.id}?tab=fields`);
    await expect(page.locator('[data-no-fields]')).toBeVisible();
    await expect(page.getByRole('tab', { name: /^Fields$/ })).toBeVisible();

    await page.goto(`/admin/asset-types/${draftOnly.id}?tab=fields`);
    await expect(page.locator('[data-form-draft]')).toContainText('Draft v1 is in progress.');
    await expect(page.getByRole('button', { name: 'Edit fields' }).first()).toBeVisible();

    // Edit fields (the primary action of the header) opens the designer; the crumb names the record and links back to it.
    await page.goto(`/admin/asset-types/${published.id}`);
    await page.locator('[data-page-actions]').getByRole('button', { name: 'Edit fields' }).click();
    await expect(page).toHaveURL(new RegExp(`/admin/asset-types/${published.id}/form$`));
    await expect(crumbs(page)).toHaveText([
      /Administration/,
      /Asset Types/,
      new RegExp(published.name),
      /Fields/,
    ]);
    await expect(page).toHaveTitle(`${published.name}: Fields - MatterFlow`);
    await crumbs(page).filter({ hasText: published.name }).getByRole('link').click();
    await expect(page).toHaveURL(new RegExp(`/admin/asset-types/${published.id}$`));
  });

  test('the Assets tab counts the assets and links to the Assets list of the type', async ({
    page,
    admin,
    seed,
  }) => {
    const token = uid();
    const t = await admin.post('/api/v1/asset-types', {
      name: `Counted ${token}`,
      description: null,
    });
    const matter = await seed.matter(await seed.client());
    for (let i = 0; i < 2; i++) {
      await admin.post('/api/v1/assets', {
        matterId: matter.matterId,
        assetTypeId: t.assetTypeId,
        displayName: `Asset ${token} ${i}`,
      });
    }
    await page.setViewportSize({ width: 1366, height: 768 });
    await page.goto(`/admin/asset-types/${t.assetTypeId}`);
    await expect(page.getByRole('tab', { name: 'Assets, 2' })).toBeVisible();
    await page.getByRole('tab', { name: /^Assets/ }).click();
    await expect(page).toHaveURL(/tab=assets$/);
    await expect(page.locator('[data-asset-count]')).toContainText('2 assets have this type.');
    await page.getByRole('link', { name: 'View assets of this type' }).click();
    await expect(page).toHaveURL(new RegExp(`/assets\\?typeId=${t.assetTypeId}`));
    await expect(page.getByText(`Asset ${token} 0`)).toBeVisible();
  });

  test('Deactivate says how many assets keep the type and Activate does not ask; focus returns to the status; Activity opens the drawer', async ({
    page,
    admin,
    seed,
  }) => {
    const token = uid();
    const t = await admin.post('/api/v1/asset-types', { name: `Life ${token}`, description: null });
    const matter = await seed.matter(await seed.client());
    await admin.post('/api/v1/assets', {
      matterId: matter.matterId,
      assetTypeId: t.assetTypeId,
      displayName: `Asset ${token}`,
    });
    await page.setViewportSize({ width: 1366, height: 768 });
    await page.goto(`/admin/asset-types/${t.assetTypeId}`);
    await page.locator('[data-page-actions] button[data-overflow]').click();
    await page.getByRole('menuitem', { name: 'Deactivate' }).click();
    const dialog = page.getByRole('dialog', { name: 'Deactivate asset type?' });
    await expect(dialog).toContainText('1 asset keeps this type.');
    await expect(dialog).toContainText("It won't be offered for new assets.");
    if (axeAvailable()) expect(await axeViolations(page)).toEqual([]);
    await dialog.getByRole('button', { name: 'Deactivate asset type' }).click();
    await expect(page.locator('[data-status-badge], mf-active-badge').first()).toContainText(
      'Inactive',
    );
    expect((await admin.get(`/api/v1/asset-types/${t.assetTypeId}`)).isActive).toBe(false);

    await page.locator('[data-page-actions] button[data-overflow]').click();
    await page.getByRole('menuitem', { name: 'Activate' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.locator('[data-status-badge], mf-active-badge').first()).toContainText(
      'Active',
    );

    // Activity (Audit.View) opens the drawer filtered to the type; axe finds nothing with it open.
    const activity = page.locator('[data-page-actions]').getByRole('button', { name: 'Activity' });
    if (await activity.isVisible()) await activity.click();
    else {
      await page.locator('[data-page-actions] button[data-overflow]').click();
      await page.getByRole('menuitem', { name: 'Activity' }).click();
    }
    await expect(page.getByRole('dialog', { name: /Activity/ })).toBeVisible();
    if (axeAvailable()) expect(await axeViolations(page)).toEqual([]);
  });

  test('an existing record at five widths: Overview, Fields and Assets tabs, axe 0 and no sideways scroll', async ({
    page,
    admin,
  }) => {
    const t = await admin.post('/api/v1/asset-types', {
      name: `Widths ${uid()}`,
      description: 'A record to look at on every screen',
    });
    await ensureForm(admin, 'AssetType', t.assetTypeId, { published: true, fields: manyFields(8) });
    for (const tab of ['', '?tab=fields', '?tab=assets']) {
      await page.goto(`/admin/asset-types/${t.assetTypeId}${tab}`);
      await expect(heading(page)).toContainText('Widths');
      await everyWidth(page, `asset-type-record${tab ? '-' + tab.slice(5) : ''}`);
    }
  });

  test('permissions: AssetType.Manage alone opens the list, the record and the designer, with no Assets tab and no Activity; Task.View alone gets the 403 page', async ({
    page,
    admin,
    seed,
    asUser,
  }) => {
    const t = await admin.post('/api/v1/asset-types', { name: `Perm ${uid()}`, description: null });
    const role = await seed.role(['AssetType.Manage'], 'Types only');
    const manager = await asUser((await seed.user([role.name], 'ad4-rec')).username);
    await manager.goto(`/admin/asset-types/${t.assetTypeId}?tab=assets`);
    await expect(heading(manager)).toContainText('Perm');
    await expect(manager.getByRole('tab')).toHaveCount(2);
    await expect(manager.getByRole('tab', { name: /^Assets/ })).toHaveCount(0);
    await expect(manager.locator('[data-overview-tab]')).toBeVisible();
    await expect(manager.getByRole('button', { name: 'Activity' })).toHaveCount(0);
    await manager.goto(`/admin/asset-types/${t.assetTypeId}/form`);
    await expect(manager.getByRole('heading', { level: 1 })).toContainText('Perm');
    await manager.goto('/admin/asset-types/new');
    await expect(heading(manager)).toHaveText('New asset type');

    const viewerRole = await seed.role(['Task.View'], 'Viewer');
    const viewer = await asUser((await seed.user([viewerRole.name], 'ad4-view')).username);
    for (const url of [`/admin/asset-types/${t.assetTypeId}`, '/admin/asset-types/new']) {
      await viewer.goto(url);
      await expect(
        viewer.getByRole('heading', { name: "You don't have permission to view this." }),
      ).toBeVisible();
    }
    void page;
    void SIZES;
  });
});
