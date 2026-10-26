import { Page } from '@playwright/test';
import { Json } from '../support/api';
import { axeAvailable, axeViolations } from '../support/axe';
import { expect, test } from '../support/fixtures';
import { MmWorld, mmWorld } from '../support/my-matters-fixtures';
import { SIZES, noHorizontalScroll, shot } from '../support/screens';
import { uid } from '../support/seed';

/**
 * PM v2, Data tab (epic #851, issues #870 and #871): how much data the Project Manager's matters hold and in what state, the two warnings, the links to
 * the Assets list, the volume over time and the size override. Screenshots: E2E_SCREENSHOTS=docs/ux/pm-v2-review/fixes/pv-data-tab.
 */
interface DataWorld {
  w: MmWorld;
  token: string;
  type: Json;
  matterA: Json;
  matterB: Json;
  assets: Record<'a1' | 'a2' | 'a3' | 'b1', Json>;
}

test.describe('My Matters: Data tab (PM v2)', () => {
  test.beforeEach(() => {
    expect(axeAvailable(), 'axe-core must be available (set E2E_AXE_PATH)').toBe(true);
  });

  /**
   * Matter A: 10 GB Active, 5.5 GB Pending disposition, 4 GB Inactive and still linked to an open task. Matter B: 2 GB Active. All in GB, so the
   * numbers can be written down: 4 assets, 21.5 GB.
   */
  async function dataWorld(
    seed: import('../support/seed').Seeder,
    personas: import('../support/personas').Personas,
    label: string,
  ): Promise<DataWorld> {
    const admin = seed.admin;
    const w = await mmWorld(seed, personas, label);
    const token = uid().slice(0, 6);
    const type = await admin.post('/api/v1/asset-types', {
      name: `Workspace ${token}`,
      description: null,
    });
    const definition = await admin.get(
      `/api/v1/forms/by-owner?ownerKind=AssetType&ownerId=${type.assetTypeId}`,
    );
    await seed.publishForm(definition.formDefinitionId, [
      { key: 'size_gb', label: 'Size (GB)', control: 'NUMBER' },
      { key: 'docs', label: 'Documents', control: 'NUMBER' },
    ]);
    const current = await admin.get(`/api/v1/asset-types/${type.assetTypeId}`);
    await admin.put(`/api/v1/asset-types/${type.assetTypeId}/size-field`, {
      sizeFieldKey: 'size_gb',
      sizeUnit: 'GB',
      rowVersion: current.rowVersion,
    });
    const matterA = await w.matter(`Data A ${token}`);
    const matterB = await w.matter(`Data B ${token}`);
    const make = (matter: Json, name: string, size: number, docs: number) =>
      admin.post('/api/v1/assets', {
        matterId: matter.matterId,
        assetTypeId: type.assetTypeId,
        displayName: `${name} ${token}`,
        formValues: { size_gb: size, docs },
      });
    const a1 = await make(matterA, 'Alpha', 10, 1000);
    const a2 = await make(matterA, 'Bravo', 5.5, 500);
    const a3 = await make(matterA, 'Charlie', 4, 40);
    const b1 = await make(matterB, 'Delta', 2, 20);
    const move = async (asset: Json, code: string, note: string | null) => {
      const fresh = await admin.get(`/api/v1/assets/${asset.assetId}`);
      await admin.put(`/api/v1/assets/${asset.assetId}/disposition`, {
        dispositionCode: code,
        note,
        rowVersion: fresh.rowVersion,
      });
    };
    const task = await w.task(matterA);
    await admin.post(`/api/v1/tasks/${task.taskId}/assets`, { assetId: a3.assetId });
    await move(a2, 'PENDING_DISPOSITION', 'Matter wrapped up');
    await move(a3, 'INACTIVE', null);
    return { w, token, type, matterA, matterB, assets: { a1, a2, a3, b1 } };
  }

  const open = async (page: Page, query = '') => {
    await page.goto(`/my-matters?tab=data${query}`);
    await expect(page.locator('#mm-tab-data')).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('[data-panel="data"] [data-loading]')).toHaveCount(0);
    await expect(page.locator('[data-panel="data-volume"] [data-loading]')).toHaveCount(0);
  };

  test('shows the counts, sizes, warnings and the volume of my matters, and every number opens the Assets list with exactly those assets', async ({
    seed,
    personas,
    asUser,
  }) => {
    const d = await dataWorld(seed, personas, 'pvd1');
    const page = await asUser(d.w.pm.username);
    await page.setViewportSize({ width: 1366, height: 768 });
    await open(page);
    await expect(page).toHaveTitle('My Matters: Data - MatterFlow');
    await expect(page.getByRole('tab')).toContainText(['Overview', 'Deadlines', 'Data']);

    // Totals and warnings are words with a link, not colours.
    await expect(page.locator('[data-total-assets]')).toHaveText('4');
    await expect(page.locator('[data-total-size]')).toHaveText('21.5 GB');
    await expect(page.locator('[data-warning="inactive-linked"]')).toContainText(
      '1 asset is not active but still linked to open tasks.',
    );
    await expect(page.locator('[data-warning="awaiting-disposition"]')).toContainText(
      '1 asset waits for disposition (oldest 0 days).',
    );

    // A real table: caption, header scopes, a row per matter, the totals row.
    const table = page.locator('[data-matters-table]');
    await expect(table.locator('caption')).toBeAttached();
    await expect(table.locator('thead th[scope="col"]')).toHaveCount(7);
    const rowA = table.locator('[data-matter-row]', { hasText: d.matterA.matterRef });
    await expect(rowA.locator('td').nth(0)).toHaveText('3'); // assets
    await expect(rowA.locator('td').nth(1)).toHaveText('19.5 GB');
    await expect(rowA.locator('td').nth(2)).toHaveText('1'); // active
    await expect(rowA.locator('td').nth(3)).toHaveText('1'); // inactive
    await expect(rowA.locator('td').nth(4)).toHaveText('1'); // pending
    await expect(rowA.locator('td').nth(5)).toHaveText('0'); // disposed
    await expect(rowA.locator('td').nth(5).locator('a')).toHaveCount(0);
    await expect(page.locator('[data-matters-total] td').nth(1)).toHaveText('21.5 GB');
    await expect(page.locator('[data-types-table]')).toContainText(`Workspace ${d.token}`);
    await expect(page.locator('[data-types-table]')).toContainText('size_gb (GB)');

    // The warning "Show" opens the list of exactly the assets it counted, with the filter as a removable chip.
    await page.locator('[data-warning="inactive-linked"] a').click();
    await expect(page).toHaveURL(/\/assets\?/);
    await expect(page.locator('tbody tr[data-asset-id]')).toHaveCount(1);
    await expect(page.locator(`tr[data-asset-id="${d.assets.a3.assetId}"]`)).toBeVisible();
    await expect(page.getByText('still linked to open tasks').first()).toBeVisible();
    await page.goBack();
    await expect(page.locator('#mm-tab-data')).toHaveAttribute('aria-selected', 'true');

    // The pending count of matter A opens that matter's pending assets only.
    await open(page);
    await page
      .locator('[data-matter-row]', { hasText: d.matterA.matterRef })
      .getByRole('link', { name: /1 pending disposition asset on / })
      .click();
    await expect(page.locator('tbody tr[data-asset-id]')).toHaveCount(1);
    await expect(page.locator(`tr[data-asset-id="${d.assets.a2.assetId}"]`)).toBeVisible();

    // The Assets count of matter B opens every disposition of that matter.
    await open(page);
    await page
      .locator('[data-matter-row]', { hasText: d.matterB.matterRef })
      .getByRole('link', { name: /^1 asset on / })
      .click();
    await expect(page.locator('tbody tr[data-asset-id]')).toHaveCount(1);
    await expect(page.locator(`tr[data-asset-id="${d.assets.b1.assetId}"]`)).toBeVisible();
  });

  test('the volume over time is a chart with a table behind Show as table, states its limit, and ends on the size held', async ({
    seed,
    personas,
    asUser,
  }) => {
    const d = await dataWorld(seed, personas, 'pvd2');
    const page = await asUser(d.w.pm.username);
    await open(page);
    await expect(page.locator('[data-panel="data-volume"] mf-column-chart')).toBeVisible();
    await expect(page.locator('[data-column]')).toHaveCount(12);
    await expect(page.locator('[data-volume-limit]')).toContainText(
      'Derived from the month each asset was created',
    );
    await expect(page.locator('[data-columns-summary]')).toContainText('highest');

    await page.locator('[data-show-table]').click();
    await expect(page.locator('[data-show-table]')).toHaveAttribute('aria-pressed', 'true');
    const rows = page.locator('[data-volume-table] tbody tr');
    await expect(rows).toHaveCount(12);
    // This month holds everything the table above counts (nothing is disposed), so the last month agrees with the Data total.
    const last = rows.last().locator('td');
    await expect(last.nth(0)).toHaveText('4');
    await expect(last.nth(1)).toHaveText('21.5');
    await expect(last.nth(2)).toHaveText('21.5');
    await expect(last.nth(3)).toHaveText('0');
    // One matter narrows the line.
    await page
      .locator('[data-volume-matter]')
      .selectOption({ label: `${d.matterB.matterRef} ${d.matterB.name}` });
    await expect(rows.last().locator('td').nth(1)).toHaveText('2');
    await page.locator('[data-volume-months]').selectOption('24');
    await expect(rows).toHaveCount(24);
  });

  test('another number field of one asset type can be measured, once its unit is chosen, without being stored', async ({
    seed,
    personas,
    asUser,
    admin,
  }) => {
    const d = await dataWorld(seed, personas, 'pvd3');
    const page = await asUser(d.w.pm.username);
    await open(page);
    await page.locator('[data-data-type]').selectOption({ label: `Workspace ${d.token}` });
    await expect(page.locator('[data-total-size]')).toHaveText('21.5 GB');
    await page.locator('[data-data-field]').selectOption('docs');
    await expect(page.locator('[data-unit-needed]')).toBeVisible();
    await page.locator('[data-data-unit]').selectOption('Items');
    await expect(page.locator('[data-total-size]')).toHaveText('1,560 Items');
    await expect(page).toHaveURL(/dataField=docs/);
    // Not stored on the type.
    const type = await admin.get(`/api/v1/asset-types/${d.type.assetTypeId}`);
    expect(type.sizeFieldKey).toBe('size_gb');
    await page.reload();
    await expect(page.locator('[data-total-size]')).toHaveText('1,560 Items');
  });

  test('says so when the person manages no matter with assets, and the tab is absent without Asset.View', async ({
    personas,
    asUser,
  }) => {
    const none = await personas.create({
      label: 'pvd-none',
      permissions: ['Matter.BeManager', 'Matter.View', 'Task.View', 'Asset.View'],
    });
    const page = await asUser(none.username);
    await open(page);
    await expect(page.locator('[data-panel="data"] [data-empty]')).toContainText(
      'no assets on the matters you manage',
    );

    const noAssets = await personas.create({
      label: 'pvd-noassets',
      permissions: ['Matter.BeManager', 'Matter.View', 'Task.View'],
    });
    const other = await asUser(noAssets.username);
    await other.goto('/my-matters?tab=data');
    await expect(other.getByRole('tab', { name: 'Data' })).toHaveCount(0);
    await expect(other.locator('#mm-tab-overview')).toHaveAttribute('aria-selected', 'true');
  });

  test('a failing Data request is reported in its panel with Retry, and the rest of the page stays', async ({
    seed,
    personas,
    asUser,
  }) => {
    const d = await dataWorld(seed, personas, 'pvd4');
    const page = await asUser(d.w.pm.username);
    let fail = true;
    await page.route('**/api/v1/my-matters/data?**', (route) =>
      fail ? route.fulfill({ status: 500, body: '{}' }) : route.continue(),
    );
    await page.route('**/api/v1/my-matters/data', (route) =>
      fail ? route.fulfill({ status: 500, body: '{}' }) : route.continue(),
    );
    await page.goto('/my-matters?tab=data');
    await expect(page.locator('[data-panel="data"] [data-panel-error]')).toContainText(
      "Couldn't load data",
    );
    await expect(page.locator('[data-panel="data-volume"]')).toBeVisible();
    fail = false;
    await page.locator('[data-panel="data"] [data-panel-retry]').click();
    await expect(page.locator('[data-matters-table]')).toBeVisible();
  });

  test('axe finds nothing and nothing scrolls sideways at four sizes, as a table and as phone cards', async ({
    seed,
    personas,
    asUser,
  }) => {
    test.setTimeout(150_000);
    const d = await dataWorld(seed, personas, 'pvd5');
    const page = await asUser(d.w.pm.username);
    for (const size of SIZES) {
      await page.setViewportSize(size);
      await open(page);
      if (size.width < 640) {
        await expect(page.locator('[data-matter-cards]')).toBeVisible();
        await expect(page.locator('[data-matters-table]')).toHaveCount(0);
      } else {
        await expect(page.locator('[data-matters-table]')).toBeVisible();
      }
      expect(await axeViolations(page), `chart view at ${size.width}`).toEqual([]);
      await noHorizontalScroll(page);
      if (size.width === 1366 || size.width === 375) await shot(page, 'pv-data-tab');
      await page.locator('[data-show-table]').click();
      await expect(page.locator('[data-volume-table]')).toBeVisible();
      // The click above scrolled the page; axe flags a link under the sticky header as obscured, so the totals come back to the middle first.
      await page
        .locator('[data-total-assets]')
        .evaluate((e) => e.scrollIntoView({ block: 'center' }));
      expect(await axeViolations(page), `table view at ${size.width}`).toEqual([]);
      await noHorizontalScroll(page);
      if (size.width === 375) await shot(page, 'pv-data-tab-volume-table');
    }
  });
});
