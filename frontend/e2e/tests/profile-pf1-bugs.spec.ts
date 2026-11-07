import { Page } from '@playwright/test';
import { expect, test } from '../support/fixtures';
import { PERSONAS } from '../support/personas';
import { shot } from '../support/screens';
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
  await menu.getByRole('menuitem', { name: 'Set Out of Office' }).click();
  const dialog = page.getByRole('dialog', { name: 'Set out of office' });
  await dialog.getByRole('button', { name: 'Set Out of Office', exact: true }).click();
  await expect(dialog).toHaveCount(0);
}

async function imBackFromMenu(page: Page): Promise<void> {
  const menu = await openMenu(page);
  await menu.getByRole('menuitem', { name: "I'm Back" }).click();
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
      await expect(me.locator('[data-profile-who] [data-availability-chip]')).toHaveText(
        /Available|Off Hours/,
      );
      await expect(me.getByRole('button', { name: 'Save Changes' })).toBeDisabled();

      await setOutFromMenu(me);
      await expect(me.locator('[data-profile-who] [data-availability-chip]')).toContainText(
        'Out of Office',
      );
      await expect(me.locator('[data-profile-who] [data-availability-chip]')).toContainText(
        'Out of Office',
      );
      await expect(me.getByRole('button', { name: 'Save Changes' })).toBeDisabled();
      await expect(me.getByRole('button', { name: 'Cancel' })).toBeDisabled();

      await imBackFromMenu(me);
      await expect(me.locator('[data-profile-who] [data-availability-chip]')).toHaveText(
        /Available|Off Hours/,
      );
      await expect(me.getByRole('button', { name: 'Save Changes' })).toBeDisabled();
      // Focus is back on the menu button, as before.
      await expect(me.getByRole('button', { name: /account menu/ })).toBeFocused();
    });
  }

  test('a change made in another tab shows after the next load', async ({ personas, asUser }) => {
    const p = await personas.create({ ...PERSONAS.technician, label: 'pf1tab' });
    const first = await asUser(p.username);
    await first.goto('/profile');
    const second = await first.context().newPage();
    await second.goto('/profile');
    await setOutFromMenu(second);
    await first.reload();
    await expect(first.locator('[data-profile-who] [data-availability-chip]')).toContainText(
      'Out of Office',
    );
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
    await expect(toasts(me).filter({ hasText: 'Out of office set' })).toHaveCount(1);
    await imBackFromMenu(me);
    await expect(toasts(me).filter({ hasText: 'Welcome back' })).toHaveCount(1);
    await expect(toasts(me).filter({ hasText: 'Out of office set' })).toHaveCount(0);
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
    await expect(toasts(me).filter({ hasText: 'Out of office set' })).toHaveCount(1);
    await me.getByLabel('Start time', { exact: true }).fill('08:00');
    await me.getByRole('button', { name: 'Save Changes' }).click();
    await expect(toasts(me).filter({ hasText: 'Availability saved' })).toHaveCount(1);
    await expect(toasts(me).filter({ hasText: 'Out of office set' })).toHaveCount(0);
  });
});
