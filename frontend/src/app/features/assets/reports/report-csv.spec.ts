import { AssetReportResult } from '../../../api/generated/api-client';
import { exportFileName, reportDocument } from './report-csv';

const result = (overrides: Partial<AssetReportResult> = {}): AssetReportResult => ({
  measure: 'sum',
  groupBy: 'disposition',
  groupByLabel: 'Disposition',
  assetTypeId: 4,
  assetTypeName: 'Relativity Workspace',
  columns: [
    { key: 'count', label: 'Assets', unit: undefined },
    { key: 'sum:GB', label: 'Sum of Size (GB)', unit: 'GB' },
  ],
  rows: [
    { key: 'ACTIVE', label: 'Active', cells: [12, 412] },
    { key: 'PENDING_DISPOSITION', label: 'Pending, "late"', cells: [3, 88.5] },
    { key: '', label: '=HYPERLINK("http://x")', cells: [1, undefined] },
    { key: 'neg', label: '-2 weeks', cells: [1, -5] },
  ],
  totals: { key: '', label: 'Total', cells: [17, 495.5] },
  hiddenGroups: 0,
  unitsWarning: undefined,
  assets: 17,
  ...overrides,
});

describe('report export', () => {
  it('writes the header, the groups and the Total row: comma, CRLF, RFC 4180 quoting, a dot and no thousand separators', () => {
    const lines = reportDocument('csv', result()).split('\r\n');
    expect(lines[0]).toBe('Disposition,Assets,Sum of Size (GB)');
    expect(lines[1]).toBe('Active,12,412');
    expect(lines[2]).toBe('"Pending, ""late""",3,88.5');
    expect(lines.at(-2)).toBe('Total,17,495.5');
    expect(lines.at(-1)).toBe('');
    expect(
      reportDocument(
        'csv',
        result({ totals: { key: '', label: 'Total', cells: [1200, 1234567.5] } }),
      ),
    ).toContain('Total,1200,1234567.5');
  });

  it('protects text cells against formulas but never prefixes a number (a real -5 stays a number); a group without a value is empty', () => {
    const lines = reportDocument('csv', result()).split('\r\n');
    expect(lines[3]).toBe(`"'=HYPERLINK(""http://x"")",1,`);
    expect(lines[4]).toBe(`'-2 weeks,1,-5`);
  });

  it('protects the column headers too', () => {
    const csv = reportDocument(
      'csv',
      result({ groupByLabel: '=Evil', columns: [{ key: 'count', label: '@x', unit: undefined }] }),
    );
    expect(csv.split('\r\n')[0]).toBe("'=Evil,'@x");
  });

  it('is the byte-order-mark-free text the shared download adds the BOM to', () => {
    expect(reportDocument('csv', result()).startsWith('﻿')).toBe(false);
  });

  it('copies as tab-separated text with the same formula rule and no tabs or line breaks inside a cell', () => {
    const tsv = reportDocument(
      'text',
      result({ rows: [{ key: 'a', label: '=1\t+\n2', cells: [1, 2] }] }),
    );
    const lines = tsv.split('\n');
    expect(lines[0]).toBe('Disposition\tAssets\tSum of Size (GB)');
    expect(lines[1]).toBe("'=1 + 2\t1\t2");
    expect(lines[2]).toBe('Total\t17\t495.5');
  });

  it('names the file <slug>-yyyyMMdd-HHmm, ASCII only, with -truncated when groups were cut', () => {
    const when = new Date(2026, 9, 26, 9, 5);
    expect(exportFileName('Data by disposition', when, false)).toBe(
      'Data-by-disposition-20261026-0905',
    );
    expect(exportFileName('Résumé & Zahlen', when, true)).toBe(
      'Resume-Zahlen-20261026-0905-truncated',
    );
    expect(exportFileName('***', when, false)).toBe('asset-report-20261026-0905');
    expect(exportFileName('x'.repeat(300), when, false).length).toBeLessThanOrEqual(100);
  });
});
