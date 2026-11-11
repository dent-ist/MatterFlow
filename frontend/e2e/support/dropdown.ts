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
  // Opens the list and waits for its panel. The click is repeated only while the button does not report aria-expanded="true" (a click that a re-render of the host swallowed);
  // a button that already reports it is never clicked again, which would close the list.
  const open = async () => {
    await expect(async () => {
      if ((await button.getAttribute('aria-expanded')) !== 'true') await button.click();
      await expect(page.locator('.dd-panel [role="listbox"]')).toBeVisible({ timeout: 3000 });
    }).toPass({ timeout: 20_000 });
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
      // The target is chosen on every attempt, on the open list: right after the click the options may not be drawn yet (a list that loads its items or whose host
      // re-renders), and a lookup by value that ran too early found nothing and fell back to the TEXT of a value such as NTH_WEEKDAY for good.
      const targetOf = async (): Promise<Locator> => {
        if (label !== undefined)
          return options().filter({
            hasText: new RegExp(`^\\s*${escape(label)}\\s*(\\d+)?\\s*$`),
          });
        const byValue = page.locator(`.dd-panel [role="option"][data-value="${value}"]`);
        return (await byValue.count()) > 0
          ? byValue
          : options().filter({
              hasText: new RegExp(`^\\s*${escape(value ?? '')}\\s*(\\d+)?\\s*$`),
            });
      };
      // The list can be re-drawn while it loads (options arrive late, the host re-renders): a click on a node that went away is tried again on the open list.
      await expect(async () => {
        if ((await page.locator('.dd-panel [role="listbox"]').count()) === 0) await open();
        await (await targetOf()).first().click({ timeout: 4000 });
      }).toPass({ timeout: 20_000 });
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

/**
 * Chooses a value with the keyboard only, the way a person does: Down on the button opens the list, Home (or Down, from a search box) goes to the first item, Down walks to the item (one
 * press per step, so the walk is the same every time), Enter chooses. The values come from the list itself, so the walk does not depend on how many items it has.
 */
export async function chooseWithKeyboard(button: Dropdown, value: string): Promise<void> {
  const page: Page = button.page();
  const values = await button.optionValues();
  const to = values.indexOf(value);
  expect(to, `the list offers ${value}: ${JSON.stringify(values)}`).toBeGreaterThanOrEqual(0);
  await button.focus();
  await page.keyboard.press('ArrowDown');
  await expect(page.locator('.dd-panel [role="listbox"]')).toBeVisible();
  // A long list opens with the focus in its search box, where Down goes to the first item; a short one opens on the chosen item, where Home goes to the first.
  const inSearch = await page.evaluate(() => document.activeElement?.tagName === 'INPUT');
  if (!inSearch) await page.keyboard.press('Home');
  for (let i = 0; i < to + (inSearch ? 1 : 0); i++) await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
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

/**
 * A dropdown inside the Filters popover of the Dashboard Users views (US-07, #1098): opens the popover first when it is closed, then finds the dropdown by its label
 * ("Highest Priority", "Availability", "Sort", "Task Type"). The popover stays open for the next choice.
 */
export async function usersFilter(page: Page, label: string): Promise<Dropdown> {
  if ((await page.locator('[data-filters-panel]').count()) === 0)
    await page.locator('[data-filters-toggle]').click();
  await expect(page.locator('[data-filters-panel]')).toBeVisible();
  return labelledDropdown(page, label);
}

/**
 * The State dropdown of the Users Workload view (US-11, #1102): opens it, clicks each state (a value of '' is "All States") and closes it with Done. The list is a
 * multi choice, so the states combine.
 */
export async function pickUserStates(page: Page, ...values: string[]): Promise<void> {
  await page.getByRole('button', { name: /^State:/ }).click();
  for (const v of values)
    await page.locator(`.dd-panel [role="option"][data-value="${v}"]`).click();
  await page.locator('[data-dd-done]').click();
}

/** The number next to a state in the State dropdown (the people in it); '' is "All States". */
export async function userStateCount(page: Page, key: string): Promise<number> {
  await page.getByRole('button', { name: /^State:/ }).click();
  const n = await page.locator(`.dd-panel [role="option"][data-value="${key}"] .n`).textContent();
  await page.keyboard.press('Escape');
  return Number(n);
}

/**
 * The View dropdown over the Tasks grid of a Matter or a Project (MD-04: the five count chips became one dropdown, `#st-view`). It lists Open, Overdue, Due Soon,
 * ASAP and On Hold, each with its number; the keys are the ones the chips had (`open`, `overdue`, `dueSoon`, `asap`, `onHold`).
 */
export const viewDropdown = (scope: Page | Locator): Dropdown => dropdownById(scope, 'st-view');

/** The numbers of the View dropdown by key (opens the list, reads it, closes it). Keys the viewer has no option for are left out. */
export async function viewCounts(scope: Page | Locator): Promise<Record<string, number>> {
  const button = scope.locator('button#st-view');
  const page = button.page();
  await expect(async () => {
    if ((await button.getAttribute('aria-expanded')) !== 'true') await button.click();
    await expect(page.locator('.dd-panel [role="listbox"]')).toBeVisible({ timeout: 3000 });
  }).toPass({ timeout: 20_000 });
  const rows = await page
    .locator('.dd-panel [role="option"]')
    .evaluateAll((els) =>
      els.map((e) => [
        e.getAttribute('data-value') ?? '',
        e.querySelector('.n')?.textContent ?? '',
      ]),
    );
  await page.keyboard.press('Escape');
  await expect(page.locator('.dd-panel')).toHaveCount(0);
  const out: Record<string, number> = {};
  for (const [key, n] of rows) if (key && n.trim() !== '') out[key] = Number(n.trim());
  return out;
}
