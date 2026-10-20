import { expect, test } from '../support/fixtures';
import { toasts } from '../support/toasts';

/** SH-B #591 (BUG-4): identical toasts are folded into one, and a toast with the same key replaces the one before it. */
test.describe('SH-B: toast de-duplication', () => {
  test('a 401 on a list shows the sign-in message once', async ({ page }) => {
    await page.route(/\/api\/v1\/(?!me\b)/, (route) =>
      route.request().method() !== 'GET'
        ? route.continue()
        : route.fulfill({
            status: 401,
            contentType: 'application/problem+json',
            body: JSON.stringify({ title: 'Unauthorized', status: 401 }),
          }),
    );
    await page.goto('/tasks');
    await expect(toasts(page).first()).toBeVisible();
    await page.waitForTimeout(1500);
    // Several requests of the page failed with the same 401: one toast, not one per request.
    await expect(toasts(page).filter({ hasText: "We couldn't verify your sign-in" })).toHaveCount(
      1,
    );
    const texts = await toasts(page).allInnerTexts();
    expect(new Set(texts).size, texts.join(' | ')).toBe(texts.length);
  });

  test("out of office followed by I'm back leaves one availability toast", async ({
    asUser,
    seed,
  }) => {
    const { username } = await seed.user(['Data Technician'], 'shb');
    const me = await asUser(username);
    await me.goto('/my-work');
    await me.getByRole('button', { name: /account menu/ }).click();
    await me
      .getByRole('menu', { name: 'Your account' })
      .getByRole('menuitem', { name: 'Set out of office...' })
      .click();
    await me
      .getByRole('dialog', { name: 'Set out of office' })
      .getByRole('button', { name: 'Set out of office' })
      .click();
    await expect(me.getByText('You are out of office')).toBeVisible();
    await me.getByRole('button', { name: /account menu/ }).click();
    await me
      .getByRole('menu', { name: 'Your account' })
      .getByRole('menuitem', { name: "I'm back" })
      .click();
    await expect(me.getByText('Welcome back')).toBeVisible();
    await expect(me.getByText('You are out of office')).toHaveCount(0);
    await expect(toasts(me)).toHaveCount(1);
  });
});
