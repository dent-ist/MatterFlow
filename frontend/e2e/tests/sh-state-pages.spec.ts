import { Page } from '@playwright/test';
import { expect, test } from '../support/fixtures';
import { atEverySize, noHorizontalScroll, shot, SIZES } from '../support/screens';

/**
 * One state-page card for the 403, the 404 and the error page (S10, #607): a centred card with the icon and the title (22 px / 700, 18 px
 * below 640), one sentence of reason, the address that was asked for in monospace, "Go to ..." as the primary action and one secondary
 * action (Search on the 404, Copy link on the 403), the brand line outside the card. Inside the shell for the 403 and the 404 (the rail
 * stays); the error page stands alone.
 */
const FORBIDDEN = "You don't have permission to view this.";
const NOT_FOUND = "We couldn't find that.";
const ERROR_TITLE = 'Something went wrong. Try again.';

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

  test('the 404: the card, the address asked for, a search that is not cut, the brand line, at four sizes', async ({
    page,
  }) => {
    for (const size of SIZES) {
      await page.setViewportSize(size);
      await page.goto('/no-such-page?x=1');
      await expect(page.getByRole('heading', { name: NOT_FOUND, level: 1 })).toBeVisible();
      const c = await card(page);
      expect(c.fontSize, `404 title at ${size.width}`).toBe(size.width < 640 ? 18 : 22);
      expect(c.fontWeight).toBeGreaterThanOrEqual(700);
      expect(c.width).toBeLessThanOrEqual(32 * 16 + 1);
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
      // The placeholder fits its box (it was cut as "Search clients, matters, tasks, a").
      const fits = await page.locator('[data-not-found-search]').evaluate((el) => {
        const input = el as HTMLInputElement;
        const probe = document.createElement('span');
        const cs = getComputedStyle(input);
        probe.style.cssText = `position:absolute;visibility:hidden;white-space:nowrap;font:${cs.font}`;
        probe.textContent = input.placeholder;
        document.body.append(probe);
        const need = probe.getBoundingClientRect().width;
        probe.remove();
        const pad = parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight);
        return input.clientWidth - pad >= need;
      });
      expect(fits, `placeholder fits at ${size.width}`).toBe(true);
      if (size.width === 1366 || size.width === 375) await shot(page, 'state-404');
    }
  });

  test('the 404 search works from the keyboard and goes to the search results', async ({
    page,
  }) => {
    await page.goto('/no-such-page');
    await expect(page.getByRole('heading', { name: NOT_FOUND, level: 1 })).toBeVisible();
    const box = page.getByRole('searchbox', { name: /Search clients/ });
    await box.focus();
    await page.keyboard.type('acme');
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/search\?q=acme/);
    await expect(page.getByRole('heading', { name: 'Search results', level: 1 })).toBeVisible();
  });

  test('the 403 uses the same card: primary "Go to", Copy link as the secondary action, no search box', async ({
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
      expect(c.fontSize, `403 title at ${size.width}`).toBe(size.width < 640 ? 18 : 22);
      expect(c.left).toBeGreaterThanOrEqual(12);
      expect(c.viewport - c.right).toBeGreaterThanOrEqual(12);
      expect(c.brandVisible).toBe(true);
      expect(c.mono).toBe(true);
      await expect(page.locator('[data-state-actions] [data-back-link]')).toBeVisible();
      await expect(page.locator('[data-state-secondary]').getByRole('button')).toHaveText(
        /Copy link/,
      );
      await expect(page.getByRole('searchbox')).toHaveCount(0);
      if (size.width === 1366 || size.width === 375) await shot(page, 'state-403');
    }
  });

  test('the error page uses the same card with Retry as the one action', async ({ page }) => {
    for (const size of SIZES) {
      await page.setViewportSize(size);
      await page.goto('/error');
      await expect(page.getByRole('heading', { name: ERROR_TITLE, level: 1 })).toBeVisible();
      const c = await card(page);
      expect(c.fontSize).toBe(size.width < 640 ? 18 : 22);
      expect(c.left).toBeGreaterThanOrEqual(12);
      expect(c.viewport - c.right).toBeGreaterThanOrEqual(12);
      expect(c.brandVisible).toBe(true);
      await expect(page.getByRole('button', { name: 'Retry' })).toBeVisible();
      await noHorizontalScroll(page);
      if (size.width === 1366 || size.width === 375) await shot(page, 'state-error');
    }
  });

  test('axe is clean on the 404, the 403 and the error page at four sizes', async ({
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

  test('keyboard only: Tab reaches "Go to ...", then the secondary action', async ({
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
    await expect(page.getByRole('button', { name: 'Copy link' })).toBeFocused();
  });

  test('permission variants: the 404 link follows the landing rule for every kind of person', async ({
    personas,
    asUser,
  }) => {
    const cases = [
      { who: 'technician' as const, href: '/tasks' },
      { who: 'director' as const, href: null },
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
