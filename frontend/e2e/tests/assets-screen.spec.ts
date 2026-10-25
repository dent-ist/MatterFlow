import { Page } from '@playwright/test';
import { expect, test } from '../support/fixtures';
import { uid } from '../support/seed';

/**
 * The Assets list (docs/ux/assets-screen, filters part; the master-detail panel was replaced by the record page, docs/ux/assets-review):
 * inline column filters in a second header row, the Filters toggle above the grid, and a name that is a link to `/assets/:id`.
 */
test.describe('Assets list: column filters and the record page link', () => {
  const filter = (page: Page, column: string) =>
    page.getByRole('textbox', { name: `Filter by ${column}` });
  const filtersToggle = (page: Page) => page.getByRole('button', { name: /^Filters/ });
  const nameLink = (page: Page, name: string) => page.getByRole('link', { name, exact: true });

  async function openFilters(page: Page): Promise<void> {
    if ((await filtersToggle(page).getAttribute('aria-pressed')) !== 'true') {
      await filtersToggle(page).click();
    }
    await expect(filter(page, 'Name')).toBeVisible();
  }

  test('the Filters button in the page header shows the filter row, open on arrival, right under the headers, aligned to the columns, and is remembered', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1366, height: 768 });
    await page.goto('/assets');
    await expect(page.getByRole('heading', { name: 'Assets', level: 1 })).toBeVisible();
    await expect(page.getByRole('button', { name: 'New asset' })).toBeVisible();

    // No standalone filter boxes; the Filters button is in the page header (#499) and the row is open from 640 px.
    await expect(page.getByLabel('Name, type or external reference')).toHaveCount(0);
    await expect(filtersToggle(page)).toHaveAttribute('aria-pressed', 'true');
    await expect(filtersToggle(page)).toHaveAttribute('aria-expanded', 'true');
    await expect(filter(page, 'Name')).toBeVisible();
    const grid = page.getByRole('region', { name: 'Assets list, scrollable' });
    const toggleBox = (await filtersToggle(page).boundingBox())!;
    const gridBox = (await grid.boundingBox())!;
    expect(toggleBox.y + toggleBox.height).toBeLessThanOrEqual(gridBox.y + 1);

    const columns = ['Name', 'Type', 'Matter', 'External reference', 'Status'];
    const headers = grid.locator('thead tr:first-child th');
    // The admin sees Linked tasks (no filter of its own): the cell under it is empty, the other five columns have a control.
    await expect(headers).toHaveCount(6);
    const position = [0, 1, 2, 4, 5];
    const headerBottom = (await headers.first().boundingBox())!;
    for (let i = 0; i < columns.length; i++) {
      const th = (await headers.nth(position[i]).boundingBox())!;
      const control = (await grid
        .locator(
          `thead tr.mf-filter-row td:nth-child(${position[i] + 1}) :is(input, select, button)`,
        )
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
    await filtersToggle(page).click();
    await expect(filter(page, 'Name')).toHaveCount(0);
    await page.reload();
    await expect(filtersToggle(page)).toHaveAttribute('aria-pressed', 'false');
    await filtersToggle(page).click();
    await expect(filter(page, 'Name')).toBeVisible();
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
    const names = page.locator('tbody tr[data-asset-id] a.mf-name');

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
    await filtersToggle(page).click(); // open on arrival (#499); close it so the choice is remembered as closed
    await expect(filtersToggle(page)).toHaveAttribute('aria-pressed', 'false');
    await page.goto(`/assets?name=${encodeURIComponent(asset.displayName)}`);
    await expect(filter(page, 'Name')).toHaveValue(asset.displayName);
    await expect(filtersToggle(page)).toHaveAttribute('aria-pressed', 'true');
    await expect(filtersToggle(page)).toContainText('(1)');
    await expect(nameLink(page, asset.displayName)).toBeVisible();
  });

  test('clicking a name opens the record page with focus on its heading; Back returns to the same list view with the row focused', async ({
    page,
    seed,
  }) => {
    await page.setViewportSize({ width: 1366, height: 768 });
    const token = uid();
    const matter = await seed.matter({ name: `Detail Matter ${token}` });
    const first = await seed.asset(matter, `First ${token}`);
    const second = await seed.asset(matter, `Second ${token}`);
    await page.goto(`/assets?name=${token}&sort=-displayName&size=25`);
    await expect(nameLink(page, first.displayName)).toBeVisible();
    // The list keeps the whole height: there is no panel any more.
    await expect(page.getByRole('region', { name: 'Asset details' })).toHaveCount(0);

    await nameLink(page, second.displayName).click();
    await expect(page).toHaveURL(new RegExp(`/assets/${second.assetId}$`));
    await expect(page.getByRole('heading', { level: 1, name: second.displayName })).toBeFocused();

    await page.goBack();
    await expect(page).toHaveURL(new RegExp(`/assets\\?name=${token}&sort=-displayName`));
    await expect(filter(page, 'Name')).toHaveValue(token);
    await expect(nameLink(page, second.displayName)).toBeFocused();

    // The breadcrumb of the record page does the same.
    await nameLink(page, first.displayName).click();
    await page
      .getByRole('navigation', { name: 'Breadcrumb' })
      .getByRole('link', { name: 'Assets' })
      .click();
    await expect(page).toHaveURL(new RegExp(`/assets\\?name=${token}&sort=-displayName`));
    await expect(nameLink(page, first.displayName)).toBeFocused();
  });

  test('older addresses keep working: /assets/:id is the record page (also for an inactive asset), ?selected= redirects once, search opens the record page', async ({
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
    await expect(page.getByRole('heading', { level: 1, name: asset.displayName })).toBeVisible();

    await page.goto(`/assets/${old.assetId}`);
    await expect(page.getByRole('heading', { level: 1, name: old.displayName })).toBeVisible();
    await expect(page.getByText('This asset is inactive')).toBeVisible();

    // An older link keeps working and applies no filter to the list behind it.
    await page.goto(`/assets?selected=${asset.assetId}&status=all`);
    await expect(page).toHaveURL(new RegExp(`/assets/${asset.assetId}$`));
    await expect(page.getByRole('heading', { level: 1, name: asset.displayName })).toBeVisible();

    // From the header search.
    await page.goto('/dashboard');
    const box = page.getByRole('combobox', { name: 'Search clients, matters, tasks, assets' });
    await box.fill(asset.displayName);
    await box.press('Enter');
    await page
      .getByRole('region', { name: /^Assets/ })
      .getByRole('link', { name: asset.displayName })
      .click();
    await expect(page).toHaveURL(new RegExp(`/assets/${asset.assetId}$`));
    await expect(page.getByRole('heading', { level: 1, name: asset.displayName })).toBeVisible();
  });

  test('Edit opens the edit form and Cancel returns to the record page; Set inactive updates the page in place', async ({
    page,
    seed,
  }) => {
    const matter = await seed.matter();
    const asset = await seed.asset(matter, `Editable ${uid()}`);
    await page.goto(`/assets/${asset.assetId}`);
    await expect(page.getByRole('heading', { level: 1, name: asset.displayName })).toBeVisible();

    await page.getByRole('button', { name: 'Edit', exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/assets/${asset.assetId}/edit$`));
    await page.getByRole('button', { name: 'Cancel' }).click();
    await expect(page).toHaveURL(new RegExp(`/assets/${asset.assetId}$`));

    await page.getByRole('button', { name: 'More actions' }).click();
    await page.getByRole('menuitem', { name: 'Set inactive' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Set inactive' }).click();
    await expect(page.getByText('This asset is inactive')).toBeVisible();
    await expect(page.locator('[data-record-header]').getByText('Inactive')).toBeVisible();
  });

  test('the header and the filter row stay while the rows scroll', async ({ page, seed }) => {
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
  });

  test('the list does not scroll sideways at 375 px', async ({ page, seed }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    const token = uid();
    const matter = await seed.matter();
    for (let from = 0; from < 10; from += 5) {
      await Promise.all(
        Array.from({ length: 5 }, (_, i) => seed.asset(matter, `Phone ${token} ${from + i + 100}`)),
      );
    }
    await page.goto(`/assets?name=${token}`);
    await expect(page.locator('li.rc a').first()).toBeVisible(); // cards below 640 px (#502)
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });
});
