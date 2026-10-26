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
  test("the header says who the person is and has a single primary action that opens the dialog and flips to I'm back", async ({
    personas,
    asUser,
    seed,
    admin,
  }) => {
    const p = await personas.create({ ...PERSONAS.technician, label: 'pf2head' });
    const pod = await seed.pod(undefined, [p.userId]);
    await admin.put(`/api/v1/pods/${pod.podId}/members/${p.userId}`, { isPrimary: true });
    const me = await asUser(p.username);
    await me.goto('/profile');

    const h1 = me.locator('main h1');
    await expect(h1).toContainText(p.username);
    await expect(h1.locator('[data-availability-chip]')).toHaveText(/Available|Off hours/);
    await expect(me.locator('[data-page-description]')).toHaveText(`Data Technician · ${pod.name}`);
    const actions = me.locator('[data-page-actions] button');
    await expect(actions).toHaveCount(1);
    await expect(actions).toHaveText('Set out of office...');
    await expect(me).toHaveTitle('My profile - MatterFlow');

    await actions.click();
    const dialog = me.getByRole('dialog', { name: 'Set out of office' });
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: 'Rest of today' }).click();
    await dialog.getByRole('button', { name: 'Set out of office' }).click();
    await expect(dialog).toHaveCount(0);
    // Same store as the menu: chip, label and the page follow; the focus is back on the action.
    await expect(h1.locator('[data-availability-chip]')).toContainText('Out of office');
    await expect(actions).toHaveText("I'm back");
    await expect(actions).toBeFocused();
    await expect(me.locator('[data-preview]')).toHaveCount(0);

    await actions.click();
    await expect(h1.locator('[data-availability-chip]')).toHaveText(/Available|Off hours/);
    await expect(actions).toHaveText('Set out of office...');
    await expect(me.getByText('Welcome back').first()).toBeVisible();
  });

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
      await expect(h1).toContainText(p.displayName!.slice(0, 20));
      const fontSize = await h1.evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
      expect(fontSize).toBe(size.width < 640 ? 18 : 22);
      const top = await h1.evaluate(
        (el) =>
          el.getBoundingClientRect().top -
          document.querySelector('main')!.getBoundingClientRect().top,
      );
      expect(top, `title top at ${size.width}`).toBeCloseTo(work, 0);
      await expect(me.locator('[data-name]')).toHaveAttribute('title', p.displayName!);
      await noHorizontalScroll(me);
      await axeClean(me, `long name at ${size.width}`);
      if (size.width === 1366 || size.width === 375) await shot(me, 'pf2-header-long-name');
    }
  });

  test('a person with no display name is shown by their Windows account', async ({
    personas,
    asUser,
  }) => {
    const p = await personas.create({ ...PERSONAS.technician, label: 'pf2noname' });
    const me = await asUser(p.username);
    await me.goto('/profile');
    await expect(me.locator('main h1')).toContainText(p.username);
  });

  test('the preview sits under the Status choice and shows only while there are edits (P12)', async ({
    personas,
    asUser,
  }) => {
    const p = await personas.create({ ...PERSONAS.technician, label: 'pf2prev' });
    const me = await asUser(p.username);
    await me.goto('/profile');
    await expect(me.locator('[data-preview]')).toHaveCount(0);
    await me.getByRole('radio', { name: /Out of office/ }).check();
    const preview = me.locator('[data-status-set] [data-preview]');
    await expect(preview).toContainText('Preview of your changes:');
    await expect(preview.locator('[data-preview-chip]')).toContainText('Out of office');
    // The header chip is the saved state until Save; both say so in words, not colour alone.
    await expect(me.locator('h1 [data-availability-chip]')).toHaveText(/Available|Off hours/);
    await me.getByRole('button', { name: 'Discard changes' }).click();
    await expect(me.locator('[data-preview]')).toHaveCount(0);
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
      await expect(me.locator('[data-card="availability"]')).toBeVisible();
      const avail = await box(me, '[data-card="availability"]');
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
        expect(Math.abs(account.top - avail.top)).toBeLessThan(2);
        expect(Math.abs(notes.width - account.width)).toBeLessThan(1);
        expect(notes.top).toBeGreaterThanOrEqual(account.bottom);
      } else {
        expect(account.top, `one column at ${size.width}`).toBeGreaterThanOrEqual(bar.bottom - 1);
        expect(Math.abs(account.width - avail.width)).toBeLessThan(1);
        expect(notes.top).toBeGreaterThanOrEqual(account.bottom - 1);
      }
      // The same bordered 8 px card for all four sections.
      for (const sel of [
        '[data-card="availability"]',
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
        expect(css, `${sel} at ${size.width}`).toEqual(['1px', '8px']);
      }
      await noHorizontalScroll(me);
      await axeClean(me, `columns at ${size.width}`);
      await shot(me, 'pf3-columns');
    }
  });

  test('the breakpoint is 1100 px: 1099 is one column, 1100 is two', async ({
    personas,
    asUser,
  }) => {
    const p = await personas.create({ ...PERSONAS.technician, label: 'pf3break' });
    const me = await asUser(p.username);
    await me.goto('/profile');
    await expect(me.locator('[data-card="availability"]')).toBeVisible();
    await me.setViewportSize({ width: 1099, height: 900 });
    let account = await box(me, '[data-account-card]');
    let avail = await box(me, '[data-card="availability"]');
    expect(account.left).toBeLessThan(avail.right);
    await me.setViewportSize({ width: 1100, height: 900 });
    account = await box(me, '[data-account-card]');
    avail = await box(me, '[data-card="availability"]');
    expect(account.left).toBeGreaterThanOrEqual(avail.right);
  });

  test('the error summary is the width of the left column and axe is clean with it open', async ({
    personas,
    asUser,
  }) => {
    const p = await personas.create({ ...PERSONAS.technician, label: 'pf3sum' });
    const me = await asUser(p.username);
    for (const size of SIZES) {
      await me.setViewportSize(size);
      await me.goto('/profile');
      await me.getByRole('radio', { name: /Out of office/ }).check();
      await me.locator('#av-from').fill('Oct 20, 2030');
      await me.locator('#av-until').fill('Oct 10, 2030');
      await me.locator('#av-until').blur();
      await me.getByRole('button', { name: 'Save changes' }).click();
      const summary = await box(me, '[data-summary]');
      const avail = await box(me, '[data-card="availability"]');
      expect(Math.abs(summary.width - avail.width), `summary at ${size.width}`).toBeLessThan(1);
      await me.evaluate(() => window.scrollTo(0, 0));
      await noHorizontalScroll(me);
      await axeClean(me, `summary at ${size.width}`);
      if (size.width === 1366 || size.width === 375) await shot(me, 'pf3-error-summary');
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
    await expect(me.locator('[data-card="availability"]')).toBeVisible();
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
  test('says No unsaved changes while clean, keeps Save and Discard disabled, and flips with the first edit', async ({
    personas,
    asUser,
  }) => {
    const p = await personas.create({ ...PERSONAS.technician, label: 'pf3bar' });
    const me = await asUser(p.username);
    await me.goto('/profile');
    const state = me.locator('[data-actions-state]');
    await expect(state).toHaveText('No unsaved changes');
    await expect(state).toHaveAttribute('role', 'status');
    await expect(me.getByRole('button', { name: 'Save changes' })).toBeDisabled();
    await expect(me.getByRole('button', { name: 'Discard changes' })).toBeDisabled();
    await me.getByRole('radio', { name: /Out of office/ }).check();
    await expect(state).toHaveText('Unsaved changes');
    await expect(me.getByRole('button', { name: 'Save changes' })).toBeEnabled();
  });

  test('at 375 the last field (Time zone) scrolls fully above the bar, and a focused field is not left behind it', async ({
    personas,
    asUser,
  }) => {
    const p = await personas.create({ ...PERSONAS.technician, label: 'pf3bar375' });
    const me = await asUser(p.username);
    await me.setViewportSize({ width: 375, height: 812 });
    await me.goto('/profile');
    // Focusing the last field of the form scrolls it clear of the sticky bar (scroll margin), never under it.
    await me.locator('#av-tz').focus();
    await expect(me.locator('#av-tz')).toBeFocused();
    const clear = () =>
      me.evaluate(() => {
        const f = document.activeElement!.getBoundingClientRect();
        const b = document.querySelector('[data-actions]')!.getBoundingClientRect();
        return f.bottom <= b.top || f.top >= b.bottom;
      });
    await expect.poll(clear, { message: 'Time zone is not under the bar' }).toBe(true);
    await shot(me, 'pf3-bar-bottom');
    // The same for a field higher up that the bar would cover when it is brought into view from below.
    await me.getByRole('radio', { name: /Out of office/ }).check();
    await me.locator('#av-note').focus();
    await expect.poll(clear, { message: 'Note is not under the bar' }).toBe(true);
  });

  test('the bar is the column width at 1366 and 1920 and carries the shared top shadow', async ({
    personas,
    asUser,
  }) => {
    const p = await personas.create({ ...PERSONAS.technician, label: 'pf3barw' });
    const me = await asUser(p.username);
    for (const size of [SIZES[2], SIZES[3]]) {
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
    await me.getByRole('menuitem', { name: 'My profile' }).click();
    const skeleton = me.locator('[data-profile-skeleton]');
    await expect(skeleton).toBeVisible();
    await expect(me.locator('[data-loading]')).toHaveText('Loading profile');
    await shot(me, 'pf3-skeleton');
    const before = await skeleton.evaluate((el) => el.getBoundingClientRect().height);
    await expect(skeleton).toHaveCount(0, { timeout: 10_000 });
    await expect(me.locator('[data-card="availability"]')).toBeVisible();
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
      await expect(me.locator('main h1')).toHaveText('My profile');
      await expect(me.locator('main h1')).toBeFocused();
      await expect(me.locator('[data-page-description]')).toHaveText("Couldn't load this profile.");
      await expect(
        state.locator('[data-error-reference], mf-error-reference').first(),
      ).toBeVisible();
      await expect(me.locator('.p-toast-message, [data-toast]')).toHaveCount(0);
      await expect(me).toHaveTitle('Profile could not be loaded - MatterFlow');
      await noHorizontalScroll(me);
      await axeClean(me, `load error at ${size.width}`);
      if (size.width === 1366 || size.width === 375) await shot(me, 'pf3-load-error');
      const retry = state.getByRole('button', { name: 'Retry' });
      await expect(retry).toBeVisible();
      await retry.click();
      await expect(me.locator('[data-record-state]')).toHaveCount(0);
      await expect(me.locator('[data-page-live]')).toHaveText('Loaded');
      await expect(me.locator('main h1')).toBeFocused();
      await expect(me.locator('[data-card="availability"]')).toBeVisible();
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
    await expect(me.locator('[data-card="availability"]')).toBeVisible();
    await expect(me.locator('[data-page-live]')).toHaveText('Loaded');
  });
});
