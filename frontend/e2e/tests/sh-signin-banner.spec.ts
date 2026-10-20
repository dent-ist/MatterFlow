import { expect, test } from '../support/fixtures';
import { failApi, goOffline } from '../support/personas';
import { atEverySize, noHorizontalScroll, shot, SIZES } from '../support/screens';
import { toasts } from '../support/toasts';

/**
 * S14 (#612): a failed sign-in (a 401 from the API) is one banner under the header with a Reload page button, not a pile of toasts. It shares
 * the slot of the offline banner and wins over it.
 */
const SIGNIN = "We couldn't verify your sign-in.";
const LISTS = /\/api\/v1\/(?!me\b)/;

test.describe('Sign-in banner (#612)', () => {
  test.setTimeout(300_000);

  test('a 401 on the lists of a page is one banner with Reload page and no toast; Reload page reloads, and the banner is gone once the server accepts the sign-in', async ({
    page,
  }) => {
    const unfail = await failApi(page, LISTS, 401, { method: 'GET' });
    await page.goto('/tasks');
    const banner = page.locator('[data-signin-banner]');
    await expect(banner).toContainText(SIGNIN);
    await page.waitForTimeout(1500);
    await expect(banner).toHaveCount(1);
    await expect(toasts(page)).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Reload page' })).toBeVisible();
    await shot(page, 'signin-banner');

    await unfail();
    // Keyboard only: focus the button and press Enter.
    await page.getByRole('button', { name: 'Reload page' }).focus();
    await Promise.all([page.waitForEvent('load'), page.keyboard.press('Enter')]);
    await expect(page.getByRole('heading', { name: 'Task Queue', level: 1 })).toBeVisible();
    await expect(page.locator('[data-signin-banner]')).toHaveCount(0);
  });

  test('when the sign-in fails and the connection is down too, the sign-in banner is the one shown', async ({
    page,
  }) => {
    await failApi(page, LISTS, 401, { method: 'GET' });
    await page.goto('/clients');
    await expect(page.locator('[data-signin-banner]')).toBeVisible();
    await goOffline(page);
    await page.waitForTimeout(500);
    await expect(page.locator('[data-signin-banner]')).toBeVisible();
    await expect(page.locator('[data-offline-banner]')).toHaveCount(0);
    await goOffline(page, false);
  });

  test('the account call itself failing with a 401 shows the sign-in sentence on the error page, not a toast', async ({
    page,
  }) => {
    await failApi(page, '**/api/v1/me', 401);
    await page.goto('/tasks');
    await expect(page).toHaveURL(/\/error$/);
    await expect(page.locator('[data-state-reason]')).toContainText(
      "We couldn't verify your sign-in. Reload the page to try again.",
    );
    await expect(toasts(page)).toHaveCount(0);
  });

  test('axe is clean with the banner shown and nothing scrolls sideways at four sizes', async ({
    page,
  }) => {
    await failApi(page, LISTS, 401, { method: 'GET' });
    await page.goto('/clients');
    await expect(page.locator('[data-signin-banner]')).toBeVisible();
    await atEverySize(page, 'signin-banner-axe');
    await page.setViewportSize(SIZES[0]);
    await noHorizontalScroll(page);
  });

  test('every kind of person gets the banner', async ({ personas, asUser }) => {
    for (const who of ['technician', 'director', 'clientViewOnly', 'taskViewOnly'] as const) {
      const person = await personas.named(who);
      const page = await asUser(person.username);
      await failApi(page, LISTS, 401, { method: 'GET' });
      await page.goto('/');
      await expect(page.locator('[data-signin-banner]'), who).toBeVisible();
      await expect(toasts(page), who).toHaveCount(0);
    }
  });
});
