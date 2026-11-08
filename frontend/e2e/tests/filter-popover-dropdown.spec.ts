import { Page } from '@playwright/test';
import { axeAvailable, axeViolations } from '../support/axe';
import { expect, test } from '../support/fixtures';
import { SIZES, shot } from '../support/screens';

/**
 * A dropdown opened inside a filter popover keeps the popover open (#1313, #1308): the option list is drawn in the page body, outside the popover, and
 * used to count as "outside". Mouse and keyboard; Esc closes the list first, the popover on the second press; picking an option sets the filter.
 * Matters (Primary PM under Other Filters, a hidden column by default) and the Task Queue (Other Filters). Desktop sizes only (D-82).
 */
const popover = (page: Page) => page.locator('mf-filter-popover');
const list = (page: Page) => page.locator('.dd-panel');

async function openOtherFilter(page: Page, key: string): Promise<void> {
  await page.locator('[data-more-filters]').click();
  await expect(popover(page)).toBeVisible();
  await page.locator(`[data-more-filter="${key}"]`).click();
}

for (const size of SIZES) {
  test.describe(`Filter popover with a dropdown at ${size.width}x${size.height}`, () => {
    test.use({ viewport: { width: size.width, height: size.height } });

    test('Matters > Other Filters > Primary PM: the list opens with the mouse, Esc closes list then popover, a pick sets the filter', async ({
      page,
    }) => {
      await page.goto('/matters?status=all');
      await openOtherFilter(page, 'primaryManager');
      const trigger = popover(page).locator('mf-dropdown button').first();
      await trigger.click();
      await expect(list(page)).toBeVisible();
      await expect(popover(page)).toBeVisible();
      await shot(page, 'filter-popover-dropdown-open');
      if (axeAvailable()) expect(await axeViolations(page)).toEqual([]);

      await page.keyboard.press('Escape');
      await expect(list(page)).toHaveCount(0);
      await expect(popover(page)).toBeVisible();
      await expect(trigger).toBeFocused();

      // The keyboard opens it too (Enter on the focused trigger), and a pick sets the filter without closing the popover.
      await page.keyboard.press('Enter');
      await expect(list(page)).toBeVisible();
      await expect(popover(page)).toBeVisible();
      const option = list(page).locator('[role="option"]:not([aria-disabled="true"])').nth(1);
      await option.click();
      await expect(list(page)).toHaveCount(0);
      await expect(popover(page)).toBeVisible();
      await expect(page.locator('[data-filter-chip], mf-filter-chips')).toContainText('Primary PM');

      await page.keyboard.press('Escape');
      await expect(popover(page)).toHaveCount(0);
    });

    test('Task Queue > Other Filters: a dropdown inside the popover keeps it open and Esc goes list first', async ({
      page,
    }) => {
      await page.goto('/tasks');
      await page.locator('[data-more-filters]').click();
      await expect(popover(page)).toBeVisible();
      const items = page.locator('[data-more-filter]');
      const count = await items.count();
      let checked = 0;
      for (let i = 0; i < count; i++) {
        await items.nth(i).click();
        const trigger = popover(page)
          .locator('mf-dropdown button, [aria-haspopup="listbox"]')
          .first();
        if ((await trigger.count()) > 0) {
          await trigger.click();
          await expect(list(page)).toBeVisible();
          await expect(popover(page)).toBeVisible();
          await page.keyboard.press('Escape');
          await expect(list(page)).toHaveCount(0);
          await expect(popover(page)).toBeVisible();
          checked++;
        }
        await popover(page).getByRole('button', { name: 'Back' }).click();
      }
      expect(checked, 'at least one Other Filters entry holds a dropdown').toBeGreaterThan(0);
      await page.keyboard.press('Escape');
      await expect(popover(page)).toHaveCount(0);
    });
  });
}
