import fs from 'node:fs';
import { Page } from '@playwright/test';
import { axeAvailable, axeViolations } from '../support/axe';
import { expect, test } from '../support/fixtures';
import { PmFixtures, pmFixtures } from '../support/pm-fixtures';
import { SIZES, noHorizontalScroll, shot } from '../support/screens';
import { Seeder, uid } from '../support/seed';

/**
 * PM v2, report lane (epic #851, issues #875 and #873): the asset report builder at /assets/reports. A project manager names a report,
 * picks an asset type, a measure and a group-by, runs it (a TABLE), draws it as a Pie or Bar, saves it, opens, renames and deletes it,
 * exports it as CSV; the units warning, the empty and error states, the four widths with axe, the keyboard-only flow and the permissions.
 * Screenshots: E2E_SCREENSHOTS=docs/ux/pm-v2-review/fixes/pv-asset-report-builder.
 */
test.describe('Asset report builder (PM v2)', () => {
  test.beforeEach(() => {
    expect(axeAvailable(), 'axe-core must be available (set E2E_AXE_PATH)').toBe(true);
  });

  interface Kit {
    fx: PmFixtures;
    token: string;
    workspace: { assetTypeId: number; name: string };
    production: { assetTypeId: number; name: string };
  }

  const kits = new WeakMap<Seeder, Promise<Kit>>();

  /** Two asset types (a size in GB and a count of Items), assets in matters pmA manages, one in a matter nobody manages. */
  function kit(seed: Seeder, personas: import('../support/personas').Personas): Promise<Kit> {
    let built = kits.get(seed);
    if (!built) {
      built = build(seed, personas);
      kits.set(seed, built);
    }
    return built;
  }

  async function build(
    seed: Seeder,
    personas: import('../support/personas').Personas,
  ): Promise<Kit> {
    const fx = await pmFixtures(seed, personas);
    const token = uid().slice(0, 6);
    const type = async (name: string, fields: import('../support/seed').FieldSpec[]) => {
      const created = await seed.admin.post('/api/v1/asset-types', {
        name,
        description: null,
        sortOrder: 6300,
      });
      const definition = await seed.admin.get(
        `/api/v1/forms/by-owner?ownerKind=AssetType&ownerId=${created.assetTypeId}`,
      );
      await seed.publishForm(definition.formDefinitionId, fields);
      return created;
    };
    const setSize = async (typeId: number, key: string, unit: string) => {
      const current = await seed.admin.get(`/api/v1/asset-types/${typeId}`);
      await seed.admin.put(`/api/v1/asset-types/${typeId}/size-field`, {
        sizeFieldKey: key,
        sizeUnit: unit,
        rowVersion: current.rowVersion,
      });
    };
    const workspace = await type(`Workspace ${token}`, [
      { key: 'size_gb', label: 'Size', control: 'NUMBER' },
      {
        key: 'platform',
        label: 'Platform',
        control: 'SELECT',
        options: [
          { key: 'prod', label: '=Prod' },
          { key: 'test', label: 'Test' },
        ],
      },
    ]);
    const production = await type(`Production ${token}`, [
      { key: 'pages', label: 'Pages', control: 'NUMBER' },
    ]);
    await setSize(workspace.assetTypeId, 'size_gb', 'GB');
    await setSize(production.assetTypeId, 'pages', 'Items');
    const make = (matterId: number, typeId: number, name: string, formValues: object) =>
      seed.admin.post('/api/v1/assets', {
        matterId,
        assetTypeId: typeId,
        displayName: `${name} ${token}`,
        formValues,
      });
    await make(fx.m.primary.matterId, workspace.assetTypeId, 'WS 1', {
      size_gb: 10,
      platform: 'prod',
    });
    await make(fx.m.primary.matterId, workspace.assetTypeId, 'WS 2', {
      size_gb: 20,
      platform: 'test',
    });
    await make(fx.m.both.matterId, workspace.assetTypeId, 'WS 3', {
      size_gb: 30,
      platform: 'prod',
    });
    await make(fx.m.both.matterId, production.assetTypeId, 'PR 1', { pages: 5000 });
    await make(fx.m.none1.matterId, workspace.assetTypeId, 'WS other', {
      size_gb: 999,
      platform: 'prod',
    });
    return {
      fx,
      token,
      workspace: { ...workspace, name: `Workspace ${token}` },
      production: { ...production, name: `Production ${token}` },
    };
  }

  /** Counts the person's interactions (clicks, choices, key presses that act); typing a name is not counted. */
  class Steps {
    n = 0;
    constructor(private readonly page: Page) {}
    async click(selector: string) {
      this.n++;
      await this.page.locator(selector).click();
    }
    async choose(selector: string, value: string) {
      this.n++;
      await this.page.locator(selector).selectOption(value);
    }
  }

  const resultRows = (page: Page) => page.locator('[data-result-table] [data-result-row]');
  const cells = async (page: Page, index: number) =>
    (await resultRows(page).nth(index).locator('th, td').allInnerTexts()).map((t) => t.trim());

  async function deleteAll(page: Page) {
    const response = await page.request.get('/api/v1/asset-reports');
    for (const r of await response.json())
      await page.request.delete(`/api/v1/asset-reports/${r.assetReportId}`, {
        headers: { 'X-MatterFlow-Client': 'web' },
      });
  }

  test('a project manager builds, runs, charts and saves a report in 8 steps or fewer; the table comes first and the chart has a graph field', async ({
    seed,
    personas,
    asUser,
  }) => {
    const k = await kit(seed, personas);
    const page = await asUser(k.fx.pmA.username);
    await page.goto('/assets/reports');
    await expect(page).toHaveTitle('Assets: Reports - MatterFlow');
    await expect(page.getByRole('heading', { level: 1, name: 'Asset reports' })).toBeVisible();
    await expect(page.locator('[data-result-idle]')).toBeVisible();

    const steps = new Steps(page);
    await page.locator('[data-name]').fill(`Data by platform ${k.token}`);
    await steps.choose('[data-type]', String(k.workspace.assetTypeId));
    await steps.click('[data-measure="sum"]');
    await expect(page.locator('[data-number-field]')).toHaveValue('size_gb');
    await steps.choose('[data-group]', 'field:platform');
    await steps.click('[data-run]');

    // The result is a table first: two groups and a total, nothing drawn yet.
    await expect(resultRows(page)).toHaveCount(2);
    expect(await cells(page, 0)).toEqual(['=Prod', '2', '40']);
    expect(await cells(page, 1)).toEqual(['Test', '1', '20']);
    await expect(page.locator('[data-result-total]')).toContainText('3');
    await expect(page.locator('[data-result-total]')).toContainText('60');
    await expect(page.locator('mf-pie-chart, mf-bar-chart')).toHaveCount(0);

    await steps.click('[data-show-pie]');
    await expect(page.locator('mf-pie-chart')).toBeVisible();
    await expect(page.getByLabel('Graph field')).toHaveValue('1');
    await steps.click('[data-save]');
    await expect(page.locator('[data-saved-item]')).toHaveCount(1);
    await expect(page.locator('[data-save]')).toHaveText('Save changes');
    expect(steps.n).toBeLessThanOrEqual(8);

    // The saved report opens from its link with the chart it was saved with, and runs again.
    const id = new URL(page.url()).searchParams.get('report');
    expect(id).toBeTruthy();
    await page.goto(`/assets/reports?report=${id}`);
    await expect(page.locator('mf-pie-chart')).toBeVisible();
    await expect(page.locator('[data-name]')).toHaveValue(`Data by platform ${k.token}`);
    await page.locator('[data-show-table]').click();
    await expect(resultRows(page)).toHaveCount(2);
    await deleteAll(page);
  });

  test('the graph field chooses the column the chart draws; Bar and the way back to the table', async ({
    seed,
    personas,
    asUser,
  }) => {
    const k = await kit(seed, personas);
    const page = await asUser(k.fx.pmA.username);
    await page.goto('/assets/reports');
    await page.locator('[data-type]').selectOption(String(k.workspace.assetTypeId));
    await page.locator('[data-measure="sum"]').click();
    await page.locator('[data-group]').selectOption('field:platform');
    await page.locator('[data-run]').click();
    await page.locator('[data-show-bar]').click();
    await expect(page.locator('mf-bar-chart')).toBeVisible();
    await expect(page.locator('mf-bar-chart')).toContainText('40');
    await page.getByLabel('Graph field').selectOption('0');
    await expect(page.locator('mf-bar-chart')).toContainText('2');
    await expect(page.locator('mf-bar-chart')).not.toContainText('40');
    await page.locator('[data-show-table]').click();
    await expect(page.locator('[data-result-table]')).toBeVisible();
    await expect(page.locator('[data-graph-field]')).toHaveCount(0);
  });

  test('Export CSV downloads the table as UTF-8 with a BOM, protects a label that starts with =, Copy as text is offered, and the export is audited', async ({
    seed,
    personas,
    asUser,
    admin,
  }) => {
    const k = await kit(seed, personas);
    const page = await asUser(k.fx.pmA.username);
    await page.goto('/assets/reports');
    await page.locator('[data-name]').fill('Platform & size');
    await page.locator('[data-type]').selectOption(String(k.workspace.assetTypeId));
    await page.locator('[data-measure="sum"]').click();
    await page.locator('[data-group]').selectOption('field:platform');
    await page.locator('[data-run]').click();
    await expect(resultRows(page)).toHaveCount(2);
    await page.locator('[data-export-menu] [data-overflow]').click();
    await expect(page.getByRole('menuitem', { name: 'Copy as text' })).toBeVisible();

    const download = page.waitForEvent('download');
    await page.getByRole('menuitem', { name: 'Download CSV' }).click();
    const file = await download;
    expect(file.suggestedFilename()).toMatch(/^Platform-size-\d{8}-\d{4}\.csv$/);
    const bytes = fs.readFileSync((await file.path())!);
    expect([...bytes.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    const lines = bytes.toString('utf8').slice(1).split('\r\n');
    expect(lines[0]).toBe('Platform,Assets,Sum of Size (GB)');
    expect(lines[1]).toBe("'=Prod,2,40");
    expect(lines[2]).toBe('Test,1,20');
    expect(lines[3]).toBe('Total,3,60');
    // The export is audited like the other lists (surface, rows, the settings; no data).
    await expect
      .poll(async () =>
        JSON.stringify(await admin.get('/api/v1/audit/search?eventType=EXPORT_RUN&pageSize=50')),
      )
      .toContain('Exported 2 rows of asset-report');
  });

  test('all asset types with a Sum mixes GB and Items: the units warning is shown clearly, with a column per unit', async ({
    seed,
    personas,
    asUser,
  }) => {
    const k = await kit(seed, personas);
    const page = await asUser(k.fx.pmA.username);
    await page.goto('/assets/reports');
    await page.locator('[data-measure="sum"]').click();
    await expect(page.locator('[data-default-size-note]')).toContainText('default size field');
    await page.locator('[data-group]').selectOption('assetType');
    await page.locator('[data-run]').click();
    const warning = page.locator('[data-units-warning]');
    await expect(warning).toBeVisible();
    await expect(warning).toContainText('Check the units');
    await expect(warning).toContainText('mixes units');
    await expect(page.locator('[data-result-table] thead th')).toContainText([
      'Asset type',
      'Assets',
      'Sum of Size (GB)',
      'Sum of Size (Items)',
    ]);
    await shot(page, 'pv-report-units');
  });

  test('empty, failed and slow runs say so; a failed save keeps the reason; a name is needed to save', async ({
    seed,
    personas,
    asUser,
  }) => {
    const k = await kit(seed, personas);
    const page = await asUser(k.fx.pmA.username);
    await page.goto('/assets/reports');

    // Empty: no disposed assets.
    await page.locator('[data-type]').selectOption(String(k.workspace.assetTypeId));
    await page.locator('[data-disposition]').selectOption('DISPOSED');
    await page.locator('[data-run]').click();
    await expect(page.locator('[data-result-empty]')).toContainText('No assets match this report');
    await expect(page.locator('[data-export-menu]')).toHaveCount(0);
    await shot(page, 'pv-report-empty');

    // Failed: the engine answers 500, then works.
    await page.route('**/api/v1/asset-reports/run', (route) =>
      route.fulfill({
        status: 500,
        contentType: 'application/problem+json',
        body: JSON.stringify({ title: 'Boom', status: 500, traceId: 'ref-123' }),
      }),
    );
    await page.locator('[data-run]').click();
    await expect(page.locator('[data-result-error]')).toBeVisible();
    await shot(page, 'pv-report-error');
    await page.unroute('**/api/v1/asset-reports/run');
    await page.locator('[data-run-retry]').click();
    await expect(page.locator('[data-result-empty]')).toBeVisible();

    // Slow: the loading line, then the result.
    await page.route('**/api/v1/asset-reports/run', async (route) => {
      await new Promise((r) => setTimeout(r, 1200));
      await route.continue();
    });
    await page.locator('[data-disposition]').selectOption('');
    await page.locator('[data-run]').click();
    await expect(page.locator('[data-result-loading]')).toBeVisible();
    await expect(resultRows(page).first()).toBeVisible();
    await page.unroute('**/api/v1/asset-reports/run');

    // Save needs a name.
    await page.locator('[data-save]').click();
    await expect(page.locator('[data-name-error]')).toContainText('Enter a name');
    await expect(page.locator('[data-name]')).toBeFocused();
  });

  test('saved reports are personal: rename and delete in the list, another person sees none, a missing id says so', async ({
    seed,
    personas,
    asUser,
  }) => {
    const k = await kit(seed, personas);
    const page = await asUser(k.fx.pmA.username);
    await deleteAll(page);
    await page.goto('/assets/reports');
    await expect(page.locator('[data-saved-empty]')).toBeVisible();
    await page.locator('[data-name]').fill('Original name');
    await page.locator('[data-save]').click();
    await expect(page.locator('[data-saved-item]')).toHaveCount(1);

    await page.getByRole('button', { name: 'Rename Original name' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.locator('[data-rename-input]').fill('Second name');
    await dialog.getByRole('button', { name: 'Rename', exact: true }).click();
    await expect(page.locator('[data-saved-open]')).toHaveText('Second name');
    await expect(page.locator('[data-name]')).toHaveValue('Second name');

    // Another person (also a project manager) sees none of it, and its id is a not-found notice.
    const id = new URL(page.url()).searchParams.get('report');
    const other = await asUser(k.fx.pmB.username);
    await other.goto(`/assets/reports?report=${id}`);
    await expect(other.locator('[data-saved-empty]')).toBeVisible();
    await expect(other.locator('[data-notice]')).toContainText('not found');

    await page.getByRole('button', { name: 'Delete Second name' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Delete', exact: true }).click();
    await expect(page.locator('[data-saved-empty]')).toBeVisible();
    await expect(page.locator('[data-name]')).toHaveValue('');
  });

  test('keyboard only: fields, Run, Pie, the graph field and Table are all reachable and work', async ({
    seed,
    personas,
    asUser,
  }) => {
    const k = await kit(seed, personas);
    const page = await asUser(k.fx.pmA.username);
    await page.goto('/assets/reports');
    const press = async (target: string) => {
      for (let i = 0; i < 40; i++) {
        if (await page.locator(target).evaluate((el) => el === document.activeElement)) return;
        await page.keyboard.press('Tab');
      }
      throw new Error(`could not reach ${target} with Tab`);
    };
    await press('[data-name]');
    await page.keyboard.type('Keyboard report');
    await press('[data-type]');
    await page.keyboard.type(k.workspace.name); // type-ahead picks the option
    await press('[data-run]');
    await page.keyboard.press('Enter');
    await expect(page.locator('[data-summary]')).toContainText('3 assets in 1 group');
    await press('[data-show-pie]');
    await page.keyboard.press('Enter');
    await expect(page.locator('mf-pie-chart')).toBeVisible();
    await press('[data-show-table]');
    await page.keyboard.press('Enter');
    await expect(page.locator('[data-result-table]')).toBeVisible();
  });

  test('every screen at the four widths: axe finds nothing and the page does not scroll sideways', async ({
    seed,
    personas,
    asUser,
  }) => {
    const k = await kit(seed, personas);
    const page = await asUser(k.fx.pmA.username);
    await deleteAll(page);
    await page.goto('/assets/reports');
    await page
      .locator('[data-name]')
      .fill(`A report with a rather long name to check wrapping ${k.token}`);
    await page.locator('[data-type]').selectOption(String(k.workspace.assetTypeId));
    await page.locator('[data-measure="sum"]').click();
    await page.locator('[data-group]').selectOption('field:platform');
    await page.locator('[data-run]').click();
    await expect(resultRows(page)).toHaveCount(2);
    await page.locator('[data-save]').click();
    await expect(page.locator('[data-saved-item]')).toHaveCount(1);

    const check = async (what: string) => {
      for (const size of SIZES) {
        await page.setViewportSize(size);
        const heading = page.getByRole('heading', { level: 1 });
        await expect(heading).toBeVisible();
        // The same scroll position at every size (the top), so axe measures the page and not a header laid over a button.
        await page.evaluate(() => {
          document.scrollingElement?.scrollTo(0, 0);
          document.querySelectorAll('main, #mf-main').forEach((el) => (el.scrollTop = 0));
        });
        expect(await axeViolations(page), `${what} at ${size.width}`).toEqual([]);
        await noHorizontalScroll(page);
        if (size.width === 1366 || size.width === 375) {
          await page
            .locator('[data-result]')
            .evaluate((el) => el.scrollIntoView({ block: 'start' }));
          await shot(page, `pv-report-${what}`);
        }
      }
    };
    await check('table');
    await page.locator('[data-show-pie]').click();
    await expect(page.locator('mf-pie-chart')).toBeVisible();
    await check('pie');
    await page.locator('[data-show-bar]').click();
    await expect(page.locator('mf-bar-chart')).toBeVisible();
    await check('bar');

    await page.getByRole('button', { name: /^Rename / }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await check('rename');
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);

    // The states: idle (new report), empty, error.
    await page.locator('[data-new-report]').click();
    await check('idle');
    await page.locator('[data-disposition]').selectOption('DISPOSED');
    await page.locator('[data-type]').selectOption(String(k.workspace.assetTypeId));
    await page.locator('[data-run]').click();
    await expect(page.locator('[data-result-empty]')).toBeVisible();
    await check('empty');
    await page.route('**/api/v1/asset-reports/run', (route) =>
      route.fulfill({
        status: 500,
        contentType: 'application/problem+json',
        body: JSON.stringify({ title: 'Boom', status: 500 }),
      }),
    );
    await page.locator('[data-run]').click();
    await expect(page.locator('[data-result-error]')).toBeVisible();
    await check('error');
    await page.unroute('**/api/v1/asset-reports/run');
    await deleteAll(page);
  });

  test('the Assets list links to the builder; the route needs Asset.View and stays out of the menu', async ({
    seed,
    personas,
    asUser,
  }) => {
    const k = await kit(seed, personas);
    const page = await asUser(k.fx.pmA.username);
    await page.goto('/assets');
    await page.locator('[data-build-report]').click();
    await expect(page).toHaveURL(/\/assets\/reports$/);
    await expect(
      page.getByRole('navigation', { name: /main|primary/i }).getByText('Reports', { exact: true }),
    ).toHaveCount(0);

    const nobody = await personas.create({ label: 'no-assets', permissions: ['Client.View'] });
    const denied = await asUser(nobody.username);
    await denied.goto('/assets/reports');
    await expect(denied.locator('[data-state-page]')).toBeVisible();
    await expect(denied.locator('[data-state-page]')).toContainText(/permission|access/i);
  });
});
