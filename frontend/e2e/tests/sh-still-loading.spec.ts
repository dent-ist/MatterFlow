import { axeAvailable } from '../support/axe';
import { expect, test } from '../support/fixtures';
import { delayApi } from '../support/personas';
import { atEverySize } from '../support/screens';

/**
 * S17 (#615): a skeleton that has been on screen for about 8 seconds adds "Still loading... Retry" (a polite live region, once); Retry asks
 * for the data again. Real time: the response is held for 10 seconds.
 */
test.describe('Still loading... Retry (#615)', () => {
  test.setTimeout(240_000);

  test('a list: silent at 6 seconds, the line at about 8, Retry issues the request again and the rows arrive', async ({
    page,
    seed,
  }) => {
    await seed.client({ name: `Still loading ${Date.now()}` });
    await page.setViewportSize({ width: 1366, height: 768 });
    let calls = 0;
    page.on('request', (r) => {
      if (/\/api\/v1\/clients\?/.test(r.url())) calls++;
    });
    await delayApi(page, /\/api\/v1\/clients\?/, 10_000);
    await page.goto('/clients');
    await expect(page.locator('[data-skeleton]').first()).toBeVisible();
    await page.waitForTimeout(6000);
    await expect(page.locator('[data-still-loading]')).toHaveCount(0);
    const line = page.locator('[data-still-loading]');
    await expect(line).toBeVisible({ timeout: 4000 });
    await expect(line).toHaveText('Still loading...');
    // A polite live region, and it is the only status text added (the sr-only "Loading clients" stays).
    await expect(page.locator('[data-still-loading-region]')).toHaveAttribute(
      'aria-live',
      'polite',
    );
    const before = calls;
    // By keyboard.
    await page.getByRole('button', { name: 'Retry' }).focus();
    await page.keyboard.press('Enter');
    await expect.poll(() => calls).toBeGreaterThan(before);
    await expect(line).toHaveCount(0);
    // The first (held) answer arrives and the rows replace the skeleton; no leftover line.
    await expect(page.locator('[data-skeleton]')).toHaveCount(0, { timeout: 30_000 });
    await expect(page.locator('tbody tr a[href^="/clients/"]').first()).toBeVisible();
    await expect(page.locator('[data-still-loading-region]')).toHaveCount(0);
  });

  test('a record page (the skeleton of the Client page) says it too, and Retry loads it', async ({
    page,
    seed,
  }) => {
    const client = await seed.client({ name: `Still record ${Date.now()}` });
    await delayApi(page, new RegExp(`/api/v1/clients/${client.clientId}$`), 10_000);
    await page.goto(`/clients/${client.clientId}`);
    await expect(page.locator('[data-record-skeleton]')).toBeVisible();
    await expect(page.locator('[data-still-loading]')).toBeVisible({ timeout: 12_000 });
    // The Retry is outside the inert skeleton: reachable by keyboard.
    await page.getByRole('button', { name: 'Retry' }).focus();
    await expect(page.getByRole('button', { name: 'Retry' })).toBeFocused();
    await expect(page.getByRole('heading', { name: client.name, level: 1 })).toBeVisible({
      timeout: 30_000,
    });
  });

  test('permission variants: the line is the same for a Director, an Intake Coordinator and a Client.View-only person', async ({
    personas,
    asUser,
  }) => {
    for (const key of ['director', 'intakeCoordinator', 'clientViewOnly'] as const) {
      const person = await personas.named(key);
      const page = await asUser(person.username);
      await delayApi(page, /\/api\/v1\/clients\?/, 10_000);
      await page.goto('/clients');
      await expect(page.locator('[data-still-loading]'), key).toBeVisible({ timeout: 14_000 });
    }
  });

  test('axe is clean with the line showing at four sizes', async ({ page, seed }) => {
    expect(axeAvailable(), 'set E2E_AXE_PATH to axe.min.js').toBe(true);
    await seed.client({ name: `Still axe ${Date.now()}` });
    await delayApi(page, /\/api\/v1\/clients\?/, 40_000);
    await atEverySize(page, 'still-loading', async () => {
      await page.goto('/clients');
      await expect(page.locator('[data-still-loading]')).toBeVisible({ timeout: 12_000 });
    });
  });
});
