import { Page } from '@playwright/test';
import { axeAvailable, axeViolations } from '../support/axe';
import { expect, test } from '../support/fixtures';
import { PERSONAS, delayApi, failApi } from '../support/personas';
import { SIZES, noHorizontalScroll, shot } from '../support/screens';

/**
 * My profile epic #520, WP-PF2 and WP-PF3: #528 (P11 / P12, header content and the preview under Status), #529 (P2, two columns and one
 * card style), #531 (P8 / BUG-5, the action bar), #532 (P14, skeleton and the shared record state). Screenshots for
 * docs/ux/profile-review/fixes/pf2-identity/ and pf3-layout/ are written when E2E_SCREENSHOTS is set.
 */

interface Box {
  left: number;
  right: number;
  top: number;
  bottom: number;
  width: number;
}

async function box(page: Page, selector: string): Promise<Box> {
  const el = page.locator(selector).first();
  await expect(el, selector).toBeVisible();
  return el.evaluate((node) => {
    const r = node.getBoundingClientRect();
    return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width };
  });
}

async function axeClean(page: Page, label: string): Promise<void> {
  if (axeAvailable()) expect(await axeViolations(page), label).toEqual([]);
}

test.describe('pf2-header: name, context line, status chip and ONE primary action (#528)', () => {
  test("the title sits where My Work's does (22 px, 12 px from the top) and a long name clamps with the full name as tooltip", async ({
    personas,
    asUser,
  }) => {
    const p = await personas.create({ ...PERSONAS.longName, label: 'pf2long' });
    const me = await asUser(p.username);
    for (const size of SIZES) {
      await me.setViewportSize(size);
      await me.goto('/my-work');
      const work = await me
        .getByRole('heading', { name: 'My Work', level: 1 })
        .evaluate(
          (el) =>
            el.getBoundingClientRect().top -
            document.querySelector('main')!.getBoundingClientRect().top,
        );
      await me.goto('/profile');
      const h1 = me.locator('main h1');
      await expect(h1).toHaveText('My Profile');
      await expect(me.locator('[data-profile-who]')).toContainText(p.displayName!.slice(0, 20));
      const fontSize = await h1.evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
      expect(fontSize).toBe(size.width < 640 ? 18 : 22);
      const top = await h1.evaluate(
        (el) =>
          el.getBoundingClientRect().top -
          document.querySelector('main')!.getBoundingClientRect().top,
      );
      expect(top, `title top at ${size.width}`).toBeCloseTo(work, 0);
      // The name is the context line under the title (UI2 #1135), not a clamped title with a tooltip: a 66-character name stays inside the window.
      const nameBox = await box(me, '[data-name]');
      expect(nameBox.right, `name inside the window at ${size.width}`).toBeLessThanOrEqual(
        size.width,
      );
      await noHorizontalScroll(me);
      await axeClean(me, `long name at ${size.width}`);
      if (size.width === 1366) await shot(me, 'pf2-header-long-name');
    }
  });

  test('a person with no display name is shown by their Windows account', async ({
    personas,
    asUser,
  }) => {
    const p = await personas.create({ ...PERSONAS.technician, label: 'pf2noname' });
    const me = await asUser(p.username);
    await me.goto('/profile');
    await expect(me.locator('[data-profile-who]')).toContainText(p.username);
  });
});

test.describe('pf3-columns: two columns from 1100 px, one card style, one width per column (#529)', () => {
  test('left column, summary and action bar are one width; Account is on the right from 1100 and last below', async ({
    personas,
    asUser,
  }) => {
    const p = await personas.create({ ...PERSONAS.technician, label: 'pf3cols' });
    const me = await asUser(p.username);
    for (const size of SIZES) {
      await me.setViewportSize(size);
      await me.goto('/profile');
      await expect(me.locator('[data-card="work-hours"]')).toBeVisible();
      // The left column starts with the Out of Office list, then Work Hours and the action bar; the right column starts with Holidays.
      const first = await box(me, '[data-absence-list]');
      const holidays = await box(me, '[data-holiday-card]');
      const avail = await box(me, '[data-card="work-hours"]');
      const hours = await box(me, '[data-card="work-hours"]');
      const bar = await box(me, '[data-actions]');
      const account = await box(me, '[data-account-card]');
      const notes = await box(me, '[data-notification-preferences]');

      expect(Math.abs(avail.width - hours.width), `cards ${size.width}`).toBeLessThan(1);
      expect(Math.abs(avail.width - bar.width), `bar ${size.width}`).toBeLessThan(1);
      if (size.width >= 1100) {
        expect(account.left, `Account right of the form at ${size.width}`).toBeGreaterThanOrEqual(
          avail.right,
        );
        expect(Math.abs(holidays.top - first.top), 'columns start level').toBeLessThan(2);
        expect(account.top, 'Account below Holidays').toBeGreaterThanOrEqual(holidays.bottom);
        expect(Math.abs(first.width - avail.width)).toBeLessThan(1);
        expect(Math.abs(notes.width - account.width)).toBeLessThan(1);
        expect(notes.top).toBeGreaterThanOrEqual(account.bottom);
      } else {
        expect(account.top, `one column at ${size.width}`).toBeGreaterThanOrEqual(bar.bottom - 1);
        expect(Math.abs(account.width - avail.width)).toBeLessThan(1);
        expect(notes.top).toBeGreaterThanOrEqual(account.bottom - 1);
      }
      // The same bordered card (the theme's 12 px radius) for all four sections.
      for (const sel of [
        '[data-card="work-hours"]',
        '[data-account-card]',
        '[data-notification-preferences]',
      ]) {
        const css = await me
          .locator(sel)
          .first()
          .evaluate((el) => {
            const s = getComputedStyle(el);
            return [s.borderTopWidth, s.borderTopLeftRadius];
          });
        expect(css, `${sel} at ${size.width}`).toEqual(['1px', '12px']);
      }
      await noHorizontalScroll(me);
      await axeClean(me, `columns at ${size.width}`);
      await shot(me, 'pf3-columns');
    }
  });

  test('Tab order follows reading order: the left column, then the right', async ({
    personas,
    asUser,
  }) => {
    const p = await personas.create({ ...PERSONAS.technician, label: 'pf3tab' });
    const me = await asUser(p.username);
    await me.setViewportSize({ width: 1366, height: 768 });
    await me.goto('/profile');
    await expect(me.locator('[data-card="work-hours"]')).toBeVisible();
    const order = await me.evaluate(() => {
      const grid = document.querySelector('[data-profile-grid]')!;
      const focusable = Array.from(
        grid.querySelectorAll<HTMLElement>('input, button, select, textarea, a[href], summary'),
      ).filter((e) => !(e as HTMLInputElement).disabled && e.offsetParent !== null);
      const main = grid.querySelector('.pp__col--main')!;
      const side = grid.querySelector('.pp__col--side')!;
      const where = focusable.map((e) =>
        main.contains(e) ? 'main' : side.contains(e) ? 'side' : '?',
      );
      return where.join(',');
    });
    expect(order).not.toContain('?');
    expect(order).toMatch(/^(main,)+(side,?)+$/);
  });
});

test.describe('pf3-bar: the action bar (#531)', () => {
  test('the bar is the column width at 1366 and 1920 and carries the shared top shadow', async ({
    personas,
    asUser,
  }) => {
    const p = await personas.create({ ...PERSONAS.technician, label: 'pf3barw' });
    const me = await asUser(p.username);
    for (const size of [SIZES[0], SIZES[1]]) {
      await me.setViewportSize(size);
      await me.goto('/profile');
      const bar = await box(me, '[data-actions]');
      const col = await box(me, '.pp__col--main');
      expect(Math.abs(bar.width - col.width), `bar at ${size.width}`).toBeLessThan(1);
      const shadow = await me
        .locator('[data-actions]')
        .evaluate((el) => getComputedStyle(el).boxShadow);
      expect(shadow).not.toBe('none');
    }
  });
});

test.describe('pf3-states: skeleton while loading and the shared record state on a failed load (#532)', () => {
  test('loading is a skeleton of the final page: the layout shifts less than 0.05 and the heights match', async ({
    personas,
    asUser,
  }) => {
    const p = await personas.create({ ...PERSONAS.technician, label: 'pf3load' });
    const me = await asUser(p.username);
    await me.setViewportSize({ width: 1366, height: 768 });
    await me.goto('/my-work'); // sign in and warm the shell
    await delayApi(me, '**/api/v1/me/availability', 1500);
    await me.evaluate(() => {
      const w = window as unknown as { __cls: number };
      w.__cls = 0;
      new PerformanceObserver((list) => {
        for (const e of list.getEntries() as unknown as {
          value: number;
          hadRecentInput: boolean;
        }[]) {
          if (!e.hadRecentInput) w.__cls += e.value;
        }
      }).observe({ type: 'layout-shift', buffered: true });
    });
    // Client-side navigation keeps the observer: open the profile through the account menu.
    await me.getByRole('button', { name: /account menu/ }).click();
    await me.getByRole('menuitem', { name: 'My Profile' }).click();
    const skeleton = me.locator('[data-profile-skeleton]');
    await expect(skeleton).toBeVisible();
    await expect(me.locator('[data-loading]')).toHaveText('Loading profile');
    await shot(me, 'pf3-skeleton');
    const before = await skeleton.evaluate((el) => el.getBoundingClientRect().height);
    await expect(skeleton).toHaveCount(0, { timeout: 10_000 });
    await expect(me.locator('[data-card="work-hours"]')).toBeVisible();
    const after = await me
      .locator('[data-profile-grid]')
      .evaluate((el) => el.getBoundingClientRect().height);
    expect(Math.abs(before - after), `skeleton ${before} vs page ${after}`).toBeLessThanOrEqual(8);
    const cls = await me.evaluate(() => (window as unknown as { __cls: number }).__cls);
    expect(cls, 'cumulative layout shift').toBeLessThan(0.05);
  });

  test('a 5xx shows the record state with reference and Retry; Retry restores the page and says Loaded; no toast', async ({
    personas,
    asUser,
  }) => {
    const p = await personas.create({ ...PERSONAS.technician, label: 'pf3err' });
    const me = await asUser(p.username);
    await failApi(me, '**/api/v1/me/availability', 500, { times: 1, method: 'GET' });
    for (const size of SIZES) {
      await me.setViewportSize(size);
      await failApi(me, '**/api/v1/me/availability', 500, { times: 1, method: 'GET' });
      await me.goto('/profile');
      const state = me.locator('[data-record-state]');
      await expect(state).toBeVisible();
      await expect(me.locator('main h1')).toHaveText('My Profile');
      await expect(me.locator('main h1')).toBeFocused();
      await expect(me.locator('[data-page-description]')).toHaveText("Couldn't load this profile.");
      await expect(
        state.locator('[data-error-reference], mf-error-reference').first(),
      ).toBeVisible();
      await expect(me.locator('.p-toast-message, [data-toast]')).toHaveCount(0);
      await expect(me).toHaveTitle('Profile could not be loaded - LPT Hub');
      await noHorizontalScroll(me);
      await axeClean(me, `load error at ${size.width}`);
      if (size.width === 1366) await shot(me, 'pf3-load-error');
      const retry = state.getByRole('button', { name: 'Retry' });
      await expect(retry).toBeVisible();
      await retry.click();
      await expect(me.locator('[data-record-state]')).toHaveCount(0);
      await expect(me.locator('[data-page-live]')).toHaveText('Loaded');
      await expect(me.locator('main h1')).toBeFocused();
      await expect(me.locator('[data-card="work-hours"]')).toBeVisible();
    }
  });

  test('no connection shows the same state and Retry works once it is back', async ({
    personas,
    asUser,
  }) => {
    const p = await personas.create({ ...PERSONAS.technician, label: 'pf3off' });
    const me = await asUser(p.username);
    let down = true;
    await me.route('**/api/v1/me/availability', (route) =>
      down && route.request().method() === 'GET'
        ? route.abort('connectionfailed')
        : route.fallback(),
    );
    await me.goto('/profile');
    const state = me.locator('[data-record-state]');
    await expect(state).toBeVisible();
    await expect(state.getByRole('button', { name: 'Retry' })).toBeVisible();
    down = false;
    await state.getByRole('button', { name: 'Retry' }).click();
    await expect(me.locator('[data-card="work-hours"]')).toBeVisible();
    await expect(me.locator('[data-page-live]')).toHaveText('Loaded');
  });
});
