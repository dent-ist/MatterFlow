import { expect, test } from '../support/fixtures';
import {
  SIZES,
  expectNoViolations,
  manyFields,
  noPageScroll,
  noSideScroll,
  shoot,
  stepWorld,
  typeWorld,
} from '../support/designer';

/**
 * Task Types UX epic #352, WP-TY8, FD4 (#410): below 1100 px the Fields come first, "Add field" is one button that opens the palette as a
 * sheet, and the details are a sheet too. The first field is within the first screen at 375. Screenshots go to E2E_SCREENSHOTS when set.
 */
test.describe('FD4: phone order', () => {
  test.use({ viewport: { width: 375, height: 812 } });

  test('the first field is within the first screen; the palette is not in the page', async ({
    page,
    seed,
    admin,
  }) => {
    const world = await typeWorld(seed, admin, { draft: true, fields: manyFields(30, true) });
    await page.goto(world.url);
    const first = page.locator('[data-row="0"]');
    await expect(first).toBeVisible();
    const box = await first.boundingBox();
    expect(box!.y + box!.height).toBeLessThanOrEqual(812);
    expect(box!.y).toBeLessThan(500); // was y = 810 under the 14 palette buttons
    await expect(page.locator('[data-palette]')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Add field' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Add Text' })).toHaveCount(0);
    await noSideScroll(page);
    await shoot(page, 'phone-fields-first', { w: 375, h: 812 });
  });

  test('Add field opens the palette as a sheet: focus is trapped, Escape returns to the button', async ({
    page,
    seed,
    admin,
  }) => {
    const world = await typeWorld(seed, admin, { draft: true });
    await page.goto(world.url);
    const add = page.getByRole('button', { name: 'Add field' });
    await add.focus();
    await page.keyboard.press('Enter');
    const sheet = page.getByRole('dialog', { name: 'Add a field' });
    await expect(sheet).toBeVisible();
    await expect(sheet.getByRole('button', { name: /^Add / })).toHaveCount(14);
    await expectNoViolations(page, 'palette sheet');
    await shoot(page, 'phone-palette-sheet', { w: 375, h: 812 });
    for (let i = 0; i < 20; i++) {
      await page.keyboard.press('Tab');
      expect(
        await sheet.evaluate(
          (el) =>
            el.contains(document.activeElement) ||
            document.activeElement === document.body ||
            document.activeElement === null,
        ),
      ).toBe(true);
    }
    await page.keyboard.press('Escape');
    await expect(sheet).toBeHidden();
    await expect(add).toBeFocused();
    // Close does the same.
    await add.click();
    await page.getByRole('button', { name: 'Close' }).click();
    await expect(sheet).toBeHidden();
    await expect(add).toBeFocused();
  });

  test('choosing a control adds the field and focuses its label; closing returns to the new field', async ({
    page,
    seed,
    admin,
  }) => {
    const world = await typeWorld(seed, admin, { draft: true, fields: manyFields(4) });
    await page.goto(world.url);
    await page.getByRole('button', { name: 'Add field' }).click();
    await page.getByRole('button', { name: 'Add Text' }).click();
    // The palette sheet turns into the properties of the new field, with its label ready to type.
    const sheet = page.getByRole('dialog', { name: 'Field details' });
    await expect(sheet).toBeVisible();
    const label = sheet.getByLabel('Label', { exact: true });
    await expect(label).toBeFocused();
    await label.fill('Matter reference');
    await expectNoViolations(page, 'new field sheet');
    await shoot(page, 'phone-field-added', { w: 375, h: 812 });
    await page.keyboard.press('Escape');
    await expect(sheet).toBeHidden();
    // Added after the last field (nothing was selected), named, and focused in the list.
    const row = page.locator('[data-row="4"]');
    await expect(row).toContainText('Matter reference');
    await expect(row).toBeFocused();
    await expect(page.locator('[data-dirty]')).toBeVisible();
    await page.getByRole('button', { name: 'Save draft' }).click();
    await expect(page.locator('[data-notice]')).toContainText('saved');
  });

  test('keyboard only: add, name, move and leave the sheet without a pointer', async ({
    page,
    seed,
    admin,
  }) => {
    const world = await typeWorld(seed, admin, { draft: true, fields: manyFields(3) });
    await page.goto(world.url);
    await page.getByRole('button', { name: 'Add field' }).focus();
    await page.keyboard.press('Space');
    await page.getByRole('button', { name: 'Add Number' }).focus();
    await page.keyboard.press('Enter');
    await expect(page.getByLabel('Label', { exact: true })).toBeFocused();
    await page.keyboard.press('Control+a'); // the label starts as the control's name
    await page.keyboard.type('Items in');
    await page.keyboard.press('Escape');
    await expect(page.locator('[data-row="3"]')).toContainText('Items in');
    await expect(page.locator('[data-row="3"]')).toBeFocused();
    // The Up/Down/Delete buttons stay the reorder model (no shortcut keys).
    await page.getByRole('button', { name: 'Move Items in up' }).focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('[data-row="2"]')).toContainText('Items in');
    await expect(page.getByRole('button', { name: 'Move Items in up' })).toBeFocused();
  });

  test('a read-only version has no Add field; Preview is a sheet', async ({
    page,
    seed,
    admin,
  }) => {
    const world = await typeWorld(seed, admin, { published: true });
    await page.goto(world.url);
    await expect(page.getByRole('button', { name: 'Add field' })).toHaveCount(0);
    await page.getByRole('button', { name: 'Preview', exact: true }).click();
    await expect(page.getByRole('dialog', { name: 'Field details' })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Preview' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
  });
});

test.describe('FD4: the sheets follow the window', () => {
  test('widening the window past 1100 px closes an open sheet and shows the three panes', async ({
    page,
    seed,
    admin,
  }) => {
    const world = await typeWorld(seed, admin, { draft: true });
    await page.setViewportSize({ width: 1000, height: 800 });
    await page.goto(world.url);
    await page.getByRole('button', { name: 'Add field' }).click();
    await expect(page.getByRole('dialog', { name: 'Add a field' })).toBeVisible();
    await page.setViewportSize({ width: 1400, height: 800 });
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.locator('[data-palette]')).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Properties' })).toBeVisible();
    await page.setViewportSize({ width: 1000, height: 800 });
    await expect(page.locator('[data-palette]')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Add field' })).toBeVisible();
  });
});

for (const size of SIZES) {
  test(`palette and details at ${size.w}x${size.h}: axe 0 with the sheet or the pane open, no side scroll`, async ({
    page,
    seed,
    admin,
  }) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width: size.w, height: size.h });
    const world = await typeWorld(seed, admin, { draft: true, fields: manyFields(40, true) });
    await page.goto(world.url);
    await expect(page.locator('[data-row="0"]')).toBeVisible();
    if (size.w >= 768) await noPageScroll(page);
    await noSideScroll(page);
    if (size.w >= 1100) {
      await expect(page.getByRole('button', { name: 'Add Text' })).toBeVisible();
      await page.getByRole('button', { name: 'Add Text' }).click();
      await expect(page.getByLabel('Label', { exact: true })).toBeFocused();
    } else {
      await page.getByRole('button', { name: 'Add field' }).click();
      await shoot(page, 'palette-sheet', size);
      await expectNoViolations(page, 'palette sheet');
      await page.getByRole('button', { name: 'Add Text' }).click();
      await expect(
        page.getByRole('dialog', { name: 'Field details' }).getByLabel('Label', { exact: true }),
      ).toBeFocused();
      await page.keyboard.press('Escape');
      await noSideScroll(page);
    }
    await shoot(page, 'phone-order', size);
    await expectNoViolations(page, 'after adding a field');
  });
}

test.describe('FD4 permissions', () => {
  test('TaskType.Manage and Workflow.Manage add fields in their own designers; Task.View only gets the 403 page', async ({
    seed,
    admin,
    asUser,
  }) => {
    const type = await typeWorld(seed, admin, { draft: true });
    const step = await stepWorld(seed, admin, { draft: true });
    const roles = [
      { perms: ['TaskType.Manage', 'Task.View'], label: 'tt-ttonly', world: type },
      { perms: ['Workflow.Manage', 'Task.View'], label: 'tt-wfonly', world: step },
    ];
    for (const r of roles) {
      const role = await seed.role(r.perms, `${r.label} role`);
      const page = await asUser((await seed.user([role.name], r.label)).username);
      await page.setViewportSize({ width: 375, height: 812 });
      await page.goto(r.world.url);
      await page.getByRole('button', { name: 'Add field' }).click();
      await page.getByRole('button', { name: 'Add Checkbox' }).click();
      await expect(page.getByRole('dialog', { name: 'Field details' })).toBeVisible();
    }
    const viewerRole = await seed.role(['Task.View'], 'Viewer');
    const viewer = await asUser((await seed.user([viewerRole.name], 'tt-viewer')).username);
    await viewer.goto(type.url);
    await expect(
      viewer.getByRole('heading', { name: "You don't have permission to view this." }),
    ).toBeVisible();
  });
});
