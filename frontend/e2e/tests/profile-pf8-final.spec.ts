import fs from 'node:fs';
import path from 'node:path';
import { Page } from '@playwright/test';
import { axeAvailable, axeViolations } from '../support/axe';
import { expect, test } from '../support/fixtures';
import { PERSONAS, delayApi, failApi } from '../support/personas';
import { SIZES, noHorizontalScroll, shot } from '../support/screens';

/**
 * My profile epic #520, WP-PF8: #601, the final verification. One contract over the review's persons (available, out of office, errors, loading,
 * load error, a 66-character name, no display name) at both desktop sizes: axe 0 (WCAG 2.2 AA, which includes target-size), no sideways scroll, the
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
    const avail = rect('[data-card="work-hours"]');
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

test.describe("pf8-final: the final contract over the review's persons at both desktop sizes (#601)", () => {
  test.setTimeout(420_000);

  test('loading and load error at both desktop sizes', async ({ personas, asUser }) => {
    const p = await personas.create({ ...PERSONAS.technician, label: 'pf8states' });
    const me = await asUser(p.username);
    for (const size of SIZES) {
      await me.setViewportSize(size);
      await me.goto('/my-work');
      const undelay = await delayApi(me, '**/api/v1/me/availability', 2500);
      await me.getByRole('button', { name: /account menu/ }).click();
      await me.getByRole('menuitem', { name: 'My Profile' }).click();
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
      // The state is the header and the shared record state: the header is the plain "My Profile" (no person action).
      await expect(me.locator('main h1')).toHaveText('My Profile');
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
    await me.locator('[data-card="work-hours"] input').first().focus();
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
