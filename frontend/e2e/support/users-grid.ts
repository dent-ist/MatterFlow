import { Locator, Page, expect } from '@playwright/test';

/**
 * The Users grid (#432, #433): the name of a person is the one control of the Name cell and the last column is one action (Grant access for a
 * pending person, otherwise the row menu). Helpers for the older specs that used the buttons the nine-column grid had in every row.
 */

/** Opens the row menu of a Users row and picks "Edit Availability" (needs User.Manage). */
export async function openEditAvailability(row: Locator): Promise<void> {
  await row.locator('button[data-overflow]').click();
  await row.page().getByRole('menuitem', { name: 'Edit Availability' }).click();
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
    : page.locator(`tr[data-record-id="${userId}"]`);
}

/** The name button that opens a person: the table's `button[data-open]`, the card's `button[data-card-name]`. */
export function userName(row: Locator): Locator {
  return row.locator('button[data-open], button[data-card-name]');
}

/**
 * The user dialog (epic #1389, issue #1390; it was the right slide panel `.mf-user-drawer`): the large centred form dialog that holds `[data-panel]`. The
 * Availability dialog is another `.mf-formdlg`; it never shows together with this one (this one steps aside while it is open, D-31).
 */
export function userDialog(page: Page): Locator {
  return page.locator('.mf-formdlg').filter({ has: page.locator('[data-panel]') });
}

/**
 * Focus is somewhere inside the open user dialog. The shared dialog puts it on the first field, or on its close button while the person is still
 * loading, so the exact control is not part of the contract.
 */
export async function expectFocusInUserDialog(page: Page): Promise<void> {
  await expect(userDialog(page).locator(':focus')).toHaveCount(1);
}

/**
 * The address filters that find a person by display name: the Users grid has First Name and Last Name filters (issue #1390), no Name filter any more.
 * The display name is split the way the person record splits it: the last word is the last name, everything before it the first name.
 */
export function nameParts(displayName: string): { first: string; last: string } {
  const name = displayName.trim();
  const space = name.lastIndexOf(' ');
  return space < 0
    ? { first: name, last: '' }
    : { first: name.slice(0, space).trimEnd(), last: name.slice(space + 1) };
}

export function nameFilter(displayName: string): string {
  const { first, last } = nameParts(displayName);
  return `firstName=${encodeURIComponent(first)}${last ? `&lastName=${encodeURIComponent(last)}` : ''}`;
}
