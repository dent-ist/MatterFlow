import fs from 'node:fs';
import path from 'node:path';
import { expect, test } from '../support/fixtures';
import { toasts } from '../support/toasts';

/** SH-B #591 (BUG-4): identical toasts are folded into one, and a toast with the same key replaces the one before it. */
const OUT = process.env['E2E_SCREENSHOTS'];
const SIZES = [
  { name: '1366x768', width: 1366, height: 768 },
  { name: '1920x1080', width: 1920, height: 1080 },
  { name: '768x1024', width: 768, height: 1024 },
  { name: '375x812', width: 375, height: 812 },
] as const;

test.describe('SH-B: toast de-duplication', () => {
  for (const size of SIZES) {
    test(`a 401 on a list is one sign-in banner and no toast at ${size.name}`, async ({ page }) => {
      await page.setViewportSize({ width: size.width, height: size.height });
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
      await expect(page.locator('[data-signin-banner]')).toBeVisible();
      await page.waitForTimeout(1500);
      // Several requests of the page failed with the same 401: one banner, no toast (S14, #612).
      await expect(page.locator('[data-signin-banner]')).toHaveCount(1);
      await expect(toasts(page)).toHaveCount(0);
      if (OUT) {
        fs.mkdirSync(OUT, { recursive: true });
        await page.screenshot({ path: path.join(OUT, `one-sign-in-banner-${size.name}.png`) });
      }
    });
  }

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
