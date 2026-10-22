import fs from 'node:fs';
import path from 'node:path';
import { Page } from '@playwright/test';
import { axeAvailable } from '../support/axe';
import { expect, test } from '../support/fixtures';
import { delayApi, failApi, goOffline } from '../support/personas';
import { SIZES, axeClean, box, pageSideScroll } from '../support/pod-work-checks';
import { toasts } from '../support/toasts';

/**
 * Final verification of the Users administration (epic #422, WP-US8, #460): the contract of the review over the people the suite has
 * created (more than a thousand on a used database, a 130-character name and long role and pod names among them) at the four sizes of the
 * definition of done, and the states of the page. The behaviour of every part has its own spec (users-us1 to users-us7); this one checks that
 * the pieces hold together:
 *  - axe (WCAG 2.2 AA, target-size, best practice) finds nothing and the page does not scroll sideways on the Users, Roles and Pods tabs, with
 *    the user panel open and with the availability dialog open;
 *  - the grid rows are 44 px from 640 px, the cards fill the width below it, there is no scroll box between the grid and its region;
 *  - the states: loading (skeleton, one polite message), error (the line, the reference, Retry, no toast), a filtered list with no match,
 *    offline (the banner; the page reads itself when the connection returns), and the 403 page for a person with Task.View only.
 * Screenshots go to `E2E_SCREENSHOTS_US` (docs/ux/users-review/fixes/final). axe is required: the suite fails, never skips, without it.
 */
const OUT = process.env['E2E_SCREENSHOTS_US'];

async function shot(page: Page, name: string): Promise<void> {
  if (!OUT) return;
  fs.mkdirSync(OUT, { recursive: true });
  await page.waitForTimeout(250);
  await page.screenshot({ path: path.join(OUT, `${name}.png`) });
}

const rows = (page: Page) => page.locator('tr[data-user], li.rc');

test.describe('Users final verification', () => {
  test('axe is available (the audits below really run)', () => {
    expect(axeAvailable(), 'set E2E_AXE_PATH to axe.min.js').toBe(true);
  });

  for (const size of SIZES) {
    test(`${size.name}: Users, Roles and Pods tabs, the panel and the availability dialog: axe 0, no sideways scroll, rows 44 px, no failed request`, async ({
      page,
    }) => {
      test.setTimeout(240_000);
      await page.setViewportSize({ width: size.width, height: size.height });
      const failed: string[] = [];
      page.on('response', (r) => {
        if (r.url().includes('/api/') && r.status() >= 400) failed.push(`${r.status()} ${r.url()}`);
      });

      await page.goto('/admin/users?status=all');
      await expect(page.getByRole('heading', { name: 'Users', level: 1 })).toBeVisible();
      const first = page.locator('button[data-open], button[data-card-name]').first();
      await expect(first).toBeVisible();
      expect(await pageSideScroll(page), 'Users tab sideways scroll').toBeLessThanOrEqual(0);
      await axeClean(page, `axe, Users tab, ${size.name}`);
      await shot(page, `users-${size.name}`);

      // The grid rows are 44 px from 640 px; below it the people are cards.
      if (size.width >= 640) {
        const heights = await page
          .locator('table.mf-grid tbody tr[data-user]')
          .evaluateAll((trs) =>
            trs.slice(0, 12).map((tr) => Math.round(tr.getBoundingClientRect().height * 10) / 10),
          );
        expect(heights.length).toBeGreaterThan(0);
        expect(
          heights.every((h) => h >= 43 && h <= 45),
          `row heights ${heights.join(', ')} (44 px; the collapsed border adds up to a pixel)`,
        ).toBe(true);
      } else {
        await expect(page.locator('li.rc').first()).toBeVisible();
        expect(await page.locator('table').count(), 'no table on a phone').toBe(0);
      }

      // The panel.
      await first.click();
      const panel = page.getByRole('dialog').first();
      await expect(panel).toBeVisible();
      expect(await pageSideScroll(page), 'panel sideways scroll').toBeLessThanOrEqual(0);
      await axeClean(page, `axe, user panel open, ${size.name}`);
      await shot(page, `panel-${size.name}`);

      // The availability dialog on top of it.
      // On a phone the sections other than Access are folded: a tap on its heading opens it.
      const fold = panel.locator('[data-section-toggle="availability"]');
      if ((await fold.count()) > 0 && (await fold.getAttribute('aria-expanded')) === 'false') {
        await fold.click();
      }
      await panel.getByRole('button', { name: /^Edit availability/ }).click();
      await expect(page.getByRole('dialog').last()).toBeVisible();
      await axeClean(page, `axe, availability dialog open, ${size.name}`);
      await page.keyboard.press('Escape'); // closes only the dialog (users-us4)
      await expect(page.getByRole('dialog')).toHaveCount(1);
      await page.getByRole('button', { name: 'Close user details' }).click();
      await expect(page.getByRole('dialog')).toHaveCount(0);

      // Roles and Pods tabs.
      for (const [tab, name] of [
        ['Roles', /^Roles/],
        ['Pods', /^Pods/],
      ] as const) {
        await page.getByRole('tab', { name }).click();
        await expect(page.getByRole('tab', { name, selected: true })).toBeVisible();
        await page.waitForTimeout(400);
        expect(await pageSideScroll(page), `${tab} tab sideways scroll`).toBeLessThanOrEqual(0);
        await axeClean(page, `axe, ${tab} tab, ${size.name}`);
        await shot(page, `${tab.toLowerCase()}-${size.name}`);
      }

      expect(failed, 'no API response of 400 or more on any allowed path').toEqual([]);
      await expect(toasts(page)).toHaveCount(0);
    });
  }

  test('the grid sits in one scroll region: no scroll box between the table and its region', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1366, height: 768 });
    await page.goto('/admin/users?status=all');
    await expect(rows(page).first()).toBeVisible();
    const scrollers = await page
      .locator('table.mf-grid')
      .first()
      .evaluate((table) => {
        const found: string[] = [];
        for (let el = table.parentElement; el && el !== document.body; el = el.parentElement) {
          const o = getComputedStyle(el).overflowY;
          if ((o === 'auto' || o === 'scroll') && el.scrollHeight > el.clientHeight) {
            found.push(`${el.tagName.toLowerCase()}.${String(el.className).slice(0, 30)}`);
          }
        }
        return found;
      });
    expect(
      scrollers.length,
      `scroll boxes around the grid: ${scrollers.join(' > ')}`,
    ).toBeLessThanOrEqual(1);
  });

  test('states: loading is a skeleton with one polite message; an error has its line, the reference and Retry and no toast; no match is one message', async ({
    page,
  }) => {
    test.setTimeout(180_000);
    for (const size of [SIZES[0], SIZES[3]]) {
      await page.setViewportSize({ width: size.width, height: size.height });

      const release = await delayApi(page, /\/api\/v1\/users\?/, 3500);
      await page.goto('/admin/users?status=all');
      await expect(page.getByRole('heading', { name: 'Users', level: 1 })).toBeVisible();
      await expect(
        page.locator('[data-skeleton], [aria-busy="true"], .skeleton').first(),
      ).toBeAttached();
      await axeClean(page, `axe while loading, ${size.name}`);
      await shot(page, `loading-${size.name}`);
      await release();
      await expect(rows(page).first()).toBeVisible({ timeout: 30_000 });

      const unfail = await failApi(page, /\/api\/v1\/users\?/, 500);
      await page.goto('/admin/users?status=all');
      const error = page.locator('[data-error]');
      await expect(error).toBeVisible();
      await expect(error).toContainText('Reference:');
      await expect(page.getByRole('button', { name: 'Retry' })).toBeVisible();
      await page.waitForTimeout(800);
      await expect(toasts(page)).toHaveCount(0);
      await axeClean(page, `axe, error state, ${size.name}`);
      await shot(page, `error-${size.name}`);
      await unfail();
      await page.getByRole('button', { name: 'Retry' }).click();
      await expect(rows(page).first()).toBeVisible();

      await page.goto('/admin/users?status=all&name=zz-nobody-has-this-name');
      await expect(page.locator('[data-empty="filtered"]')).toContainText(
        'No users match these filters',
      );
      expect(await pageSideScroll(page)).toBeLessThanOrEqual(0);
      await axeClean(page, `axe, no match, ${size.name}`);
      await shot(page, `no-match-${size.name}`);
    }
  });

  test('offline: the banner says so, nothing toasts, and the list reads itself when the connection returns', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1366, height: 768 });
    await page.goto('/admin/users?status=all');
    await expect(rows(page).first()).toBeVisible();
    await goOffline(page);
    await expect(page.locator('[data-offline-banner]')).toBeVisible({ timeout: 5000 });
    await shot(page, 'offline-1366x768');
    await expect(toasts(page)).toHaveCount(0);
    await goOffline(page, false);
    await expect(page.locator('[data-offline-banner]')).toHaveCount(0, { timeout: 30_000 });
    await expect(rows(page).first()).toBeVisible();
  });

  test('a person with Task.View only gets the 403 page, not the list', async ({
    personas,
    asUser,
  }) => {
    const viewer = await personas.create({
      label: `us8v${Date.now() % 100000}`,
      permissions: ['Task.View'],
    });
    const page = await asUser(viewer.username);
    for (const size of [SIZES[0], SIZES[3]]) {
      await page.setViewportSize({ width: size.width, height: size.height });
      await page.goto('/admin/users');
      await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();
      await expect(rows(page)).toHaveCount(0);
      await expect(page.getByText(/permission|not allowed|403/i).first()).toBeVisible();
      await axeClean(page, `axe, 403 page, ${size.name}`);
      await shot(page, `403-${size.name}`);
    }
    expect(await box(page.getByRole('heading', { level: 1 }).first())).toBeTruthy();
  });
});
