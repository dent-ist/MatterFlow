import { AssetReportResult } from '../../../api/generated/api-client';
import { ExportFormat, csvCell, textCell } from '../../../shared/ui/list-export';

/**
 * The export of a report result (epic #851, issues #873 and #875): the table on screen as CSV or tab-separated text, built in the browser (the
 * result is already here, computed under the viewer's visibility; nothing more is read). It reuses the list-export kit of PM v2 (#879): the
 * header row, the groups shown and the Total row; UTF-8 with the byte order mark and the download are the kit's `downloadText`; the formula rule
 * (a TEXT cell that starts with `=`, `+`, `-`, `@`, a tab or a carriage return gets a leading apostrophe) is the kit's `csvCell` and
 * `textCell`, applied to the group labels and the column headers. Numbers are written from typed values and are never prefixed (a real -5 stays a
 * number; the same rule as docs/ux/reports-review/README.md section 12.3), with an invariant culture: a dot, no thousand separators; a group
 * without a value is an empty cell.
 */
export function reportDocument(format: ExportFormat, result: AssetReportResult): string {
  const csv = format === 'csv';
  const text = csv ? csvCell : textCell;
  const number = (value: number | null | undefined) =>
    value === null || value === undefined ? '' : String(value);
  const separator = csv ? ',' : '\t';
  const eol = csv ? '\r\n' : '\n';
  const header = [result.groupByLabel, ...result.columns.map((c) => c.label)].map(text);
  const rows = [...result.rows, result.totals].map((row) =>
    [text(row.label), ...row.cells.map(number)].join(separator),
  );
  return [header.join(separator), ...rows].join(eol) + eol;
}

const pad = (n: number) => String(n).padStart(2, '0');

/** `<report-name-slug>-yyyyMMdd-HHmm` (the menu adds `.csv`; ASCII only, at most 100 characters), plus `-truncated` when groups were cut. */
export function exportFileName(name: string, when: Date, truncated: boolean): string {
  const slug =
    name
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^A-Za-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60)
      .replace(/-+$/g, '') || 'asset-report';
  const stamp = `${when.getFullYear()}${pad(when.getMonth() + 1)}${pad(when.getDate())}-${pad(when.getHours())}${pad(when.getMinutes())}`;
  return `${slug}-${stamp}${truncated ? '-truncated' : ''}`;
}
