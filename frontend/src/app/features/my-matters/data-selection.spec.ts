import { convertToParamMap } from '@angular/router';
import type { AssetDataResponse, AssetDataTypeRow } from '../../api/generated/api-client';
import {
  DEFAULT_SELECTION,
  chosenCount,
  countOf,
  fromRemembered,
  hasExplicitSelection,
  isEverything,
  listIsExact,
  listParams,
  parseSelection,
  parseSizeToken,
  parseStatus,
  parseView,
  periodRange,
  rememberedOf,
  selectionArgs,
  selectionToParams,
  sizeOf,
  sizeToken,
  typeChartRows,
  unitsOf,
} from './data-selection';

const q = (o: Record<string, string>) => convertToParamMap(o);
const unit = (u: string, value: number, assets = 1) => ({ unit: u, value, assets });

describe('the selection of the Data Area', () => {
  it('reads the four choices from the address, ignoring anything that is not an id, a unit or a date', () => {
    const s = parseSelection(
      q({
        dm: '5,6,x,6,0,-3',
        dt: '3',
        ds: '3:docs:Items,3:size_gb,4:bad key,5:x:parsecs',
        dp: 'custom',
        dfrom: '2026-01-01',
        dto: 'tomorrow',
      }),
    );
    expect(s.matterIds).toEqual([5, 6]);
    expect(s.typeIds).toEqual([3]);
    expect(s.sizeFields).toEqual([
      { typeId: 3, key: 'docs', unit: 'Items' },
      { typeId: 3, key: 'size_gb', unit: null },
    ]);
    expect(s.period).toBe('custom');
    expect(s.from).toBe('2026-01-01');
    expect(s.to).toBeNull();
  });

  it('knows an address that says something from one that says nothing', () => {
    expect(hasExplicitSelection(q({}))).toBe(false);
    expect(hasExplicitSelection(q({ tab: 'data', scope: 'all' }))).toBe(false);
    expect(hasExplicitSelection(q({ dp: 'all' }))).toBe(true);
    expect(hasExplicitSelection(q({ dm: '4' }))).toBe(true);
    expect(parseSelection(q({}))).toEqual(DEFAULT_SELECTION);
    expect(parseView(q({ dv: 'pie' }))).toBe('pie');
    expect(parseView(q({ dv: 'cube' }))).toBe('table');
    expect(parseStatus(q({ dstatus: 'pending' }))).toBe('pending');
    expect(parseStatus(q({ dstatus: 'gone' }))).toBeNull();
  });

  it('writes defaults as null, except the period which marks that the person chose', () => {
    expect(selectionToParams(DEFAULT_SELECTION)).toEqual({
      dm: null,
      dt: null,
      ds: null,
      dp: 'all',
      dfrom: null,
      dto: null,
    });
    const s = {
      matterIds: [5, 6],
      typeIds: [3],
      sizeFields: [{ typeId: 3, key: 'docs', unit: 'Items' }],
      period: 'custom' as const,
      from: '2026-01-01',
      to: '2026-03-31',
    };
    const params = selectionToParams(s);
    expect(params).toEqual({
      dm: '5,6',
      dt: '3',
      ds: '3:docs:Items',
      dp: 'custom',
      dfrom: '2026-01-01',
      dto: '2026-03-31',
    });
    expect(parseSelection(convertToParamMap(params as Record<string, string>))).toEqual(s);
    expect(chosenCount(s)).toBe(4);
    expect(chosenCount(DEFAULT_SELECTION)).toBe(0);
    expect(isEverything(DEFAULT_SELECTION)).toBe(true);
    expect(isEverything(s)).toBe(false);
  });

  it('turns a ready period into dates of the viewer s calendar', () => {
    const today = '2026-10-28';
    const of = (period: 'all' | '30d' | '12m' | 'year') =>
      periodRange({ ...DEFAULT_SELECTION, period }, today);
    expect(of('all')).toEqual({ from: undefined, to: undefined });
    expect(of('30d')).toEqual({ from: '2026-09-29', to: today });
    expect(of('12m')).toEqual({ from: '2025-10-29', to: today });
    expect(of('year')).toEqual({ from: '2026-01-01', to: today });
    expect(
      periodRange({ ...DEFAULT_SELECTION, period: 'custom', from: '2026-02-01', to: null }, today),
    ).toEqual({ from: '2026-02-01', to: undefined });
  });

  it('hands the client the arguments in the order of the generated call', () => {
    expect(selectionArgs(DEFAULT_SELECTION, '2026-10-28')).toEqual({
      matterIds: undefined,
      assetTypeIds: undefined,
      sizeFields: undefined,
      from: undefined,
      to: undefined,
    });
    const args = selectionArgs(
      {
        ...DEFAULT_SELECTION,
        matterIds: [5],
        typeIds: [3, 4],
        sizeFields: [{ typeId: 3, key: 'docs', unit: 'Items' }],
        period: '30d',
      },
      '2026-10-28',
    );
    expect(args.matterIds).toEqual([5]);
    expect(args.assetTypeIds).toEqual([3, 4]);
    expect(args.sizeFields).toEqual(['3:docs:Items']);
    expect(args.from).toBe('2026-09-29');
  });

  it('round-trips the remembered state and survives a broken one', () => {
    const s = {
      ...DEFAULT_SELECTION,
      matterIds: [5],
      sizeFields: [{ typeId: 3, key: 'size_gb', unit: null }],
      period: '12m' as const,
    };
    const back = fromRemembered(rememberedOf(s, 'pie'));
    expect(back.selection).toEqual(s);
    expect(back.view).toBe('pie');
    expect(fromRemembered(null).selection).toEqual(DEFAULT_SELECTION);
    expect(
      fromRemembered({ matterIds: 'x', typeIds: [3, 'a', -1], period: 'forever', sizeFields: [4] })
        .selection,
    ).toEqual({ ...DEFAULT_SELECTION, typeIds: [3] });
  });

  it('writes and reads a size token', () => {
    expect(sizeToken({ typeId: 3, key: 'docs', unit: 'Items' })).toBe('3:docs:Items');
    expect(sizeToken({ typeId: 3, key: 'size_gb', unit: null })).toBe('3:size_gb');
    expect(parseSizeToken('3:docs:Items')).toEqual({ typeId: 3, key: 'docs', unit: 'Items' });
    expect(parseSizeToken('docs')).toBeNull();
    expect(parseSizeToken('0:docs')).toBeNull();
    expect(parseSizeToken('3:docs:furlongs')).toBeNull();
  });

  it('opens the Assets list only for counts it can show exactly', () => {
    expect(listIsExact(DEFAULT_SELECTION)).toBe(true);
    expect(listIsExact({ ...DEFAULT_SELECTION, matterIds: [5] })).toBe(true);
    expect(listIsExact({ ...DEFAULT_SELECTION, matterIds: [5, 6] })).toBe(false);
    expect(listIsExact({ ...DEFAULT_SELECTION, period: '12m' })).toBe(false);
    // The whole selection is one list only for all types or one.
    expect(listIsExact({ ...DEFAULT_SELECTION, typeIds: [3, 4] })).toBe(true);
    expect(listIsExact({ ...DEFAULT_SELECTION, typeIds: [3, 4] }, true)).toBe(false);
    expect(listIsExact({ ...DEFAULT_SELECTION, typeIds: [3] }, true)).toBe(true);
    const p = listParams(
      'matterManagedByMe=true&assetTypeId=3',
      'mine',
      {
        ...DEFAULT_SELECTION,
        matterIds: [5],
      },
      'pending',
    );
    expect(p).toMatchObject({ scope: 'mine', typeId: '3', matterId: 5, status: 'pending' });
  });
});

describe('the numbers of the grid, the tiles and the chart', () => {
  const counts = (assets: number, active: number, pending: number, size = [unit('GB', 100)]) => ({
    assets,
    active,
    inactive: 0,
    pendingDisposition: pending,
    disposed: assets - active - pending,
    size,
  });
  const row = (id: number, name: string, c: ReturnType<typeof counts>): AssetDataTypeRow => ({
    assetTypeId: id,
    name,
    counts: c,
    query: `assetTypeId=${id}`,
    measures: [],
    numberFields: [],
    dispositionSizes: [{ disposition: 'ACTIVE', size: [unit('GB', 60)] }],
  });
  const d = {
    totals: counts(12, 8, 2, [unit('GB', 150), unit('Items', 900)]),
    types: [
      row(1, 'Workspace', counts(10, 6, 2)),
      { ...row(2, 'Production', counts(2, 2, 0, [unit('Items', 900)])), dispositionSizes: [] },
    ],
  } as unknown as AssetDataResponse;

  it('counts one status or every asset', () => {
    expect(countOf(d.totals, null)).toBe(12);
    expect(countOf(d.totals, 'active')).toBe(8);
    expect(countOf(d.totals, 'pending')).toBe(2);
    expect(countOf(d.totals, 'disposed')).toBe(2);
  });

  it('gives the size of a status from the split the answer carries, the whole size otherwise', () => {
    const w = d.types[0];
    expect(sizeOf(w, null)).toEqual([unit('GB', 100)]);
    expect(sizeOf(w, 'active')).toEqual([unit('GB', 60)]);
    expect(sizeOf(w, 'disposed')).toEqual([]);
  });

  it('lists the units of an answer once, never added together', () => {
    expect(unitsOf(d)).toEqual(['GB', 'Items']);
  });

  it('makes one chart row per asset type for the assets or for one unit of size', () => {
    const none = () => null;
    expect(typeChartRows(d, 'assets', null, none).map((r) => [r.label, r.value])).toEqual([
      ['Workspace', 10],
      ['Production', 2],
    ]);
    expect(typeChartRows(d, 'Items', null, none).map((r) => r.value)).toEqual([0, 900]);
    expect(typeChartRows(d, 'GB', 'active', none).map((r) => r.value)).toEqual([60, 0]);
    expect(typeChartRows(d, 'assets', 'pending', none).map((r) => r.value)).toEqual([2, 0]);
  });
});
