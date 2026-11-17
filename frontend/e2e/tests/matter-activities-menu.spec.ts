import fs from 'node:fs';
import path from 'node:path';
import { Page } from '@playwright/test';
import { axeAvailable, axeViolations } from '../support/axe';
import { expect, test } from '../support/fixtures';

/**
 * Activities is an entry of the Matter's More Actions menu that opens a large dialog (#1404, epic #1389): no section, no jump link, no tab.
 * The entry needs Audit.View; the dialog loads only when it opens; Esc, the X, Close and the scrim close it and focus returns to More Actions;
 * `?tab=activities` and the old `?tab=activity` open the one page with the dialog and the parameter leaves with it. Screenshots go to E2E_SCREENSHOTS when it is set.
 */
const OUT = process.env['E2E_SCREENSHOTS'];
const SIZES = [
  [1366, 768],
  [1920, 1080],
] as const;

async function shot(page: Page, name: string): Promise<void> {
  if (!OUT) return;
  fs.mkdirSync(OUT, { recursive: true });
  const size = page.viewportSize()!;
  await page.screenshot({ path: path.join(OUT, `${name}-${size.width}x${size.height}.png`) });
}

const more = (page: Page) => page.locator('[data-overflow][aria-label="More actions"]');
const dialog = (page: Page) => page.getByRole('dialog', { name: /Activities/ });

test.describe('Matter > More Actions > Activities (#1404)', () => {
  for (const [width, height] of SIZES) {
    test(`opens the dialog from the menu, shows the list, is axe clean, and Esc closes it with focus back on More Actions at ${width}x${height}`, async ({
      page,
      seed,
    }) => {
      test.skip(!axeAvailable(), 'axe-core is not installed');
      const world = await seed.world();
      await seed.task(world);
      await page.setViewportSize({ width, height });
      await page.goto(`/matters/${world.matter.matterId}`);
      await expect(page.locator('[data-matter-one-page]')).toBeVisible();
      // No card, no jump link: Activities left the page.
      await expect(page.locator('#section-activities, [data-jump="activities"]')).toHaveCount(0);

      const requests: string[] = [];
      page.on('request', (r) => {
        if (/\/api\/v1\/audit\/search\?/.test(r.url())) requests.push(r.url());
      });
      await more(page).click();
      const items = page.getByRole('menuitem');
      const names = (await items.allTextContents()).map((t) => t.trim());
      expect(names.at(-1)).toMatch(/^Set Inactive/);
      const at = names.findIndex((n) => /^Activities/.test(n));
      expect(at, 'Activities is in the menu, before Set Inactive').toBeGreaterThanOrEqual(0);
      expect(at).toBeLessThan(names.length - 1);
      await shot(page, 'menu');
      expect(requests, 'nothing is asked before the dialog opens').toHaveLength(0);
      await page.getByRole('menuitem', { name: /^Activities/ }).click();

      const dlg = dialog(page);
      await expect(dlg).toBeVisible();
      await expect(dlg.locator('[data-panel-title]')).toContainText('Activities');
      await expect(dlg.locator('.mf-dlg__sub')).toContainText(world.matter.matterRef as string);
      expect((await dlg.boundingBox())!.width).toBeCloseTo(768, -1);
      await expect(dlg.locator('tbody tr[data-record-id]').first()).toBeVisible();
      await expect(dlg.getByRole('button', { name: /^Kind/ })).toBeVisible();
      // All three columns are in the frame: the list does not scroll sideways at the dialog's width.
      const frame = dlg.getByRole('region', { name: /Matter activities/ });
      const room = await frame.evaluate((el) => ({ sw: el.scrollWidth, cw: el.clientWidth }));
      await expect(dlg.getByRole('columnheader', { name: 'Who' })).toBeVisible();
      expect(room.sw, 'no sideways scroll').toBeLessThanOrEqual(room.cw + 1);
      expect(requests.length).toBeGreaterThan(0);
      await shot(page, 'dialog');
      expect(await axeViolations(page), 'dialog open').toEqual([]);
      await expect(page).not.toHaveURL(/tab=/);

      // Esc closes and focus returns to More Actions.
      await page.keyboard.press('Escape');
      await expect(page.getByRole('dialog')).toHaveCount(0);
      await expect(more(page)).toBeFocused();
    });
  }

  for (const how of ['the X', 'Close', 'a click on the scrim'] as const) {
    test(`${how} closes the dialog and focus returns to More Actions`, async ({ page, seed }) => {
      const world = await seed.world();
      await page.setViewportSize({ width: 1366, height: 768 });
      await page.goto(`/matters/${world.matter.matterId}`);
      await expect(page.locator('[data-matter-one-page]')).toBeVisible();
      await more(page).click();
      await page.getByRole('menuitem', { name: /^Activities/ }).click();
      await expect(dialog(page)).toBeVisible();
      if (how === 'the X') await page.locator('[data-panel-close]').click();
      else if (how === 'Close')
        await page.locator('[data-panel-cancel]').getByRole('button', { name: 'Close' }).click();
      else await page.mouse.click(1300, 400);
      await expect(page.getByRole('dialog')).toHaveCount(0);
      await expect(more(page)).toBeFocused();
    });
  }

  test('is in the full views too, and opening it there leaves the tab where it was', async ({
    page,
    seed,
  }) => {
    const world = await seed.world();
    await page.setViewportSize({ width: 1366, height: 768 });
    await page.goto(`/matters/${world.matter.matterId}?tab=tasks`);
    await expect(page.getByRole('tab', { name: /^Tasks/ })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await expect(page.getByRole('tab', { name: /Activities/ })).toHaveCount(0);
    await more(page).click();
    await page.getByRole('menuitem', { name: /^Activities/ }).click();
    await expect(dialog(page)).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page).toHaveURL(/tab=tasks/);
  });

  for (const param of ['activities', 'activity']) {
    test(`?tab=${param} opens the one page with the dialog; closing it removes the parameter and Back does not return to it`, async ({
      page,
      seed,
    }) => {
      const world = await seed.world();
      await page.setViewportSize({ width: 1366, height: 768 });
      await page.goto('/matters');
      await expect(page.locator('main h1')).toBeVisible();
      await page.goto(`/matters/${world.matter.matterId}?tab=${param}`);
      await expect(page.locator('[data-matter-one-page]')).toBeVisible();
      await expect(dialog(page)).toBeVisible();
      await expect(page.getByRole('tab')).toHaveCount(0);
      await page.keyboard.press('Escape');
      await expect(page.getByRole('dialog')).toHaveCount(0);
      await expect(page).not.toHaveURL(/tab=/);
      await expect(page.locator('[data-matter-one-page]')).toBeVisible();
      // Back leaves the matter (the link's entry was replaced); it does not reopen the dialog.
      await page.goBack();
      await expect(page).toHaveURL(/\/matters$/);
    });
  }

  test('a viewer without Audit.View has no Activities entry, and the old links show just the page', async ({
    personas,
    asUser,
    seed,
  }) => {
    const world = await seed.world();
    const viewer = await personas.create({
      label: 'noaudit',
      permissions: ['Matter.View', 'Client.View', 'Task.View', 'Task.Comment'],
    });
    const page = await asUser(viewer.username);
    await page.setViewportSize({ width: 1366, height: 768 });
    await page.goto(`/matters/${world.matter.matterId}`);
    await expect(page.locator('[data-matter-one-page]')).toBeVisible();
    await more(page).click();
    await expect(page.getByRole('menuitem', { name: /^Open Task List/ })).toBeVisible();
    await expect(page.getByRole('menuitem', { name: /^Activities/ })).toHaveCount(0);
    await page.keyboard.press('Escape');
    await page.goto(`/matters/${world.matter.matterId}?tab=activity`);
    await expect(page.locator('[data-matter-one-page]')).toBeVisible();
    await expect(page.getByRole('dialog')).toHaveCount(0);
  });
});
