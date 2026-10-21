import { Page } from '@playwright/test';
import { axeAvailable, axeViolations } from '../support/axe';
import { expect, test } from '../support/fixtures';
import { uid } from '../support/seed';

/**
 * The shared column-filter foundation (docs/ux/column-filters/README.md, issue #76), proven on the Assets screen: chips while the row is
 * closed, the sheet below 768 px, the print line, keyboard behaviour, the live region and axe in every state.
 */
test.describe('Column filters on the Assets screen', () => {
  const filter = (page: Page, column: string) =>
    page.getByRole('textbox', { name: `Filter by ${column}` });
  const toggle = (page: Page) => page.getByRole('button', { name: /^Filters/ });
  const names = (page: Page) => page.locator('tbody tr[data-asset-id] a.mf-name');
  const sheet = (page: Page) => page.getByRole('dialog', { name: 'Filters' });

  async function seedSet(
    seed: {
      matter: (o?: { name?: string }) => Promise<{ matterId: number }>;
      asset: (m: { matterId: number }, name: string) => Promise<unknown>;
    },
    token: string,
  ) {
    const matter = await seed.matter({ name: `CF Matter ${token}` });
    for (const n of ['Alpha', 'Beta', 'Gamma']) await seed.asset(matter, `${n} ${token}`);
  }

  test('chips summarise the filters while the row is closed, each removable; the row shows the values instead', async ({
    page,
    seed,
  }) => {
    await page.setViewportSize({ width: 1366, height: 768 });
    const token = uid();
    await seedSet(seed, token);
    await page.goto(`/assets?name=${token}&status=all`);
    // A link that carries filters opens the row; the row shows the values, so no chips repeat them.
    await expect(filter(page, 'Name')).toHaveValue(token);
    await expect(page.locator('[data-filter-chips]')).toHaveCount(0);

    await toggle(page).click();
    await expect(filter(page, 'Name')).toHaveCount(0);
    const chips = page.getByRole('list', { name: 'Active filters' });
    await expect(chips.getByRole('listitem')).toHaveCount(2);
    await expect(chips).toContainText(`Name: ${token}`);
    await expect(chips).toContainText('Status: All');

    await page.getByRole('button', { name: 'Remove filter Status: All' }).click();
    await expect(page).not.toHaveURL(/status=/);
    await expect(chips.getByRole('listitem')).toHaveCount(1);
    await expect(names(page)).toHaveText([`Alpha ${token}`, `Beta ${token}`, `Gamma ${token}`]);

    await page.getByRole('button', { name: `Remove filter Name: ${token}` }).click();
    await expect(page.locator('[data-filter-chips]')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Clear filters' })).toHaveCount(0);
  });

  test('a live region announces the result count after a filter change, not while typing', async ({
    page,
    seed,
  }) => {
    await page.setViewportSize({ width: 1366, height: 768 });
    const token = uid();
    await seedSet(seed, token);
    await page.goto('/assets');
    await toggle(page).click();
    const live = page.locator('[data-filter-live]');
    await expect(live).toHaveAttribute('aria-live', 'polite');
    await expect(live).toHaveText('');
    await filter(page, 'Name').fill(`beta ${token}`);
    await expect(names(page)).toHaveText([`Beta ${token}`]);
    await expect(live).toHaveText(/^\s*1 asset\u200b?\s*$/);
    await filter(page, 'Name').fill(`${token}`);
    await expect(names(page)).toHaveCount(3);
    await expect(live).toHaveText(/^\s*3 assets\u200b?\s*$/);
  });

  test('keyboard: Tab order is toggle, headers, filter row left to right; Enter applies; Esc clears a filled box', async ({
    page,
    seed,
  }) => {
    await page.setViewportSize({ width: 1366, height: 768 });
    const token = uid();
    await seedSet(seed, token);
    await page.goto('/assets');
    await toggle(page).focus();
    await page.keyboard.press('Enter'); // opens the row
    await expect(filter(page, 'Name')).toBeVisible();

    // From the Filters button: header sort buttons first, then the controls of the row in column order.
    const order: string[] = [];
    for (let i = 0; i < 9; i++) {
      await page.keyboard.press('Tab');
      order.push(
        await page.evaluate(
          () =>
            document.activeElement?.getAttribute('aria-label') ??
            document.activeElement?.textContent?.trim() ??
            '',
        ),
      );
    }
    const at = (label: string) => order.findIndex((o) => o.includes(label));
    expect(at('Name')).toBeGreaterThanOrEqual(0);
    expect(at('Filter by Name')).toBeGreaterThan(at('Type'));
    expect(at('Filter by Type')).toBeGreaterThan(at('Filter by Name'));
    expect(at('Filter by Matter')).toBeGreaterThan(at('Filter by Type'));
    expect(at('Filter by External reference')).toBeGreaterThan(at('Filter by Matter'));
    expect(at('Filter by Status')).toBeGreaterThan(at('Filter by External reference'));

    // Enter applies a half-typed value at once; Esc clears the filled box and keeps focus there.
    await filter(page, 'Name').fill(`gamma ${token}`);
    await filter(page, 'Name').press('Enter');
    await expect(page).toHaveURL(/name=gamma/);
    await expect(names(page)).toHaveText([`Gamma ${token}`]);
    await filter(page, 'Name').press('Escape');
    await expect(filter(page, 'Name')).toHaveValue('');
    await expect(filter(page, 'Name')).toBeFocused();
    await expect(page).not.toHaveURL(/name=/);
  });

  test('the / key opens the closed row and focuses the first text filter; the box keeps "/" while typing', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1366, height: 768 });
    await page.addInitScript(() => localStorage.clear());
    await page.goto('/assets');
    await expect(toggle(page)).toHaveAttribute('aria-pressed', 'false');
    await page.keyboard.press('/');
    await expect(filter(page, 'Name')).toBeFocused();
    await expect(toggle(page)).toHaveAttribute('aria-pressed', 'true');
    await page.keyboard.type('a/b');
    await expect(filter(page, 'Name')).toHaveValue('a/b');
  });

  test('below 768 px the Filters button opens a sheet with the same controls; chips stay above the grid', async ({
    page,
    seed,
  }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    const token = uid();
    await seedSet(seed, token);
    await page.goto('/assets');
    await expect(names(page).first()).toBeVisible();
    await expect(toggle(page)).toHaveAttribute('aria-haspopup', 'dialog');
    await toggle(page).click();
    await expect(sheet(page)).toBeVisible();
    await expect(page.locator('tr.mf-filter-row')).toHaveCount(0);
    for (const column of ['Name', 'Matter', 'External reference', 'Status']) {
      await expect(sheet(page).getByLabel(`Filter by ${column}`)).toBeVisible();
    }
    // Type is a multi-select: its checkbox group sits in the sheet.
    await expect(sheet(page).locator('.ms-group')).toBeVisible();
    // 44 px targets.
    const box = (await sheet(page).getByLabel('Filter by Name').boundingBox())!;
    expect(box.height).toBeGreaterThanOrEqual(43);

    // Changes apply live; the footer says how many results.
    await sheet(page).getByLabel('Filter by Name').fill(`alpha ${token}`);
    await expect(page).toHaveURL(/name=alpha/);
    await expect(sheet(page).getByRole('button', { name: 'Show 1 result' })).toBeVisible();

    // Esc clears the filled box first, a second Esc closes the sheet and focus returns to the Filters button.
    await sheet(page).getByLabel('Filter by Name').press('Escape');
    await expect(sheet(page).getByLabel('Filter by Name')).toHaveValue('');
    await sheet(page).getByLabel('Filter by Name').fill(`alpha ${token}`);
    await expect(names(page)).toHaveText([`Alpha ${token}`]);
    await sheet(page).getByRole('button', { name: 'Show 1 result' }).click();
    await expect(sheet(page)).toHaveCount(0);
    await expect(toggle(page)).toBeFocused();
    await expect(page.getByRole('list', { name: 'Active filters' })).toContainText(
      `Name: alpha ${token}`,
    );
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);

    // Clear filters from the sheet.
    await toggle(page).click();
    await sheet(page).getByRole('button', { name: 'Clear filters' }).click();
    await expect(page).not.toHaveURL(/name=/);
    await page.keyboard.press('Escape');
    await expect(sheet(page)).toHaveCount(0);
  });

  test('the sheet also replaces the row when the grid overflows sideways (1024 px wide window)', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1024, height: 768 });
    await page.goto('/assets');
    await expect(page.getByRole('region', { name: 'Assets list, scrollable' })).toBeVisible();
    const overflows = await page
      .getByRole('region', { name: 'Assets list, scrollable' })
      .evaluate((e) => e.scrollWidth > e.clientWidth);
    await toggle(page).click();
    if (overflows) {
      await expect(sheet(page)).toBeVisible();
      await expect(page.locator('tr.mf-filter-row')).toHaveCount(0);
    } else {
      await expect(filter(page, 'Name')).toBeVisible();
    }
  });

  test('a filtered grid prints with a "Filters: ..." line; the row, toggle and chips are not printed', async ({
    page,
    seed,
  }) => {
    await page.setViewportSize({ width: 1366, height: 768 });
    const token = uid();
    await seedSet(seed, token);
    await page.goto(`/assets?name=${token}`);
    await expect(names(page)).toHaveCount(3);
    const line = page.locator('[data-filter-print]');
    await expect(line).toBeHidden(); // not on screen
    await page.emulateMedia({ media: 'print' });
    await expect(line).toBeVisible();
    await expect(line).toHaveText(`Filters: Name ${token}, Status Active`);
    await expect(toggle(page)).toBeHidden();
    await expect(page.locator('tr.mf-filter-row')).toBeHidden();
    await page.emulateMedia({ media: 'screen' });
    await expect(line).toBeHidden();
    await expect(toggle(page)).toBeVisible();
  });

  test('axe: no violations with the row closed, open, filtered with chips, and in the sheet', async ({
    page,
    seed,
  }) => {
    test.skip(!axeAvailable(), 'axe-core not installed (set E2E_AXE_PATH to axe.min.js)');
    test.setTimeout(180_000);
    const token = uid();
    await seedSet(seed, token);
    await page.setViewportSize({ width: 1366, height: 768 });
    await page.addInitScript(() => localStorage.clear());
    await page.goto('/assets');
    await expect(names(page).first()).toBeVisible();
    expect(await axeViolations(page)).toEqual([]); // row closed

    await toggle(page).click();
    await expect(filter(page, 'Name')).toBeVisible();
    expect(await axeViolations(page)).toEqual([]); // row open

    await filter(page, 'Name').fill(token);
    await filter(page, 'Name').press('Enter');
    await expect(names(page)).toHaveCount(3);
    expect(await axeViolations(page)).toEqual([]); // row open, filtered

    await toggle(page).click();
    await expect(page.getByRole('list', { name: 'Active filters' })).toBeVisible();
    expect(await axeViolations(page)).toEqual([]); // row closed, chips

    await page.setViewportSize({ width: 375, height: 812 });
    await toggle(page).click();
    await expect(sheet(page)).toBeVisible();
    expect(await axeViolations(page)).toEqual([]); // sheet
  });
});
