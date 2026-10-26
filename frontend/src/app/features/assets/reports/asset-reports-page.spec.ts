import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';
import {
  AssetReportFieldsResponse,
  AssetReportResponse,
  AssetReportResult,
  AssetReportRunClient,
  AssetReportsClient,
  AssetTypesClient,
} from '../../../api/generated/api-client';
import { AuthStore } from '../../../core/auth/auth.store';
import { Permission } from '../../../core/auth/permissions';
import { ExportService } from '../../../shared/ui/export.service';
import { anAssetType, pageOfAssetTypes } from '../../../shared/testing/asset-testing';
import {
  FakeMeApi,
  apiError,
  ok,
  provideFakeMe,
  settle,
  withPermissions,
} from '../../../shared/testing/org-testing';
import { AssetReportsPage } from './asset-reports-page';

type Mock = ReturnType<typeof vi.fn>;

const fields = (over: Partial<AssetReportFieldsResponse> = {}): AssetReportFieldsResponse => ({
  measures: ['count', 'sum', 'average'],
  numberFields: [
    { key: 'size_gb', label: 'Size', isDefaultSize: true, unit: 'GB' },
    { key: 'pages', label: 'Pages', isDefaultSize: false, unit: undefined },
  ],
  groupBy: [
    { key: 'disposition', label: 'Disposition' },
    { key: 'matter', label: 'Matter' },
    { key: 'field:platform', label: 'Platform' },
  ],
  units: ['B', 'GB', 'Items'],
  defaultSizeFieldKey: 'size_gb',
  defaultSizeUnit: 'GB',
  ...over,
});

const countResult = (over: Partial<AssetReportResult> = {}): AssetReportResult => ({
  measure: 'count',
  groupBy: 'disposition',
  groupByLabel: 'Disposition',
  assetTypeId: undefined,
  assetTypeName: undefined,
  columns: [{ key: 'count', label: 'Assets', unit: undefined }],
  rows: [
    { key: 'ACTIVE', label: 'Active', cells: [12] },
    { key: 'DISPOSED', label: 'Disposed', cells: [3] },
  ],
  totals: { key: '', label: 'Total', cells: [15] },
  hiddenGroups: 0,
  unitsWarning: undefined,
  assets: 15,
  ...over,
});

const sumResult = (over: Partial<AssetReportResult> = {}): AssetReportResult =>
  countResult({
    measure: 'sum',
    assetTypeId: 4,
    assetTypeName: 'Document Set',
    columns: [
      { key: 'count', label: 'Assets', unit: undefined },
      { key: 'sum:GB', label: 'Sum of Size (GB)', unit: 'GB' },
    ],
    rows: [
      { key: 'ACTIVE', label: 'Active', cells: [12, 412] },
      { key: 'DISPOSED', label: 'Disposed', cells: [3, 88.5] },
    ],
    totals: { key: '', label: 'Total', cells: [15, 500.5] },
    ...over,
  });

const saved = (id: number, name: string): AssetReportResponse => ({
  assetReportId: id,
  name,
  definition: { v: 1, measure: 'count', groupBy: 'disposition', scope: 'mine', chart: 'bar' },
  isSupported: true,
  rowVersion: 'AAAA',
  createdAtUtc: '2026-10-20T12:00:00Z',
  modifiedAtUtc: undefined,
});

describe('AssetReportsPage', () => {
  let fixture: ComponentFixture<AssetReportsPage>;
  let reports: Record<string, Mock>;
  let run: Record<string, Mock>;
  let exportsLog: Mock;
  const el = (): HTMLElement => fixture.nativeElement;
  const q = <T extends HTMLElement>(sel: string): T => el().querySelector<T>(sel)!;

  async function create(permissions: Permission[] = ['Asset.View', 'Matter.BeManager']) {
    reports = {
      listAssetReports: vi.fn().mockReturnValue(ok([saved(7, 'Data by disposition')])),
      getAssetReportFields: vi.fn().mockReturnValue(ok(fields())),
      createAssetReport: vi
        .fn()
        .mockImplementation((b) => ok({ ...saved(8, b.name), definition: b.definition })),
      updateAssetReport: vi
        .fn()
        .mockImplementation((id, b) => ok({ ...saved(id, b.name), definition: b.definition })),
      deleteAssetReport: vi.fn().mockReturnValue(of(undefined)),
    };
    exportsLog = vi.fn().mockResolvedValue(undefined);
    run = {
      runAssetReport: vi.fn().mockReturnValue(ok(countResult())),
      runSavedAssetReport: vi.fn().mockReturnValue(ok(countResult())),
    };
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        provideFakeMe(new FakeMeApi(withPermissions(...permissions))),
        {
          provide: AssetTypesClient,
          useValue: {
            listAssetTypes: vi
              .fn()
              .mockReturnValue(
                ok(
                  pageOfAssetTypes(
                    anAssetType(),
                    anAssetType({ assetTypeId: 5, name: 'Production' }),
                  ),
                ),
              ),
          },
        },
        { provide: AssetReportsClient, useValue: reports },
        { provide: AssetReportRunClient, useValue: run },
        { provide: ExportService, useValue: { log: exportsLog } },
      ],
    });
    await TestBed.inject(AuthStore).ensureLoaded();
    fixture = TestBed.createComponent(AssetReportsPage);
    await settle(fixture);
  }

  const click_ = async (sel: string) => {
    q(sel).click();
    await settle(fixture);
  };
  const choose = async (sel: string, value: string) => {
    const select = q<HTMLSelectElement>(sel);
    select.value = value;
    select.dispatchEvent(new Event('change'));
    await settle(fixture);
  };

  it('shows the define form, an idle result and the saved reports', async () => {
    await create();
    expect(q('h1').textContent).toContain('Asset reports');
    expect(q('[data-result-idle]')).toBeTruthy();
    expect(el().querySelectorAll('[data-saved-item]')).toHaveLength(1);
    expect(q<HTMLSelectElement>('[data-type]').options.length).toBe(3);
    expect(q('[data-number-field]')).toBeNull();
  });

  it('runs a count and shows the result as a table with a total row, before any chart', async () => {
    await create();
    await click_('[data-run]');
    expect(run['runAssetReport']).toHaveBeenCalledWith(
      expect.objectContaining({ measure: 'count', groupBy: 'disposition', scope: 'mine' }),
    );
    const rows = el().querySelectorAll('[data-result-row]');
    expect(rows).toHaveLength(2);
    expect(q('[data-result-total]').textContent).toContain('15');
    expect(el().querySelector('mf-pie-chart, mf-bar-chart')).toBeNull();
  });

  it('a sum for a type asks for its number field, adds a measure column and offers the unit only for a non-default field', async () => {
    await create();
    await choose('[data-type]', '4');
    expect(reports['getAssetReportFields']).toHaveBeenLastCalledWith(4);
    await click_('[data-measure="sum"]');
    expect(q<HTMLSelectElement>('[data-number-field]').value).toBe('size_gb');
    expect(q('[data-number-unit]')).toBeNull();
    await choose('[data-number-field]', 'pages');
    expect(q('[data-number-unit]')).toBeTruthy();
    await click_('[data-run]');
    expect(run['runAssetReport']).not.toHaveBeenCalled();
    expect(q('[data-number-unit]').getAttribute('aria-invalid')).toBe('true');
    await choose('[data-number-unit]', 'Items');
    run['runAssetReport'].mockReturnValue(ok(sumResult()));
    await click_('[data-run]');
    expect(run['runAssetReport']).toHaveBeenCalledWith(
      expect.objectContaining({
        assetTypeId: 4,
        measure: 'sum',
        numberField: 'pages',
        numberUnit: 'Items',
      }),
    );
    expect(el().querySelectorAll('[data-result-table] thead th')).toHaveLength(3);
  });

  it('shows the units warning of the engine clearly', async () => {
    await create();
    run['runAssetReport'].mockReturnValue(
      ok(sumResult({ unitsWarning: 'This result mixes units: GB (Doc) and Items (Prod).' })),
    );
    await click_('[data-run]');
    expect(q('[data-units-warning]').textContent).toContain('Check the units');
    expect(q('[data-units-warning]').textContent).toContain('mixes units');
  });

  it('draws a pie or bar on request, chooses the graph field, and Table brings the result table back', async () => {
    await create();
    run['runAssetReport'].mockReturnValue(ok(sumResult()));
    await click_('[data-run]');
    expect(q('[data-graph-field]')).toBeNull();
    await click_('[data-show-pie]');
    expect(el().querySelector('mf-pie-chart')).toBeTruthy();
    const graph = q<HTMLSelectElement>('[data-graph-field]');
    expect(graph.options.length).toBe(2);
    expect(graph.labels?.[0].textContent).toContain('Graph field');
    expect(graph.value).toBe('1');
    expect(q('mf-chart-panel').textContent).toContain('412');
    await choose('[data-graph-field]', '0');
    expect(q('mf-chart-panel').textContent).toContain('12 assets');
    await click_('[data-show-bar]');
    expect(el().querySelector('mf-bar-chart')).toBeTruthy();
    await click_('[data-show-table]');
    expect(q('[data-result-table]')).toBeTruthy();
    expect(q('[data-graph-field]')).toBeNull();
  });

  it('says so when the result has no groups', async () => {
    await create();
    run['runAssetReport'].mockReturnValue(
      ok(countResult({ rows: [], totals: { key: '', label: 'Total', cells: [0] }, assets: 0 })),
    );
    await click_('[data-run]');
    expect(q('[data-result-empty]')).toBeTruthy();
    expect(q('[data-export-csv]')).toBeNull();
  });

  it('shows a failed run with a way to try again, and the cut-off note for hidden groups', async () => {
    await create();
    run['runAssetReport'].mockReturnValue(
      apiError(409, { code: 'REPORT_TIMEOUT', detail: 'The report took longer than 10 seconds.' }),
    );
    await click_('[data-run]');
    expect(q('[data-result-error]').textContent).toContain('took longer than 10 seconds');
    run['runAssetReport'].mockReturnValue(ok(countResult({ hiddenGroups: 7 })));
    await click_('[data-run-retry]');
    expect(q('[data-hidden-groups]').textContent).toContain('7 more groups are hidden');
  });

  it('says the result is out of date once a setting changes', async () => {
    await create();
    await click_('[data-run]');
    await choose('[data-group]', 'matter');
    expect(q('[data-stale]')).toBeTruthy();
  });

  it('exports the table on screen from the shared Export menu: a CSV file with the BOM, and the export is logged without data', async () => {
    await create();
    let blob: Blob | undefined;
    let fileName = '';
    URL.createObjectURL = vi.fn((b: Blob) => ((blob = b), 'blob:report'));
    URL.revokeObjectURL = vi.fn();
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      fileName = this.download;
    });
    await click_('[data-run]');
    expect(el().querySelector('[data-export-menu] [data-overflow]')).toBeTruthy();
    await click_('[data-export-menu] [data-overflow]');
    const item = Array.from(el().querySelectorAll<HTMLButtonElement>('[role=menuitem]')).find((b) =>
      b.textContent?.includes('Download CSV'),
    )!;
    item.click();
    await settle(fixture);
    click.mockRestore();
    expect(fileName).toMatch(/^asset-report-\d{8}-\d{4}\.csv$/);
    const bytes = new Uint8Array(await blob!.arrayBuffer());
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    const text = await blob!.text();
    expect(text).toContain('Active,12');
    expect(exportsLog).toHaveBeenCalledWith(
      'asset-report',
      'csv',
      2,
      expect.stringContaining('scope mine'),
    );
    expect(exportsLog.mock.calls[0][3]).not.toContain('Active');
  });

  it('needs a name to save, then creates the report and keeps it open for the next save', async () => {
    await create();
    await click_('[data-save]');
    expect(q('[data-name-error]')).toBeTruthy();
    expect(reports['createAssetReport']).not.toHaveBeenCalled();
    const name = q<HTMLInputElement>('[data-name]');
    name.value = 'My report';
    name.dispatchEvent(new Event('input'));
    await click_('[data-save]');
    expect(reports['createAssetReport']).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'My report' }),
    );
    expect(q('[data-save]').textContent).toContain('Save changes');
    await click_('[data-save]');
    expect(reports['updateAssetReport']).toHaveBeenCalledWith(
      8,
      expect.objectContaining({ name: 'My report', rowVersion: 'AAAA' }),
    );
  });

  it('opens a saved report, fills the form, runs it and shows its chart', async () => {
    await create();
    await click_('[data-saved-open]');
    expect(run['runSavedAssetReport']).toHaveBeenCalledWith(7);
    expect(q<HTMLInputElement>('[data-name]').value).toBe('Data by disposition');
    expect(el().querySelector('mf-bar-chart')).toBeTruthy();
  });

  it('keeps a failed save in the page with the reason', async () => {
    await create();
    reports['createAssetReport'].mockReturnValue(
      apiError(409, { code: 'DUPLICATE_NAME', detail: "You already have a report named 'X'." }),
    );
    const name = q<HTMLInputElement>('[data-name]');
    name.value = 'X';
    name.dispatchEvent(new Event('input'));
    await click_('[data-save]');
    expect(q('[data-save-error]').textContent).toContain('already have a report');
  });

  it('renames and deletes a saved report from the list', async () => {
    await create();
    await click_('[data-saved-rename]');
    const input = document.querySelector<HTMLInputElement>('[data-rename-input]')!;
    input.value = 'Renamed';
    input.dispatchEvent(new Event('input'));
    document
      .querySelector<HTMLElement>('[data-confirm-primary] button, button[data-confirm-primary]')
      ?.click();
    await settle(fixture);
    expect(reports['updateAssetReport']).toHaveBeenCalledWith(
      7,
      expect.objectContaining({ name: 'Renamed' }),
    );
    expect(q('[data-saved-open]').textContent).toContain('Renamed');
    await click_('[data-saved-delete]');
    document
      .querySelector<HTMLElement>('[data-confirm-primary] button, button[data-confirm-primary]')
      ?.click();
    await settle(fixture);
    expect(reports['deleteAssetReport']).toHaveBeenCalledWith(7);
    expect(q('[data-saved-empty]')).toBeTruthy();
  });

  it('only offers All matters to a person who may assign managers', async () => {
    await create();
    expect(el().querySelector('[data-scope-switch]')).toBeNull();
    TestBed.resetTestingModule();
    await create(['Asset.View', 'Matter.BeManager', 'Matter.AssignManagers']);
    expect(el().querySelector('[data-scope-switch]')).toBeTruthy();
  });
});
