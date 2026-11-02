import { Page, expect } from '@playwright/test';

/**
 * The Summary tab of a matter shows its details list at once (MD-03, #1004; the old Details disclosure is gone). Kept so specs can say "the details are
 * on screen" in one line: it waits for the list.
 */
export async function openMatterDetails(page: Page): Promise<void> {
  await expect(page.locator('[data-summary-details] dl')).toBeVisible();
}
