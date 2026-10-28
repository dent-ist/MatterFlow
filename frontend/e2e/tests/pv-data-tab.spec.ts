import { Page } from '@playwright/test';
import { Json } from '../support/api';
import { axeAvailable, axeViolations } from '../support/axe';
import { expect, test } from '../support/fixtures';
import { MmWorld, mmWorld } from '../support/my-matters-fixtures';
import { SIZES, noHorizontalScroll, shot } from '../support/screens';
import { Seeder, uid } from '../support/seed';

/**
 * The Data Area of My Matters (PM v2 epic #851; epic #893 issues #931, #932, #933): one selection bar (Matters, Asset types, Size fields, Period), headline tiles, the
 * selected asset types as a grid with a switch to a Bar and a Pie, the links to the Assets list, the volume over time when there is history and the size fields.
 * Screenshots: E2E_SCREENSHOTS=docs/ux/my-matters-calm/after.
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
    await expect(page.locator('[aria-busy="true"]')).toHaveCount(0);
  };

  const tile = (page: Page, key: string) => page.locator(`[data-tile="${key}"]`);

  test('shows the headline numbers as tiles, one warning line and a grid of the asset types, and every number opens the Assets list with exactly those assets', async ({
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

    // The tiles: the value first in every name, the unit once, a zero muted and not a button.
    await expect(page.getByRole('group', { name: '4 total assets' })).toBeVisible();
    await expect(page.getByRole('group', { name: '21.5 GB total size' })).toBeVisible();
    await expect(page.getByRole('button', { name: '2 active' })).toBeVisible();
    await expect(page.getByRole('button', { name: '1 inactive' })).toBeVisible();
    await expect(
      page.getByRole('button', { name: '1 pending disposition, oldest 0 days' }),
    ).toBeVisible();
    await expect(page.getByRole('group', { name: '0 disposed' })).toBeVisible();
    await expect(tile(page, 'disposed').locator('button')).toHaveCount(0);
    await expect(page.locator('[data-tiles] li')).toHaveCount(6);

    // The warning is one line with a link, not a colour.
    await expect(page.locator('[data-warning="inactive-linked"]')).toContainText(
      '1 asset is not active but still linked to open tasks.',
    );
    // No raw field name, no second table, no "Measured by" column.
    await expect(page.locator('[data-data-area]')).not.toContainText('size_gb');
    await expect(page.locator('[data-matters-table]')).toHaveCount(0);

    // A real table: caption, header scopes, one row for the asset type.
    const table = page.locator('[data-types-table]');
    await expect(table.locator('caption')).toBeAttached();
    await expect(table.locator('thead th[scope="col"]')).toHaveCount(7);
    const row = table.locator('[data-type-row]', { hasText: `Workspace ${d.token}` });
    await expect(row.locator('td').nth(0)).toHaveText('4'); // assets
    await expect(row.locator('td').nth(1)).toHaveText('21.5 GB');
    await expect(row.locator('td').nth(2)).toHaveText('2'); // active
    await expect(row.locator('td').nth(3)).toHaveText('1'); // inactive
    await expect(row.locator('td').nth(4)).toHaveText('1'); // pending
    await expect(row.locator('td').nth(5)).toHaveText('0'); // disposed
    await expect(row.locator('td').nth(5).locator('a')).toHaveCount(0);

    // The warning "Show" opens the list of exactly the assets it counted, with the filter as a removable chip.
    await page.locator('[data-warning="inactive-linked"] a').click();
    await expect(page).toHaveURL(/\/assets\?/);
    await expect(page.locator('tbody tr[data-asset-id]')).toHaveCount(1);
    await expect(page.locator(`tr[data-asset-id="${d.assets.a3.assetId}"]`)).toBeVisible();
    await page.goBack();
    await expect(page.locator('#mm-tab-data')).toHaveAttribute('aria-selected', 'true');

    // The pending count of the asset type opens its pending assets only.
    await open(page);
    await page
      .locator('[data-type-row]')
      .getByRole('link', { name: /1 pending disposition asset on / })
      .click();
    await expect(page.locator('tbody tr[data-asset-id]')).toHaveCount(1);
    await expect(page.locator(`tr[data-asset-id="${d.assets.a2.assetId}"]`)).toBeVisible();

    // The Assets count opens every disposition of the type.
    await open(page);
    await page
      .locator('[data-type-row]')
      .getByRole('link', { name: /^4 assets on / })
      .click();
    await expect(page.locator('tbody tr[data-asset-id]')).toHaveCount(4);

    // No history, no volume: all four assets were added this month.
    await open(page);
    await expect(page.locator('[data-panel="data-volume"]')).toHaveCount(0);
  });

  test('a tile filters the grid to its status, and a press on it again shows all', async ({
    seed,
    personas,
    asUser,
  }) => {
    const d = await dataWorld(seed, personas, 'pvd2');
    const page = await asUser(d.w.pm.username);
    await open(page);
    const pending = tile(page, 'pending').locator('button');
    await expect(pending).toHaveAttribute('aria-pressed', 'false');
    await pending.click();
    await expect(pending).toHaveAttribute('aria-pressed', 'true');
    await expect(page).toHaveURL(/dstatus=pending/);
    await expect(page.locator('[data-status-filter]')).toContainText(
      'Showing pending disposition assets only.',
    );
    await expect(page.locator('[data-types-table] thead th')).toHaveText([
      'Asset type',
      'Pending disposition',
      'Size',
    ]);
    const row = page.locator('[data-type-row]');
    await expect(row.locator('td').nth(0)).toHaveText('1');
    await expect(row.locator('td').nth(1)).toHaveText('5.5 GB'); // the size of the pending asset only
    await pending.click();
    await expect(page.locator('[data-status-filter]')).toHaveCount(0);
    await expect(page.locator('[data-types-table] thead th')).toHaveCount(7);
  });

  test('the selection bar narrows everything: matters, asset types, size fields and period, and is remembered for the person', async ({
    seed,
    personas,
    asUser,
    admin,
  }) => {
    const d = await dataWorld(seed, personas, 'pvd3');
    const page = await asUser(d.w.pm.username);
    await page.setViewportSize({ width: 1366, height: 768 });
    await open(page);

    // Matters: one matter. The totals follow, and with one matter the links stay exact.
    const matters = page.locator('[data-pick-matters]');
    await matters.locator('summary').click();
    await matters.getByLabel(new RegExp(d.matterB.name)).check();
    await expect(page).toHaveURL(/dm=\d+/);
    await expect(page.getByRole('group', { name: '1 total assets' })).toBeVisible();
    await expect(page.getByRole('group', { name: '2 GB total size' })).toBeVisible();
    await expect(matters.locator('summary')).toContainText(d.matterB.name);
    await expect(page.locator('[data-types-table] td a').first()).toBeVisible();
    // Both matters: the Assets list cannot show exactly those, so the numbers are plain text and the info point says why.
    await matters.getByLabel(new RegExp(d.matterA.name)).check();
    await expect(page.getByRole('group', { name: '4 total assets' })).toBeVisible();
    await expect(matters.locator('summary')).toContainText('2 matters');
    await expect(page.locator('[data-types-table] td a')).toHaveCount(0);
    await page.keyboard.press('Escape');
    await page.locator('[data-how]').click();
    await expect(page.locator('[data-info-links]')).toContainText('do not open the Assets list');
    await page.locator('[data-how]').click();

    // Remembered: the address is bare, and the choice comes back (the browser's copy at once, the server's for another workstation).
    await page.goto('/my-matters?tab=data');
    await expect(page.locator('[data-pick-matters] summary')).toContainText('2 matters');
    // Asset type: a type that holds nothing leaves nothing.
    const other = await admin.post('/api/v1/asset-types', {
      name: `Empty ${d.token}`,
      description: null,
    });
    await page.reload();
    const types = page.locator('[data-pick-types]');
    await types.locator('summary').click();
    await types.getByLabel(`Empty ${d.token}`).check();
    await expect(page.locator('[data-no-match]')).toContainText('No assets match this selection');
    await page.locator('[data-clear-selection]').click();
    await expect(page.getByRole('group', { name: '4 total assets' })).toBeVisible();
    expect(other.assetTypeId).toBeGreaterThan(0);

    // Period: a custom range in the past holds nothing; the ready periods are counted from today.
    const period = page.locator('[data-data-period]');
    await period.selectOption('custom');
    await page.locator('[data-data-from]').fill('2000-01-01');
    await page.locator('[data-data-to]').fill('2000-01-31');
    await expect(page.locator('[data-no-match]')).toBeVisible();
    await period.selectOption('30d');
    await expect(page.getByRole('group', { name: '4 total assets' })).toBeVisible();

    // Size fields: another number field needs its unit; it is not stored on the asset type.
    const sizes = page.locator('[data-pick-sizes]');
    await sizes.locator('summary').click();
    await sizes.locator(`[data-size-field="${d.type.assetTypeId}:docs"]`).check();
    await sizes.locator(`[data-size-unit="${d.type.assetTypeId}:docs"]`).selectOption('Items');
    await expect(
      page
        .getByRole('group', { name: /^1,560 Items total size/ })
        .or(page.getByRole('group', { name: /1,560 total size in items/i })),
    ).toBeVisible();
    await expect(page).toHaveURL(/ds=/);
    const type = await admin.get(`/api/v1/asset-types/${d.type.assetTypeId}`);
    expect(type.sizeFieldKey).toBe('size_gb');
    // Ticking the default field as well measures both: GB and Items stay apart, two tiles.
    await sizes.locator(`[data-size-field="${d.type.assetTypeId}:size_gb"]`).check();
    await expect(page.getByRole('group', { name: '21.5 total size in gb' })).toBeVisible();
    await expect(page.getByRole('group', { name: '1,560 total size in items' })).toBeVisible();
  });

  test('the same data as a Bar and as a Pie from the shared charts, with the table behind them', async ({
    seed,
    personas,
    asUser,
  }) => {
    const d = await dataWorld(seed, personas, 'pvd4');
    const page = await asUser(d.w.pm.username);
    await open(page);
    const toggle = page.getByRole('group', { name: 'Show the result as' });
    await expect(toggle.getByRole('button')).toHaveText(['Table', 'Bar', 'Pie']);
    await expect(page.locator('[data-show-table]')).toHaveAttribute('aria-pressed', 'true');
    await page.locator('[data-show-bar]').click();
    await expect(page).toHaveURL(/dv=bar/);
    await expect(page.locator('mf-bar-chart')).toBeVisible();
    await expect(page.locator('[data-types-table]')).toHaveCount(0);
    await expect(page.locator('[data-measure="GB"]')).toBeVisible();
    await page.locator('[data-measure="GB"]').click();
    await expect(page.locator('mf-bar-chart')).toContainText('GB');
    await page.locator('[data-show-pie]').click();
    await expect(page.locator('mf-pie-chart')).toBeVisible();
    // A change of selection keeps the chart.
    await page.locator('[data-data-period]').selectOption('30d');
    await expect(page.locator('mf-pie-chart')).toBeVisible();
    await page.reload();
    await expect(page.locator('mf-pie-chart')).toBeVisible();
    await page.locator('[data-show-table]').click();
    await expect(page.locator('[data-types-table]')).toBeVisible();
  });

  test('the volume over time appears only when assets were added over at least three months', async ({
    seed,
    personas,
    asUser,
  }) => {
    test.skip(!Seeder.canWriteLegacyText(), 'needs the SQL container of run-local.sh');
    const d = await dataWorld(seed, personas, 'pvd5');
    const ids = [d.assets.a1, d.assets.a2, d.assets.a3].map((a) => a.assetId);
    ids.forEach((id, i) =>
      seed.sql(
        `DISABLE TRIGGER dbo.TR_Asset_Guard ON dbo.Asset; UPDATE dbo.Asset SET CreatedAtUtc = DATEADD(MONTH, -${i + 1}, SYSUTCDATETIME()) WHERE AssetId = ${id}; ENABLE TRIGGER dbo.TR_Asset_Guard ON dbo.Asset;`,
      ),
    );
    const page = await asUser(d.w.pm.username);
    await page.goto('/my-matters?tab=data');
    const panel = page.locator('[data-panel="data-volume"]');
    await expect(panel).toBeVisible();
    await expect(panel.locator('mf-column-chart')).toBeVisible();
    await expect(panel.locator('[data-column]')).toHaveCount(24);
    await expect(panel.locator('[data-volume-limit]')).toHaveCount(0);
    await page.locator('[data-how]').click();
    await expect(page.locator('[data-info-volume]')).toContainText(
      'Derived from the month each asset was created',
    );
    await panel.locator('[data-volume-as-table]').click();
    const rows = panel.locator('[data-volume-table] tbody tr');
    await expect(rows).toHaveCount(24);
    // The last month holds everything the tiles count (nothing is disposed).
    const last = rows.last().locator('td');
    await expect(last.nth(0)).toHaveText('4');
    await expect(last.nth(1)).toHaveText('21.5');
    // One matter narrows the line with the rest of the Data Area.
    const matters = page.locator('[data-pick-matters]');
    await matters.locator('summary').click();
    await matters.getByLabel(new RegExp(d.matterB.name)).check();
    await expect(page.getByRole('group', { name: '1 total assets' })).toBeVisible();
    // One asset of matter B is one month of additions: the history is too short now.
    await expect(page.locator('[data-panel="data-volume"]')).toHaveCount(0);
  });

  test('a matter the person may not see is not counted even when its id is in the address, and is not named', async ({
    seed,
    personas,
    asUser,
  }) => {
    const d = await dataWorld(seed, personas, 'pvd6');
    const outsider = await personas.create({
      label: 'pvd-outsider',
      permissions: ['Matter.BeManager', 'Matter.View', 'Task.View', 'Asset.View'],
    });
    const page = await asUser(outsider.username);
    await page.goto(`/my-matters?tab=data&dm=${d.matterA.matterId},${d.matterB.matterId}&dp=all`);
    await expect(page.locator('#mm-tab-data')).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('[data-no-match]')).toContainText('No assets match this selection');
    await expect(page.locator('[data-panel="data"]')).not.toContainText(d.matterA.name);
    await expect(page.locator('[data-panel="data"]')).not.toContainText(d.token);
    await expect(page.getByRole('group', { name: /total assets/ })).toHaveCount(0);
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
    const d = await dataWorld(seed, personas, 'pvd7');
    const page = await asUser(d.w.pm.username);
    let fail = true;
    await page.route(/\/api\/v1\/my-matters\/data(\?.*)?$/, (route) =>
      fail ? route.fulfill({ status: 500, body: '{}' }) : route.continue(),
    );
    await page.goto('/my-matters?tab=data');
    await expect(page.locator('[data-panel="data"] [data-panel-error]')).toContainText(
      "Couldn't load data",
    );
    await expect(page.locator('#mm-tab-data')).toBeVisible();
    fail = false;
    await page.locator('[data-panel="data"] [data-panel-retry]').click();
    await expect(page.locator('[data-types-table]')).toBeVisible();
  });

  test('axe finds nothing and nothing scrolls sideways at four sizes: the grid, the cards on a phone, the charts and an open picker', async ({
    seed,
    personas,
    asUser,
  }) => {
    test.setTimeout(180_000);
    const d = await dataWorld(seed, personas, 'pvd8');
    const page = await asUser(d.w.pm.username);
    for (const size of SIZES) {
      await page.setViewportSize(size);
      await open(page);
      if (size.width < 640) {
        await expect(page.locator('[data-type-cards]')).toBeVisible();
        await expect(page.locator('[data-types-table]')).toHaveCount(0);
      } else {
        await expect(page.locator('[data-types-table]')).toBeVisible();
      }
      expect(await axeViolations(page), `grid at ${size.width}`).toEqual([]);
      await noHorizontalScroll(page);
      if (size.width === 1366 || size.width === 375 || size.width === 768 || size.width === 1920)
        await shot(page, 'pm1-data');

      // The charts, the table behind them, and the info point.
      await page.locator('[data-show-bar]').click();
      await expect(page.locator('mf-bar-chart')).toBeVisible();
      expect(await axeViolations(page), `bar at ${size.width}`).toEqual([]);
      await page.locator('[data-show-pie]').click();
      await expect(page.locator('mf-pie-chart')).toBeVisible();
      expect(await axeViolations(page), `pie at ${size.width}`).toEqual([]);
      await noHorizontalScroll(page);
      await page.locator('[data-show-table]').click();
      await page.locator('[data-how]').click();
      await expect(page.locator('[data-info]')).toBeVisible();
      expect(await axeViolations(page), `info at ${size.width}`).toEqual([]);
      await page.locator('[data-how]').click();

      // A picker open.
      const matters = page.locator('[data-pick-matters]');
      await matters.locator('summary').click();
      await expect(matters.getByLabel(new RegExp(d.matterA.name))).toBeVisible();
      expect(await axeViolations(page), `matter picker at ${size.width}`).toEqual([]);
      await noHorizontalScroll(page);
      await page.keyboard.press('Escape');
    }
  });
});
