import { Page } from '@playwright/test';
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
 * Task Types UX epic #352, WP-TY8, FD1 (#408): Preview and Validation are tabs of the details column (with Properties), "Validation (2)"
 * carries the live error count, and Publish... with errors left shows the Validation tab. Below 1100 px the details column is a bottom
 * sheet (a native modal dialog) opened from the Fields pane. Screenshots go to E2E_SCREENSHOTS when it is set.
 */
const tab = (page: Page, name: string) => page.getByRole('tab', { name });

/** Adds a Dropdown and removes its two options: two errors (the field and the form) are left. */
async function addBrokenDropdown(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Add Dropdown' }).click();
  for (let i = 0; i < 2; i++) {
    await page
      .getByRole('button', { name: /^Remove option/ })
      .first()
      .click();
  }
}

test.describe('FD1: Properties, Preview and Validation tabs (wide)', () => {
  test.use({ viewport: { width: 1366, height: 768 } });

  test('the tab keyboard model: one tab stop, arrows, Home and End, focus follows the selection', async ({
    page,
    seed,
    admin,
  }) => {
    const world = await typeWorld(seed, admin, { draft: true, published: false });
    await page.goto(world.url);
    const list = page.getByRole('tablist', { name: 'Field details' });
    await expect(list.getByRole('tab')).toHaveText([/Properties/, /Preview/, /Validation/]);
    await expect(tab(page, 'Properties')).toHaveAttribute('aria-selected', 'true');
    await expect(tab(page, 'Preview')).toHaveAttribute('tabindex', '-1');
    await tab(page, 'Properties').focus();
    await page.keyboard.press('ArrowRight');
    await expect(tab(page, 'Preview')).toBeFocused();
    await expect(tab(page, 'Preview')).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('[data-panel="preview"]')).toBeVisible();
    await expect(page.locator('[data-panel="props"]')).toBeHidden();
    await page.keyboard.press('End');
    await expect(tab(page, 'Validation')).toBeFocused();
    await page.keyboard.press('ArrowRight');
    await expect(tab(page, 'Properties')).toBeFocused();
    await page.keyboard.press('ArrowLeft');
    await expect(tab(page, 'Validation')).toBeFocused();
    await page.keyboard.press('Home');
    await expect(tab(page, 'Properties')).toBeFocused();
    // The tab panel is named by its tab.
    await expect(page.getByRole('tabpanel', { name: 'Properties' })).toBeVisible();
    // One Tab stop: Tab leaves the list instead of visiting the other two tabs.
    await page.keyboard.press('Tab');
    await expect(page.locator('.fd__tab:focus')).toHaveCount(0);
  });

  test('Validation (n) shows the live error count, "Go to" opens the field, fixing it removes the count', async ({
    page,
    seed,
    admin,
  }) => {
    const world = await typeWorld(seed, admin, { draft: true, published: false });
    await page.goto(world.url);
    await expect(tab(page, 'Validation')).toHaveText(/^\s*Validation\s*$/);
    await addBrokenDropdown(page);
    await expect(tab(page, 'Validation')).toContainText(/\(2\)/);
    await tab(page, 'Validation').click();
    await expect(page.locator('[data-panel="issues"]')).toContainText('2 errors to fix');
    await page
      .getByRole('button', { name: /^Go to/ })
      .first()
      .click();
    await expect(tab(page, 'Properties')).toHaveAttribute('aria-selected', 'true');
    await page.getByRole('button', { name: 'Add option' }).click();
    await expect(tab(page, 'Validation')).toHaveText(/^\s*Validation\s*$/);
    await tab(page, 'Validation').click();
    await expect(page.locator('[data-valid]')).toContainText('This form can be published');
  });

  test('Publish... with errors left does not open the dialog: the Validation tab opens and takes focus', async ({
    page,
    seed,
    admin,
  }) => {
    const world = await typeWorld(seed, admin, { draft: true, published: false });
    await page.goto(world.url);
    await addBrokenDropdown(page);
    await expect(tab(page, 'Properties')).toHaveAttribute('aria-selected', 'true');
    await page.getByRole('button', { name: 'Publish...' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(tab(page, 'Validation')).toBeFocused();
    await expect(tab(page, 'Validation')).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('[data-form-alert]')).toContainText(
      'Fix 2 errors before publishing. They are listed under Validation.',
    );
    await expectNoViolations(page, 'Validation tab with errors');
    await shoot(page, 'tabs-validation', { w: 1366, h: 768 });
    // Fixing the errors clears the message and Publish... opens the dialog again.
    await page
      .getByRole('button', { name: /^Go to/ })
      .first()
      .click();
    await page.getByRole('button', { name: 'Add option' }).click();
    await expect(page.locator('[data-form-alert]')).toHaveCount(0);
    await page.getByRole('button', { name: 'Publish...' }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
  });

  test('Preview is a tab that stays alive: the answers survive a trip to another tab, Test submit validates', async ({
    page,
    seed,
    admin,
  }) => {
    const world = await typeWorld(seed, admin, {
      draft: true,
      fields: [{ key: 'ref', label: 'Reference', control: 'TEXT', required: true }],
    });
    await page.goto(world.url);
    await tab(page, 'Preview').click();
    const preview = page.locator('[data-panel="preview"]');
    await expect(preview.getByLabel(/Reference/)).toBeVisible();
    await preview.getByLabel(/Reference/).fill('keep me');
    await tab(page, 'Properties').click();
    await tab(page, 'Preview').click();
    await expect(preview.getByLabel(/Reference/)).toHaveValue('keep me');
    await preview.getByLabel(/Reference/).fill('');
    await preview.getByRole('button', { name: 'Test submit' }).click();
    await expect(preview).toContainText(/required/i);
    await shoot(page, 'tabs-preview', { w: 1366, h: 768 });
    await expectNoViolations(page, 'Preview tab');
  });

  test('choosing a field returns to Properties from the other tabs', async ({
    page,
    seed,
    admin,
  }) => {
    const world = await typeWorld(seed, admin, { draft: true });
    await page.goto(world.url);
    await tab(page, 'Preview').click();
    await page.locator('[data-row="2"]').click();
    await expect(tab(page, 'Properties')).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByLabel('Label', { exact: true })).toHaveValue('Field 3');
  });
});

for (const size of SIZES) {
  test.describe(`FD1 narrow layout at ${size.w}x${size.h}`, () => {
    test.use({ viewport: { width: size.w, height: size.h } });
    const wide = size.w >= 1100;

    test('details: wide shows the tabs in a column, narrow opens them as a sheet; axe 0, no side scroll', async ({
      page,
      seed,
      admin,
    }) => {
      test.setTimeout(120_000);
      const world = await typeWorld(seed, admin, { draft: true, fields: manyFields(30, true) });
      await page.goto(world.url);
      await expect(page.getByRole('button', { name: 'Publish...' })).toBeVisible();
      await noSideScroll(page);
      if (size.w >= 768) await noPageScroll(page);
      if (wide) {
        await expect(page.getByRole('button', { name: 'Add field', exact: true })).toHaveCount(0);
        await page.locator('[data-row="2"]').click();
        await shoot(page, 'tabs-properties', size);
        await expectNoViolations(page, 'wide properties');
        await tab(page, 'Preview').click();
        await shoot(page, 'tabs-preview', size);
        await expectNoViolations(page, 'wide preview');
        await tab(page, 'Validation').click();
        await shoot(page, 'tabs-validation-ok', size);
        await expectNoViolations(page, 'wide validation');
        return;
      }
      // Fields come first and there is no palette in the page: one Add field button.
      await expect(page.locator('[data-palette]')).toHaveCount(0);
      await expect(page.locator('[data-row="0"]')).toBeInViewport();
      await shoot(page, 'sheet-fields', size);
      await expectNoViolations(page, 'narrow fields');

      const row = page.locator('[data-row="2"]');
      await row.click();
      const sheet = page.getByRole('dialog', { name: 'Field details' });
      await expect(sheet).toBeVisible();
      await expect(sheet.getByLabel('Label', { exact: true })).toHaveValue(/^Request field 3 /);
      await shoot(page, 'sheet-properties', size);
      await expectNoViolations(page, 'properties sheet');
      await tab(page, 'Preview').click();
      await shoot(page, 'sheet-preview', size);
      await expectNoViolations(page, 'preview sheet');
      await tab(page, 'Validation').click();
      await expectNoViolations(page, 'validation sheet');
      await page.keyboard.press('Escape');
      await expect(sheet).toBeHidden();
      await expect(row).toBeFocused(); // focus returns to the field that was chosen
    });

    if (!wide) {
      test('the sheet traps focus, closes with Escape and Close, and returns focus', async ({
        page,
        seed,
        admin,
      }) => {
        const world = await typeWorld(seed, admin, { draft: true });
        await page.goto(world.url);
        const preview = page.getByRole('button', { name: 'Preview', exact: true });
        await preview.focus();
        await page.keyboard.press('Enter');
        const sheet = page.getByRole('dialog', { name: 'Field details' });
        await expect(sheet).toBeVisible();
        await expect(tab(page, 'Preview')).toHaveAttribute('aria-selected', 'true');
        // Focus never reaches the page behind the sheet however often Tab is pressed (the browser's own controls and the sheet are the only stops).
        for (let i = 0; i < 12; i++) {
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
        await sheet.getByRole('tab', { name: 'Preview' }).focus();
        await page.keyboard.press('Escape');
        await expect(sheet).toBeHidden();
        await expect(preview).toBeFocused();

        await preview.click();
        await page.getByRole('button', { name: 'Close' }).click();
        await expect(sheet).toBeHidden();
        await expect(preview).toBeFocused();

        // The Validation button carries the error count of the form.
        await page.getByRole('button', { name: 'Add field' }).click();
        await page.getByRole('button', { name: 'Add Dropdown' }).click();
        for (let i = 0; i < 2; i++) {
          await page
            .getByRole('button', { name: /^Remove option/ })
            .first()
            .click();
        }
        await page.getByRole('button', { name: 'Close' }).click();
        await expect(page.getByRole('button', { name: /^Validation/ })).toContainText('(2)');
        await page.getByRole('button', { name: 'Publish...' }).click();
        await expect(page.getByRole('dialog', { name: 'Field details' })).toBeVisible();
        await expect(tab(page, 'Validation')).toBeFocused();
        await shoot(page, 'sheet-validation', size);
        await expectNoViolations(page, 'validation sheet with errors');
      });
    }
  });
}

test.describe("FD1 permissions: the designer follows its owner's permission", () => {
  test('TaskType.Manage opens the task type designer, Workflow.Manage the step designer, Task.View only gets 403', async ({
    seed,
    admin,
    asUser,
  }) => {
    const type = await typeWorld(seed, admin, { draft: true });
    const step = await stepWorld(seed, admin, { draft: true });

    const typeRole = await seed.role(['TaskType.Manage', 'Task.View'], 'Type only');
    const typePage = await asUser((await seed.user([typeRole.name], 'tt-ttonly')).username);
    await typePage.goto(type.url);
    await expect(typePage.getByRole('tab', { name: 'Properties' })).toBeVisible();
    await expect(typePage.getByRole('button', { name: 'Publish...' })).toBeVisible();
    await typePage.goto(step.url);
    await expect(
      typePage.getByRole('heading', { name: "You don't have permission to view this." }),
    ).toBeVisible();

    const wfRole = await seed.role(['Workflow.Manage', 'Task.View'], 'Workflow only');
    const wfPage = await asUser((await seed.user([wfRole.name], 'tt-wfonly')).username);
    await wfPage.goto(step.url);
    await expect(wfPage.getByRole('tab', { name: 'Validation' })).toBeVisible();
    await wfPage.goto(type.url);
    await expect(
      wfPage.getByRole('heading', { name: "You don't have permission to view this." }),
    ).toBeVisible();

    const viewerRole = await seed.role(['Task.View'], 'Viewer');
    const viewer = await asUser((await seed.user([viewerRole.name], 'tt-viewer')).username);
    for (const url of [type.url, step.url]) {
      await viewer.goto(url);
      await expect(
        viewer.getByRole('heading', { name: "You don't have permission to view this." }),
      ).toBeVisible();
    }
  });
});
