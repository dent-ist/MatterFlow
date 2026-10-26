import { Page } from '@playwright/test';
import { axeAvailable, axeViolations } from '../support/axe';
import { expect, test } from '../support/fixtures';
import { PERSONAS } from '../support/personas';
import { SIZES, noHorizontalScroll, shot } from '../support/screens';

/**
 * My profile epic #520, WP-PF5 menu part: #580 (P5, the identity and status row at the top of the account menu) and #578 (P4, the
 * out-of-office dot on the phone icon). No keyboard shortcut is added or changed. Screenshots for docs/ux/profile-review/fixes/pf5-menu/ are
 * written when E2E_SCREENSHOTS is set.
 */

const menuButton = (page: Page) => page.getByRole('button', { name: /account menu/ });

test.describe('pf5-menu-identity: the account menu starts with who and how (#580)', () => {
  test('identity row, then My profile, Set out of office, a divider and Keyboard shortcuts; arrows skip the row', async ({
    personas,
    asUser,
  }) => {
    const p = await personas.create({
      ...PERSONAS.technician,
      displayName: 'Pat Example',
      label: 'pf5id',
    });
    const me = await asUser(p.username);
    await me.goto('/my-work');
    await menuButton(me).click();
    const row = me.locator('[data-menu-identity]');
    await expect(row).toBeVisible();
    await expect(row.locator('.um-id__name')).toHaveText('Pat Example');
    await expect(row.locator('.um-id__account')).toHaveText(p.username);
    await expect(row.locator('[data-availability-chip]')).toHaveText(/Available|Off hours/);
    await expect(row.locator('button, a, [tabindex]')).toHaveCount(0);
    const menu = me.getByRole('menu', { name: 'Your account' });
    await expect(menu.getByRole('menuitem')).toHaveText([
      /My profile/,
      /Set out of office/,
      /Keyboard shortcuts/,
    ]);
    await expect(menu.getByRole('separator')).toHaveCount(1);
    await expect(menu).toHaveAccessibleDescription(/Pat Example/);
    // The first menu item has focus; Up from it wraps past the row to the last item.
    await expect(menu.getByRole('menuitem', { name: 'My profile' })).toBeFocused();
    await me.keyboard.press('ArrowUp');
    await expect(menu.getByRole('menuitem', { name: 'Keyboard shortcuts' })).toBeFocused();
    await me.keyboard.press('Escape');
    await expect(menuButton(me)).toBeFocused();
  });

  test("while out of office the row says Out of office until ... and the menu offers I'm back", async ({
    personas,
    asUser,
  }) => {
    const p = await personas.create({ ...PERSONAS.technician, label: 'pf5out' });
    const me = await asUser(p.username);
    await me.goto('/my-work');
    await menuButton(me).click();
    await me.getByRole('menuitem', { name: 'Set out of office...' }).click();
    const dialog = me.getByRole('dialog', { name: 'Set out of office' });
    await dialog.getByRole('button', { name: 'Until Monday' }).click();
    await dialog.getByRole('button', { name: 'Set out of office' }).click();
    await expect(dialog).toHaveCount(0);
    await menuButton(me).click();
    await expect(me.locator('[data-menu-identity] [data-availability-chip]')).toContainText(
      'Out of office until',
    );
    await expect(me.getByRole('menuitem')).toHaveText([
      /My profile/,
      /I'm back/,
      /Keyboard shortcuts/,
    ]);
  });

  test('a person without Task.View sees the name and Keyboard shortcuts only', async ({
    personas,
    asUser,
  }) => {
    const p = await personas.create({ ...PERSONAS.clientViewOnly, label: 'pf5notask' });
    const me = await asUser(p.username);
    await me.goto('/clients');
    await menuButton(me).click();
    await expect(me.locator('[data-menu-identity] .um-id__name')).toBeVisible();
    await expect(me.locator('[data-menu-identity] [data-availability-chip]')).toHaveCount(0);
    await expect(me.getByRole('menuitem')).toHaveText([/Keyboard shortcuts/]);
  });

  test('a 66-character name is cut with an ellipsis in the row (full name as tooltip); axe and no scroll with the menu open at four sizes', async ({
    personas,
    asUser,
  }) => {
    const p = await personas.create({ ...PERSONAS.longName, label: 'pf5long' });
    const me = await asUser(p.username);
    for (const size of SIZES) {
      await me.setViewportSize(size);
      await me.goto('/my-work');
      await menuButton(me).click();
      const name = me.locator('.um-id__name');
      await expect(name).toHaveAttribute('title', p.displayName!);
      const fits = await name.evaluate((el) => el.scrollWidth >= el.clientWidth);
      expect(fits).toBe(true);
      const box = await me.locator('.um-pop').boundingBox();
      expect(box!.x + box!.width).toBeLessThanOrEqual(size.width);
      expect(box!.x).toBeGreaterThanOrEqual(0);
      await noHorizontalScroll(me);
      if (axeAvailable()) expect(await axeViolations(me), `menu at ${size.width}`).toEqual([]);
      await shot(me, 'pf5-menu-identity');
    }
  });
});

test.describe('pf5-phone-dot: the out-of-office dot on the phone icon (#578)', () => {
  test('visible at 375 only while out, named in words, hidden when the text label shows (desktop)', async ({
    personas,
    asUser,
  }) => {
    const p = await personas.create({ ...PERSONAS.technician, label: 'pf5dot' });
    const me = await asUser(p.username);
    await me.setViewportSize({ width: 375, height: 812 });
    await me.goto('/my-work');
    await expect(menuButton(me)).toBeVisible();
    await expect(me.locator('[data-ooo-dot]')).toHaveCount(0);
    await menuButton(me).click();
    await me.getByRole('menuitem', { name: 'Set out of office...' }).click();
    const dialog = me.getByRole('dialog', { name: 'Set out of office' });
    await dialog.getByRole('button', { name: 'Rest of today' }).click();
    await dialog.getByRole('button', { name: 'Set out of office' }).click();
    await expect(dialog).toHaveCount(0);
    const dot = me.locator('[data-ooo-dot]');
    await expect(dot).toBeVisible();
    await expect(dot).toHaveAttribute('title', 'Out of office');
    await expect(menuButton(me)).toHaveAccessibleName(/Out of office until/);
    await noHorizontalScroll(me);
    if (axeAvailable()) expect(await axeViolations(me), 'dot at 375').toEqual([]);
    await shot(me, 'pf5-phone-dot');
    await me.setViewportSize({ width: 1366, height: 768 });
    await expect(dot).toBeHidden();
    await expect(me.locator('[data-ooo-label]')).toBeVisible();
    // I'm back removes the dot.
    await me.setViewportSize({ width: 375, height: 812 });
    await menuButton(me).click();
    await me.getByRole('menuitem', { name: "I'm back" }).click();
    await expect(me.locator('[data-ooo-dot]')).toHaveCount(0);
  });
});
