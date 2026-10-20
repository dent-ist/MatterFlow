import { expect, test } from '../support/fixtures';
import { goOffline } from '../support/personas';
import { atEverySize, noHorizontalScroll, shot, SIZES } from '../support/screens';

/**
 * S13 (#611): one banner under the header while the server cannot be reached, with automatic retry and "Back online.". Playwright's
 * `setOffline` turns the browser offline (the `offline` event, `navigator.onLine` false).
 */
const OFFLINE = "You're offline. Pages you have open still work; changes can't be saved.";

test.describe('Offline banner (#611)', () => {
  test.setTimeout(300_000);

  test('appears within 2 seconds with the review wording and a Retry button, says "Back online." when the connection returns, and goes away', async ({
    page,
  }) => {
    await page.goto('/clients');
    await expect(page.getByRole('heading', { name: 'Clients', level: 1 })).toBeVisible();
    await expect(page.locator('[data-offline-banner]')).toHaveCount(0);
    await goOffline(page);
    await expect(page.locator('[data-offline-banner]')).toContainText(OFFLINE, { timeout: 2000 });
    await expect(page.getByRole('button', { name: 'Retry' })).toBeVisible();
    await shot(page, 'offline-banner');
    // The banner is under the header and pushes the page down; the header stays where it was.
    const geometry = await page.evaluate(() => {
      const header = document.querySelector('header.mf-header')!.getBoundingClientRect();
      const banner = document.querySelector('[data-offline-banner]')!.getBoundingClientRect();
      const main = document.querySelector('main')!.getBoundingClientRect();
      return {
        headerTop: header.top,
        headerBottom: header.bottom,
        bannerTop: banner.top,
        bannerBottom: banner.bottom,
        mainTop: main.top,
      };
    });
    expect(geometry.headerTop).toBe(0);
    expect(geometry.bannerTop).toBeGreaterThanOrEqual(geometry.headerBottom - 1);
    expect(geometry.mainTop).toBeGreaterThanOrEqual(geometry.bannerBottom - 1);

    await goOffline(page, false);
    await expect(page.locator('[data-back-online]')).toContainText('Back online.');
    await expect(page.locator('[data-connection-status]')).toContainText('Back online.');
    await expect(page.locator('[data-offline-banner]')).toHaveCount(0);
    await expect(page.locator('[data-back-online]')).toHaveCount(0, { timeout: 10_000 });
  });

  test('a list that failed to load while offline shows one inline state, no toast, and reads itself once when the connection returns', async ({
    page,
    seed,
  }) => {
    await seed.client({ name: `Offline ${Date.now()}` });
    // Both list pages are opened once while online, in the same document, so their code is loaded; then the list is read afresh offline.
    const rail = page.getByRole('navigation', { name: 'Main' });
    await page.goto('/clients');
    await expect(page.getByRole('heading', { name: 'Clients', level: 1 })).toBeVisible();
    await rail.getByRole('link', { name: 'Matters' }).click();
    await expect(page.getByRole('heading', { name: 'Matters', level: 1 })).toBeVisible();
    await goOffline(page);
    await expect(page.locator('[data-offline-banner]')).toBeVisible();
    // Open a loaded page whose list is read afresh: the read fails inline.
    await page
      .getByRole('navigation', { name: 'Main' })
      .getByRole('link', { name: 'Clients' })
      .click();
    await expect(page.getByText("Couldn't load clients.").first()).toBeVisible();
    // No toast for the failed load: the banner and the inline state say it (S13d).
    await expect(page.locator('[data-toast]')).toHaveCount(0);

    const reads: string[] = [];
    page.on('request', (r) => {
      // One load of the Clients list is two reads: the rows, and the count of inactive clients the filter hides.
      if (/\/api\/v1\/clients\?.*IsActive=true/.test(r.url())) reads.push(r.url());
    });
    await goOffline(page, false);
    await expect(page.getByText("Couldn't load clients.")).toHaveCount(0, { timeout: 10_000 });
    await expect(page.getByRole('link', { name: /Offline \d+/ }).first()).toBeVisible();
    await page.waitForTimeout(1500);
    // One automatic retry (the shared list state), not a storm.
    expect(reads.length, reads.join('\n')).toBe(1);
  });

  test('Retry is reachable by keyboard, and pressing it while still offline changes nothing but leaves focus on the button', async ({
    page,
  }) => {
    await page.goto('/my-work');
    await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();
    await goOffline(page);
    const retry = page.locator('[data-offline-retry]');
    await expect(retry).toBeVisible();
    await retry.focus();
    await page.keyboard.press('Enter');
    await expect(retry).toBeFocused();
    await expect(page.locator('[data-offline-banner]')).toBeVisible();
    await goOffline(page, false);
    await expect(page.locator('[data-back-online]')).toBeVisible();
  });

  test('axe is clean with the banner shown, nothing scrolls sideways at four sizes, and the banner wraps on a phone', async ({
    page,
  }) => {
    await page.goto('/clients');
    await expect(page.getByRole('heading', { name: 'Clients', level: 1 })).toBeVisible();
    await goOffline(page);
    await expect(page.locator('[data-offline-banner]')).toBeVisible();
    await atEverySize(page, 'offline-banner-axe');
    await page.setViewportSize(SIZES[0]);
    await noHorizontalScroll(page);
    const box = (await page.locator('[data-offline-banner]').boundingBox())!;
    expect(box.width).toBeLessThanOrEqual(375);
  });

  test('the banner shows for every kind of person', async ({ personas, asUser }) => {
    for (const who of ['technician', 'director', 'clientViewOnly', 'taskViewOnly'] as const) {
      const person = await personas.named(who);
      const page = await asUser(person.username);
      await page.goto('/');
      await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();
      await goOffline(page);
      await expect(page.locator('[data-offline-banner]'), who).toContainText(OFFLINE, {
        timeout: 2000,
      });
      await goOffline(page, false);
      await expect(page.locator('[data-back-online]')).toBeVisible();
    }
  });
});
