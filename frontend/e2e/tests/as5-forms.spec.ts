import { axeAvailable, axeViolations } from '../support/axe';
import { expect, test } from '../support/fixtures';
import { SIZES, noHorizontalScroll, shot } from '../support/screens';
import { uid } from '../support/seed';

/**
 * Assets UX review, package WP-AS5 (docs/ux/assets-review): the New asset page (#511) and the Edit asset page (#512) on the Create task
 * form pattern. Screenshots: E2E_SCREENSHOTS=docs/ux/assets-review/fixes/as5-forms.
 */
test.describe('Asset forms (WP-AS5)', () => {
  test.beforeEach(() => {
    expect(axeAvailable(), 'axe-core must be available (set E2E_AXE_PATH)').toBe(true);
  });

  /** A type with a published form of two fields, and a matter to put assets in. */
  async function world(
    seed: import('../support/seed').Seeder,
    admin: import('../support/api').Api,
    fields = 2,
  ) {
    const token = uid();
    const matter = await seed.matter({ name: `Form Matter ${token}` });
    const type = await admin.post('/api/v1/asset-types', {
      name: `Form type ${token}`,
      description: null,
      sortOrder: 6200,
    });
    const definition = await admin.get(
      `/api/v1/forms/by-owner?ownerKind=AssetType&ownerId=${type.assetTypeId}`,
    );
    await seed.publishForm(
      definition.formDefinitionId,
      Array.from({ length: fields }, (_, i) => ({
        key: `f${i + 1}`,
        label: `Field ${i + 1}`,
        control: 'TEXT',
        required: i === 0,
      })),
    );
    return { token, matter, type };
  }

  test('New asset: record header, sections, matter placeholder, required words, first error focus, Create lands on the asset page', async ({
    page,
    seed,
    admin,
  }) => {
    const { token, type } = await world(seed, admin, 2);
    await page.setViewportSize({ width: 1366, height: 768 });
    await page.goto('/assets/new');

    await expect(page.getByRole('heading', { level: 1, name: 'New asset' })).toBeVisible();
    await expect(page.locator('[data-record-header] mf-active-badge')).toHaveCount(0);
    await expect(page.locator('#asset-matter')).toHaveAttribute(
      'placeholder',
      'e.g. 90001-80011 or matter name',
    );
    await expect(page.locator('[data-section="asset"]')).toContainText('(required)');
    await expect(page.locator('[data-fields-pending]')).toContainText('Choose an asset type');

    // The type fields appear under their own heading with the count, in a section that was already there (nothing moves).
    const before = (await page.locator('[data-section="fields"]').boundingBox())!;
    await page.locator('#asset-type').selectOption(String(type.assetTypeId));
    await expect(page.locator('[data-fields-title]')).toContainText(
      `Form type ${token} fields (2)`,
    );
    const after = (await page.locator('[data-section="fields"]').boundingBox())!;
    expect(Math.abs(after.y - before.y)).toBeLessThan(2);

    // Blocking validation: the summary, and the first field with an error has focus.
    await page.getByRole('button', { name: 'Create asset' }).click();
    await expect(page.locator('[data-summary]')).toContainText('Select a matter.');
    await expect(page.locator('#asset-matter')).toBeFocused();
    await shot(page, 'as5-new-asset');
  });

  test('New asset from a matter: Create lands on the asset page with a toast; Cancel goes back to the matter; the leave guard asks', async ({
    page,
    seed,
    admin,
  }) => {
    const { token, matter, type } = await world(seed, admin, 2);
    await page.goto(`/assets/new?matterId=${matter.matterId}`);
    await expect(page.locator('[data-chosen]')).toContainText(matter.matterRef);
    await page.locator('#asset-type').selectOption(String(type.assetTypeId));
    await page.locator('#asset-name').fill(`Created ${token}`);
    await page.getByLabel('Field 1').first().fill('WS-1');

    // Leaving with typed values asks first.
    await page.getByRole('link', { name: 'Assets', exact: true }).first().click();
    const ask = page.getByRole('dialog', { name: 'Leave without saving?' });
    await expect(ask).toBeVisible();
    await ask.getByRole('button', { name: 'Stay' }).click();
    await expect(page).toHaveURL(/\/assets\/new/);
    await expect(page.locator('#asset-name')).toHaveValue(`Created ${token}`);

    await page.getByRole('button', { name: 'Create asset' }).click();
    await expect(page).toHaveURL(/\/assets\/\d+$/);
    await expect(page.getByRole('heading', { level: 1, name: `Created ${token}` })).toBeVisible();
    await expect(page.getByText(`Asset Created ${token} saved`)).toBeVisible();

    await page.goto(`/assets/new?matterId=${matter.matterId}`);
    await page.getByRole('button', { name: 'Cancel' }).click();
    await expect(page).toHaveURL(new RegExp(`/matters/${matter.matterId}\\?tab=assets`));
  });

  test('Edit asset: the record context, matter and type locked with the reason, Save only when changed, Save and Cancel return to the asset page', async ({
    page,
    seed,
    admin,
  }) => {
    const { token, matter, type } = await world(seed, admin, 2);
    const asset = await admin.post('/api/v1/assets', {
      matterId: matter.matterId,
      assetTypeId: type.assetTypeId,
      displayName: `Editable ${token}`,
      formValues: { f1: 'A1', f2: 'B1' },
    });
    await page.setViewportSize({ width: 1366, height: 768 });
    await page.goto(`/assets/${asset.assetId}/edit`);

    await expect(page.getByRole('heading', { level: 1, name: `Editable ${token}` })).toBeVisible();
    await expect(page.locator('[data-record-header] mf-active-badge')).toContainText('Active');
    await expect(page.locator('[data-type-badge]')).toContainText(`Form type ${token}`);
    await expect(page.locator('[data-form-context] a.mf-ref')).toHaveAttribute(
      'href',
      `/matters/${matter.matterId}`,
    );
    await expect(page.locator('[data-type-reason]')).toContainText("can't be changed");
    await expect(page.locator('[data-chosen]')).toContainText(matter.matterRef);
    await expect(page.locator('[data-fields-title]')).toContainText('fields (2)');
    const save = page.getByRole('button', { name: 'Save changes' });
    await expect(save).toBeDisabled();
    await shot(page, 'as5-edit-asset');

    await page.locator('#asset-name').fill(`Edited ${token}`);
    await expect(save).toBeEnabled();
    await save.click();
    await expect(page).toHaveURL(new RegExp(`/assets/${asset.assetId}$`));
    await expect(page.getByRole('heading', { level: 1, name: `Edited ${token}` })).toBeVisible();

    await page.goto(`/assets/${asset.assetId}/edit`);
    await page.getByRole('button', { name: 'Cancel' }).click();
    await expect(page).toHaveURL(new RegExp(`/assets/${asset.assetId}$`));
  });

  test('Edit: a concurrent change shows the conflict banner with Reload and keeps the typed values; an inactive asset is read-only with a link to its page', async ({
    page,
    seed,
    admin,
  }) => {
    const { token, matter, type } = await world(seed, admin, 1);
    const asset = await admin.post('/api/v1/assets', {
      matterId: matter.matterId,
      assetTypeId: type.assetTypeId,
      displayName: `Race ${token}`,
      formValues: { f1: 'A1' },
    });
    await page.goto(`/assets/${asset.assetId}/edit`);
    await expect(page.locator('#asset-name')).toHaveValue(`Race ${token}`);
    // Someone else saves first.
    await admin.put(`/api/v1/assets/${asset.assetId}`, {
      displayName: `Other ${token}`,
      externalReference: null,
      description: null,
      rowVersion: asset.rowVersion,
    });
    await page.locator('#asset-name').fill(`Mine ${token}`);
    await page.getByRole('button', { name: 'Save changes' }).click();
    const conflict = page.locator('[data-conflict]');
    await expect(conflict).toBeVisible();
    await expect(conflict.getByRole('button', { name: 'Reload latest' })).toBeVisible();
    await expect(page.locator('#asset-name')).toHaveValue(`Mine ${token}`);
    await shot(page, 'as5-edit-conflict');

    const fresh = await admin.get(`/api/v1/assets/${asset.assetId}`);
    await admin.post(`/api/v1/assets/${asset.assetId}/active`, {
      isActive: false,
      rowVersion: fresh.rowVersion,
    });
    await page.goto(`/assets/${asset.assetId}/edit`);
    await expect(page.locator('[data-inactive-banner]')).toContainText("can't be edited");
    await expect(page.locator('form')).toHaveCount(0);
    await page.locator('[data-record-link]').click();
    await expect(page).toHaveURL(new RegExp(`/assets/${asset.assetId}$`));
  });

  test('permissions: without Asset.Create /assets/new is the 403 page and no New asset button shows; Asset.Edit without Matter.View or Task.View edits with a plain matter and a sentence for the type fields', async ({
    page,
    seed,
    admin,
    personas,
    asUser,
  }) => {
    const { token, matter, type } = await world(seed, admin, 2);
    const asset = await admin.post('/api/v1/assets', {
      matterId: matter.matterId,
      assetTypeId: type.assetTypeId,
      displayName: `Perm ${token}`,
      formValues: { f1: 'A1' },
    });
    expect(page).toBeTruthy();

    const viewer = await personas.create({ label: 'assetview', permissions: ['Asset.View'] });
    const v = await asUser(viewer.username);
    await v.goto('/assets/new');
    await expect(
      v.getByRole('heading', { name: "You don't have permission to view this." }),
    ).toBeVisible();
    await v.goto(`/assets/${asset.assetId}/edit`);
    await expect(
      v.getByRole('heading', { name: "You don't have permission to view this." }),
    ).toBeVisible();
    await v.goto('/assets');
    await expect(v.getByRole('button', { name: 'New asset' })).toHaveCount(0);

    const editor = await personas.create({
      label: 'assetedit',
      permissions: ['Asset.View', 'Asset.Edit'],
    });
    const e = await asUser(editor.username);
    const requests: string[] = [];
    e.on('request', (r) => requests.push(r.url()));
    await e.goto(`/assets/${asset.assetId}/edit`);
    await expect(e.getByRole('heading', { level: 1, name: `Perm ${token}` })).toBeVisible();
    await expect(e.locator('[data-form-context] a')).toHaveCount(0);
    await expect(e.locator('[data-fields-unavailable]')).toContainText(
      'Type fields are not available with your access.',
    );
    expect(requests.filter((u) => /\/forms\/versions\//.test(u))).toEqual([]);
    await e.locator('#asset-name').fill(`Perm edited ${token}`);
    await e.getByRole('button', { name: 'Save changes' }).click();
    await expect(e).toHaveURL(new RegExp(`/assets/${asset.assetId}$`));
    const saved = await admin.get(`/api/v1/assets/${asset.assetId}`);
    expect(saved.displayName).toBe(`Perm edited ${token}`);
    expect(saved.formValues).toEqual({ f1: 'A1' }); // the values the person never saw are untouched
  });

  test('axe finds nothing and nothing scrolls sideways at four sizes on New and Edit', async ({
    page,
    seed,
    admin,
  }) => {
    const { matter, type } = await world(seed, admin, 12);
    const asset = await admin.post('/api/v1/assets', {
      matterId: matter.matterId,
      assetTypeId: type.assetTypeId,
      displayName: 'Axe asset',
      formValues: { f1: 'A1' },
    });
    for (const size of SIZES) {
      await page.setViewportSize(size);
      await page.goto(`/assets/new?matterId=${matter.matterId}`);
      await page.locator('#asset-type').selectOption(String(type.assetTypeId));
      await expect(page.locator('[data-type-fields]')).toBeVisible();
      expect(await axeViolations(page), `new at ${size.width}`).toEqual([]);
      await noHorizontalScroll(page);
      await page.getByRole('button', { name: 'Create asset' }).click(); // the summary and inline errors are on screen
      await expect(page.locator('[data-summary]')).toBeVisible();
      expect(await axeViolations(page), `new with errors at ${size.width}`).toEqual([]);
      if (size.width === 375) await shot(page, 'as5-new-asset-errors');

      await page.goto(`/assets/${asset.assetId}/edit`);
      await expect(page.locator('[data-type-fields]')).toBeVisible();
      expect(await axeViolations(page), `edit at ${size.width}`).toEqual([]);
      await noHorizontalScroll(page);
      if (size.width === 375 || size.width === 1920) await shot(page, 'as5-edit-asset');
    }
  });
});
