import { Locator, Page } from '@playwright/test';
import { expect, test } from '../support/fixtures';
import { atEverySize, SIZES } from '../support/screens';
import { uid } from '../support/seed';

/**
 * The inline asset type form (first-release patch, #530, BUG-2 and BUG-4, AD-C): the whole card shows at its natural height at every size,
 * a failed submit puts the summary at the top and focus on Name, and half-typed text is asked about before a tab switch or navigation.
 * #635 replaces the inline form with the record page and deletes this code; the spec then moves with it. Screenshots go to E2E_SCREENSHOTS
 * (docs/ux/admin-pages-review/fixes/ad1-first-release).
 */
const newButton = (page: Page) => page.getByRole('button', { name: 'New asset type' });
const form = (page: Page) => page.locator('[data-editor]');
const ask = (page: Page) => page.getByRole('dialog', { name: 'Leave without saving?' });

/** The element is inside the window: nothing of it is cut off by a box or the fixed page. */
async function expectInView(page: Page, target: Locator, what: string): Promise<void> {
  const box = await target.boundingBox();
  const size = page.viewportSize()!;
  expect(box, what).not.toBeNull();
  expect(box!.y, `${what}: top`).toBeGreaterThanOrEqual(0);
  expect(box!.y + box!.height, `${what}: bottom inside ${size.height}`).toBeLessThanOrEqual(
    size.height + 1,
  );
}

test.describe('Inline asset type form (#530)', () => {
  test('the whole form shows at every size: no boxed or sticky bar, no inner scroll', async ({
    page,
  }) => {
    await page.goto('/admin/asset-types');
    await newButton(page).click();
    await expect(form(page)).toBeVisible();
    await atEverySize(page, 'asset-type-form-open', async (size) => {
      await page.evaluate(() => window.scrollTo(0, 0));
      const card = form(page);
      // The card is not cut off by a box of its own.
      expect(
        await card.evaluate((el) => el.scrollHeight <= el.clientHeight + 1),
        `form is not an inner scroll box at ${size.width}`,
      ).toBe(true);
      // The action bar sits in the flow of the card, not stuck to a window edge.
      const bar = card.locator('.pg-actions');
      expect(await bar.evaluate((el) => getComputedStyle(el).position)).not.toBe('sticky');
      for (const control of [
        card.getByLabel('Name'),
        card.getByLabel('Description'),
        card.getByLabel('Order'),
        card.getByRole('button', { name: 'Create asset type' }),
        card.getByRole('button', { name: 'Cancel' }),
      ]) {
        await expect(control).toBeVisible();
      }
      // Where the page is fixed (768 px and wider) the card must be fully inside the window; on a phone the page scrolls normally.
      if (size.width >= 768) {
        await expectInView(page, card, `form at ${size.width}x${size.height}`);
        await expectInView(page, bar, `form buttons at ${size.width}x${size.height}`);
      }
    });
  });

  test('a failed submit shows one summary at the top and puts focus on Name', async ({ page }) => {
    await page.goto('/admin/asset-types');
    await newButton(page).click();
    await form(page).getByRole('button', { name: 'Create asset type' }).click();
    const summary = form(page).locator('[data-summary]');
    await expect(summary).toBeVisible();
    await expect(summary).toHaveText(/Enter a name\./);
    expect((await summary.innerText()).match(/Enter a name\./g)).toHaveLength(1);
    await expect(form(page).getByLabel('Name')).toBeFocused();
    await expect(form(page).getByLabel('Name')).toHaveAttribute('aria-invalid', 'true');
    // The summary is above the first field.
    const [s, n] = await Promise.all([
      summary.boundingBox(),
      form(page).getByLabel('Name').boundingBox(),
    ]);
    expect(s!.y).toBeLessThan(n!.y);
  });

  test('a duplicate name from the server keeps the form open and focuses Name', async ({
    page,
    admin,
  }) => {
    const name = `Dup ${uid()}`;
    await admin.post('/api/v1/asset-types', { name, description: null });
    await page.goto('/admin/asset-types');
    await newButton(page).click();
    await form(page).getByLabel('Name').fill(name);
    await form(page).getByRole('button', { name: 'Create asset type' }).click();
    await expect(form(page)).toContainText('already exists');
    await expect(form(page).getByLabel('Name')).toBeFocused();
  });

  test('half-typed text is asked about before a tab switch: Stay keeps it, Leave goes', async ({
    page,
  }) => {
    await page.goto('/admin/asset-types');
    // An untouched form leaves without a question.
    await newButton(page).click();
    await page.getByRole('tab', { name: /Link Roles|Asset Link Roles/ }).click();
    await expect(ask(page)).toHaveCount(0);
    await expect(page).toHaveURL(/tab=link-roles/);
    await page.getByRole('tab', { name: /^Asset Types/ }).click();

    await newButton(page).click();
    const name = form(page).getByLabel('Name');
    await name.fill('Half typed');
    await page.getByRole('tab', { name: /Link Roles|Asset Link Roles/ }).click();
    await expect(ask(page)).toBeVisible();
    await expect(ask(page).getByRole('button', { name: 'Stay' })).toBeFocused();
    await ask(page).getByRole('button', { name: 'Stay' }).click();
    await expect(ask(page)).toHaveCount(0);
    await expect(page).not.toHaveURL(/tab=link-roles/);
    await expect(name).toHaveValue('Half typed');

    await page.getByRole('tab', { name: /Link Roles|Asset Link Roles/ }).click();
    await ask(page).getByRole('button', { name: 'Leave' }).click();
    await expect(page).toHaveURL(/tab=link-roles/);
    await expect(ask(page)).toHaveCount(0); // one question, not two
  });

  test('half-typed text is asked about before navigating away, and before another form replaces it', async ({
    page,
    admin,
  }) => {
    const name = `Keep ${uid()}`;
    await admin.post('/api/v1/asset-types', { name, description: null });
    await page.goto('/admin/asset-types');
    await newButton(page).click();
    await form(page).getByLabel('Name').fill('Half typed');

    // Another row's Edit would replace the typed text.
    await page.getByRole('button', { name: `Edit ${name}` }).click();
    await expect(ask(page)).toBeVisible();
    await ask(page).getByRole('button', { name: 'Stay' }).click();
    await expect(form(page).getByLabel('Name')).toHaveValue('Half typed');

    // Navigating to another page asks too.
    await page.getByRole('link', { name: 'Dashboard' }).first().click();
    await expect(ask(page)).toBeVisible();
    await ask(page).getByRole('button', { name: 'Stay' }).click();
    await expect(page).toHaveURL(/\/admin\/asset-types/);
    await expect(form(page).getByLabel('Name')).toHaveValue('Half typed');
  });

  test('permissions: AssetType.Manage alone opens the form; Task.View alone gets the 403 page', async ({
    seed,
    asUser,
  }) => {
    const manager = await asUser(
      (await seed.user([(await seed.role(['AssetType.Manage'], 'Types only')).name], 'ad1-mgr'))
        .username,
    );
    await manager.goto('/admin/asset-types');
    await manager.getByRole('button', { name: 'New asset type' }).click();
    await expect(manager.locator('[data-editor]')).toBeVisible();
    await manager.setViewportSize({ width: SIZES[2].width, height: SIZES[2].height });
    await expectInView(manager, manager.locator('[data-editor]'), 'form for the type manager');

    const viewer = await asUser(
      (await seed.user([(await seed.role(['Task.View'], 'Viewer')).name], 'ad1-view')).username,
    );
    await viewer.goto('/admin/asset-types');
    await expect(
      viewer.getByRole('heading', { name: "You don't have permission to view this." }),
    ).toBeVisible();
  });
});
