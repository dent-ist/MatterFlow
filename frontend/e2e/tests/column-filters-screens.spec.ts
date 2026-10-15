import fs from 'node:fs';
import path from 'node:path';
import { Page } from '@playwright/test';
import { seedBulk } from '../support/bulk';
import { expect, test } from '../support/fixtures';

/**
 * Screenshot run for docs/ux/column-filters (not a test: skipped unless E2E_SCREENSHOTS is set to the output folder):
 *   E2E_SCREENSHOTS=docs/ux/column-filters/screenshots frontend/e2e/run-local.sh -g "column filters screenshots"
 * Seeds 60 assets, then takes the Assets screen at 1366x768 and 375x812: row closed, row open, filters active, chips with the row closed,
 * the sheet (empty and filtered) and the print rendering.
 */
const OUT = process.env['E2E_SCREENSHOTS'];

test.describe('column filters screenshots', () => {
  test.skip(!OUT, 'set E2E_SCREENSHOTS to the output folder');

  test('capture', async ({ page, admin, seed }) => {
    test.setTimeout(600_000);
    await seedBulk(admin, seed, {
      tasks: 0,
      clients: 2,
      matters: 8,
      projects: 2,
      workflows: 0,
      users: 0,
      assets: 60,
    });
    fs.mkdirSync(OUT!, { recursive: true });
    const shot = async (p: Page, name: string) => {
      await p.waitForLoadState('networkidle');
      await p.waitForTimeout(300);
      const size = p.viewportSize()!;
      await p.screenshot({ path: path.join(OUT!, `${name}-${size.width}x${size.height}.png`) });
    };
    const toggle = page.getByRole('button', { name: /^Filters/ });
    const rows = page.locator('tbody tr[data-asset-id]');

    // Wide window: the row.
    await page.setViewportSize({ width: 1366, height: 768 });
    await page.addInitScript(() => localStorage.clear());
    await page.goto('/assets');
    await expect(rows.first()).toBeVisible();
    await shot(page, 'assets-filters-closed');
    await toggle.click();
    await expect(page.getByRole('textbox', { name: 'Filter by Name' })).toBeVisible();
    await shot(page, 'assets-filters-open');
    await page.goto('/assets?name=Bulk%20asset&matter=Bulk&status=all');
    await expect(rows.first()).toBeVisible();
    await shot(page, 'assets-filters-active');
    await toggle.click();
    await expect(page.getByRole('list', { name: 'Active filters' })).toBeVisible();
    await shot(page, 'assets-chips-row-closed');

    // Print rendering.
    await page.emulateMedia({ media: 'print' });
    await shot(page, 'assets-print');
    await page.emulateMedia({ media: 'screen' });

    // Phone: the sheet.
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto('/assets');
    await expect(rows.first()).toBeVisible();
    await shot(page, 'assets-closed');
    await toggle.click();
    await expect(page.getByRole('dialog', { name: 'Filters' })).toBeVisible();
    await shot(page, 'assets-sheet');
    await page
      .getByRole('dialog', { name: 'Filters' })
      .getByLabel('Filter by Name')
      .fill('Bulk asset 1');
    await page.waitForTimeout(600);
    await shot(page, 'assets-sheet-filtered');
    await page.getByRole('button', { name: /^Show \d+ results?$/ }).click();
    await expect(page.getByRole('list', { name: 'Active filters' })).toBeVisible();
    await shot(page, 'assets-chips');
  });
});
