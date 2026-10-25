import { Page } from '@playwright/test';
import { axeAvailable, axeViolations } from '../support/axe';
import { expect, test } from '../support/fixtures';
import { noHorizontalScroll, shot, SIZES } from '../support/screens';

/**
 * S7 / S8 (#623): the 56 px icon rail has 18 px icons, a name that shows on hover and keyboard focus (Esc dismisses it), a dot instead of
 * the pending count, and My Work has its own glyph.
 */
const nav = (page: Page) => page.getByRole('navigation', { name: 'Main' });
const tip = (page: Page) => page.locator('[data-nav-tip]');

test.describe('Icon rail (#623)', () => {
  test.setTimeout(300_000);

  test('18 px icons; My Work has its own glyph; tabbing shows each name and Esc dismisses it', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 768, height: 1024 });
    await page.goto('/clients');
    const icon = nav(page).getByRole('link', { name: 'Clients' }).locator('i');
    expect(await icon.evaluate((i) => getComputedStyle(i).fontSize)).toBe('18px');
    await expect(
      nav(page).getByRole('link', { name: 'My Work' }).locator('i.pi-check-square'),
    ).toHaveCount(1);
    await expect(page.locator('.um-icon.pi-user')).toHaveCount(1); // the header button keeps its glyph

    const links = nav(page).getByRole('link');
    const count = await links.count();
    expect(count).toBeGreaterThan(8);
    await links.first().focus();
    await page.keyboard.press('Shift+Tab');
    await page.keyboard.press('Tab');
    for (let i = 0; i < count; i++) {
      const link = links.nth(i);
      await expect(link).toBeFocused();
      const name = (await link.getAttribute('data-tip'))!;
      await expect(tip(page)).toHaveText(name);
      // Beside its icon, inside the window, not covering the icon.
      const box = (await tip(page).boundingBox())!;
      const icon = (await link.locator('i').boundingBox())!;
      expect(box.x).toBeGreaterThanOrEqual(icon.x + icon.width);
      if (i === 2) {
        await page.keyboard.press('Escape');
        await expect(tip(page)).toHaveCount(0);
        await expect(link).toBeFocused();
      }
      if (i < count - 1) await page.keyboard.press('Tab');
    }
  });

  test('hover shows the name; wide windows and the phone panel show no tip', async ({ page }) => {
    await page.setViewportSize({ width: 768, height: 1024 });
    await page.goto('/clients');
    await nav(page).getByRole('link', { name: 'Matters', exact: true }).hover();
    await expect(tip(page)).toHaveText('Matters');
    await page.mouse.move(600, 600);
    await expect(tip(page)).toHaveCount(0);
    await page.setViewportSize({ width: 1366, height: 768 });
    await nav(page).getByRole('link', { name: 'Matters', exact: true }).hover();
    await expect(tip(page)).toHaveCount(0);
  });

  test('the pending-users badge is a dot at the icon corner, with its accessible name kept', async ({
    page,
    personas,
  }) => {
    await personas.named('pending');
    await page.setViewportSize({ width: 768, height: 1024 });
    await page.goto('/admin/users');
    const users = nav(page).getByRole('link', { name: /^Users/ });
    await expect(users).toHaveAccessibleName(/\d+ users? waiting for access/);
    const dot = users.locator('[data-pending-badge]');
    await expect(dot).toBeVisible();
    const d = (await dot.boundingBox())!;
    const i = (await users.locator('i').boundingBox())!;
    expect(d.width).toBeLessThanOrEqual(10);
    // No overlap with the icon, and at its top right.
    const overlap =
      d.x < i.x + i.width && d.x + d.width > i.x && d.y < i.y + i.height && d.y + d.height > i.y;
    expect(overlap).toBe(false);
    expect(d.x).toBeGreaterThanOrEqual(i.x + i.width - 1);
    expect(d.y).toBeLessThan(i.y + i.height / 2);
    await shot(page, 'rail-dot');
    await users.focus();
    await page.keyboard.press('Shift+Tab');
    await page.keyboard.press('Tab');
    await expect(tip(page)).toContainText(/Users \(\d+ waiting\)/);
    // On the phone panel and the wide rail the count is a number again.
    await page.setViewportSize({ width: 1366, height: 768 });
    await expect(dot).toHaveText(/\d+/);
  });

  test('axe 0 and no sideways scroll at four widths, with the rail tip open', async ({ page }) => {
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
      await page.setViewportSize({ width: 768, height: 1024 });
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
        ).toBe('18px');
      }
    }
  });
});
