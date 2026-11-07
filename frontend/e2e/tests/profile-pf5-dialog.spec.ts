import { Page } from '@playwright/test';
import { axeAvailable, axeViolations } from '../support/axe';
import { expect, test } from '../support/fixtures';
import { PERSONAS } from '../support/personas';
import { SIZES, noHorizontalScroll, shot } from '../support/screens';

/**
 * My profile epic #520, WP-PF5 dialog part: #538 (P6, quick choices fill Until) and #539 (M1, focus on the heading, link "More options on
 * My profile"). No keyboard shortcut is added or changed. Screenshots for docs/ux/profile-review/fixes/pf5-menu/ are written when
 * E2E_SCREENSHOTS is set.
 */

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** A calendar day in the firm zone (the suite runs in America/New_York): today plus `plus` days. */
function inDays(plus: number): { text: string; iso: string; short: string; numeric: string } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
  }).formatToParts(new Date());
  const get = (t: string) => Number(parts.find((p) => p.type === t)!.value);
  const d = new Date(Date.UTC(get('year'), get('month') - 1, get('day') + plus));
  const [y, m, day] = [d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()];
  const iso = `${y}-${String(m + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  // `numeric` is the chip form (D-60): MM/DD this year, MM/DD/YYYY otherwise.
  const thisYear = get('year');
  const mmdd = `${String(m + 1).padStart(2, '0')}/${String(day).padStart(2, '0')}`;
  return {
    text: `${MONTHS[m]} ${day}, ${y}`,
    iso,
    short: `${MONTHS[m]} ${day}`,
    numeric: y === thisYear ? mmdd : `${mmdd}/${y}`,
  };
}

/** Days from today to the next Monday after today (a Monday means the following one). */
function daysToMonday(): number {
  const weekday = new Date(inDays(0).text + ' 12:00:00 UTC').getUTCDay();
  return (1 - weekday + 7) % 7 || 7;
}

async function openDialog(page: Page) {
  await page.getByRole('button', { name: /account menu/ }).click();
  await page
    .getByRole('menu', { name: 'Your account' })
    .getByRole('menuitem', { name: 'Set Out of Office' })
    .click();
  const dialog = page.getByRole('dialog', { name: 'Set out of office' });
  await expect(dialog).toBeVisible();
  return dialog;
}

const WHO = [
  { key: 'technician', ...PERSONAS.technician },
  { key: 'observer', ...PERSONAS.readOnlyObserver },
  { key: 'director', ...PERSONAS.director },
];

test.describe('pf5-dialog-presets: quick choices fill Until (#538)', () => {
  for (const who of WHO) {
    test(`each chip sets the date and the sentence names the return day, ${who.key}`, async ({
      personas,
      asUser,
    }) => {
      const p = await personas.create({ ...who, label: `pf5chips${who.key}` });
      const me = await asUser(p.username);
      await me.goto('/my-work');
      const dialog = await openDialog(me);
      const cases = [
        { id: 'today', plus: 0 },
        { id: 'tomorrow', plus: 1 },
        { id: 'monday', plus: daysToMonday() },
        { id: 'week', plus: 7 },
      ];
      for (const c of cases) {
        await dialog.locator(`[data-key="${c.id}"]`).click();
        await expect(dialog.locator('#ooo-until')).toHaveValue(inDays(c.plus).iso);
        await expect(dialog.locator(`[data-key="${c.id}"]`)).toHaveAttribute(
          'aria-pressed',
          'true',
        );
        await expect(dialog.locator('[data-ooo-summary]')).toContainText(
          `until ${inDays(c.plus).short} and as available again on ${inDays(c.plus + 1).short}`,
        );
        await expect(dialog.locator('[aria-pressed="true"]')).toHaveCount(1);
      }
    });
  }

  test('typing a date clears the chip; Pick a date focuses the field; Set out of office with a chip works from the keyboard', async ({
    personas,
    asUser,
  }) => {
    const p = await personas.create({ ...PERSONAS.technician, label: 'pf5keys' });
    const me = await asUser(p.username);
    await me.goto('/my-work');
    const dialog = await openDialog(me);
    await dialog.locator('[data-key="tomorrow"]').click();
    await dialog.locator('#ooo-until').fill(inDays(3).iso);
    await dialog.locator('#ooo-until').blur();
    await expect(dialog.locator('[aria-pressed="true"]')).toHaveCount(0);
    await dialog.getByRole('button', { name: 'Pick a Date' }).click();
    await expect(dialog.locator('#ooo-until')).toBeFocused();

    // Keyboard only: Space on a chip, then Tab to the confirm button and Enter.
    await dialog.locator('[data-key="week"]').focus();
    await me.keyboard.press('Space');
    await expect(dialog.locator('[data-key="week"]')).toHaveAttribute('aria-pressed', 'true');
    await dialog.getByRole('button', { name: 'Set out of office' }).focus();
    await me.keyboard.press('Enter');
    await expect(me.locator('[data-ooo-label]')).toContainText(
      `Out of Office until ${inDays(7).numeric}`,
    );
    await expect(me.getByRole('button', { name: /account menu/ })).toBeFocused();
  });
});

test.describe('pf5-dialog-focus: heading focus and the link to My profile (#539)', () => {
  test('opens on the first field, the Type list (no focus ring on the date field), Tab reaches everything, Esc returns to the menu button', async ({
    personas,
    asUser,
  }) => {
    const p = await personas.create({ ...PERSONAS.technician, label: 'pf5focus' });
    const me = await asUser(p.username);
    await me.goto('/my-work');
    const button = me.getByRole('button', { name: /account menu/ });
    await button.focus();
    await me.keyboard.press('Enter');
    await me.getByRole('menuitem', { name: 'Set Out of Office' }).press('Enter');
    const dialog = me.getByRole('dialog', { name: 'Set out of office' });
    await expect(dialog).toBeVisible();
    // The shared form dialog puts focus on its first field (the Type list), never on the date field.
    await expect(dialog.locator('#ooo-type')).toBeFocused();
    await expect(dialog.locator('#ooo-until')).not.toBeFocused();

    // Tab reaches the chips, the date, the note, the link and the buttons.
    const reached = new Set<string>();
    for (let i = 0; i < 16; i++) {
      await me.keyboard.press('Tab');
      const label = await me.evaluate(() => {
        const a = document.activeElement as HTMLElement | null;
        return a?.getAttribute('data-key') || a?.id || a?.textContent?.trim() || '';
      });
      reached.add(label);
    }
    for (const want of ['today', 'tomorrow', 'monday', 'week', 'pick', 'ooo-until', 'ooo-note']) {
      expect(reached, `Tab reaches ${want}`).toContain(want);
    }
    expect([...reached].join('|')).toContain('More Options on My Profile');
    expect([...reached].join('|')).toContain('Cancel');

    await me.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(button).toBeFocused();
  });

  test('the link opens My profile and closes the dialog', async ({ personas, asUser }) => {
    const p = await personas.create({ ...PERSONAS.technician, label: 'pf5link' });
    const me = await asUser(p.username);
    await me.goto('/my-work');
    const dialog = await openDialog(me);
    await dialog.getByRole('link', { name: 'More Options on My Profile' }).click();
    await expect(me).toHaveURL(/\/profile$/);
    await expect(dialog).toHaveCount(0);
    await expect(me.locator('[data-profile-header] h1')).toBeVisible();
  });

  test('axe is clean and nothing scrolls sideways with the dialog open, at both desktop sizes', async ({
    personas,
    asUser,
  }) => {
    expect(axeAvailable(), 'axe-core must be available (set E2E_AXE_PATH)').toBe(true);
    const p = await personas.create({ ...PERSONAS.technician, label: 'pf5axe' });
    const me = await asUser(p.username);
    await me.goto('/my-work');
    const dialog = await openDialog(me);
    await dialog.locator('[data-key="monday"]').click();
    for (const size of SIZES) {
      await me.setViewportSize(size);
      await expect(dialog).toBeVisible();
      expect(await axeViolations(me), `dialog at ${size.width}`).toEqual([]);
      await noHorizontalScroll(me);
      await shot(me, 'pf5-ooo-dialog');
    }
  });
});
