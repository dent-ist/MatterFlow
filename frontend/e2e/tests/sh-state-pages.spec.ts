import { Page } from '@playwright/test';
import { expect, test } from '../support/fixtures';
import { atEverySize, noHorizontalScroll, shot, SIZES } from '../support/screens';

/**
 * One state-page card for the 403, the 404 and the error page (S10, #607, #1193): a centred card 480 px wide with a 48 px icon tile and the
 * title (22 px / 700, one line), one sentence of reason, the address that was asked for in muted monospace with a copy button, "Go to ..."
 * as the one button, the brand line outside the card. Inside the shell for the 403 and the 404 (the rail stays); the error page stands alone.
 */
const FORBIDDEN = "You don't have access.";
const NOT_FOUND = "We couldn't find that.";
const ERROR_TITLE = "Couldn't load your account.";

interface Card {
  fontSize: number;
  fontWeight: number;
  left: number;
  right: number;
  width: number;
  viewport: number;
  brandVisible: boolean;
  mono: boolean;
}

async function card(page: Page): Promise<Card> {
  await expect(page.locator('[data-state-page]')).toBeVisible();
  return page.evaluate(() => {
    const sp = document.querySelector('[data-state-page]') as HTMLElement;
    const h1 = sp.querySelector('h1') as HTMLElement;
    const r = sp.getBoundingClientRect();
    const asked = sp.querySelector('[data-asked-path]');
    const brand = document.querySelector('[data-state-brand]') as HTMLElement;
    return {
      fontSize: parseFloat(getComputedStyle(h1).fontSize),
      fontWeight: Number(getComputedStyle(h1).fontWeight),
      left: r.left,
      right: r.right,
      width: r.width,
      viewport: window.innerWidth,
      brandVisible: brand.getBoundingClientRect().height > 0,
      mono: asked ? /mono|courier/i.test(getComputedStyle(asked).fontFamily) : true,
    };
  });
}

test.describe('State pages are one family (#607)', () => {
  test.setTimeout(300_000);

  test('the 404: the card, the address asked for, the brand line, at both desktop sizes', async ({
    page,
  }) => {
    for (const size of SIZES) {
      await page.setViewportSize(size);
      await page.goto('/no-such-page?x=1');
      await expect(page.getByRole('heading', { name: NOT_FOUND, level: 1 })).toBeVisible();
      const c = await card(page);
      expect(c.fontSize, `404 title at ${size.width}`).toBe(22);
      expect(c.fontWeight).toBeGreaterThanOrEqual(700);
      expect(c.width).toBeLessThanOrEqual(481);
      // The card never touches the page edges: at least the 16 px gutter of the main area on a phone.
      expect(c.left, `404 card left at ${size.width}`).toBeGreaterThanOrEqual(12);
      expect(c.viewport - c.right, `404 card right at ${size.width}`).toBeGreaterThanOrEqual(12);
      expect(c.brandVisible).toBe(true);
      expect(c.mono).toBe(true);
      await expect(page.locator('[data-asked-path]')).toHaveText('/no-such-page?x=1');
      // The rail stays: the 404 is inside the shell.
      if (size.width >= 768)
        await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible();
      else await expect(page.getByRole('button', { name: 'Menu', exact: true })).toBeVisible();
      if (size.width === 1366) await shot(page, 'state-404');
    }
  });

  test('the 403 uses the same card: one "Go to" button, the address with a copy button, no search box', async ({
    personas,
    asUser,
  }) => {
    const tech = await personas.named('technician');
    const page = await asUser(tech.username);
    for (const size of SIZES) {
      await page.setViewportSize(size);
      await page.goto('/admin/users');
      await expect(page.getByRole('heading', { name: FORBIDDEN, level: 1 })).toBeVisible();
      const c = await card(page);
      expect(c.fontSize, `403 title at ${size.width}`).toBe(22);
      expect(c.left).toBeGreaterThanOrEqual(12);
      expect(c.viewport - c.right).toBeGreaterThanOrEqual(12);
      expect(c.brandVisible).toBe(true);
      expect(c.mono).toBe(true);
      await expect(page.locator('[data-state-actions] [data-back-link]')).toBeVisible();
      await expect(page.locator('[data-asked]').getByRole('button')).toHaveAccessibleName(
        'Copy address',
      );
      await expect(page.getByRole('searchbox')).toHaveCount(0);
      if (size.width === 1366) await shot(page, 'state-403');
    }
  });

  test('the error page uses the same card with Retry as the one action', async ({ page }) => {
    for (const size of SIZES) {
      await page.setViewportSize(size);
      await page.goto('/error');
      await expect(page.getByRole('heading', { name: ERROR_TITLE, level: 1 })).toBeVisible();
      const c = await card(page);
      expect(c.fontSize).toBe(22);
      expect(c.left).toBeGreaterThanOrEqual(12);
      expect(c.viewport - c.right).toBeGreaterThanOrEqual(12);
      expect(c.brandVisible).toBe(true);
      await expect(page.getByRole('button', { name: 'Retry' })).toBeVisible();
      await noHorizontalScroll(page);
      if (size.width === 1366) await shot(page, 'state-error');
    }
  });

  test('axe is clean on the 404, the 403 and the error page at both desktop sizes', async ({
    page,
    personas,
    asUser,
  }) => {
    await page.goto('/no-such-page');
    await expect(page.getByRole('heading', { name: NOT_FOUND, level: 1 })).toBeVisible();
    await atEverySize(page, 'state-axe-404');
    await page.goto('/error');
    await expect(page.getByRole('heading', { name: ERROR_TITLE, level: 1 })).toBeVisible();
    await atEverySize(page, 'state-axe-error');
    const tech = await personas.named('technician');
    const t = await asUser(tech.username);
    await t.goto('/admin/users');
    await expect(t.getByRole('heading', { name: FORBIDDEN, level: 1 })).toBeVisible();
    await atEverySize(t, 'state-axe-403');
  });

  test('keyboard only: Tab reaches "Go to ...", then Copy address', async ({
    personas,
    asUser,
  }) => {
    const tech = await personas.named('technician');
    const page = await asUser(tech.username);
    await page.goto('/admin/users');
    await expect(page.getByRole('heading', { name: FORBIDDEN, level: 1 })).toBeVisible();
    await page.locator('h1').evaluate((h) => {
      h.setAttribute('tabindex', '-1');
      (h as HTMLElement).focus();
    });
    await page.keyboard.press('Tab');
    await expect(page.locator('[data-back-link]')).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(page.getByRole('button', { name: 'Copy address' })).toBeFocused();
  });

  test('permission variants: the 404 link follows the landing rule for every kind of person', async ({
    personas,
    asUser,
  }) => {
    const cases = [
      // No pod and no assigned task, and Dashboard.ViewUnassigned: the landing rule (#628) leads to the Dashboard.
      { who: 'technician' as const, href: '/dashboard' },
      // The Director holds Matter.BeManager (issue #976), so the landing rule leads to My Matters.
      { who: 'director' as const, href: '/my-matters' },
      { who: 'clientViewOnly' as const, href: '/clients' },
      { who: 'taskViewOnly' as const, href: '/tasks' },
    ];
    for (const c of cases) {
      const person = await personas.named(c.who);
      const page = await asUser(person.username);
      await page.goto('/no-such-page');
      await expect(page.getByRole('heading', { name: NOT_FOUND, level: 1 })).toBeVisible();
      const link = page.locator('[data-state-actions] [data-back-link]');
      await expect(link).toHaveCount(1);
      if (c.href) await expect(link).toHaveAttribute('href', c.href);
      await expect(page.locator('[data-asked-path]')).toHaveText('/no-such-page');
    }
  });
});
