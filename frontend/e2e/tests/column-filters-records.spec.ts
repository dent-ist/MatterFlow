import { Page } from '@playwright/test';
import { axeAvailable, axeViolations } from '../support/axe';
import { expect, test } from '../support/fixtures';
import { Seeder, uid } from '../support/seed';

/**
 * Column filters on the record lists (epic #75, Batch 2, issue #77): Clients, Matters, Projects, the Client's Matters grid and the
 * Matter's Assets tab. The standalone search boxes and status selects are gone; the filter row is closed by default, URLs keep their
 * parameter names, and the headers and the row stay in every empty state.
 */
const toggle = (page: Page) => page.getByRole('button', { name: /^Filters/ });
const text = (page: Page, column: string) =>
  page.getByRole('textbox', { name: `Filter by ${column}` });
const select = (page: Page, column: string) =>
  page.getByRole('combobox', { name: `Filter by ${column}` });
const grid = (page: Page, name: string) =>
  page.getByRole('region', { name: `${name}, scrollable` });
const sheet = (page: Page) => page.getByRole('dialog', { name: 'Filters' });

test.describe('Column filters on the record lists', () => {
  test.describe('Clients', () => {
    test('the row is closed by default; Name and Client number filter the server list; Active is shown, not counted', async ({
      page,
      seed,
    }) => {
      await page.setViewportSize({ width: 1366, height: 768 });
      const token = uid();
      const a = await seed.client({ name: `Alpha ${token}` });
      const b = await seed.client({ name: `Beta ${token}` });
      await page.goto('/clients');
      const rows = grid(page, 'Clients list').locator('tbody tr');
      await expect(rows.first()).toBeVisible();
      // No standalone search box or status select, the row is closed, nothing is counted.
      await expect(page.getByRole('searchbox')).toHaveCount(0);
      await expect(page.locator('#client-search, #client-status')).toHaveCount(0);
      await expect(text(page, 'Name')).toHaveCount(0);
      await expect(toggle(page)).toHaveAttribute('aria-pressed', 'false');

      await toggle(page).click();
      await expect(select(page, 'Status')).toHaveValue('active');
      await expect(toggle(page)).toHaveText(/^\s*Filters\s*$/); // Active is a default: no count

      await text(page, 'Name').fill(token);
      await expect(page).toHaveURL(new RegExp(`name=${token}`));
      await expect(rows).toHaveCount(2);
      await expect(page.locator('[data-filter-live]')).toHaveText(/^\s*2 clients\u200b?\s*$/);
      await text(page, 'Name').fill(`alpha ${token}`); // case-insensitive
      await expect(rows).toHaveCount(1);
      await expect(rows.first()).toContainText(a.clientNumber);

      await text(page, 'Name').fill('');
      await text(page, 'Client number').fill(b.clientNumber);
      await expect(page).toHaveURL(/clientNumber=/);
      await expect(rows.filter({ hasText: `Beta ${token}` })).toHaveCount(1);
      await expect(toggle(page)).toContainText('(1)');
    });

    test('the filtered empty state keeps the headers and the filter row; Clear filters restores the list; chips with the row closed', async ({
      page,
    }) => {
      await page.setViewportSize({ width: 1366, height: 768 });
      await page.goto(`/clients?name=${uid()}-nothing`);
      const region = grid(page, 'Clients list');
      await expect(region.locator('td[data-empty="filtered"]')).toContainText(
        'No clients match these filters',
      );
      await expect(region.locator('thead th').first()).toBeVisible();
      await expect(text(page, 'Name')).toBeVisible(); // opened by the address
      await expect(page.locator('mf-pager')).toHaveCount(0);

      // Row closed: the same filter is a chip.
      await toggle(page).click();
      const chips = page.getByRole('list', { name: 'Active filters' });
      await expect(chips).toContainText('Name:');
      await region.getByRole('button', { name: 'Clear filters' }).click();
      await expect(page).not.toHaveURL(/name=/);
      await expect(region.locator('tbody tr').first()).toBeVisible();
      await expect(region.locator('td[data-empty]')).toHaveCount(0);
    });

    test('the status filter reaches inactive clients; "All" is a chip that goes back to the default', async ({
      page,
      seed,
      admin,
    }) => {
      await page.setViewportSize({ width: 1366, height: 768 });
      const token = uid();
      const client = await seed.client({ name: `Retired ${token}` });
      await admin.put(`/api/v1/clients/${client.clientId}`, {
        name: client.name,
        isActive: false,
        rowVersion: client.rowVersion,
      });
      await page.goto(`/clients?name=${token}`);
      const rows = grid(page, 'Clients list').locator('tbody tr');
      await expect(grid(page, 'Clients list').locator('td[data-empty="filtered"]')).toBeVisible();
      await select(page, 'Status').selectOption('inactive');
      await expect(page).toHaveURL(/status=inactive/);
      await expect(rows).toHaveCount(1);
      await select(page, 'Status').selectOption('all');
      await expect(rows).toHaveCount(1);
      await toggle(page).click();
      await page.getByRole('button', { name: 'Remove filter Status: All' }).click();
      await expect(page).not.toHaveURL(/status=/);
      await expect(grid(page, 'Clients list').locator('td[data-empty="filtered"]')).toBeVisible();
    });

    test('below 768 px the Filters button opens the sheet with the same controls', async ({
      page,
      seed,
    }) => {
      await page.setViewportSize({ width: 375, height: 812 });
      const token = uid();
      await seed.client({ name: `Phone ${token}` });
      await page.goto('/clients');
      await expect(grid(page, 'Clients list').locator('tbody tr').first()).toBeVisible();
      await toggle(page).click();
      await expect(sheet(page)).toBeVisible();
      for (const column of ['Client number', 'Name', 'Status']) {
        await expect(sheet(page).getByLabel(`Filter by ${column}`)).toBeVisible();
      }
      await sheet(page).getByLabel('Filter by Name').fill(`phone ${token}`);
      await expect(page).toHaveURL(/name=phone/);
      await sheet(page).getByRole('button', { name: 'Show 1 result' }).click();
      await expect(page.getByRole('list', { name: 'Active filters' })).toContainText('Name:');
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow).toBeLessThanOrEqual(0);
    });
  });

  test.describe('Matters', () => {
    async function seedMatters(seed: Seeder, token: string) {
      const alpha = await seed.client({ name: `Alpha ${token}` });
      const beta = await seed.client({ name: `Beta ${token}` });
      const merger = await seed.matter({ client: alpha, number: '00001', name: `Merger ${token}` });
      const audit = await seed.matter({
        client: alpha,
        number: '00002',
        name: `Audit ${token}`,
        sensitive: true,
      });
      const review = await seed.matter({ client: beta, number: '00001', name: `Review ${token}` });
      return { alpha, beta, merger, audit, review };
    }

    test('Matter reference, Name and Client are column filters; Sensitive lives under More filters', async ({
      page,
      seed,
    }) => {
      await page.setViewportSize({ width: 1366, height: 768 });
      const token = uid();
      const { alpha, merger, audit } = await seedMatters(seed, token);
      await page.goto(`/matters?name=${token}`);
      const rows = grid(page, 'Matters list').locator('tbody tr');
      await expect(page.getByRole('searchbox')).toHaveCount(0);
      await expect(rows).toHaveCount(3);

      await text(page, 'Client').fill(`alpha ${token}`);
      await expect(page).toHaveURL(/client=alpha/);
      await expect(rows).toHaveCount(2);
      await text(page, 'Client').fill(alpha.clientNumber);
      await expect(rows.filter({ hasText: `Merger ${token}` })).toHaveCount(1);
      await expect(rows.filter({ hasText: `Review ${token}` })).toHaveCount(0);
      await text(page, 'Client').fill('');

      // The typed pair finds the padded reference.
      const pair = `${alpha.clientNumber.replace(/^0+/, '')}-1`;
      await text(page, 'Matter reference').fill(pair);
      await expect(rows.filter({ hasText: merger.matterRef })).toHaveCount(1);
      await expect(rows.filter({ hasText: audit.matterRef })).toHaveCount(0);
      await text(page, 'Matter reference').fill('');

      // Sensitive has no column: More filters, then a chip when the row is closed.
      await expect(select(page, 'Sensitive')).toHaveCount(0);
      await page.getByRole('button', { name: 'More filters' }).click();
      await page.locator('[data-more-filter="isSensitive"]').click();
      await page.getByRole('combobox', { name: 'Filter by Sensitive' }).selectOption('true');
      await expect(page).toHaveURL(/isSensitive=true/);
      await expect(rows).toHaveCount(1);
      await expect(rows.first()).toContainText(`Audit ${token}`);
      await page.keyboard.press('Escape');
      await expect(page.getByRole('list', { name: 'Active filters' })).toContainText(
        'Sensitive: Yes',
      );
    });

    test('a link from a client keeps ?clientId= as a removable chip and the other filters work with it', async ({
      page,
      seed,
    }) => {
      await page.setViewportSize({ width: 1366, height: 768 });
      const token = uid();
      const { alpha } = await seedMatters(seed, token);
      await page.goto(`/matters?clientId=${alpha.clientId}`);
      const rows = grid(page, 'Matters list').locator('tbody tr');
      await expect(rows).toHaveCount(2);
      await toggle(page).click(); // closed: chips show the client
      const chip = page.getByRole('button', {
        name: `Remove filter Client: ${alpha.clientNumber} ${alpha.name}`,
      });
      await expect(chip).toBeVisible();
      await toggle(page).click();
      await text(page, 'Name').fill(`merger ${token}`);
      await expect(rows).toHaveCount(1);
      await chip.click();
      await expect(page).not.toHaveURL(/clientId=/);
      await expect(page).toHaveURL(/name=merger/);
    });

    test('an empty result keeps the headers and the row', async ({ page }) => {
      await page.setViewportSize({ width: 1366, height: 768 });
      await page.goto(`/matters?matterRef=99999-99999&client=${uid()}`);
      const region = grid(page, 'Matters list');
      await expect(region.locator('td[data-empty="filtered"]')).toContainText(
        'No matters match these filters',
      );
      await expect(region.locator('thead th').first()).toBeVisible();
      await expect(text(page, 'Matter reference')).toHaveValue('99999-99999');
    });
  });

  test.describe('Projects', () => {
    test('Name and Matter are column filters; the Status select calls inactive "Archived"; ?matterId= is a chip', async ({
      page,
      seed,
    }) => {
      await page.setViewportSize({ width: 1366, height: 768 });
      const token = uid();
      const client = await seed.client({ name: `Proj Client ${token}` });
      const matter = await seed.matter({ client, number: '00001', name: `Docket ${token}` });
      const other = await seed.matter({ client, number: '00002', name: `Ledger ${token}` });
      await seed.project(matter, `Phase One ${token}`);
      await seed.project(other, `Phase Two ${token}`);
      await page.goto(`/projects?name=${token}`);
      const rows = grid(page, 'Projects list').locator('tbody tr');
      await expect(page.getByRole('searchbox')).toHaveCount(0);
      await expect(rows).toHaveCount(2);
      await expect(select(page, 'Status').locator('option', { hasText: 'Archived' })).toHaveCount(
        1,
      );

      await text(page, 'Matter').fill(`docket ${token}`); // matter name
      await expect(rows).toHaveCount(1);
      await expect(rows.first()).toContainText(`Phase One ${token}`);
      await text(page, 'Matter').fill(other.matterRef); // matter reference
      await expect(rows.first()).toContainText(`Phase Two ${token}`);

      await page.goto(`/projects?matterId=${matter.matterId}`);
      await expect(rows).toHaveCount(1);
      await toggle(page).click();
      await expect(
        page.getByRole('button', {
          name: `Remove filter Matter: ${matter.matterRef} ${matter.name}`,
        }),
      ).toBeVisible();
    });
  });

  test.describe("Client's Matters", () => {
    test('the grid has the column filters in the client page, Create matter beside the Filters button, and keeps the headers when empty', async ({
      page,
      seed,
    }) => {
      await page.setViewportSize({ width: 1366, height: 768 });
      const token = uid();
      const client = await seed.client({ name: `CM Client ${token}` });
      await seed.matter({ client, number: '00001', name: `Alpha ${token}` });
      await seed.matter({ client, number: '00002', name: `Beta ${token}`, sensitive: true });
      await page.goto(`/clients/${client.clientId}?tab=matters`);
      const region = grid(page, 'Matters list');
      const rows = region.locator('tbody tr');
      await expect(rows).toHaveCount(2);
      await expect(page.locator('#client-matter-search, #client-matter-status')).toHaveCount(0);
      await expect(text(page, 'Name')).toHaveCount(0);
      await expect(page.getByRole('button', { name: 'Create matter' })).toBeVisible();

      await toggle(page).click();
      await expect(select(page, 'Status')).toHaveValue('active');
      await text(page, 'Name').fill(`beta ${token}`);
      await expect(page).toHaveURL(/name=beta/);
      await expect(rows).toHaveCount(1);
      await text(page, 'Matter').fill('00001');
      await expect(region.locator('td[data-empty="filtered"]')).toBeVisible();
      await expect(region.locator('thead th').first()).toBeVisible();
      await expect(text(page, 'Matter')).toBeVisible();
      await region.getByRole('button', { name: 'Clear filters' }).click();
      await expect(rows).toHaveCount(2);
    });
  });

  test.describe("Matter's Assets tab", () => {
    test('Name, Type (several), External reference and Status filter the tab through the address; leaving the tab drops them', async ({
      page,
      seed,
      admin,
    }) => {
      await page.setViewportSize({ width: 1366, height: 768 });
      const token = uid();
      const matter = await seed.matter({ name: `Assets Matter ${token}` });
      const typeA = await admin.post('/api/v1/asset-types', {
        name: `Kit A ${token}`,
        description: null,
      });
      const typeB = await admin.post('/api/v1/asset-types', {
        name: `Kit B ${token}`,
        description: null,
      });
      const create = (typeId: number, displayName: string, externalReference?: string) =>
        admin.post('/api/v1/assets', {
          matterId: matter.matterId,
          assetTypeId: typeId,
          displayName,
          externalReference,
        });
      await create(typeA.assetTypeId, `Laptop ${token}`, 'WS-1');
      await create(typeB.assetTypeId, `Server ${token}`, 'SRV-9');
      await create(await seed.assetTypeId(), `Phone ${token}`);

      await page.goto(`/matters/${matter.matterId}?tab=assets`);
      const region = grid(page, 'Assets list');
      const rows = region.locator('tbody tr');
      await expect(rows).toHaveCount(3);
      await expect(page.locator('#matter-asset-search, #matter-asset-status')).toHaveCount(0);
      await expect(text(page, 'Name')).toHaveCount(0);
      await toggle(page).click();

      await text(page, 'Name').fill(`laptop ${token}`);
      await expect(page).toHaveURL(/name=laptop/);
      await expect(page).toHaveURL(/tab=assets/);
      await expect(rows).toHaveCount(1);
      await text(page, 'Name').fill('');
      await text(page, 'External reference').fill('srv');
      await expect(page).toHaveURL(/extref=srv/);
      await expect(rows).toHaveCount(1);
      await expect(rows.first()).toContainText(`Server ${token}`);
      await text(page, 'External reference').fill('');

      // Type is a multi-select.
      await page.getByRole('button', { name: /^Filter by Type/ }).click();
      await page.getByRole('checkbox', { name: `Kit A ${token}` }).check();
      await page.getByRole('checkbox', { name: `Kit B ${token}` }).check();
      await page.getByRole('button', { name: 'Done' }).click();
      await expect(page).toHaveURL(/typeId=\d+&typeId=\d+/);
      await expect(rows).toHaveCount(2);
      await expect(rows.filter({ hasText: `Phone ${token}` })).toHaveCount(0);

      // The tab's filters belong to the tab.
      await page.getByRole('tab', { name: /^Projects/ }).click();
      await expect(page).toHaveURL(/tab=projects/);
      await expect(page).not.toHaveURL(/typeId=/);
      await page.getByRole('tab', { name: 'Assets' }).click();
      await expect(rows).toHaveCount(3);
    });

    test('the Assets screen takes several types too', async ({ page, seed, admin }) => {
      await page.setViewportSize({ width: 1366, height: 768 });
      const token = uid();
      const matter = await seed.matter({ name: `Multi Matter ${token}` });
      const typeA = await admin.post('/api/v1/asset-types', {
        name: `Kit A ${token}`,
        description: null,
      });
      const typeB = await admin.post('/api/v1/asset-types', {
        name: `Kit B ${token}`,
        description: null,
      });
      for (const [t, n] of [
        [typeA, 'One'],
        [typeB, 'Two'],
        [{ assetTypeId: await seed.assetTypeId() }, 'Three'],
      ] as const) {
        await admin.post('/api/v1/assets', {
          matterId: matter.matterId,
          assetTypeId: t.assetTypeId,
          displayName: `${n} ${token}`,
        });
      }
      await page.goto(
        `/assets?matter=${token}&typeId=${typeA.assetTypeId}&typeId=${typeB.assetTypeId}`,
      );
      await expect(page.locator('tbody tr[data-asset-id]')).toHaveCount(2);
      await expect(page.getByRole('button', { name: /^Filter by Type, 2 selected/ })).toBeVisible();
    });
  });

  test('axe: Clients, Matters, Projects, the Client page and the Matter page, row closed, open, filtered, and the sheet at 375 px', async ({
    page,
    seed,
  }) => {
    test.skip(!axeAvailable(), 'axe-core not installed (set E2E_AXE_PATH to axe.min.js)');
    test.setTimeout(300_000);
    const token = uid();
    const client = await seed.client({ name: `Axe Client ${token}` });
    const matter = await seed.matter({ client, number: '00001', name: `Axe Matter ${token}` });
    await seed.project(matter, `Axe Project ${token}`);
    await seed.asset(matter, `Axe Asset ${token}`);
    await page.setViewportSize({ width: 1366, height: 768 });

    for (const [url, region] of [
      ['/clients', 'Clients list'],
      ['/matters', 'Matters list'],
      ['/projects', 'Projects list'],
      [`/clients/${client.clientId}?tab=matters`, 'Matters list'],
      [`/matters/${matter.matterId}?tab=assets`, 'Assets list'],
    ] as const) {
      await page.goto(url);
      await expect(grid(page, region).locator('tbody tr').first()).toBeVisible();
      expect(await axeViolations(page), `${url} closed`).toEqual([]);
      await toggle(page).click();
      await expect(text(page, 'Name')).toBeVisible();
      expect(await axeViolations(page), `${url} open`).toEqual([]);
      await text(page, 'Name').fill(token);
      await text(page, 'Name').press('Enter');
      await expect(page).toHaveURL(/name=/);
      await expect(grid(page, region).locator('tbody tr').first()).toBeVisible();
      expect(await axeViolations(page), `${url} filtered`).toEqual([]);
      await text(page, 'Name').fill(`${token}-nothing`);
      await text(page, 'Name').press('Enter');
      await expect(grid(page, region).locator('td[data-empty="filtered"]')).toBeVisible();
      expect(await axeViolations(page), `${url} empty`).toEqual([]);
    }

    await page.setViewportSize({ width: 375, height: 812 });
    for (const url of ['/clients', '/matters', '/projects']) {
      await page.goto(url);
      await toggle(page).click();
      await expect(sheet(page)).toBeVisible();
      expect(await axeViolations(page), `${url} sheet`).toEqual([]);
    }
  });
});
