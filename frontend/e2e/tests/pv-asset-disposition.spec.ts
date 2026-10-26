import { axeAvailable, axeViolations } from '../support/axe';
import { expect, test } from '../support/fixtures';
import { SIZES, noHorizontalScroll, shot } from '../support/screens';
import { uid } from '../support/seed';

/**
 * PM v2, assets lane (epic #851, issues #865 and #866): the disposition of an asset (Active, Inactive, Pending disposition, Disposed) changed from the
 * record page and from the list (bulk), the impact line, the note, the history and the Assets list column, filter and warning.
 * Screenshots: E2E_SCREENSHOTS=docs/ux/pm-v2-review/fixes/pv-asset-disposition.
 */
test.describe('Asset disposition (PM v2)', () => {
  test.beforeEach(() => {
    expect(axeAvailable(), 'axe-core must be available (set E2E_AXE_PATH)').toBe(true);
  });

  async function openTask(seed: import('../support/seed').Seeder, linked: number) {
    const world = await seed.world();
    const token = uid();
    const asset = await seed.asset(world.matter, `Disposition ${token}`);
    for (let i = 0; i < linked; i++) {
      const task = await seed.task(world);
      await seed.admin.post(`/api/v1/tasks/${task.taskId}/assets`, { assetId: asset.assetId });
    }
    return { world, asset, token };
  }

  test('a project manager moves an asset to Pending disposition: the impact line, the note, the badge, the banner and the history', async ({
    seed,
    personas,
    asUser,
  }) => {
    const { asset } = await openTask(seed, 2);
    const pm = await personas.create({
      label: 'disposer',
      permissions: ['Asset.View', 'Asset.Edit', 'Asset.Dispose', 'Task.View', 'Matter.View'],
    });
    const page = await asUser(pm.username);
    await page.goto(`/assets/${asset.assetId}`);
    await page.getByRole('button', { name: 'More actions' }).click();
    await page.getByRole('menuitem', { name: 'Change disposition' }).click();

    const dialog = page.getByRole('dialog');
    await expect(dialog).toContainText(asset.displayName);
    await dialog.getByRole('radio', { name: /^Pending disposition/ }).check();
    await expect(dialog.locator('[data-disposition-impact]')).toContainText(
      '2 open tasks keep this link.',
    );
    await dialog.getByLabel(/^Note/).fill('Matter closed 12 Oct');
    await dialog.getByRole('button', { name: 'Set pending disposition' }).click();

    await expect(page.locator('[data-disposition-badge]')).toContainText('Pending disposition');
    await expect(page.locator('[data-inactive-banner]')).toContainText('pending disposition');
    await expect(page.locator('[data-inactive-linked-banner]')).toContainText('2 open tasks');
    await expect(page.locator('[data-disposition-change]').first()).toContainText(
      'Active to Pending disposition',
    );
    await expect(page.locator('[data-disposition-change]').first()).toContainText(
      'Matter closed 12 Oct',
    );
    await expect(page.getByRole('button', { name: 'Edit', exact: true })).toHaveCount(0);
  });

  test('Disposed needs a note and is final except for a correction back to Inactive; a person without Asset.Dispose cannot choose it', async ({
    seed,
    personas,
    asUser,
  }) => {
    const { asset } = await openTask(seed, 0);
    const editor = await personas.create({
      label: 'editor',
      permissions: ['Asset.View', 'Asset.Edit'],
    });
    const disposer = await personas.create({
      label: 'disposer2',
      permissions: ['Asset.View', 'Asset.Edit', 'Asset.Dispose'],
    });

    const plain = await asUser(editor.username);
    await plain.goto(`/assets/${asset.assetId}`);
    await plain.getByRole('button', { name: 'More actions' }).click();
    await plain.getByRole('menuitem', { name: 'Change disposition' }).click();
    await expect(plain.getByRole('radio', { name: /^Disposed/ })).toBeDisabled();
    await expect(plain.getByRole('dialog')).toContainText('needs the permission to dispose assets');
    await plain.keyboard.press('Escape');

    const page = await asUser(disposer.username);
    await page.goto(`/assets/${asset.assetId}`);
    await page.getByRole('button', { name: 'More actions' }).click();
    await page.getByRole('menuitem', { name: 'Change disposition' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('radio', { name: /^Disposed/ }).check();
    await dialog.getByRole('button', { name: 'Set disposed' }).click();
    await expect(dialog.locator('[data-confirm-error]')).toContainText('note is required');
    await dialog.getByLabel(/^Note/).fill('Destroyed');
    await dialog.getByRole('button', { name: 'Set disposed' }).click();
    await expect(page.locator('[data-disposition-badge]')).toContainText('Disposed');

    await page.getByRole('button', { name: 'More actions' }).click();
    await page.getByRole('menuitem', { name: 'Change disposition' }).click();
    await expect(page.getByRole('radio', { name: /^Active/ })).toBeDisabled();
    await expect(page.getByRole('radio', { name: /^Pending disposition/ })).toBeDisabled();
    await page.getByRole('radio', { name: /^Inactive/ }).check();
    await page.getByLabel(/^Note/).fill('Disposed by mistake');
    await page.getByRole('dialog').getByRole('button', { name: 'Set inactive' }).click();
    await expect(page.locator('[data-disposition-badge]')).toHaveCount(0);
    await expect(page.locator('[data-disposition-change]')).toHaveCount(3);
  });

  test('the Assets list shows the disposition and a warning, filters by it and changes several assets at once', async ({
    seed,
    page,
  }) => {
    const { asset, token } = await openTask(seed, 1);
    const other = await seed.asset((await seed.world()).matter, `Disposition other ${token}`);
    await seed.admin.put(`/api/v1/assets/${asset.assetId}/disposition`, {
      dispositionCode: 'PENDING_DISPOSITION',
      note: 'Closed',
      rowVersion: asset.rowVersion,
    });

    await page.setViewportSize({ width: 1366, height: 768 });
    await page.goto(`/assets?name=${token}&status=all`);
    const row = page.locator(`tr[data-asset-id="${asset.assetId}"]`);
    await expect(row.locator('[data-disposition-badge]')).toContainText('Pending disposition');
    await expect(row.locator('[data-inactive-linked]')).toContainText('Still linked to open tasks');

    await page.goto(`/assets?name=${token}&status=pending`);
    await expect(page.locator('tbody tr[data-asset-id]')).toHaveCount(1);
    await page.goto(`/assets?name=${token}&status=all`);
    await expect(page.locator('tbody tr[data-asset-id]')).toHaveCount(2);

    await page.locator(`tr[data-asset-id="${other.assetId}"] [data-select-row]`).check();
    await expect(page.locator('[data-bulk-count]')).toContainText('1 asset selected');
    await page.locator('[data-select-all]').check();
    await expect(page.locator('[data-bulk-count]')).toContainText('2 assets selected');
    await page.locator('[data-bulk-disposition]').click();
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('radio', { name: /^Inactive/ }).check();
    await dialog.getByRole('button', { name: 'Change 2 assets' }).click();
    await expect(dialog.locator('[data-disposition-summary]')).toContainText('2 changed');
    await dialog.getByRole('button', { name: 'Close' }).first().click();
    await expect(
      page.locator(`tr[data-asset-id="${other.assetId}"] [data-disposition-badge]`),
    ).toContainText('Inactive');
  });

  test('axe finds nothing and nothing scrolls sideways at four sizes: record, dialog and list', async ({
    seed,
    page,
  }) => {
    const { asset, token } = await openTask(seed, 1);
    for (const size of SIZES) {
      await page.setViewportSize(size);
      await page.goto(`/assets/${asset.assetId}`);
      await expect(page.getByRole('heading', { level: 1, name: asset.displayName })).toBeVisible();
      expect(await axeViolations(page), `record at ${size.width}`).toEqual([]);
      await noHorizontalScroll(page);

      await page.getByRole('button', { name: 'More actions' }).click();
      await page.getByRole('menuitem', { name: 'Change disposition' }).click();
      await page.getByRole('radio', { name: /^Pending disposition/ }).check();
      await expect(page.getByRole('dialog')).toBeVisible();
      expect(await axeViolations(page), `dialog at ${size.width}`).toEqual([]);
      await noHorizontalScroll(page);
      if (size.width === 1366 || size.width === 375) await shot(page, 'pv-disposition-dialog');
      await page.keyboard.press('Escape');
      await expect(page.getByRole('dialog')).toHaveCount(0);

      await page.goto(`/assets?name=${token}&status=all`);
      await expect(page.locator('tbody tr[data-asset-id], li.rc').first()).toBeVisible();
      expect(await axeViolations(page), `list at ${size.width}`).toEqual([]);
      await noHorizontalScroll(page);
      if (size.width === 1366 || size.width === 375) await shot(page, 'pv-disposition-list');
    }
  });
});
