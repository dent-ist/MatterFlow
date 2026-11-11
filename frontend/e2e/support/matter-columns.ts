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

/**
 * The Tasks tab of a Matter or a Project shows Ref, Type, Title, Priority, Assignee, Due and Status by default; Project (matter tab only) and Progress are optional
 * (the tab is already inside one record, and Status and Priority stay whole at 1366, #1154). This turns the named columns on through the Columns menu by their keys
 * (`project`, `steps`); the choice is remembered in the browser.
 */
export async function showTaskTabColumns(page: Page, ...keys: string[]): Promise<void> {
  await page.locator('[data-grid-columns]').click();
  const panel = page.locator('[data-grid-columns-panel]');
  for (const key of keys) await panel.locator(`[data-column="${key}"]`).check();
  await page.keyboard.press('Escape');
}
