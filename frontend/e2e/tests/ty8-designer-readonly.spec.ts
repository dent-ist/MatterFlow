import { Page } from '@playwright/test';
import { expect, test } from '../support/fixtures';
import {
  SIZES,
  expectNoViolations,
  manyFields,
  noPageScroll,
  noSideScroll,
  shoot,
  typeWorld,
} from '../support/designer';

/**
 * Task Types UX epic #352, WP-TY8, FD2 and FD3 (#409): a read-only (published or retired) version shows the Fields list and the Preview
 * side by side, and the title carries the version as a badge ("Published v3", "Draft v4") with the published version as muted text
 * while a draft exists. Screenshots go to E2E_SCREENSHOTS when it is set.
 */
const badge = (page: Page) => page.getByRole('heading', { level: 1 }).locator('[data-status]');

for (const size of SIZES) {
  test.describe(`FD2 and FD3 at ${size.w}x${size.h}`, () => {
    test.use({ viewport: { width: size.w, height: size.h } });
    const wide = size.w >= 1100;

    test('published (read-only): badge with icon in the title, Fields and Preview side by side, axe 0', async ({
      page,
      seed,
      admin,
    }) => {
      const world = await typeWorld(seed, admin, { published: true, fields: manyFields(14) });
      await page.goto(world.url);
      await expect(badge(page)).toHaveText('Published v1');
      await expect(badge(page).locator('i.pi')).toHaveCount(1);
      await expect(page.locator('[data-published-note]')).toHaveCount(0);
      await expect(page.getByRole('button', { name: 'Retire version' })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Create new draft' })).toBeVisible();
      await expect(page.locator('[data-readonly-banner]')).toContainText("can't be edited");
      await noSideScroll(page);
      if (size.w >= 768) await noPageScroll(page);
      await expect(page.locator('[data-palette]')).toHaveCount(0);

      if (wide) {
        // Fields on the left, Preview beside it (the Preview tab is selected), no empty right half.
        await expect(page.getByRole('tab', { name: 'Preview' })).toHaveAttribute(
          'aria-selected',
          'true',
        );
        const fields = await page.locator('.fd__canvas').boundingBox();
        const side = await page.locator('.fd__side').boundingBox();
        const holder = await page.locator('mf-form-designer').boundingBox();
        expect(fields && side && holder).toBeTruthy();
        expect(Math.abs(fields!.y - side!.y)).toBeLessThanOrEqual(1);
        expect(side!.x).toBeGreaterThan(fields!.x + fields!.width - 1);
        expect(side!.x + side!.width).toBeGreaterThan(holder!.x + holder!.width - 4); // the right edge is used
        await expect(page.locator('[data-panel="preview"] mf-dynamic-form')).toBeVisible();
        await shoot(page, 'readonly-published', size);
        await expectNoViolations(page, 'read-only published');
        // Choosing a field keeps the Preview beside the list; Properties are one tab away, read-only.
        await page.locator('[data-row="1"]').click();
        await expect(page.getByRole('tab', { name: 'Preview' })).toHaveAttribute(
          'aria-selected',
          'true',
        );
        await page.getByRole('tab', { name: 'Properties' }).click();
        await expect(page.getByLabel('Label', { exact: true })).toBeDisabled();
      } else {
        await expect(page.getByRole('button', { name: 'Add field' })).toHaveCount(0);
        await page.getByRole('button', { name: 'Preview', exact: true }).click();
        await expect(page.getByRole('dialog', { name: 'Field details' })).toBeVisible();
        await shoot(page, 'readonly-sheet', size);
        await expectNoViolations(page, 'read-only sheet');
        await page.keyboard.press('Escape');
      }
      if (!wide) {
        await shoot(page, 'readonly-published', size);
        await expectNoViolations(page, 'read-only published');
      }
    });

    test('a draft beside a published version: badge Draft v2 and "(published: v1)", Open draft from the read-only version', async ({
      page,
      seed,
      admin,
    }) => {
      const world = await typeWorld(seed, admin, {
        published: true,
        draft: true,
        fields: manyFields(8),
      });
      await page.goto(world.url);
      await expect(badge(page)).toHaveText('Draft v2');
      await expect(page.locator('[data-published-note]')).toHaveText('(published: v1)');
      await shoot(page, 'title-draft', size);
      await expectNoViolations(page, 'draft title');

      // Open the published version from the Versions dialog: read-only, with a link back to the draft instead of a second draft.
      await page.getByRole('button', { name: 'Versions (2)' }).click();
      const dialog = page.getByRole('dialog', { name: 'Form versions' });
      await dialog.getByRole('button', { name: 'v1' }).click();
      await expect(badge(page)).toHaveText('Published v1');
      await expect(page.getByRole('button', { name: 'Create new draft' })).toHaveCount(0);
      await expect(page.locator('[data-readonly-banner]')).toContainText('Open the draft');
      await page.getByRole('button', { name: 'Open draft v2' }).click();
      await expect(badge(page)).toHaveText('Draft v2');
      await noSideScroll(page);
    });

    test('retired: neutral badge with its icon, read-only', async ({ page, seed, admin }) => {
      const world = await typeWorld(seed, admin, { published: true, fields: manyFields(5) });
      await page.goto(world.url);
      await page.getByRole('button', { name: 'Retire version' }).click();
      await page
        .getByRole('dialog')
        .getByRole('button', { name: /^Retire v1/ })
        .click();
      await expect(badge(page)).toHaveText('Retired v1');
      await expect(badge(page).locator('i.pi')).toHaveCount(1);
      await expect(page.getByRole('button', { name: 'Retire version' })).toHaveCount(0);
      await shoot(page, 'readonly-retired', size);
      await expectNoViolations(page, 'retired');
    });
  });
}

test.describe('FD2 and FD3: Versions dialog, long names and permissions', () => {
  test('Versions is a dialog: reachable by keyboard, focus returns to the button, a dirty draft asks before it is left', async ({
    page,
    seed,
    admin,
  }) => {
    await page.setViewportSize({ width: 1366, height: 768 });
    const world = await typeWorld(seed, admin, { published: true, draft: true });
    await page.goto(world.url);
    const versions = page.getByRole('button', { name: 'Versions (2)' });
    await versions.focus();
    await page.keyboard.press('Enter');
    const dialog = page.getByRole('dialog', { name: 'Form versions' });
    await expect(dialog.getByRole('row')).toHaveCount(3);
    await expectNoViolations(page, 'versions dialog');
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(versions).toBeFocused();

    // A dirty draft is not left silently.
    await page.getByRole('button', { name: 'Add Text' }).click();
    await versions.click();
    await dialog.getByRole('button', { name: 'v1' }).click();
    await expect(page.getByRole('dialog', { name: /Discard/ })).toBeVisible();
    await page.getByRole('button', { name: 'Keep editing' }).click();
    await expect(badge(page)).toHaveText('Draft v2');
    await expect(page.locator('[data-dirty]')).toBeVisible();
  });

  test('a long task type name wraps in the title and the badge stays', async ({
    page,
    seed,
    admin,
  }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    const world = await typeWorld(seed, admin, {
      published: true,
      name: `E2E ${'Very long task type name '.repeat(3)}${Date.now()}`,
    });
    await page.goto(world.url);
    await expect(badge(page)).toHaveText('Published v1');
    await noSideScroll(page);
    await expectNoViolations(page, 'long title');
  });

  test('permissions: TaskType.Manage sees the read-only version, Task.View only gets the 403 page', async ({
    seed,
    admin,
    asUser,
  }) => {
    const world = await typeWorld(seed, admin, { published: true });
    const typeRole = await seed.role(['TaskType.Manage', 'Task.View'], 'Type only');
    const typePage = await asUser((await seed.user([typeRole.name], 'tt-ttonly')).username);
    await typePage.goto(world.url);
    await expect(badge(typePage)).toHaveText('Published v1');
    const viewerRole = await seed.role(['Task.View'], 'Viewer');
    const viewer = await asUser((await seed.user([viewerRole.name], 'tt-viewer')).username);
    await viewer.goto(world.url);
    await expect(
      viewer.getByRole('heading', { name: "You don't have permission to view this." }),
    ).toBeVisible();
  });
});
