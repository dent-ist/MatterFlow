import { expect, test } from '../support/fixtures';
import { failMe } from '../support/personas';
import { atEverySize, shot } from '../support/screens';

/**
 * S11 (#608): the error page (the account cannot be loaded) shows the Reference of the failed call with Copy, the brand line, and Retry
 * reloads the page the person was on; "Go to home" appears only after Retry has failed as well.
 */
const TITLE = 'Something went wrong. Try again.';

test.describe('The error page (#608)', () => {
  test.setTimeout(240_000);

  test('shows the Reference with Copy and the brand line; Copy puts the reference on the clipboard, from the keyboard too', async ({
    page,
  }) => {
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
    await failMe(page, 500);
    await page.goto('/tasks?view=mine');
    await expect(page).toHaveURL(/\/error$/);
    await expect(page.getByRole('heading', { name: TITLE, level: 1 })).toBeVisible();
    await expect(page.locator('[data-error-reference]')).toContainText('e2e-500-trace');
    await expect(page.locator('[data-state-brand]')).toHaveText('MatterFlow');
    // The reference is on the page, not only in a toast that goes away after 8 seconds.
    await page.waitForTimeout(9000);
    await expect(page.locator('[data-error-reference]')).toContainText('e2e-500-trace');
    await expect(page.locator('[data-toast]')).toHaveCount(0);
    await expect(page.locator('[data-go-home]')).toHaveCount(0);
    await shot(page, 'error-page-reference');

    await page.locator('[data-error-reference] button').focus();
    await page.keyboard.press('Enter');
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('e2e-500-trace');
  });

  test('Retry reloads the page the person was on once the account loads', async ({ page }) => {
    const unfail = await failMe(page, 500);
    await page.goto('/matters?status=all');
    await expect(page.getByRole('heading', { name: TITLE, level: 1 })).toBeVisible();
    await unfail();
    // Keyboard only: the heading is followed by the Reference's Copy button, then Retry.
    await page.getByRole('button', { name: 'Retry' }).focus();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/matters\?status=all$/);
    await expect(page.getByRole('heading', { name: 'Matters', level: 1 })).toBeVisible();
  });

  test('a Retry that fails again says so and offers "Go to home", which opens the landing page once the account loads', async ({
    page,
  }) => {
    const unfail = await failMe(page, 500);
    await page.goto('/clients');
    await expect(page.getByRole('heading', { name: TITLE, level: 1 })).toBeVisible();
    await page.getByRole('button', { name: 'Retry' }).click();
    await expect(page.locator('[data-failed-again]')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Go to home' })).toBeVisible();
    await shot(page, 'error-page-failed-again');
    await unfail();
    await page.getByRole('link', { name: 'Go to home' }).click();
    await expect(page).not.toHaveURL(/\/error$/);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  });

  test('axe is clean with the Reference and with "Go to home" at four sizes', async ({ page }) => {
    await failMe(page, 500);
    await page.goto('/clients');
    await expect(page.getByRole('heading', { name: TITLE, level: 1 })).toBeVisible();
    await atEverySize(page, 'error-page-axe');
    await page.getByRole('button', { name: 'Retry' }).click();
    await expect(page.locator('[data-failed-again]')).toBeVisible();
    await atEverySize(page, 'error-page-axe-again');
  });
});
