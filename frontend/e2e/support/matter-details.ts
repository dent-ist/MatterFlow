import { Page, expect } from '@playwright/test';

/**
 * The Details disclosure of a matter's Overview (PM v2, #882): the compact summary stays above the sections and the client, status, dates and custom
 * fields sit behind "Details". Opens it (a viewer without Task.View and Asset.View has it open already).
 */
export async function openMatterDetails(page: Page): Promise<void> {
  const toggle = page.locator('[data-details-toggle]');
  await expect(toggle).toBeVisible();
  if ((await toggle.getAttribute('aria-expanded')) !== 'true') await toggle.click();
  await expect(page.locator('[data-details-block]')).toBeVisible();
}
