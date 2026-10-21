import { Locator, Page } from '@playwright/test';

/**
 * The Users grid (#432, #433): the name of a person is the one control of the Name cell and the last column is one action (Grant access for a
 * pending person, otherwise the row menu). Helpers for the older specs that used the buttons the nine-column grid had in every row.
 */

/** Opens the row menu of a Users row and picks "Edit availability" (needs User.Manage). */
export async function openEditAvailability(row: Locator): Promise<void> {
  await row.locator('button[data-overflow]').click();
  await row.page().getByRole('menuitem', { name: 'Edit availability' }).click();
}

/** The names of the items of the row menu of a Users row (the menu is left open). */
export async function rowMenuItems(row: Locator): Promise<string[]> {
  await row.locator('button[data-overflow]').click();
  const items = row.page().getByRole('menuitem');
  return (await items.allTextContents()).map((t) => t.replace(/\s+/g, ' ').trim());
}

/**
 * The row of a person on a window of this width: the table row below, the card (found by the account under the name) below 640 px (#445).
 * `account` is the Windows account, `userId` the id the table row carries.
 */
export function userRow(page: Page, userId: number, account: string): Locator {
  const width = page.viewportSize()?.width ?? 1366;
  return width < 640
    ? page.locator('li.rc', { hasText: account })
    : page.locator(`tr[data-user="${userId}"]`);
}

/** The name button that opens a person: the table's `button[data-open]`, the card's `button[data-card-name]`. */
export function userName(row: Locator): Locator {
  return row.locator('button[data-open], button[data-card-name]');
}
