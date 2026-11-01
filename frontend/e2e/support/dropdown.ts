import { expect, Locator, Page } from '@playwright/test';

/**
 * Test helper for the shared dropdown (`mf-dropdown`, the one select of the app since TH-17 #999). A `Dropdown` is the BUTTON of the control (its accessible name is
 * "<label>: <chosen text>") with the same `selectOption` a native select has, so a spec only changes how it finds the control:
 *
 *   await filterDropdown(page, 'Status').selectOption('inactive');          // by value (the option's data-value) or by its text
 *   await filterDropdown(page, 'Status').selectOption({ label: 'Inactive' });
 *   await expect(filterDropdown(page, 'Status')).toHaveAttribute('data-value', 'active');   // the chosen value (native: toHaveValue)
 *   await expect(filterDropdown(page, 'Status')).toContainText('Active');                   // the chosen text
 *   expect(await filterDropdown(page, 'Status').optionTexts()).toEqual([...]);              // opens the list, reads it, closes it
 *
 * The list is drawn in the page body (an overlay), so options are found on the page, not inside the control's cell.
 */
export type Dropdown = Locator & {
  selectOption(choice: string | { label?: string; value?: string }): Promise<void>;
  optionTexts(): Promise<string[]>;
  optionValues(): Promise<string[]>;
};

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Wraps the button of a dropdown. */
export function asDropdown(button: Locator): Dropdown {
  const page: Page = button.page();
  const options = () => page.locator('.dd-panel [role="option"]:not([aria-disabled="true"])');
  const open = async () => {
    if ((await button.getAttribute('aria-expanded')) !== 'true') await button.click();
    await expect(page.locator('.dd-panel [role="listbox"]')).toBeVisible();
  };
  const close = async () => {
    if ((await button.getAttribute('aria-expanded')) === 'true')
      await page.keyboard.press('Escape');
    await expect(page.locator('.dd-panel')).toHaveCount(0);
  };
  return Object.assign(button, {
    async selectOption(choice: string | { label?: string; value?: string }): Promise<void> {
      const value = typeof choice === 'string' ? choice : choice.value;
      const label = typeof choice === 'string' ? undefined : choice.label;
      await open();
      let target: Locator;
      if (label !== undefined) {
        target = options().filter({ hasText: new RegExp(`^\\s*${escape(label)}\\s*(\\d+)?\\s*$`) });
      } else {
        const byValue = page.locator(`.dd-panel [role="option"][data-value="${value}"]`);
        target =
          (await byValue.count()) > 0
            ? byValue
            : options().filter({
                hasText: new RegExp(`^\\s*${escape(value ?? '')}\\s*(\\d+)?\\s*$`),
              });
      }
      await target.first().click();
      await expect(page.locator('.dd-panel')).toHaveCount(0);
    },
    async optionTexts(): Promise<string[]> {
      await open();
      const texts = (await options().allTextContents()).map((t) => t.replace(/\s+/g, ' ').trim());
      await close();
      return texts;
    },
    async optionValues(): Promise<string[]> {
      await open();
      const values = await options().evaluateAll((els) =>
        els.map((e) => e.getAttribute('data-value') ?? ''),
      );
      await close();
      return values;
    },
  });
}

/** The dropdown with this accessible label ("Scope", "Period", "Rows per page"), found in `scope` (a page or a region). */
export const labelledDropdown = (scope: Page | Locator, label: string): Dropdown =>
  asDropdown(scope.getByRole('button', { name: new RegExp(`^${escape(label)}:`) }));

/** The inline column filter of a grid ("Status", "Availability"): its label is "Filter by <column>". */
export const filterDropdown = (scope: Page | Locator, column: string): Dropdown =>
  labelledDropdown(scope, `Filter by ${column}`);

/** The dropdown whose button has this id (`#av-tz`, `#sf-active`). */
export const dropdownById = (scope: Page | Locator, id: string): Dropdown =>
  asDropdown(scope.locator(`button#${id}`));

/** The dropdown whose host element carries this attribute (`data-sort-select`). */
export const dropdownByAttr = (scope: Page | Locator, attr: string): Dropdown =>
  asDropdown(scope.locator(`[${attr}] button`));
