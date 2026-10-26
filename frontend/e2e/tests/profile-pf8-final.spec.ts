import fs from 'node:fs';
import path from 'node:path';
import { Page } from '@playwright/test';
import { axeAvailable, axeViolations } from '../support/axe';
import { expect, test } from '../support/fixtures';
import { PERSONAS, delayApi, failApi } from '../support/personas';
import { SIZES, noHorizontalScroll, shot } from '../support/screens';

/**
 * My profile epic #520, WP-PF8: #601, the final verification. One contract over the review's persons (available, out of office, errors, loading,
 * load error, a 66-character name, no display name) at the four sizes: axe 0 (WCAG 2.2 AA, which includes target-size), no sideways scroll, the
 * title where the other pages have it, ONE primary action in the header, the columns, the first screen at 1366x768 and at most 18 Tab stops to
 * Save. The measurements are written to `measurements.json` next to the screenshots (docs/ux/profile-review/fixes/final/) when E2E_SCREENSHOTS
 * is set; the before/after table in that folder's README compares them with the review's numbers.
 */

interface Row {
  state: string;
  width: number;
  h1Size: number;
  h1Top: number;
  actions: number;
  leftColumn: number | null;
  bar: number | null;
  account: 'right' | 'below' | null;
  barBottom: number | null;
  overflow: number;
  axe: number;
}

const rows: Row[] = [];

async function measure(page: Page, state: string, expectActions: number): Promise<Row> {
  await page.evaluate(() => window.scrollTo(0, 0));
  const m = await page.evaluate(() => {
    const rect = (s: string) => document.querySelector(s)?.getBoundingClientRect() ?? null;
    const h1 = document.querySelector('main h1') as HTMLElement;
    const main = document.querySelector('main')!.getBoundingClientRect();
    const left = rect('.pp__col--main');
    const bar = rect('[data-actions]');
    const account = rect('[data-account-card]');
    const avail = rect('[data-card="availability"]');
    return {
      h1Size: parseFloat(getComputedStyle(h1).fontSize),
      h1Top: h1.getBoundingClientRect().top - main.top,
      actions: document.querySelectorAll('[data-page-actions] button').length,
      leftColumn: left && left.width > 0 ? Math.round(left.width) : null,
      bar: bar && bar.width > 0 ? Math.round(bar.width) : null,
      account:
        account && avail && account.width > 0
          ? account.left >= avail.right
            ? 'right'
            : 'below'
          : null,
      barBottom: bar && bar.width > 0 ? Math.round(bar.bottom) : null,
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    };
  });
  const violations = axeAvailable() ? await axeViolations(page) : [];
  const size = page.viewportSize()!;
  const row = {
    state,
    width: size.width,
    ...m,
    axe: violations.length,
    account: m.account as Row['account'],
  };
  expect(violations, `axe: ${state} at ${size.width}`).toEqual([]);
  expect(m.overflow, `sideways scroll: ${state} at ${size.width}`).toBeLessThanOrEqual(0);
  expect(m.h1Size, `title size: ${state} at ${size.width}`).toBe(size.width < 640 ? 18 : 22);
  expect(m.h1Top, `title top: ${state} at ${size.width}`).toBeCloseTo(12, 0);
  expect(m.actions, `primary actions: ${state} at ${size.width}`).toBe(expectActions);
  rows.push(row);
  return row;
}

test.describe.configure({ mode: 'serial' });

test.describe("pf8-final: the final contract over the review's persons at four sizes (#601)", () => {
  test.setTimeout(420_000);

  test('available, out of office, errors, long name and no display name', async ({
    personas,
    asUser,
    seed,
    admin,
  }) => {
    const seeded = await personas.create({
      ...PERSONAS.technician,
      label: 'pf8seed',
      displayName: 'Dana Final Reviewer',
    });
    const pod = await seed.pod('Final Review Pod', [seeded.userId]);
    await admin.put(`/api/v1/pods/${pod.podId}/members/${seeded.userId}`, { isPrimary: true });
    const long = await personas.create({ ...PERSONAS.longName, label: 'pf8long' });
    const plain = await personas.create({ ...PERSONAS.technician, label: 'pf8plain' });
    const me = await asUser(seeded.username);
    const tall = await asUser(long.username);
    const noName = await asUser(plain.username);

    for (const size of SIZES) {
      await me.setViewportSize(size);
      await me.goto('/profile');
      await expect(me.locator('[data-card="availability"]')).toBeVisible();
      const av = await measure(me, 'available', 1);
      expect(av.account).toBe(size.width >= 1100 ? 'right' : 'below');
      if (size.width >= 1100) expect(Math.abs(av.leftColumn! - av.bar!)).toBeLessThan(2);
      await expect(me.locator('[data-page-description]')).toHaveText(
        'Data Technician · Final Review Pod',
      );
      await shot(me, 'final-available');
      if (size.width === 1366) {
        expect(av.barBottom!, 'first screen at 1366x768 holds the Save bar').toBeLessThanOrEqual(
          768,
        );
        await expect(me.locator('#av-tz-note')).toBeInViewport();
      }

      await me.locator('[data-primary-action] button').click();
      const dialog = me.getByRole('dialog', { name: 'Set out of office' });
      await dialog.getByRole('button', { name: 'Until Monday' }).click();
      await dialog.getByRole('button', { name: 'Set out of office' }).click();
      await expect(dialog).toHaveCount(0);
      await expect(me.locator('[data-primary-action] button')).toHaveText("I'm back");
      await measure(me, 'out of office', 1);
      await shot(me, 'final-out-of-office');
      await me.locator('[data-primary-action] button').click();
      await expect(me.locator('[data-primary-action] button')).toHaveText('Set out of office...');

      await me.getByRole('radio', { name: /Out of office/ }).check();
      await me.locator('#av-from').fill('Oct 20, 2030');
      await me.locator('#av-until').fill('Oct 10, 2030');
      await me.locator('#av-until').blur();
      await me.getByRole('button', { name: 'Save changes' }).click();
      await expect(me.locator('[data-summary]')).toBeVisible();
      const err = await measure(me, 'errors', 1);
      if (size.width >= 1100) {
        const widths = await me.evaluate(() => ({
          summary: document.querySelector('[data-summary]')!.getBoundingClientRect().width,
          left: document.querySelector('.pp__col--main')!.getBoundingClientRect().width,
        }));
        expect(Math.abs(widths.summary - widths.left)).toBeLessThan(2);
      }
      void err;
      await shot(me, 'final-errors');

      await tall.setViewportSize(size);
      await tall.goto('/profile');
      await expect(tall.locator('[data-card="availability"]')).toBeVisible();
      await measure(tall, 'long name', 1);
      await expect(tall.locator('[data-name]')).toHaveAttribute('title', long.displayName!);
      await shot(tall, 'final-long-name');

      await noName.setViewportSize(size);
      await noName.goto('/profile');
      await expect(noName.locator('main h1')).toContainText(plain.username);
      await measure(noName, 'no display name', 1);
      await shot(noName, 'final-no-display-name');
    }
  });

  test('loading and load error at four sizes', async ({ personas, asUser }) => {
    const p = await personas.create({ ...PERSONAS.technician, label: 'pf8states' });
    const me = await asUser(p.username);
    for (const size of SIZES) {
      await me.setViewportSize(size);
      await me.goto('/my-work');
      const undelay = await delayApi(me, '**/api/v1/me/availability', 2500);
      await me.getByRole('button', { name: /account menu/ }).click();
      await me.getByRole('menuitem', { name: 'My profile' }).click();
      await expect(me.locator('[data-profile-skeleton]')).toBeVisible();
      await measure(me, 'loading', 0);
      await shot(me, 'final-loading');
      await expect(me.locator('[data-profile-skeleton]')).toHaveCount(0, { timeout: 15_000 });
      await undelay();

      const unfail = await failApi(me, '**/api/v1/me/availability', 500, {
        times: 1,
        method: 'GET',
      });
      await me.goto('/profile');
      await expect(me.locator('[data-record-state]')).toBeVisible();
      // The state is the header and the shared record state: the header is the plain "My profile" (no person action).
      await expect(me.locator('main h1')).toHaveText('My profile');
      await measure(me, 'load error', 0);
      await shot(me, 'final-load-error');
      await unfail();
    }
  });

  test('Tab stops from Status to Save at 1366x768, and the record of every measurement', async ({
    personas,
    asUser,
  }) => {
    const p = await personas.create({ ...PERSONAS.technician, label: 'pf8tab' });
    const me = await asUser(p.username);
    await me.setViewportSize({ width: 1366, height: 768 });
    await me.goto('/profile');
    await me.getByRole('button', { name: 'Saturday', exact: true }).click();
    await me.locator('[data-status-available]').focus();
    let stops = -1;
    for (let n = 1; n <= 60; n++) {
      await me.keyboard.press('Tab');
      if (await me.evaluate(() => !!document.activeElement?.closest('[data-save]'))) {
        stops = n;
        break;
      }
    }
    expect(stops).toBeGreaterThan(0);
    expect(stops, 'Tab stops to Save').toBeLessThanOrEqual(18);
    await noHorizontalScroll(me);

    const out = process.env['E2E_SCREENSHOTS'];
    if (out) {
      fs.mkdirSync(out, { recursive: true });
      fs.writeFileSync(
        path.join(out, 'measurements.json'),
        JSON.stringify({ tabStopsToSave: stops, budget: 18, rows }, null, 2),
      );
    }
  });
});
