import { Page } from '@playwright/test';
import { axeAvailable, axeViolations } from '../support/axe';
import { expect, test } from '../support/fixtures';
import { SIZES } from '../support/screens';

/**
 * MM-43 (#939) and MM-44 (#940): the navigation panel has its own background (not the page's, not the header's), and its foot carries the
 * version of the root package.json, read as "Version 0.1.1", also in the 56 px rail and in the phone menu.
 */
const nav = (page: Page) => page.getByRole('navigation', { name: 'Main' });

async function openMenuIfPhone(page: Page): Promise<void> {
  if ((page.viewportSize()?.width ?? 1000) < 640) {
    await page.getByRole('button', { name: 'Menu', exact: true }).click();
    await expect(nav(page)).toBeVisible();
  }
}

test.describe('Navigation panel colour and version (#939, #940)', () => {
  test.setTimeout(300_000);

  test('own background, selected item a filled pill (no thick border), bigger icons, version at the foot, axe clean, at every width', async ({
    page,
  }) => {
    expect(axeAvailable(), 'set E2E_AXE_PATH to axe.min.js').toBe(true);
    for (const size of SIZES) {
      await page.setViewportSize(size);
      await page.goto('/dashboard');
      await openMenuIfPhone(page);
      const bg = await nav(page).evaluate((el) => getComputedStyle(el).backgroundColor);
      const page_ = await page
        .locator('body')
        .evaluate((el) => getComputedStyle(el).backgroundColor);
      expect(bg, `${size.width}: panel colour`).toBe('rgb(26, 53, 86)');
      expect(bg).not.toBe(page_);

      const active = nav(page).locator('a.mf-active').first();
      await expect(active).toHaveAttribute('aria-current', 'page');
      const marks = await active.evaluate((el) => {
        const s = getComputedStyle(el);
        const icon = getComputedStyle(el.querySelector('i')!);
        return {
          weight: Number(s.fontWeight),
          bg: s.backgroundColor,
          radius: parseFloat(s.borderTopLeftRadius),
          left: s.borderLeftWidth,
          shadowInset: s.boxShadow.includes('inset'),
          icon: icon.fontSize,
          height: el.getBoundingClientRect().height,
        };
      });
      expect(marks.weight, 'semi-bold').toBeGreaterThanOrEqual(600);
      expect(marks.bg, 'filled').toBe('rgb(255, 255, 255)');
      expect(marks.radius, 'rounded').toBeGreaterThanOrEqual(10);
      expect(marks.left, 'no thick left border').toBe('0px');
      expect(marks.shadowInset, 'no inset bar').toBe(false);
      expect(marks.icon, 'icon size').toBe(
        size.width >= 640 && size.width < 1100 ? '21px' : '19px',
      );
      if (size.width < 640) expect(marks.height, 'phone target').toBeGreaterThanOrEqual(44);

      const version = nav(page).getByTestId('nav-version');
      await expect(version).toHaveText('Version 0.1.1v0.1.1');
      await expect(version).toBeVisible();
      const [vBox, navBox] = await Promise.all([version.boundingBox(), nav(page).boundingBox()]);
      expect(vBox!.y + vBox!.height, 'at the foot').toBeGreaterThan(
        navBox!.y + navBox!.height - 40,
      );
      expect(vBox!.x + vBox!.width, 'inside the panel').toBeLessThanOrEqual(
        navBox!.x + navBox!.width,
      );
      expect(await axeViolations(page), `${size.width}: axe`).toEqual([]);
    }
  });
});
