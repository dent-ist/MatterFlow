import { Page } from '@playwright/test';
import { expect, test } from '../support/fixtures';
import {
  SIZES,
  assetTypeWorld,
  customFieldWorld,
  expectNoViolations,
  manyFields,
  noPageScroll,
  noSideScroll,
  shoot,
  typeWorld,
} from '../support/designer';

/**
 * Task Types UX epic #352, WP-TY8, #412: the designer is ONE shared component, so the two extra owners (Asset Types, and the Custom
 * Fields of Client, Matter and Project) get the same layout as Task Types and Steps. This walks their designer routes at four widths:
 * layout, publish, retire, permission (`AssetType.Manage`, `CustomField.Manage`), axe. Their own list and edit screens are not touched.
 *
 * The custom-field forms are singletons shared by every test, so nothing there is published or retired for real: the publish and retire
 * dialogs are opened and cancelled. The Asset Type is created for the test and goes through the whole lifecycle.
 * Screenshots go to the folder in E2E_SCREENSHOTS (docs/ux/task-types-review/fixes/ty8-designer) when it is set.
 */
const CUSTOM = ['client', 'matter', 'project'] as const;
const badge = (page: Page) => page.getByRole('heading', { level: 1 }).locator('[data-status]');

test.describe('Asset Type designer: the whole lifecycle in the shared layout', () => {
  test('create a draft, add a field, save, publish, read-only view, new draft, retire', async ({
    page,
    admin,
  }) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width: 1366, height: 768 });
    const world = await assetTypeWorld(admin);
    await page.goto(world.url);
    await expect(page.getByRole('heading', { level: 1 })).toContainText(`Form: ${world.name}`);
    await expect(page.getByText('This asset type has no form yet.')).toBeVisible();
    await page.getByRole('button', { name: 'Create new draft' }).click();
    await expect(badge(page)).toHaveText('Draft v1');

    // Draft: three panes, tabs, sticky buttons.
    await page.getByRole('button', { name: 'Add Text' }).click();
    await page.getByLabel('Label', { exact: true }).fill('Serial number');
    await expect(page.locator('[data-dirty]')).toBeVisible();
    await noPageScroll(page);
    await expectNoViolations(page, 'asset type draft');
    await shoot(page, 'assettype-draft', { w: 1366, h: 768 });
    await page.getByRole('button', { name: 'Save draft' }).click();
    await expect(page.locator('[data-notice]')).toContainText('Draft v1 saved.');
    await page.getByRole('button', { name: 'Publish...' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toContainText('Serial number');
    await dialog.getByRole('button', { name: 'Publish v1' }).click();
    await expect(badge(page)).toHaveText('Published v1');
    await expect(page.locator('[data-notice]')).toContainText('Version 1 published.');

    // Read-only: Fields and Preview side by side.
    await expect(page.getByRole('tab', { name: 'Preview' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await expect(page.locator('[data-panel="preview"]')).toContainText('Serial number');
    await shoot(page, 'assettype-published', { w: 1366, h: 768 });
    await expectNoViolations(page, 'asset type published');

    await page.getByRole('button', { name: 'Create new draft' }).click();
    await expect(badge(page)).toHaveText('Draft v2');
    await expect(page.locator('[data-published-note]')).toHaveText('(published: v1)');
    await page.getByRole('button', { name: 'Versions (2)' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'v1' }).click();
    await expect(badge(page)).toHaveText('Published v1');
    await page.getByRole('button', { name: 'Retire version' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Retire v1' }).click();
    await expect(badge(page)).toHaveText('Retired v1');
    await expect(page.getByRole('button', { name: 'Open draft v2' })).toBeVisible();
    await shoot(page, 'assettype-retired', { w: 1366, h: 768 });
    await expectNoViolations(page, 'asset type retired');
  });

  for (const size of SIZES) {
    test(`Asset Type draft and published at ${size.w}x${size.h}: layout, axe 0, no side scroll`, async ({
      page,
      admin,
    }) => {
      test.setTimeout(120_000);
      await page.setViewportSize({ width: size.w, height: size.h });
      const draft = await assetTypeWorld(admin, { fields: manyFields(35, true), draft: true });
      await page.goto(draft.url);
      await expect(page.getByRole('button', { name: 'Publish...' })).toBeVisible();
      await noSideScroll(page);
      if (size.w >= 768) await noPageScroll(page);
      await shoot(page, 'assettype-draft-layout', size);
      await expectNoViolations(page, 'asset type draft');

      const published = await assetTypeWorld(admin, { fields: manyFields(12), published: true });
      await page.goto(published.url);
      await expect(badge(page)).toHaveText('Published v1');
      await noSideScroll(page);
      if (size.w >= 768) await noPageScroll(page);
      await shoot(page, 'assettype-published-layout', size);
      await expectNoViolations(page, 'asset type published');
    });
  }
});

test.describe('Custom Fields designer (Client, Matter, Project)', () => {
  test.describe.configure({ mode: 'serial' });

  for (const object of CUSTOM) {
    for (const size of SIZES) {
      test(`${object} at ${size.w}x${size.h}: layout, publish and retire dialogs, axe 0, no side scroll`, async ({
        page,
        admin,
      }) => {
        test.setTimeout(120_000);
        const world = await customFieldWorld(admin, object);
        await page.setViewportSize({ width: size.w, height: size.h });
        await page.goto(world.url);
        const label = `${object[0].toUpperCase()}${object.slice(1)} custom fields`;
        // The object is named by what it is, "Matter custom fields" (#645), without the "Form:" of the other owners.
        await expect(page.getByRole('heading', { level: 1 })).toContainText(label);
        await expect(page.getByRole('heading', { level: 1 })).not.toContainText('Form:');
        await expect(page.getByRole('group', { name: 'Form actions' })).toBeVisible();
        await noSideScroll(page);
        if (size.w >= 768) await noPageScroll(page);
        await shoot(page, `customfields-${object}`, size);
        await expectNoViolations(page, `${object} custom fields`);

        // Whatever state the shared form is in, its dialogs open and cancel without changing anything.
        const publish = page.getByRole('button', { name: 'Publish...' });
        if (await publish.isVisible()) {
          await publish.click();
          const dialog = page.getByRole('dialog');
          if ((await dialog.count()) > 0) {
            await expect(dialog).toBeVisible();
            await expectNoViolations(page, `${object} publish dialog`);
            await page.keyboard.press('Escape');
            await expect(dialog).toHaveCount(0);
            await expect(publish).toBeFocused();
          }
        }
        const retire = page.getByRole('button', { name: 'Retire version' });
        if (await retire.isVisible()) {
          await retire.click();
          await expect(page.getByRole('dialog')).toBeVisible();
          await expectNoViolations(page, `${object} retire dialog`);
          await page.keyboard.press('Escape');
          await expect(page.getByRole('dialog')).toHaveCount(0);
          await expect(retire).toBeFocused();
        }
      });
    }
  }
});

test.describe('permissions of the shared designer', () => {
  // The server reads an Asset Type with Asset.View and every form with Task.View, so a manager of either owner also holds those (the roles below).
  test('AssetType.Manage opens Asset Types, CustomField.Manage opens Custom Fields; neither opens the other; Task.View only gets 403', async ({
    seed,
    admin,
    asUser,
  }) => {
    const asset = await assetTypeWorld(admin, { fields: manyFields(4), draft: true });
    const custom = await customFieldWorld(admin, 'project');
    const forbidden = (p: Page) =>
      expect(
        p.getByRole('heading', { name: "You don't have permission to view this." }),
      ).toBeVisible();

    const assetRole = await seed.role(
      ['AssetType.Manage', 'Asset.View', 'Task.View'],
      'Asset types',
    );
    const assetPage = await asUser((await seed.user([assetRole.name], 'tt-assets')).username);
    await assetPage.goto(asset.url);
    await expect(assetPage.getByRole('tab', { name: 'Properties' })).toBeVisible();
    await expect(assetPage.getByRole('button', { name: 'Publish...' })).toBeVisible();
    await assetPage.goto(custom.url);
    await forbidden(assetPage);

    const customRole = await seed.role(['CustomField.Manage', 'Task.View'], 'Custom fields');
    const customPage = await asUser((await seed.user([customRole.name], 'tt-custom')).username);
    await customPage.goto(custom.url);
    await expect(customPage.getByRole('tab', { name: 'Validation' })).toBeVisible();
    await customPage.goto(asset.url);
    await forbidden(customPage);

    const viewerRole = await seed.role(['Task.View'], 'Viewer');
    const viewer = await asUser((await seed.user([viewerRole.name], 'tt-viewer')).username);
    for (const w of [asset, custom]) {
      await viewer.goto(w.url);
      await forbidden(viewer);
    }
    // The task type designer is its own permission.
    const type = await typeWorld(seed, admin, { draft: true });
    await assetPage.goto(type.url);
    await forbidden(assetPage);
  });
});
