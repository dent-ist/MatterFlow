import { Page } from '@playwright/test';

/**
 * The title row of My Matters has ONE Options menu at every width (issue #900): the "My matters | All matters" switch and the Focus checklist live in it, so
 * a test that picks the scope or the Focus opens it first. A no-op when it is already open.
 */
export async function openHeaderOptions(page: Page): Promise<void> {
  const menu = page.locator('[data-header-options] details[data-options]');
  await menu.waitFor({ state: 'attached' });
  if (!(await menu.evaluate((el) => (el as HTMLDetailsElement).open))) {
    await page.locator('[data-header-options] [data-options-trigger]').click();
  }
}
