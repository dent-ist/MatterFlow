import { Page } from '@playwright/test';
import { axeAvailable, axeViolations } from '../support/axe';
import { expect, test } from '../support/fixtures';
import { noHorizontalScroll, shot, SIZES } from '../support/screens';

/**
 * S7 / S8 (#623): the 56 px icon rail has 21 px icons, a name that shows on hover and keyboard focus (Esc dismisses it), a dot instead of
 * the pending count, and My Work has its own glyph.
 */
const nav = (page: Page) => page.getByRole('navigation', { name: 'Main' });
const tip = (page: Page) => page.locator('[data-nav-tip]');

test.describe('Icon rail (#623)', () => {
  test.setTimeout(300_000);

  test('axe 0 and no sideways scroll at both desktop sizes, with the rail tip open', async ({
    page,
  }) => {
    expect(axeAvailable(), 'set E2E_AXE_PATH to axe.min.js').toBe(true);
    for (const size of SIZES) {
      await page.setViewportSize(size);
      await page.goto('/clients');
      if (size.width >= 640 && size.width < 1100) {
        await nav(page).getByRole('link', { name: 'Projects' }).focus();
        await page.keyboard.press('Shift+Tab');
        await page.keyboard.press('Tab');
        await expect(tip(page)).toBeVisible();
      }
      expect(await axeViolations(page), `rail at ${size.width}`).toEqual([]);
      await noHorizontalScroll(page);
      await shot(page, 'rail-tip');
    }
  });

  test('permission variants: every person gets the glyphs and names of the items they have', async ({
    personas,
    asUser,
  }) => {
    for (const who of ['technician', 'director', 'taskViewOnly', 'clientViewOnly'] as const) {
      const person = await personas.named(who);
      const page = await asUser(person.username);
      await page.setViewportSize({ width: 1366, height: 768 });
      await page.goto('/');
      await expect(nav(page)).toBeVisible();
      const links = nav(page).getByRole('link');
      const n = await links.count();
      for (let i = 0; i < n; i++) {
        await expect(links.nth(i)).toHaveAttribute('data-tip', /.+/);
        expect(
          await links
            .nth(i)
            .locator('i')
            .evaluate((e) => getComputedStyle(e).fontSize),
        ).toBe('21px');
      }
    }
  });
});
