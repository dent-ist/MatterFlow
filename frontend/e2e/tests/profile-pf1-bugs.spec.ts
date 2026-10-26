import { Page } from '@playwright/test';
import { axeAvailable, axeViolations } from '../support/axe';
import { expect, test } from '../support/fixtures';
import { PERSONAS } from '../support/personas';
import { SIZES, noHorizontalScroll, shot } from '../support/screens';
import { toasts } from '../support/toasts';

/**
 * My profile epic #520, WP-PF1 (first release): #521 (BUG-1 / P7, the open page follows the header menu) and #525 (BUG-4, one availability
 * toast at a time). Screenshots for docs/ux/profile-review/fixes/pf1-bugs/ are written when E2E_SCREENSHOTS is set.
 */

async function openMenu(page: Page) {
  await page.getByRole('button', { name: /account menu/ }).click();
  return page.getByRole('menu', { name: 'Your account' });
}

/** Name menu > Set out of office... > Set out of office (no date, no note). */
async function setOutFromMenu(page: Page): Promise<void> {
  const menu = await openMenu(page);
  await menu.getByRole('menuitem', { name: 'Set out of office...' }).click();
  const dialog = page.getByRole('dialog', { name: 'Set out of office' });
  await dialog.getByRole('button', { name: 'Set out of office' }).click();
  await expect(dialog).toHaveCount(0);
}

async function imBackFromMenu(page: Page): Promise<void> {
  const menu = await openMenu(page);
  await menu.getByRole('menuitem', { name: "I'm back" }).click();
}

const WHO = [
  { key: 'technician', ...PERSONAS.technician },
  { key: 'observer', ...PERSONAS.readOnlyObserver },
  { key: 'director', ...PERSONAS.director },
];

test.describe('pf1-follow-menu: the open profile page follows the header menu (#521)', () => {
  for (const who of WHO) {
    test(`clean page, ${who.key}: Set out of office and I'm back update the page without a reload`, async ({
      personas,
      asUser,
    }) => {
      const p = await personas.create({ ...who, label: `pf1${who.key}` });
      const me = await asUser(p.username);
      await me.goto('/profile');
      await expect(me.locator('[data-status-available]')).toBeChecked();
      await expect(me.getByRole('button', { name: 'Save changes' })).toBeDisabled();

      await setOutFromMenu(me);
      await expect(me.locator('[data-status-ooo]')).toBeChecked();
      await expect(me.locator('h1 [data-availability-chip]')).toContainText('Out of office');
      await expect(me.locator('[data-updated-note]')).toHaveText(/Your availability was updated\./);
      await expect(me.locator('[data-updated-note]')).toHaveAttribute('aria-live', 'polite');
      await expect(me.getByRole('button', { name: 'Save changes' })).toBeDisabled();
      await expect(me.getByRole('button', { name: 'Discard changes' })).toBeDisabled();
      await expect(me.locator('[data-stale]')).toHaveCount(0);

      await imBackFromMenu(me);
      await expect(me.locator('[data-status-available]')).toBeChecked();
      await expect(me.locator('[data-ooo-fields]')).toHaveCount(0);
      await expect(me.getByRole('button', { name: 'Save changes' })).toBeDisabled();
      // Focus is back on the menu button, as before.
      await expect(me.getByRole('button', { name: /account menu/ })).toBeFocused();
    });
  }

  test('a page with unsaved edits keeps them, offers Load latest, and Save still takes the conflict path', async ({
    personas,
    asUser,
  }) => {
    const p = await personas.create({ ...PERSONAS.technician, label: 'pf1dirty' });
    const me = await asUser(p.username);
    await me.goto('/profile');
    await me.getByLabel('Start time', { exact: true }).fill('08:30');
    await setOutFromMenu(me);

    const stale = me.locator('[data-stale]');
    await expect(stale).toContainText('changed somewhere else');
    await expect(me.getByLabel('Start time', { exact: true })).toHaveValue('08:30');
    await expect(me.locator('[data-status-available]')).toBeChecked();
    await expect(me.getByRole('button', { name: 'Save changes' })).toBeEnabled();

    // Nothing is overwritten silently: Save raises the existing conflict message and shows the latest values.
    await me.getByRole('button', { name: 'Save changes' }).click();
    await expect(me.locator('[data-conflict]')).toContainText('your edits were not saved');
    await expect(me.locator('[data-status-ooo]')).toBeChecked();
    await expect(me.getByLabel('Start time', { exact: true })).toHaveValue('09:00');
    await expect(stale).toHaveCount(0);
  });

  test("Load latest discards the edits and says so politely; I'm back follows the same rules", async ({
    personas,
    asUser,
  }) => {
    const p = await personas.create({ ...PERSONAS.technician, label: 'pf1latest' });
    const me = await asUser(p.username);
    await me.goto('/profile');
    await setOutFromMenu(me);
    await expect(me.locator('[data-status-ooo]')).toBeChecked();

    await me.getByLabel('End time', { exact: true }).fill('16:00');
    await imBackFromMenu(me);
    await expect(me.locator('[data-stale]')).toBeVisible();
    await expect(me.locator('[data-status-ooo]')).toBeChecked();
    await expect(me.getByLabel('End time', { exact: true })).toHaveValue('16:00');

    await me.getByRole('button', { name: 'Load latest' }).click();
    await expect(me.locator('[data-status-available]')).toBeChecked();
    await expect(me.getByLabel('End time', { exact: true })).toHaveValue('17:00');
    await expect(me.locator('[data-updated-note]')).toContainText('latest availability');
    await expect(me.locator('[data-status-available]')).toBeFocused();
    await expect(me.locator('[data-stale]')).toHaveCount(0);
  });

  test('a change made in another tab shows after the next load', async ({ personas, asUser }) => {
    const p = await personas.create({ ...PERSONAS.technician, label: 'pf1tab' });
    const first = await asUser(p.username);
    await first.goto('/profile');
    const second = await first.context().newPage();
    await second.goto('/profile');
    await setOutFromMenu(second);
    await first.reload();
    await expect(first.locator('[data-status-ooo]')).toBeChecked();
  });

  test('axe and no sideways scroll with the stale note shown, at the four sizes', async ({
    personas,
    asUser,
  }) => {
    expect(axeAvailable(), 'axe-core must be available (set E2E_AXE_PATH)').toBe(true);
    const p = await personas.create({ ...PERSONAS.technician, label: 'pf1axe' });
    const me = await asUser(p.username);
    await me.goto('/profile');
    await me.getByLabel('Start time', { exact: true }).fill('08:30');
    await setOutFromMenu(me);
    await expect(me.locator('[data-stale]')).toBeVisible();
    for (const size of SIZES) {
      await me.setViewportSize(size);
      expect(await axeViolations(me), `stale note at ${size.width}`).toEqual([]);
      await noHorizontalScroll(me);
      await shot(me, 'pf1-follow-menu-dirty');
    }
    await me.getByRole('button', { name: 'Load latest' }).click();
    for (const size of SIZES) {
      await me.setViewportSize(size);
      expect(await axeViolations(me), `followed page at ${size.width}`).toEqual([]);
      await noHorizontalScroll(me);
      await shot(me, 'pf1-follow-menu-clean');
    }
  });
});

test.describe('pf1-toast-replace: one availability toast at a time (#525)', () => {
  test("Set out of office and then I'm back within seconds leaves only the second toast", async ({
    personas,
    asUser,
  }) => {
    const p = await personas.create({ ...PERSONAS.technician, label: 'pf1toast' });
    const me = await asUser(p.username);
    await me.goto('/my-work');
    await setOutFromMenu(me);
    await expect(toasts(me).filter({ hasText: 'You are out of office' })).toHaveCount(1);
    await imBackFromMenu(me);
    await expect(toasts(me).filter({ hasText: 'Welcome back' })).toHaveCount(1);
    await expect(toasts(me).filter({ hasText: 'You are out of office' })).toHaveCount(0);
    await expect(toasts(me)).toHaveCount(1);
    await shot(me, 'pf1-toast-replace');
  });

  test('saving on My profile after the menu also replaces the previous availability toast', async ({
    personas,
    asUser,
  }) => {
    const p = await personas.create({ ...PERSONAS.technician, label: 'pf1toast2' });
    const me = await asUser(p.username);
    await me.goto('/profile');
    await setOutFromMenu(me);
    await expect(toasts(me).filter({ hasText: 'You are out of office' })).toHaveCount(1);
    await me.getByLabel('Start time', { exact: true }).fill('08:00');
    await me.getByRole('button', { name: 'Save changes' }).click();
    await expect(toasts(me).filter({ hasText: 'Availability saved' })).toHaveCount(1);
    await expect(toasts(me).filter({ hasText: 'You are out of office' })).toHaveCount(0);
  });
});
