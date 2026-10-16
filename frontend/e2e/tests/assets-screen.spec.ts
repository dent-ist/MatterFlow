import { Page } from '@playwright/test';
import { expect, test } from '../support/fixtures';
import { uid } from '../support/seed';

/**
 * The Assets screen (docs/ux/assets-screen): inline column filters in a second header row, the Filters toggle above the grid, and the
 * selected asset's details in a panel BELOW the grid (`/assets?selected=<id>`) instead of a page of their own.
 */
test.describe('Assets screen: column filters and details below the grid', () => {
  const filter = (page: Page, column: string) =>
    page.getByRole('textbox', { name: `Filter by ${column}` });
  const filtersToggle = (page: Page) => page.getByRole('button', { name: /^Filters/ });
  const panel = (page: Page) => page.getByRole('region', { name: 'Asset details' });
  const nameButton = (page: Page, name: string) => page.getByRole('button', { name, exact: true });

  async function openFilters(page: Page): Promise<void> {
    if ((await filtersToggle(page).getAttribute('aria-pressed')) !== 'true') {
      await filtersToggle(page).click();
    }
    await expect(filter(page, 'Name')).toBeVisible();
  }

  test('the Filters button above the grid shows the filter row right under the headers, aligned to the columns, and is remembered', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1366, height: 768 });
    await page.goto('/assets');
    await expect(page.getByRole('heading', { name: 'Assets', level: 1 })).toBeVisible();
    await expect(page.getByRole('button', { name: 'New asset' })).toBeVisible();

    // No standalone filter boxes any more; the toggle sits at the right end of a bar above the grid.
    await expect(page.getByLabel('Name, type or external reference')).toHaveCount(0);
    await expect(filtersToggle(page)).toHaveAttribute('aria-pressed', 'false');
    await expect(filter(page, 'Name')).toHaveCount(0);
    const grid = page.getByRole('region', { name: 'Assets list, scrollable' });
    const toggleBox = (await filtersToggle(page).boundingBox())!;
    const gridBox = (await grid.boundingBox())!;
    expect(toggleBox.y + toggleBox.height).toBeLessThanOrEqual(gridBox.y + 1);
    expect(toggleBox.x + toggleBox.width).toBeGreaterThan(gridBox.x + gridBox.width - 40);

    await filtersToggle(page).click();
    await expect(filtersToggle(page)).toHaveAttribute('aria-pressed', 'true');
    await expect(filtersToggle(page)).toHaveAttribute('aria-expanded', 'true');

    const columns = ['Name', 'Type', 'Matter', 'External reference', 'Status'];
    const headers = grid.locator('thead tr:first-child th');
    await expect(headers).toHaveCount(5);
    const headerBottom = (await headers.first().boundingBox())!;
    for (let i = 0; i < columns.length; i++) {
      const th = (await headers.nth(i).boundingBox())!;
      const control = (await grid
        .locator(`thead tr.mf-filter-row td:nth-child(${i + 1}) :is(input, select, button)`)
        .first()
        .boundingBox())!;
      // Directly under its column, inside the column width, 32 px high.
      expect(control.y).toBeGreaterThanOrEqual(headerBottom.y + headerBottom.height - 1);
      expect(control.x).toBeGreaterThanOrEqual(th.x - 0.5);
      expect(control.x + control.width).toBeLessThanOrEqual(th.x + th.width + 0.5);
      expect(control.width).toBeGreaterThan(th.width - 26); // the header text's own padding
      expect(Math.round(control.height)).toBe(32);
    }
    await expect(page.getByRole('combobox', { name: 'Filter by Status' })).toHaveValue('active');

    // The choice is remembered per user, also after a reload.
    await page.reload();
    await expect(filter(page, 'Name')).toBeVisible();
    await filtersToggle(page).click();
    await expect(filter(page, 'Name')).toHaveCount(0);
    await page.reload();
    await expect(filtersToggle(page)).toHaveAttribute('aria-pressed', 'false');
  });

  test('every column filters on the server, lands in the URL and is cleared from the bar; the empty state keeps headers and filters', async ({
    page,
    seed,
    admin,
  }) => {
    const token = uid();
    const matter = await seed.matter({ name: `Filter Matter ${token}` });
    const other = await seed.matter({ name: `Other Matter ${uid()}` });
    const typeName = `Type ${token}`;
    const type = await admin.post('/api/v1/asset-types', { name: typeName, description: null });
    const create = (m: { matterId: number }, name: string, externalReference?: string) =>
      admin.post('/api/v1/assets', {
        matterId: m.matterId,
        assetTypeId: type.assetTypeId,
        displayName: name,
        externalReference,
      });
    await create(matter, `Alpha ${token}`, `REF-${token}-A`);
    await create(matter, `Beta ${token}`, `REF-${token}-B`);
    const gamma = await create(other, `Gamma ${token}`);
    await admin.post(`/api/v1/assets/${gamma.assetId}/active`, {
      isActive: false,
      rowVersion: gamma.rowVersion,
    });

    await page.goto('/assets');
    await openFilters(page);
    const names = page.locator('tbody tr[data-asset-id] button.as-name');

    // Type (multi-select) narrows to the type's assets; Active is the default status, so the inactive one is hidden.
    await page.getByRole('button', { name: /^Filter by Type/ }).click();
    await page.getByRole('checkbox', { name: typeName }).check();
    await page.getByRole('button', { name: 'Done' }).click();
    await expect(page).toHaveURL(new RegExp(`typeId=${type.assetTypeId}`));
    await expect(names).toHaveText([`Alpha ${token}`, `Beta ${token}`]);
    await expect(filtersToggle(page)).toContainText('(1)');

    // Name: live after a pause, URL synced; the other columns keep their text.
    await filter(page, 'Name').fill(`beta ${token}`);
    await expect(page).toHaveURL(new RegExp(`name=beta\\+${token}|name=beta%20${token}`));
    await expect(names).toHaveText([`Beta ${token}`]);
    await filter(page, 'Name').fill('');
    await expect(names).toHaveText([`Alpha ${token}`, `Beta ${token}`]);

    // Enter applies at once; External reference only matches that column.
    await filter(page, 'External reference').fill(`${token}-b`);
    await filter(page, 'External reference').press('Enter');
    await expect(page).toHaveURL(/extref=/);
    await expect(names).toHaveText([`Beta ${token}`]);
    await page.getByRole('button', { name: 'Clear External reference filter' }).click();
    await expect(names).toHaveText([`Alpha ${token}`, `Beta ${token}`]);

    // Matter: by name and by the typed reference.
    await filter(page, 'Matter').fill(`Filter Matter ${token}`);
    await filter(page, 'Matter').press('Enter');
    await expect(names).toHaveText([`Alpha ${token}`, `Beta ${token}`]);
    await filter(page, 'Matter').fill(`Other Matter`);
    await filter(page, 'Matter').press('Enter');
    await expect(page.getByText('No assets match these filters')).toBeVisible(); // Gamma is inactive
    await page.getByRole('combobox', { name: 'Filter by Status' }).selectOption('all');
    await expect(names).toHaveText([`Gamma ${token}`]);
    await filter(page, 'Matter').fill(String(matter.matterRef).replace(/(^|-)0+/g, '$1')); // typed pair, unpadded
    await filter(page, 'Matter').press('Enter');
    await expect(names).toHaveText([`Alpha ${token}`, `Beta ${token}`]);

    // Nothing matches: headers and the filter row stay, with the message and Clear filters.
    await filter(page, 'Name').fill(`nothing-${token}`);
    await filter(page, 'Name').press('Enter');
    await expect(page.getByText('No assets match these filters')).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Name' })).toBeVisible();
    await expect(filter(page, 'Name')).toBeVisible();
    await expect(page.getByRole('combobox', { name: 'Filter by Status' })).toBeVisible();

    await page.getByRole('main').getByRole('button', { name: 'Clear filters' }).first().click();
    await expect(page).not.toHaveURL(/name=|typeId=|matter=|status=|extref=/);
    await expect(filtersToggle(page)).not.toContainText('(');
    await expect(filter(page, 'Name')).toHaveValue('');
  });

  test('the filter row opens by itself when the address carries filters (also with the toggle remembered as closed)', async ({
    page,
    seed,
  }) => {
    const matter = await seed.matter();
    const asset = await seed.asset(matter, `Linked filter ${uid()}`);
    await page.goto('/assets');
    await expect(filtersToggle(page)).toHaveAttribute('aria-pressed', 'false');
    await page.goto(`/assets?name=${encodeURIComponent(asset.displayName)}`);
    await expect(filter(page, 'Name')).toHaveValue(asset.displayName);
    await expect(filtersToggle(page)).toHaveAttribute('aria-pressed', 'true');
    await expect(filtersToggle(page)).toContainText('(1)');
    await expect(nameButton(page, asset.displayName)).toBeVisible();
  });

  test('clicking a name shows the details below the grid in the same screen; Esc closes and returns focus to the row', async ({
    page,
    seed,
  }) => {
    await page.setViewportSize({ width: 1366, height: 768 });
    const token = uid();
    const matter = await seed.matter({ name: `Detail Matter ${token}` });
    const first = await seed.asset(matter, `First ${token}`);
    const second = await seed.asset(matter, `Second ${token}`);
    await page.goto(`/assets?name=${token}`);
    await expect(panel(page)).toHaveCount(0);

    await nameButton(page, first.displayName).click();
    await expect(page).toHaveURL(new RegExp(`/assets\\?.*selected=${first.assetId}`));
    await expect(panel(page)).toBeVisible();
    await expect(panel(page).getByRole('heading', { name: first.displayName })).toBeVisible();
    await expect(panel(page)).toContainText(matter.matterRef);
    await expect(panel(page).getByRole('button', { name: 'Edit' })).toBeVisible();
    await expect(panel(page).getByRole('button', { name: 'Set inactive' })).toBeVisible();
    await expect(panel(page).getByRole('tab', { name: 'Linked Tasks' })).toBeVisible();

    // The selected row is marked (aria-current, a left bar and a bold name), the other is not.
    const row = page.locator(`tr[data-asset-id="${first.assetId}"]`);
    await expect(row).toHaveAttribute('aria-current', 'true');
    await expect(page.locator(`tr[data-asset-id="${second.assetId}"]`)).not.toHaveAttribute(
      'aria-current',
      'true',
    );
    expect(
      await nameButton(page, first.displayName).evaluate((e) => getComputedStyle(e).fontWeight),
    ).toBe('700');

    // Layout: the grid is above, the panel below it and about 40% of the main area, both inside the window.
    const grid = (await page
      .getByRole('region', { name: 'Assets list, scrollable' })
      .boundingBox())!;
    const box = (await panel(page).boundingBox())!;
    expect(box.y).toBeGreaterThanOrEqual(grid.y + grid.height - 1);
    expect(box.y + box.height).toBeLessThanOrEqual(768 + 1);
    const main = (await page.locator('#mf-main').boundingBox())!;
    expect(box.height / main.height).toBeGreaterThan(0.33);
    expect(box.height / main.height).toBeLessThan(0.47);
    const pageScroll = await page.evaluate(
      () => document.documentElement.scrollHeight - document.documentElement.clientHeight,
    );
    expect(pageScroll).toBeLessThanOrEqual(1);

    // Another selection swaps the same panel.
    await nameButton(page, second.displayName).click();
    await expect(panel(page).getByRole('heading', { name: second.displayName })).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`selected=${second.assetId}`));

    // Keyboard: Enter on a name moves focus to the panel heading; Esc closes and returns to the row.
    await nameButton(page, first.displayName).focus();
    await page.keyboard.press('Enter');
    await expect(panel(page).getByRole('heading', { name: first.displayName })).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(panel(page)).toHaveCount(0);
    await expect(page).not.toHaveURL(/selected=/);
    await expect(nameButton(page, first.displayName)).toBeFocused();

    // The Close button does the same.
    await nameButton(page, second.displayName).click();
    await panel(page).getByRole('button', { name: 'Close details' }).click();
    await expect(panel(page)).toHaveCount(0);
  });

  test('the old asset address, search results and links keep working: the list opens with the asset selected, even an inactive one', async ({
    page,
    seed,
    admin,
  }) => {
    const matter = await seed.matter();
    const asset = await seed.asset(matter, `Deep link ${uid()}`);
    const old = await seed.asset(matter, `Retired ${uid()}`);
    await admin.post(`/api/v1/assets/${old.assetId}/active`, {
      isActive: false,
      rowVersion: old.rowVersion,
    });

    await page.goto(`/assets/${asset.assetId}`);
    await expect(page).toHaveURL(new RegExp(`/assets\\?.*selected=${asset.assetId}`));
    await expect(panel(page).getByRole('heading', { name: asset.displayName })).toBeVisible();
    await expect(page.locator(`tr[data-asset-id="${asset.assetId}"]`)).toHaveAttribute(
      'aria-current',
      'true',
    );

    // An inactive asset is not hidden by the Active default: it is shown selected (the list is narrowed to its matter, all states).
    await page.goto(`/assets/${old.assetId}`);
    await expect(panel(page).getByRole('heading', { name: old.displayName })).toBeVisible();
    await expect(panel(page).getByText('This asset is inactive')).toBeVisible();
    await expect(page.locator(`tr[data-asset-id="${old.assetId}"]`)).toHaveAttribute(
      'aria-current',
      'true',
    );

    // From the header search.
    await page.goto('/dashboard');
    const box = page.getByRole('combobox', { name: 'Search clients, matters, tasks, assets' });
    await box.fill(asset.displayName);
    await box.press('Enter');
    await page
      .getByRole('region', { name: /^Assets/ })
      .getByRole('link', { name: asset.displayName })
      .click();
    await expect(page).toHaveURL(new RegExp(`selected=${asset.assetId}`));
    await expect(panel(page).getByRole('heading', { name: asset.displayName })).toBeVisible();
  });

  test('Set inactive from the panel updates the row; Edit opens the edit form and Cancel returns to the list with the asset selected', async ({
    page,
    seed,
  }) => {
    const token = uid();
    const matter = await seed.matter();
    const asset = await seed.asset(matter, `Editable ${token}`);
    await page.goto(`/assets?name=${token}&selected=${asset.assetId}`);
    await expect(panel(page).getByRole('heading', { name: asset.displayName })).toBeVisible();

    await panel(page).getByRole('button', { name: 'Edit' }).click();
    await expect(page).toHaveURL(new RegExp(`/assets/${asset.assetId}/edit$`));
    await page.getByRole('button', { name: 'Cancel' }).click();
    await expect(page).toHaveURL(new RegExp(`/assets\\?selected=${asset.assetId}$`));
    await expect(panel(page).getByRole('heading', { name: asset.displayName })).toBeVisible();

    await page.goto(`/assets?name=${token}&selected=${asset.assetId}`);
    await panel(page).getByRole('button', { name: 'Set inactive' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Set inactive' }).click();
    await expect(panel(page).getByText('This asset is inactive')).toBeVisible();
    await expect(
      page.locator(`tr[data-asset-id="${asset.assetId}"]`).getByText('Inactive'),
    ).toBeVisible();
  });

  test('the header and the filter row stay while the rows scroll, and a selection keeps the scroll position', async ({
    page,
    seed,
  }) => {
    await page.setViewportSize({ width: 1366, height: 768 });
    const token = uid();
    const matter = await seed.matter();
    for (let from = 0; from < 36; from += 6) {
      await Promise.all(
        Array.from({ length: 6 }, (_, i) =>
          seed.asset(matter, `Scroll ${token} ${from + i + 100}`),
        ),
      );
    }
    await page.goto(`/assets?name=${token}&size=50`);
    const grid = page.getByRole('region', { name: 'Assets list, scrollable' });
    const header = grid.locator('thead tr:first-child th').first();
    const filterRow = grid.locator('tr.mf-filter-row td').first();
    await expect(filterRow).toBeVisible();
    const before = { header: await header.boundingBox(), filter: await filterRow.boundingBox() };

    await grid.evaluate((e) => (e.scrollTop = 400));
    await expect.poll(() => grid.evaluate((e) => e.scrollTop)).toBeGreaterThan(300);
    const after = { header: await header.boundingBox(), filter: await filterRow.boundingBox() };
    expect(after.header!.y).toBeCloseTo(before.header!.y, 0);
    expect(after.filter!.y).toBeCloseTo(before.filter!.y, 0);
    // The filter row is right under the header row.
    expect(after.filter!.y).toBeCloseTo(after.header!.y + after.header!.height, 0);

    // Selecting a row further down neither jumps the grid to the top nor loses the row.
    const rows = grid.locator('tbody tr[data-asset-id]');
    const target = rows.nth(12);
    const name = (await target.locator('button.as-name').textContent())!.trim();
    await nameButton(page, name).click();
    await expect(panel(page).getByRole('heading', { name })).toBeVisible();
    await expect(target).toBeInViewport();
    expect(await grid.evaluate((e) => e.scrollTop)).toBeGreaterThan(0);
  });

  test('below the fixed-layout size the page scrolls normally and choosing a row brings the panel into view (375 px)', async ({
    page,
    seed,
  }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    const token = uid();
    const matter = await seed.matter();
    for (let from = 0; from < 20; from += 5) {
      await Promise.all(
        Array.from({ length: 5 }, (_, i) => seed.asset(matter, `Phone ${token} ${from + i + 100}`)),
      );
    }
    await page.goto(`/assets?name=${token}`);
    const last = page.locator('tbody tr[data-asset-id] button.as-name').last();
    await last.scrollIntoViewIfNeeded();
    const name = (await last.textContent())!.trim();
    await last.click();
    await expect(panel(page).getByRole('heading', { name })).toBeVisible();
    await expect(panel(page)).toBeInViewport();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
    const grid = (await page
      .getByRole('region', { name: 'Assets list, scrollable' })
      .boundingBox())!;
    const box = (await panel(page).boundingBox())!;
    expect(box.y).toBeGreaterThanOrEqual(grid.y + grid.height - 1);

    // Esc closes it and brings the row back.
    await page.keyboard.press('Escape');
    await expect(panel(page)).toHaveCount(0);
    await expect(last).toBeFocused();
  });
});
