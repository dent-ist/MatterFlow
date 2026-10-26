import fs from 'node:fs';
import path from 'node:path';
import { Page } from '@playwright/test';
import { axeAvailable, axeViolations } from '../support/axe';
import { expect, test } from '../support/fixtures';
import { PERSONAS } from '../support/personas';
import { SIZES, noHorizontalScroll, shot } from '../support/screens';

/**
 * My profile epic #520, WP-PF4 and WP-PF6: #534 (compact work hours), #535 (Different hours on some days opens the grid), #536 (the two
 * quiet buttons), #540 (Time zone select) and #567 (local time and the display-zone sentence). Screenshots for
 * docs/ux/profile-review/fixes/pf4-work-hours/ and pf6-time-zone/ are written when E2E_SCREENSHOTS is set.
 */

const axeClean = async (page: Page, label: string): Promise<void> => {
  if (axeAvailable()) expect(await axeViolations(page), label).toEqual([]);
};

/** Tab stops from the first Status radio to Save (Save is reachable once something changed). */
async function tabStopsToSave(page: Page): Promise<number> {
  await page.locator('[data-status-available]').focus();
  for (let n = 1; n <= 60; n++) {
    await page.keyboard.press('Tab');
    const onSave = await page.evaluate(() => !!document.activeElement?.closest('[data-save]'));
    if (onSave) return n;
  }
  return -1;
}

test.describe('pf4-hours: compact work hours (#534)', () => {
  test('seven toggles and one pair write the same hours; a toggled-on day gets the pair; the saved week comes back', async ({
    personas,
    asUser,
  }) => {
    const p = await personas.create({ ...PERSONAS.technician, label: 'pf4hours' });
    const me = await asUser(p.username);
    await me.goto('/profile');
    const toggles = me.locator('[data-day-toggle]');
    await expect(toggles).toHaveCount(7);
    await expect(me.getByRole('button', { name: 'Monday', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expect(me.getByRole('button', { name: 'Saturday', exact: true })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
    await expect(me.locator('[data-hours-grid]')).toHaveCount(0);

    await me.getByLabel('Start time', { exact: true }).fill('08:00');
    await me.getByLabel('End time', { exact: true }).fill('16:00');
    await me.getByRole('button', { name: 'Saturday', exact: true }).click();
    await me.getByRole('button', { name: 'Friday', exact: true }).click();
    await me.getByRole('button', { name: 'Save changes' }).click();
    await expect(me.getByText('Availability saved').first()).toBeVisible();

    const saved = await me.evaluate(async () => {
      const r = await fetch('/api/v1/me/availability', {
        headers: { 'X-MatterFlow-Client': 'web' },
      });
      return (
        (await r.json()) as { workHours: { dayOfWeek: number; start: string; end: string }[] }
      ).workHours;
    });
    expect(saved.map((h) => h.dayOfWeek)).toEqual([1, 2, 3, 4, 6]);
    expect(saved.every((h) => h.start.startsWith('08:00') && h.end.startsWith('16:00'))).toBe(true);

    await me.reload();
    await expect(me.getByRole('button', { name: 'Saturday', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expect(me.getByRole('button', { name: 'Friday', exact: true })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
    await expect(me.getByLabel('End time', { exact: true })).toHaveValue('16:00');
  });

  test('an end before the start is one message, linked from the summary to the field', async ({
    personas,
    asUser,
  }) => {
    const p = await personas.create({ ...PERSONAS.technician, label: 'pf4err' });
    const me = await asUser(p.username);
    await me.goto('/profile');
    await me.getByLabel('End time', { exact: true }).fill('08:00');
    await expect(me.locator('[data-hours-error]')).toContainText(
      'the end time must be after the start time',
    );
    await me.getByRole('button', { name: 'Save changes' }).click();
    const summary = me.locator('[data-summary]');
    await expect(summary.locator('li')).toHaveCount(1);
    await summary.getByRole('link', { name: /Work hours/ }).click();
    await expect(me.getByLabel('Start time', { exact: true })).toBeFocused();
  });

  test('Tab stops from Status to Save: at most 18 (the review measured about 50), evidence written', async ({
    personas,
    asUser,
  }) => {
    const p = await personas.create({ ...PERSONAS.technician, label: 'pf4tab' });
    const me = await asUser(p.username);
    await me.setViewportSize({ width: 1366, height: 768 });
    await me.goto('/profile');
    await me.getByRole('button', { name: 'Saturday', exact: true }).click();
    const stops = await tabStopsToSave(me);
    expect(stops).toBeGreaterThan(0);
    expect(stops, 'Tab stops to Save').toBeLessThanOrEqual(18);
    const out = process.env['E2E_SCREENSHOTS'];
    if (out) {
      fs.mkdirSync(out, { recursive: true });
      fs.writeFileSync(
        path.join(out, 'tab-stops-compact.json'),
        JSON.stringify({ stopsToSave: stops, budget: 18, before: 'about 50' }, null, 2),
      );
    }
  });

  test('the first screen at 1366x768 holds Availability, Work hours with the time zone, and the Save bar', async ({
    personas,
    asUser,
  }) => {
    const p = await personas.create({ ...PERSONAS.technician, label: 'pf4first' });
    const me = await asUser(p.username);
    await me.setViewportSize({ width: 1366, height: 768 });
    await me.goto('/profile');
    await expect(me.locator('#av-tz')).toBeVisible();
    const bottom = await me.evaluate(() => {
      const main = document.querySelector('main')!;
      const bar = document.querySelector('[data-actions]')!.getBoundingClientRect();
      const tz = document.querySelector('#av-tz-note')!.getBoundingClientRect();
      return {
        bar: bar.bottom,
        tz: tz.bottom,
        view: Math.min(innerHeight, main.getBoundingClientRect().bottom),
        scrollTop: main.scrollTop,
      };
    });
    expect(bottom.scrollTop).toBe(0);
    expect(bottom.bar).toBeLessThanOrEqual(bottom.view);
    expect(bottom.tz).toBeLessThanOrEqual(bottom.view);
    await shot(me, 'pf4-first-screen');
  });

  test('axe and no sideways scroll at four sizes, compact and with the grid open', async ({
    personas,
    asUser,
  }) => {
    const p = await personas.create({ ...PERSONAS.technician, label: 'pf4axe' });
    const me = await asUser(p.username);
    for (const size of SIZES) {
      await me.setViewportSize(size);
      await me.goto('/profile');
      await expect(me.locator('[data-day-toggle]').first()).toBeVisible();
      await noHorizontalScroll(me);
      await axeClean(me, `compact at ${size.width}`);
      await shot(me, 'pf4-compact');
      const toggle = await me.locator('[data-day-toggle]').first().boundingBox();
      expect(toggle!.height).toBeGreaterThanOrEqual(32);
      await me.getByRole('button', { name: 'Different hours on some days' }).click();
      await expect(me.locator('[data-hours-grid]')).toBeVisible();
      await noHorizontalScroll(me);
      await axeClean(me, `grid at ${size.width}`);
      if (size.width === 1366 || size.width === 375) await shot(me, 'pf4-grid');
    }
  });
});

test.describe('pf4-grid: Different hours on some days (#535) and the quiet buttons (#536)', () => {
  test('the link opens the grid in place (aria-expanded, focus stays), Copy Monday and Reset are the same quiet button', async ({
    personas,
    asUser,
  }) => {
    const p = await personas.create({ ...PERSONAS.technician, label: 'pf4grid' });
    const me = await asUser(p.username);
    await me.goto('/profile');
    const disclosure = me.locator('[data-hours-disclosure]');
    await expect(disclosure).toHaveAttribute('aria-expanded', 'false');
    await disclosure.focus();
    await me.keyboard.press('Enter');
    await expect(disclosure).toHaveAttribute('aria-expanded', 'true');
    await expect(disclosure).toBeFocused();
    await expect(disclosure).toHaveText('Use the same hours on all days');
    await expect(me.locator('[data-hours-grid]')).toBeVisible();

    const copy = me.locator('[data-copy-weekdays]');
    const reset = me.locator('[data-reset-hours]');
    const css = async (l: typeof copy) =>
      l.evaluate((el) => {
        const s = getComputedStyle(el);
        return [
          s.color,
          s.backgroundColor,
          s.borderTopWidth,
          s.fontSize,
          s.fontWeight,
          el.querySelector('.pi') === null,
        ];
      });
    expect(await css(copy)).toEqual(await css(reset));
    expect((await css(copy))[5]).toBe(true);

    await me.getByLabel('Monday start time').fill('07:00');
    await copy.click();
    await expect(me.getByLabel('Friday start time')).toHaveValue('07:00');
    await reset.click();
    await expect(me.getByLabel('Friday start time')).toHaveValue('09:00');
    await disclosure.click();
    await expect(me.locator('[data-hours-grid]')).toHaveCount(0);
    await expect(disclosure).toBeFocused();
  });

  test('a week whose days differ opens the grid by itself, cannot be collapsed, and is never flattened on save', async ({
    personas,
    asUser,
  }) => {
    const p = await personas.create({ ...PERSONAS.technician, label: 'pf4differ' });
    const me = await asUser(p.username);
    await me.goto('/profile');
    await me.getByRole('button', { name: 'Different hours on some days' }).click();
    await me.getByLabel('Wednesday end time').fill('13:00');
    await me.getByRole('button', { name: 'Save changes' }).click();
    await expect(me.getByText('Availability saved').first()).toBeVisible();

    await me.reload();
    await expect(me.locator('[data-hours-grid]')).toBeVisible();
    const disclosure = me.locator('[data-hours-disclosure]');
    await expect(disclosure).toHaveAttribute('aria-disabled', 'true');
    await expect(me.locator('#av-hours-differ')).toContainText('Hours differ');
    await disclosure.click({ force: true });
    await expect(me.locator('[data-hours-grid]')).toBeVisible();
    await expect(me.getByLabel('Wednesday end time')).toHaveValue('13:00');
    await me.getByLabel('Wednesday end time').fill('17:00');
    await expect(disclosure).not.toHaveAttribute('aria-disabled', 'true');
    await shot(me, 'pf4-differ');
  });
});

test.describe('pf6-zone: the Time zone select (#540) and the local time sentence (#567)', () => {
  test('US zones first with their IANA ids, Other zones... reveals the search list, and a chosen zone is saved', async ({
    personas,
    asUser,
  }) => {
    const p = await personas.create({ ...PERSONAS.technician, label: 'pf6zone' });
    const me = await asUser(p.username);
    await me.goto('/profile');
    const select = me.locator('#av-tz');
    await expect(select).toBeVisible();
    const options = (await select.locator('option').allTextContents()).map((t) =>
      t.replace(/\s+/g, ' ').trim(),
    );
    expect(options.slice(-8)).toEqual([
      'Eastern (America/New_York)',
      'Central (America/Chicago)',
      'Mountain (America/Denver)',
      'Pacific (America/Los_Angeles)',
      'Alaska (America/Anchorage)',
      'Hawaii (Pacific/Honolulu)',
      'Arizona (no daylight saving) (America/Phoenix)',
      'Other zones...',
    ]);
    await expect(select).toHaveValue('America/New_York');
    await expect(me.locator('[data-tz-time]')).toContainText(
      /It is \d{1,2}:\d{2} (AM|PM) there now\./,
    );
    await expect(me.locator('[data-tz-note]')).toContainText("It is your browser's time zone");
    await select.selectOption('America/Chicago');
    await expect(me.locator('[data-tz-live]')).toContainText('Time zone set. It is');
    await expect(me.locator('[data-tz-note]')).toContainText('(America/New_York)');
    await me.getByRole('button', { name: 'Save changes' }).click();
    await expect(me.getByText('Availability saved').first()).toBeVisible();
    await me.reload();
    await expect(me.locator('#av-tz')).toHaveValue('America/Chicago');

    await me.locator('#av-tz').selectOption('__other__');
    await me.locator('#av-tz-other').fill('Asia/Tokyo');
    await expect(me.locator('[data-tz-error]')).toHaveCount(0);
    await me.getByRole('button', { name: 'Save changes' }).click();
    await expect(me.getByText('Availability saved').first()).toBeVisible();
    await me.reload();
    // The saved zone stays selectable as an extra first option; it is never lost behind Other zones.
    await expect(me.locator('#av-tz')).toHaveValue('Asia/Tokyo');
    await expect(me.locator('#av-tz option').first()).toContainText('Asia/Tokyo (saved)');
  });

  test('a non-US browser zone is an extra first option and preselected; an unknown typed zone is named in the summary', async ({
    personas,
    asUser,
  }) => {
    const p = await personas.create({ ...PERSONAS.technician, label: 'pf6berlin' });
    const me = await asUser(p.username, { timezoneId: 'Europe/Berlin' });
    await me.goto('/profile');
    await expect(me.locator('#av-tz')).toHaveValue('Europe/Berlin');
    await expect(me.locator('#av-tz option').first()).toContainText('Europe/Berlin');
    await me.locator('#av-tz').selectOption('__other__');
    await me.locator('#av-tz-other').fill('Mars/Olympus');
    await expect(me.locator('[data-tz-error]')).toContainText('is not a time zone we know');
    await me.getByRole('button', { name: 'Save changes' }).click();
    await me
      .locator('[data-summary]')
      .getByRole('link', { name: /Mars\/Olympus/ })
      .click();
    await expect(me.locator('#av-tz-other')).toBeFocused();
  });

  test('axe and no sideways scroll at four sizes, with the other-zones search open', async ({
    personas,
    asUser,
  }) => {
    const p = await personas.create({ ...PERSONAS.technician, label: 'pf6axe' });
    const me = await asUser(p.username);
    for (const size of SIZES) {
      await me.setViewportSize(size);
      await me.goto('/profile');
      await expect(me.locator('#av-tz')).toBeVisible();
      await noHorizontalScroll(me);
      await axeClean(me, `zone select at ${size.width}`);
      await shot(me, 'pf6-time-zone');
      await me.locator('#av-tz').selectOption('__other__');
      await expect(me.locator('#av-tz-other')).toBeVisible();
      await noHorizontalScroll(me);
      await axeClean(me, `other zones at ${size.width}`);
    }
  });
});
