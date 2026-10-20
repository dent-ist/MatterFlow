import fs from 'node:fs';
import path from 'node:path';
import { Page } from '@playwright/test';
import { axeAvailable, axeBestPractice } from '../support/axe';
import { expect, test } from '../support/fixtures';

/**
 * App shell SH1 (epic #585), #592: a long display name is clamped (header stays 57 px) and a name that differs from the account only by case
 * is shown once. With E2E_SCREENSHOTS set the run writes screenshots to docs/ux/shell-review/fixes/sh1-critical.
 */
const OUT = process.env['E2E_SCREENSHOTS'];
const SIZES = [
  [1366, 768],
  [1920, 1080],
  [768, 1024],
  [375, 812],
] as const;

async function shot(page: Page, name: string): Promise<void> {
  if (!OUT) return;
  fs.mkdirSync(OUT, { recursive: true });
  const size = page.viewportSize()!;
  await page.waitForTimeout(250);
  await page.screenshot({ path: path.join(OUT, `${name}-${size.width}x${size.height}.png`) });
}

async function axeClean(page: Page, what: string): Promise<void> {
  if (axeAvailable()) expect(await axeBestPractice(page), what).toEqual([]);
}

async function noSidewaysScroll(page: Page): Promise<void> {
  const m = await page.evaluate(() => {
    const e = document.scrollingElement!;
    return { sw: e.scrollWidth, cw: e.clientWidth };
  });
  expect(m.sw, 'page scrolls sideways').toBeLessThanOrEqual(m.cw);
}

const headerHeight = (page: Page) =>
  page.locator('header.mf-header').evaluate((h) => h.getBoundingClientRect().height);

let longName: string;

test.beforeAll(async ({ seed }) => {
  // Dev auth takes the display name from the account: a 66 character account is a 66 character name.
  longName = (await seed.user(['Data Technician'], 'long' + 'x'.repeat(60))).username;
});

test.describe('Header user name (#592)', () => {
  test('a different display name and account are both shown; a name equal to the account is shown once', async ({
    page,
  }) => {
    await page.goto('/my-work');
    const trigger = page.getByTestId('user-menu');
    await expect(trigger).toBeVisible();
    const name = (await trigger.locator('.um-name').textContent())!.trim();
    const accounts = await trigger.locator('.um-account').allTextContents();
    expect(accounts.length).toBeLessThanOrEqual(1);
    for (const a of accounts) expect(a.trim().toLowerCase()).not.toBe(name.toLowerCase());
  });

  test('a 66 character name keeps the header 57 px high at five widths and ends in an ellipsis; the tooltip has the full name', async ({
    page,
    asUser,
  }) => {
    await page.goto('/access-pending');
    const long = await asUser(longName);
    await long.goto('/');
    for (const [w, h] of [...SIZES, [1024, 768]] as const) {
      await page.setViewportSize({ width: w, height: h });
      await long.setViewportSize({ width: w, height: h });
      await page.goto('/my-work');
      await expect(page.getByTestId('user-menu')).toBeVisible();
      const normal = await headerHeight(page);
      await long.goto('/my-work');
      const trigger = long.getByTestId('user-menu');
      await expect(trigger).toBeVisible();
      expect(await headerHeight(long), `header at ${w}`).toBe(normal);
      expect(normal).toBe(57);
      await noSidewaysScroll(long);
      await expect(trigger).toHaveAttribute('title', /.{60,}/);
      if (w >= 481) {
        const clamped = await trigger
          .locator('.um-name')
          .evaluate(
            (el) =>
              el.scrollWidth > el.clientWidth && getComputedStyle(el).textOverflow === 'ellipsis',
          );
        expect(clamped, `ellipsis at ${w}`).toBe(true);
      }
      await axeClean(long, `long name at ${w}x${h}`);
      await shot(long, 'long-name-header');
    }
  });
});
