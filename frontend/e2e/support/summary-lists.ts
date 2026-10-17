import { expect, Locator } from '@playwright/test';

/**
 * The Dashboard Summary's Unassigned row: "Assign to me" is the first choice of the row's "Assign" menu (above the search box and the people).
 * Opens the menu of `row` (a `li[data-task]`) with the pointer and picks it.
 */
export async function assignToMeFromRow(row: Locator, number: string): Promise<void> {
  await row.getByRole('button', { name: `Assign ${number}`, exact: true }).click();
  await row
    .page()
    .getByRole('button', { name: `Assign ${number} to me`, exact: true })
    .click();
}

/** The same through the keyboard: Enter on the trigger opens the menu with the search box focused, Arrow Up reaches "Assign to me", Enter picks it. */
export async function assignToMeByKeyboard(row: Locator, number: string): Promise<void> {
  const trigger = row.getByRole('button', { name: `Assign ${number}`, exact: true });
  await trigger.focus();
  const page = row.page();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('textbox', { name: 'Search people' })).toBeFocused();
  await page.keyboard.press('ArrowUp');
  await expect(
    page.getByRole('button', { name: `Assign ${number} to me`, exact: true }),
  ).toBeFocused();
  await page.keyboard.press('Enter');
}
