import fs from 'node:fs';
import path from 'node:path';
import { Page } from '@playwright/test';
import { axeAvailable, axeBestPractice } from '../support/axe';
import { expect, test } from '../support/fixtures';

/**
 * App shell SH1 (epic #585), #590: offline, a click on a rail item whose page is not loaded yet says so once, keeps focus on the link and the
 * address, and opens the page once the connection is back. With E2E_SCREENSHOTS set the run writes screenshots to docs/ux/shell-review/fixes/sh1-critical.
 */
const OUT = process.env['E2E_SCREENSHOTS'];
async function shot(page: Page, name: string): Promise<void> {
  if (!OUT) return;
  fs.mkdirSync(OUT, { recursive: true });
  const size = page.viewportSize()!;
  await page.waitForTimeout(250);
  await page.screenshot({ path: path.join(OUT, `${name}-${size.width}x${size.height}.png`) });
}

async function axeClean(page: Page, what: string): Promise<void> {
  if (axeAvailable()) expect(await axeBestPractice(page), what).toEqual([]);
}

test.describe('Offline click on a rail item (#590)', () => {
  test('says so once, keeps focus on the link and the address, and works again online', async ({
    page,
    context,
  }) => {
    await page.goto('/my-work');
    await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();
    const link = page
      .getByRole('navigation', { name: 'Main' })
      .getByRole('link', { name: 'Clients' });
    await context.setOffline(true);
    await link.focus();
    await link.click();
    const toast = page.getByText("Couldn't open Clients. Check your connection and try again.");
    await expect(toast).toHaveCount(1);
    await expect(link).toBeFocused();
    expect(new URL(page.url()).pathname).toBe('/my-work');
    await link.click();
    await expect(toast).toHaveCount(1);
    await axeClean(page, 'offline toast');
    await shot(page, 'offline-nav-click');
    await context.setOffline(false);
    await link.click();
    await expect(page).toHaveURL(/\/clients/);
  });
});
