import { Page } from '@playwright/test';
import { axeAvailable, axeViolations } from '../support/axe';
import { expect, test } from '../support/fixtures';
import { noHorizontalScroll, shot, SIZES } from '../support/screens';

/**
 * S18 (#619): the dialog and drawer rule. Title 16 px / 600 in dialogs and drawers; one close button style (round, borderless, icon only);
 * the footer has the secondary on the left and the primary on the right.
 */
interface CloseLook {
  borderColor: string;
  radius: string;
  background: string;
  color: string;
}

async function titleLook(page: Page, selector: string) {
  return page.locator(selector).evaluate((el) => {
    const cs = getComputedStyle(el);
    return { size: parseFloat(cs.fontSize), weight: Number(cs.fontWeight) };
  });
}

async function closeLook(page: Page, selector: string): Promise<CloseLook> {
  return page.locator(selector).evaluate((el) => {
    const cs = getComputedStyle(el);
    return {
      borderColor: cs.borderTopWidth === '0px' ? 'transparent' : cs.borderTopColor,
      radius: cs.borderTopLeftRadius,
      background: cs.backgroundColor,
      color: cs.color,
    };
  });
}

const isRound = (r: string) => r === '50%' || parseFloat(r) >= 14;
const isTransparent = (c: string) => c === 'rgba(0, 0, 0, 0)' || c === 'transparent';

test.describe('One rule for dialogs and drawers (#619)', () => {
  test.setTimeout(300_000);

  test('the Activity drawer and a confirm dialog: 16 px / 600 titles and the same close button', async ({
    page,
    seed,
  }) => {
    expect(axeAvailable(), 'set E2E_AXE_PATH to axe.min.js').toBe(true);
    const client = await seed.client({ name: `Rule client ${Date.now()}` });
    await page.setViewportSize({ width: 1366, height: 768 });
    await page.goto(`/clients/${client.clientId}`);

    await page.getByRole('button', { name: 'Activity' }).click();
    const drawer = page.getByRole('dialog', { name: `Activity: ${client.name}` });
    await expect(drawer).toBeVisible();
    expect(await titleLook(page, '[data-drawer-title]')).toEqual({ size: 16, weight: 600 });
    const drawerClose = await closeLook(page, '.mf-drawer button[aria-label="Close activity"]');
    await page.keyboard.press('Escape');
    await expect(drawer).toBeHidden();
    // Axe with the drawer open at the four sizes (on a phone the entry is in the overflow menu).
    for (const size of SIZES) {
      await page.setViewportSize(size);
      await page.goto(`/clients/${client.clientId}`);
      await expect(page.locator('[data-overflow]')).toBeVisible();
      const direct = page.locator('[data-action=activity]');
      if (await direct.isVisible()) {
        await direct.click();
      } else {
        await page.locator('[data-overflow]').click();
        await page.getByRole('menuitem', { name: /Activity/ }).click();
      }
      await expect(drawer).toBeVisible();
      expect(await axeViolations(page), `drawer at ${size.width}`).toEqual([]);
      await noHorizontalScroll(page);
      await shot(page, 'rule-drawer');
      await page.keyboard.press('Escape');
      await expect(drawer).toBeHidden();
    }
    await page.setViewportSize({ width: 1366, height: 768 });
    await page.goto(`/clients/${client.clientId}`);

    await page.locator('[data-overflow]').click();
    await page.getByRole('menuitem', { name: /Set inactive/ }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    expect(await titleLook(page, '.p-dialog-title')).toEqual({ size: 16, weight: 600 });
    const dialogClose = await closeLook(page, '.p-dialog-close-button');
    expect(drawerClose).toEqual(dialogClose);
    expect(isTransparent(drawerClose.background)).toBe(true);
    expect(isTransparent(drawerClose.borderColor)).toBe(true);
    expect(isRound(drawerClose.radius)).toBe(true);
    // Footer order: secondary on the left, primary on the right.
    const footer = dialog.locator('.p-dialog-footer button');
    const names = await footer.allInnerTexts();
    expect(names.map((n) => n.trim())[0]).toBe('Cancel');
    const boxes = await footer.evaluateAll((els) => els.map((e) => e.getBoundingClientRect().left));
    expect(boxes).toEqual([...boxes].sort((a, b) => a - b));
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    for (const size of SIZES) {
      await page.setViewportSize(size);
      await page.goto(`/clients/${client.clientId}`);
      await page.locator('[data-overflow]').click();
      await page.getByRole('menuitem', { name: /Set inactive/ }).click();
      await expect(dialog).toBeVisible();
      expect(await axeViolations(page), `confirm dialog at ${size.width}`).toEqual([]);
      await noHorizontalScroll(page);
      await shot(page, 'rule-confirm-dialog');
      await page.keyboard.press('Escape');
      await expect(dialog).toBeHidden();
    }
  });

  test('the phone filter sheet: 16 px / 600 title, the same round close button, axe clean', async ({
    page,
    seed,
  }) => {
    expect(axeAvailable(), 'set E2E_AXE_PATH to axe.min.js').toBe(true);
    await seed.client({ name: `Rule sheet ${Date.now()}` });
    const phone = SIZES[0];
    await page.setViewportSize(phone);
    await page.goto('/clients');
    await page.getByRole('button', { name: /^Filters/ }).click();
    const sheet = page.getByRole('dialog', { name: 'Filters' });
    await expect(sheet).toBeVisible();
    expect(await titleLook(page, '.fs-title')).toEqual({ size: 16, weight: 600 });
    const close = await closeLook(page, '.fs-close');
    expect(isTransparent(close.borderColor)).toBe(true);
    expect(isRound(close.radius)).toBe(true);
    expect(isTransparent(close.background)).toBe(true);
    // The colour of the dialog's own close button (the primary colour).
    expect(close.color).toBe('rgb(31, 78, 156)');
    // 44 px target on a phone.
    const box = await page.locator('.fs-close').boundingBox();
    expect(box!.width).toBeGreaterThanOrEqual(44);
    expect(box!.height).toBeGreaterThanOrEqual(44);
    await shot(page, 'rule-filter-sheet');
    await noHorizontalScroll(page);
    await page.getByRole('button', { name: 'Close filters' }).focus();
    await page.keyboard.press('Enter');
    await expect(sheet).toBeHidden();
    await expect(page.getByRole('button', { name: /^Filters/ })).toBeFocused();
  });
});
