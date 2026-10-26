import { AssetReportResult } from '../../../api/generated/api-client';
import {
  NEW_DRAFT,
  cellText,
  chartRows,
  toDefinition,
  toDraft,
  undrawnGroups,
} from './report-model';

describe('report model', () => {
  it('a count has no number field or unit', () => {
    const def = toDefinition(
      { ...NEW_DRAFT, typeId: 4, numberField: 'size_gb', numberUnit: 'GB' },
      'table',
      'size_gb',
    );
    expect(def.numberField).toBeUndefined();
    expect(def.numberUnit).toBeUndefined();
    expect(def.measure).toBe('count');
  });

  it('for all asset types a sum names no field (each type uses its default size)', () => {
    const def = toDefinition({ ...NEW_DRAFT, measure: 'sum', numberField: 'size_gb' }, 'bar', null);
    expect(def.assetTypeId).toBeUndefined();
    expect(def.numberField).toBeUndefined();
    expect(def.chart).toBe('bar');
  });

  it('a sum of the default size field sends no unit; another field sends the unit chosen', () => {
    const base = { ...NEW_DRAFT, typeId: 4, measure: 'sum' as const, numberUnit: 'MB' };
    expect(
      toDefinition({ ...base, numberField: 'size_gb' }, 'table', 'size_gb').numberUnit,
    ).toBeUndefined();
    const other = toDefinition({ ...base, numberField: 'pages' }, 'table', 'size_gb');
    expect(other.numberField).toBe('pages');
    expect(other.numberUnit).toBe('MB');
  });

  it('a disposition choice becomes a one-item filter and comes back', () => {
    const def = toDefinition({ ...NEW_DRAFT, disposition: 'ACTIVE', scope: 'all' }, 'table', null);
    expect(def.dispositions).toEqual(['ACTIVE']);
    const back = toDraft('Mine', def);
    expect(back).toMatchObject({
      name: 'Mine',
      disposition: 'ACTIVE',
      scope: 'all',
      measure: 'count',
    });
  });

  const result = {
    columns: [
      { key: 'count', label: 'Assets', unit: undefined },
      { key: 'average:GB', label: 'Average Size (GB)', unit: 'GB' },
    ],
    rows: [
      { key: 'a', label: 'A', cells: [2, 10.5] },
      { key: 'b', label: '', cells: [1, undefined] },
    ],
  } as AssetReportResult;

  it('chart rows leave out groups without a value in the chosen column, and count them', () => {
    expect(chartRows(result, 0).map((r) => r.value)).toEqual([2, 1]);
    expect(chartRows(result, 1)).toEqual([{ label: 'A', value: 10.5, link: null }]);
    expect(undrawnGroups(result, 1)).toBe(1);
    expect(undrawnGroups(result, 0)).toBe(0);
  });

  it('formats cells with grouping and at most two decimals; no value is empty', () => {
    expect(cellText(1240)).toBe('1,240');
    expect(cellText(412.456)).toBe('412.46');
    expect(cellText(undefined)).toBe('');
    expect(cellText(0)).toBe('0');
  });
});
