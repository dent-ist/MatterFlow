import fs from 'node:fs';
import path from 'node:path';
import { Page } from '@playwright/test';
import { expect, test } from '../support/fixtures';
import { seedBulk } from '../support/bulk';

/**
 * Screenshot run for docs/ux/assets-screen (not a test: skipped unless E2E_SCREENSHOTS is set to the output folder):
 *   E2E_SCREENSHOTS=docs/ux/assets-screen/after frontend/e2e/run-local.sh -g "assets screen screenshots"
 * Seeds 60 assets in 8 matters, then takes the Assets screen at 1366x768 and 375x812: filters hidden, filters shown (some active), with a
 * selected asset, and an empty result.
 */
const OUT = process.env['E2E_SCREENSHOTS'];
const SIZES = [
  { w: 1366, h: 768 },
  { w: 375, h: 812 },
];

test.describe('assets screen screenshots', () => {
  test.skip(!OUT, 'set E2E_SCREENSHOTS to the output folder');

  test('capture', async ({ page, admin, seed }) => {
    test.setTimeout(600_000);
    const bulk = await seedBulk(admin, seed, {
      tasks: 0,
      clients: 2,
      matters: 8,
      projects: 2,
      workflows: 0,
      users: 0,
      assets: 60,
    });
    fs.mkdirSync(OUT!, { recursive: true });
    const shot = async (p: Page, name: string, size: { w: number; h: number }) => {
      await p.waitForLoadState('networkidle');
      await p.waitForTimeout(300);
      await p.screenshot({ path: path.join(OUT!, `${name}-${size.w}x${size.h}.png`) });
    };
    // Looked up by this run's own tag: the first assets by name of a shared database are everyone else's.
    const first = (
      await admin.get(
        `/api/v1/assets?name=${encodeURIComponent(`Bulk asset ${bulk.tag}`)}&pageSize=5&sort=displayName&isActive=true`,
      )
    ).items[0];

    for (const size of SIZES) {
      await page.setViewportSize({ width: size.w, height: size.h });
      await page.addInitScript(() => localStorage.clear());

      await page.goto('/assets');
      await expect(page.getByRole('heading', { name: 'Assets', level: 1 })).toBeVisible();
      await expect(page.locator('tbody tr[data-asset-id]').first()).toBeVisible();
      await shot(page, 'assets-filters-hidden', size);

      await page.getByRole('button', { name: /^Filters/ }).click();
      await expect(page.getByRole('textbox', { name: 'Filter by Name' })).toBeVisible();
      await shot(page, 'assets-filters-shown', size);

      await page.goto('/assets?name=Bulk%20asset&matter=Bulk&status=all');
      await expect(page.locator('tbody tr[data-asset-id]').first()).toBeVisible();
      await shot(page, 'assets-filters-active', size);

      await page.goto(`/assets?selected=${first.assetId}`);
      await expect(page.getByRole('region', { name: 'Asset details' })).toBeVisible();
      await expect(
        page.getByRole('region', { name: 'Asset details' }).getByRole('heading').first(),
      ).toContainText('Bulk asset');
      await shot(page, 'assets-selected', size);

      await page.goto('/assets?name=no-such-asset-anywhere');
      await expect(page.getByText('No assets match these filters')).toBeVisible();
      await shot(page, 'assets-empty', size);
    }
  });
});
