import { Page } from '@playwright/test';
import { axeAvailable, axeViolations } from '../support/axe';
import { expect, test } from '../support/fixtures';
import { noHorizontalScroll, shot } from '../support/screens';

/**
 * SH-01 (#1044, epic #1037): the dark navigation panel runs the full height of the window with the logo and the application name at its top, the
 * white top bar starts to its right and its search box lines up with the page content, and the selected item is a 6 px rounded white row with 8 px
 * side margins. On a phone the logo stays in the white top bar and the menu is a drawer.
 */
const SIZES_DESKTOP = [
  { width: 1366, height: 768 },
  { width: 1920, height: 1080 },
] as const;

const box = async (page: Page, selector: string) => {
  const b = await page.locator(selector).first().boundingBox();
  expect(b, selector).not.toBeNull();
  return b!;
};

test.describe('Full-height navigation panel (SH-01, #1044)', () => {
  test.setTimeout(240_000);

  for (const size of SIZES_DESKTOP) {
    test(`at ${size.width}x${size.height}: panel from the very top to the bottom, logo in it, top bar to its right, search aligned with the content`, async ({
      page,
    }) => {
      await page.setViewportSize(size);
      await page.goto('/dashboard');
      await expect(page.locator('.mf-nav .mf-active')).toBeVisible();
      const nav = await box(page, 'nav.mf-nav');
      expect(nav.x).toBe(0);
      expect(nav.y).toBe(0);
      expect(Math.round(nav.height)).toBe(size.height);

      // The logo and name sit inside the panel's top row, as tall as the old header.
      const logo = await box(page, '.mf-logo');
      expect(logo.x).toBe(0);
      expect(logo.y).toBe(0);
      expect(logo.width).toBeLessThanOrEqual(nav.width + 1);
      const header = await box(page, 'header.mf-header');
      expect(header.x).toBeGreaterThanOrEqual(nav.width - 1);
      expect(header.y).toBe(0);
      expect(Math.round(logo.height)).toBe(Math.round(header.height));
      await expect(page.locator('.mf-logo__mark')).toBeVisible();
      if (size.width >= 1100) await expect(page.locator('.mf-logo [data-app-name]')).toBeVisible();
      await expect(page.locator('.mf-logo')).toHaveAttribute('aria-label', /home$/);

      // The search box starts where the page content starts (the same left edge as the title below).
      const search = await box(page, 'header.mf-header [role="search"]');
      const content = await page.evaluate(() => {
        const main = document.querySelector('main.mf-main')!;
        return main.getBoundingClientRect().left + parseFloat(getComputedStyle(main).paddingLeft);
      });
      expect(Math.abs(search.x - content)).toBeLessThanOrEqual(1);

      // The selected row: 6 px corners, 8 px from both panel edges (the rail's items are narrower, with the same margins).
      const active = await page.locator('.mf-nav a.mf-active').first().boundingBox();
      expect(active!.x).toBeGreaterThanOrEqual(8 - 1);
      expect(nav.x + nav.width - (active!.x + active!.width)).toBeGreaterThanOrEqual(8 - 1);
      expect(
        await page
          .locator('.mf-nav a.mf-active')
          .first()
          .evaluate((a) => getComputedStyle(a).borderTopLeftRadius),
      ).toBe('6px');

      // The page itself does not scroll and the version line stays inside the panel.
      expect(
        await page.evaluate(() => document.documentElement.scrollHeight - window.innerHeight),
      ).toBeLessThanOrEqual(1);
      const version = await box(page, '[data-testid="nav-version"]');
      expect(version.y + version.height).toBeLessThanOrEqual(size.height + 1);
      await noHorizontalScroll(page);
      if (axeAvailable()) expect(await axeViolations(page), 'axe').toEqual([]);
      await shot(page, 'sh01-panel');
    });
  }

  test('hover and sub-items use the same 6 px corners', async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 768 });
    await page.goto('/dashboard');
    const radius = (selector: string) =>
      page
        .locator(selector)
        .first()
        .evaluate((a) => getComputedStyle(a).borderTopLeftRadius);
    expect(await radius('.mf-nav li:not(.mf-nav-child) > a:not(.mf-active)')).toBe('6px');
    if ((await page.locator('.mf-nav .mf-nav-child > a').count()) > 0)
      expect(await radius('.mf-nav .mf-nav-child > a')).toBe('6px');
  });

  test('the keyboard focus ring shows on a menu item', async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 768 });
    await page.goto('/dashboard');
    const link = page.locator('.mf-nav li:not(.mf-nav-child) > a:not(.mf-active)').first();
    await link.focus();
    await page.keyboard.press('Shift+Tab');
    await page.keyboard.press('Tab');
    await expect(link).toBeFocused();
    expect(await link.evaluate((a) => getComputedStyle(a).outlineStyle)).not.toBe('none');
  });
});
