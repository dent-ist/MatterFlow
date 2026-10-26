import fs from 'node:fs';
import path from 'node:path';
import { Page } from '@playwright/test';
import { axeAvailable, axeViolations } from '../support/axe';
import { expect, test } from '../support/fixtures';
import { PERSONAS, delayApi, failApi } from '../support/personas';
import { SIZES, noHorizontalScroll, shot } from '../support/screens';

/**
 * My profile epic #520, WP-PF7: #582, the keyboard and axe audit of the finished page with Tab-stop evidence. Everything is done with the
 * keyboard only (Tab, Shift+Tab, Enter, Space, arrows, Escape). No keyboard shortcut is added or changed (Phase 2 backlog #420): the Keyboard
 * shortcuts dialog is read before and after and must be identical. Evidence JSON goes to docs/ux/profile-review/fixes/pf7-audit/ when
 * E2E_SCREENSHOTS is set.
 */

const press = async (page: Page, key: string, times = 1): Promise<void> => {
  for (let i = 0; i < times; i++) await page.keyboard.press(key);
};

/** The Keyboard shortcuts dialog as it was before the Profile epic (no shortcut added or changed, #420). */
const SHORTCUT_ROWS: string[] = [
  'Anywhere',
  'CtrlK Search matters, clients, tasks and assets (Cmd + K on a Mac)',
  '? Show or hide this list',
  'Esc Close a menu, list or dialog and return to where you were',
  'GthenM Go to My Work',
  'GthenT Go to Task Queue',
  'GthenP Go to Pod Work',
  'Menus and lists',
  'EnterSpace Open a menu or choose the highlighted option',
  '↑↓ Move through the options of a menu or search results',
  'Tabs',
  '←→ Switch to the previous or next tab',
  'HomeEnd Go to the first or last tab',
];

const evidence = (name: string, data: unknown): void => {
  const out = process.env['E2E_SCREENSHOTS'];
  if (!out) return;
  fs.mkdirSync(out, { recursive: true });
  fs.writeFileSync(path.join(out, name), JSON.stringify(data, null, 2));
};

test.describe('pf7-keyboard: keyboard-only flows on My profile (#582)', () => {
  test("set out of office from the header action with a preset, then I'm back, all by keyboard; focus returns to the action", async ({
    personas,
    asUser,
  }) => {
    const p = await personas.create({ ...PERSONAS.technician, label: 'pf7kbA' });
    const me = await asUser(p.username);
    await me.goto('/profile');
    const action = me.locator('[data-primary-action] button');
    await action.focus();
    await press(me, 'Enter');
    const dialog = me.getByRole('dialog', { name: 'Set out of office' });
    await expect(dialog).toBeVisible();
    await expect(dialog.locator('.p-dialog-title')).toBeFocused();
    await dialog.getByRole('button', { name: 'Until tomorrow' }).focus();
    await press(me, 'Space');
    await expect(dialog.getByRole('button', { name: 'Until tomorrow' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await dialog.getByRole('button', { name: 'Set out of office' }).focus();
    await press(me, 'Enter');
    await expect(dialog).toHaveCount(0);
    await expect(action).toHaveText("I'm back");
    await expect(action).toBeFocused();
    await expect(me.locator('[data-status-ooo]')).toBeChecked();
    await press(me, 'Enter');
    await expect(action).toHaveText('Set out of office...');
    await expect(me.locator('[data-status-available]')).toBeChecked();
  });

  test('the account menu: arrows, Enter on Set out of office, a preset, Escape; focus returns to the menu button', async ({
    personas,
    asUser,
  }) => {
    const p = await personas.create({ ...PERSONAS.technician, label: 'pf7kbB' });
    const me = await asUser(p.username);
    await me.goto('/my-work');
    const button = me.getByRole('button', { name: /account menu/ });
    await button.focus();
    await press(me, 'ArrowDown');
    await expect(me.getByRole('menuitem', { name: 'My profile' })).toBeFocused();
    await press(me, 'ArrowDown');
    await expect(me.getByRole('menuitem', { name: 'Set out of office...' })).toBeFocused();
    await press(me, 'Enter');
    const dialog = me.getByRole('dialog', { name: 'Set out of office' });
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: 'Rest of today' }).focus();
    await press(me, 'Enter');
    await press(me, 'Escape');
    await expect(dialog).toHaveCount(0);
    await expect(button).toBeFocused();
  });

  test('work hours with the keyboard: toggle days with Space, type the pair, per-day grid, time zone by typing, Save with Enter', async ({
    personas,
    asUser,
  }) => {
    const p = await personas.create({ ...PERSONAS.technician, label: 'pf7kbC' });
    const me = await asUser(p.username);
    await me.goto('/profile');
    const sat = me.getByRole('button', { name: 'Saturday', exact: true });
    await sat.focus();
    await press(me, 'Space');
    await expect(sat).toHaveAttribute('aria-pressed', 'true');
    await expect(sat).toBeFocused();

    const disclosure = me.locator('[data-hours-disclosure]');
    await disclosure.focus();
    await press(me, 'Enter');
    await expect(me.locator('[data-hours-grid]')).toBeVisible();
    await expect(disclosure).toBeFocused();
    await me.getByLabel('Sunday', { exact: true }).focus();
    await press(me, 'Space');
    await expect(me.getByLabel('Sunday start time')).toBeVisible();
    await press(me, 'Space');
    await disclosure.focus();

    const select = me.locator('#av-tz');
    await select.focus();
    await me.keyboard.type('Central');
    await expect(select).toHaveValue('America/Chicago');
    await me.locator('[data-save] button').focus();
    await press(me, 'Enter');
    await expect(me.getByText('Availability saved').first()).toBeVisible();
    await expect(me.locator('[data-actions-state]')).toHaveText('No unsaved changes');
  });

  test('the error summary: its links move focus to the field; the sticky bar never hides the focused field', async ({
    personas,
    asUser,
  }) => {
    const p = await personas.create({ ...PERSONAS.technician, label: 'pf7kbD' });
    const me = await asUser(p.username);
    for (const size of [SIZES[0], SIZES[2]]) {
      await me.setViewportSize(size);
      await me.goto('/profile');
      await me.getByLabel('End time', { exact: true }).fill('08:00');
      await me.locator('[data-save] button').focus();
      await press(me, 'Enter');
      const summary = me.locator('[data-summary]');
      await expect(summary).toBeFocused();
      await summary.getByRole('link').first().focus();
      await press(me, 'Enter');
      await expect(me.getByLabel('Start time', { exact: true })).toBeFocused();
      await expect
        .poll(
          () =>
            me.evaluate(() => {
              const a = document.activeElement!.getBoundingClientRect();
              const b = document.querySelector('[data-actions]')!.getBoundingClientRect();
              return a.bottom > b.top && a.top < b.bottom;
            }),
          { message: `focused field behind the bar at ${size.width}` },
        )
        .toBe(false);
    }
  });

  test('the unsaved-changes guard: Stay and Leave work with the keyboard', async ({
    personas,
    asUser,
  }) => {
    const p = await personas.create({ ...PERSONAS.technician, label: 'pf7kbE' });
    const me = await asUser(p.username);
    await me.goto('/profile');
    await me.getByRole('button', { name: 'Sunday', exact: true }).focus();
    await press(me, 'Space');
    await me.getByRole('link', { name: 'My Work' }).focus();
    await press(me, 'Enter');
    const ask = me.getByRole('dialog', { name: 'Leave without saving?' });
    await expect(ask).toBeVisible();
    await ask.getByRole('button', { name: 'Stay' }).focus();
    await press(me, 'Enter');
    await expect(me).toHaveURL(/\/profile$/);
    await expect(me.getByRole('button', { name: 'Sunday', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await me.getByRole('link', { name: 'My Work' }).focus();
    await press(me, 'Enter');
    await me
      .getByRole('dialog', { name: 'Leave without saving?' })
      .getByRole('button', { name: 'Leave' })
      .focus();
    await press(me, 'Enter');
    await expect(me).toHaveURL(/\/my-work$/);
  });

  test('the skip link works and every stop on the page shows a focus ring and is not hidden behind the bar (Tab sweep evidence)', async ({
    personas,
    asUser,
  }) => {
    const p = await personas.create({ ...PERSONAS.technician, label: 'pf7kbF' });
    const me = await asUser(p.username);
    await me.setViewportSize({ width: 1366, height: 768 });
    await me.goto('/profile');
    await expect(me.locator('[data-card="availability"]')).toBeVisible();
    await press(me, 'Tab');
    await expect(me.getByRole('link', { name: /Skip to main/ })).toBeFocused();
    await press(me, 'Enter');
    const inMain = await me.evaluate(
      () => !!document.activeElement?.closest('main') || document.activeElement?.id === 'mf-main',
    );
    expect(inMain).toBe(true);

    // Sweep the form: from the first Status radio to the end of the right column.
    await me.getByRole('button', { name: 'Saturday', exact: true }).click(); // something to save, so Save is a stop
    await me.locator('[data-status-available]').focus();
    const stops: { label: string; ring: boolean; covered: boolean }[] = [];
    for (let n = 0; n < 80; n++) {
      const info = await me.evaluate(() => {
        const el = document.activeElement as HTMLElement;
        const r = el.getBoundingClientRect();
        const cs = getComputedStyle(el);
        const ring =
          (cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) > 0) ||
          cs.boxShadow !== 'none';
        const top = document.elementFromPoint(
          r.left + r.width / 2,
          Math.min(Math.max(r.top + r.height / 2, 0), innerHeight - 1),
        );
        const covered = !!top && !(el === top || el.contains(top) || top.contains(el));
        const label =
          el.getAttribute('aria-label') ||
          (el as HTMLInputElement).labels?.[0]?.textContent?.trim().slice(0, 40) ||
          el.textContent?.trim().slice(0, 40) ||
          el.id ||
          el.tagName;
        const inGrid = !!el.closest('[data-profile-grid]');
        return { label, ring, covered, inGrid };
      });
      if (!info.inGrid) break;
      stops.push({ label: info.label, ring: info.ring, covered: info.covered });
      await me.keyboard.press('Tab');
    }
    expect(stops.length).toBeGreaterThan(10);
    expect(
      // The first stop was focused by the test (no keyboard modality yet); every stop reached with Tab shows a focus indicator.
      stops
        .slice(1)
        .filter((s) => !s.ring)
        .map((s) => s.label),
      'stops without a visible focus indicator',
    ).toEqual([]);
    const toSave = stops.findIndex((s) => s.label === 'Save changes') + 1;
    expect(toSave).toBeGreaterThan(0);
    expect(toSave, 'Tab stops from Status to Save').toBeLessThanOrEqual(18);
    evidence('pf7-tab-sweep-1366.json', {
      stopsToSave: toSave,
      budget: 18,
      totalStopsInForm: stops.length,
      stops,
    });
  });

  test('the Keyboard shortcuts dialog is unchanged (no shortcut added or changed)', async ({
    personas,
    asUser,
  }) => {
    const p = await personas.create({ ...PERSONAS.technician, label: 'pf7kbG' });
    const me = await asUser(p.username);
    await me.goto('/profile');
    await me.getByRole('button', { name: /account menu/ }).click();
    await me.getByRole('menuitem', { name: 'Keyboard shortcuts' }).click();
    const dialog = me.getByRole('dialog', { name: /Keyboard shortcuts/ });
    await expect(dialog).toBeVisible();
    const rows = (
      await dialog.locator('[data-shortcut-help] h3, [data-shortcut-help] .sh__row').allInnerTexts()
    )
      .map((t) => t.replace(/\s+/g, ' ').trim())
      .filter(Boolean);
    expect(rows).toEqual(SHORTCUT_ROWS);
  });
});

test.describe('pf7-axe: axe 0 and no sideways scroll at four sizes for every state (#582)', () => {
  test.setTimeout(240_000);

  test('available, out of office, errors, dialog open, menu open, loading and load error', async ({
    personas,
    asUser,
  }) => {
    const p = await personas.create({ ...PERSONAS.technician, label: 'pf7axe' });
    const me = await asUser(p.username);
    const check = async (label: string, size: { width: number }): Promise<void> => {
      // The page may have scrolled to show the summary or the dialog; axe measures the page from its top (a button half under the fixed header is not a target).
      await me.evaluate(() => window.scrollTo(0, 0));
      await noHorizontalScroll(me);
      if (axeAvailable()) expect(await axeViolations(me), `${label} at ${size.width}`).toEqual([]);
    };
    for (const size of SIZES) {
      await me.setViewportSize(size);
      await me.goto('/profile');
      await expect(me.locator('[data-card="availability"]')).toBeVisible();
      await check('available', size);
      if (size.width === 1366 || size.width === 375) await shot(me, 'pf7-available');

      await me.getByRole('radio', { name: /Out of office/ }).check();
      await check('out of office (edited)', size);
      await me.locator('#av-from').fill('Oct 20, 2030');
      await me.locator('#av-until').fill('Oct 10, 2030');
      await me.locator('#av-until').blur();
      await me.getByRole('button', { name: 'Save changes' }).click();
      await expect(me.locator('[data-summary]')).toBeVisible();
      await check('errors', size);
      if (size.width === 1366 || size.width === 375) await shot(me, 'pf7-errors');

      await me.goto('/profile');
      await me.locator('[data-primary-action] button').click();
      await expect(me.getByRole('dialog', { name: 'Set out of office' })).toBeVisible();
      await check('dialog open', size);
      await me.keyboard.press('Escape');
      await me.getByRole('button', { name: /account menu/ }).click();
      await expect(me.locator('[data-menu-identity]')).toBeVisible();
      await check('menu open', size);
      await me.keyboard.press('Escape');

      const undelay = await delayApi(me, '**/api/v1/me/availability', 2500);
      await me.goto('/my-work');
      await me.getByRole('button', { name: /account menu/ }).click();
      await me.getByRole('menuitem', { name: 'My profile' }).click();
      await expect(me.locator('[data-profile-skeleton]')).toBeVisible();
      await check('loading', size);
      await expect(me.locator('[data-profile-skeleton]')).toHaveCount(0, { timeout: 15_000 });
      await undelay();

      const unfail = await failApi(me, '**/api/v1/me/availability', 500, {
        times: 1,
        method: 'GET',
      });
      await me.goto('/profile');
      await expect(me.locator('[data-record-state]')).toBeVisible();
      await check('load error', size);
      await unfail();
    }
  });
});
