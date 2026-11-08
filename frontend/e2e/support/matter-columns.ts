import { Page } from '@playwright/test';

/**
 * The Matters list shows CM Number, Matter Name, Client, Matter Type, Current State and Status by default (owner, 2026-11-08, epic #1298; the default set fits
 * the 1366 frame, D-43a). Primary PM, Secondary PM, Open Tasks and Overdue are optional: this turns the named columns on through the Columns menu
 * (the choice is remembered in the browser).
 */
export async function showMatterColumns(page: Page, ...names: string[]): Promise<void> {
  const columns = page.getByRole('button', { name: 'Columns', exact: true });
  await columns.click();
  for (const name of names) await page.getByLabel(name, { exact: true }).check();
  await columns.click();
}
