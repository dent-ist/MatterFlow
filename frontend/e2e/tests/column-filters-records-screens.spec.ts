import fs from 'node:fs';
import path from 'node:path';
import { Page } from '@playwright/test';
import { seedBulk } from '../support/bulk';
import { expect, test } from '../support/fixtures';

/**
 * Screenshot run for docs/ux/column-filters (Batch 2 screens; not a test: skipped unless E2E_SCREENSHOTS is set to the output folder):
 *   E2E_SCREENSHOTS=docs/ux/column-filters/screenshots frontend/e2e/run-local.sh -g "column filters records screenshots"
 * Clients, Matters, Projects, the Client's Matters grid and the Matter's Assets tab at 1366x768 (row closed, open, filtered, empty,
 * chips) and 375x812 (the sheet).
 */
const OUT = process.env['E2E_SCREENSHOTS'];

test.describe('column filters records screenshots', () => {
  test.skip(!OUT, 'set E2E_SCREENSHOTS to the output folder');

  test('capture', async ({ page, admin, seed }) => {
    test.setTimeout(900_000);
    const bulk = await seedBulk(admin, seed, {
      tasks: 0,
      clients: 12,
      matters: 24,
      projects: 14,
      workflows: 0,
      users: 0,
      assets: 40,
    });
    fs.mkdirSync(OUT!, { recursive: true });
    const shot = async (p: Page, name: string) => {
      await p.waitForLoadState('networkidle');
      await p.waitForTimeout(300);
      const size = p.viewportSize()!;
      await p.screenshot({ path: path.join(OUT!, `${name}-${size.width}x${size.height}.png`) });
    };
    const toggle = page.getByRole('button', { name: /^Filters/ });
    const first = (name: string) =>
      page
        .getByRole('region', { name: `${name}, scrollable` })
        .locator('tbody tr')
        .first();
    const matterId = bulk.mainMatter.matterId;
    const clientId = bulk.mainClient.clientId;

    await page.setViewportSize({ width: 1366, height: 768 });
    // Clients
    await page.goto('/clients');
    await expect(first('Clients list')).toBeVisible();
    // Since WP8 (#270) the row is open by default on the four record lists; the Matter's Assets tab keeps it closed.
    await expect(page.getByRole('textbox', { name: 'Filter by Name' })).toBeVisible();
    await shot(page, 'clients-filters-open');
    await toggle.click();
    await shot(page, 'clients-filters-closed');
    await toggle.click();
    await page.goto('/clients?name=Bulk&status=all');
    await expect(first('Clients list')).toBeVisible();
    await shot(page, 'clients-filters-active');
    await page.goto('/clients?name=no-such-client');
    await expect(page.locator('td[data-empty="filtered"]')).toBeVisible();
    await shot(page, 'clients-empty-filtered');

    // Matters: Sensitive is a select after Status (WP8 #272), then chips with the row closed
    await page.goto('/matters');
    await expect(first('Matters list')).toBeVisible();
    await shot(page, 'matters-sensitive-filter');
    await page.goto(`/matters?clientId=${clientId}&name=Bulk&isSensitive=false`);
    await expect(first('Matters list')).toBeVisible();
    await shot(page, 'matters-filters-active');
    await toggle.click();
    await expect(page.getByRole('list', { name: 'Active filters' })).toBeVisible();
    await shot(page, 'matters-chips-row-closed');

    // Projects
    await page.goto('/projects');
    await expect(first('Projects list')).toBeVisible();
    await shot(page, 'projects-filters-open');

    // Client page, Matters grid
    await page.goto(`/clients/${clientId}?tab=matters`);
    await expect(first('Matters list')).toBeVisible();
    await shot(page, 'client-matters-open');
    await page.getByRole('textbox', { name: 'Filter by Name' }).fill(`Bulk matter ${bulk.tag}-1`);
    await page.waitForTimeout(600);
    await shot(page, 'client-matters-filtered');

    // Matter page, Assets tab
    await page.goto(`/matters/${matterId}?tab=assets`);
    await expect(first('Assets list')).toBeVisible();
    await toggle.click();
    await page.getByRole('button', { name: /^Filter by Type/ }).click();
    await shot(page, 'matter-assets-type-multiselect');
    await page.keyboard.press('Escape');

    // Phone: the sheet
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto('/clients');
    await expect(first('Clients list')).toBeVisible();
    await shot(page, 'clients-closed');
    await page.getByRole('button', { name: /^Filters/ }).click();
    await expect(page.getByRole('dialog', { name: 'Filters' })).toBeVisible();
    await shot(page, 'clients-sheet');
    await page.getByRole('dialog', { name: 'Filters' }).getByLabel('Filter by Name').fill('Bulk');
    await page.waitForTimeout(600);
    await shot(page, 'clients-sheet-filtered');
    await page.goto(`/matters/${matterId}?tab=assets`);
    await expect(first('Assets list')).toBeVisible();
    await shot(page, 'matter-assets-closed');
  });
});
