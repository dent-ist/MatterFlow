/**
 * Plain-list export (PM v2, #879), the browser side. A list export is the rows of a list as CSV or tab-separated text, and nothing more: it is not a
 * status report (no layout, no narrative, no schedule, no mail). The same rules as the server's `ListExport`: a cell that starts with `=`, `+`, `-`
 * or `@` gets a leading `'` so a spreadsheet never runs it as a formula; CSV cells are quoted when they hold a comma, a quote or a line break.
 * No Angular and no api-client in this file.
 */
export const EXPORT_ROW_CAP = 10_000;

export type ExportFormat = 'csv' | 'text';

const FORMULA_START = /^[=+\-@\t\r]/;

export function csvCell(value: string | number | null | undefined): string {
  let text = value === null || value === undefined ? '' : String(value);
  if (FORMULA_START.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function textCell(value: string | number | null | undefined): string {
  const text = (value === null || value === undefined ? '' : String(value)).replace(
    /[\t\r\n]/g,
    ' ',
  );
  return /^[=+\-@]/.test(text) ? `'${text}` : text;
}

/** The header and the rows as one document: CSV (CRLF line ends) or tab-separated text (LF). The byte order mark is added by `downloadCsv`. */
export function buildList(
  format: ExportFormat,
  header: readonly string[],
  rows: readonly (readonly (string | number | null | undefined)[])[],
): string {
  const csv = format === 'csv';
  const cell = csv ? csvCell : textCell;
  const eol = csv ? '\r\n' : '\n';
  const line = (cells: readonly (string | number | null | undefined)[]) =>
    cells.map(cell).join(csv ? ',' : '\t');
  return [header, ...rows].map(line).join(eol) + eol;
}

/** Saves text as a file in the browser (UTF-8, with the byte order mark Excel needs for non-ASCII text when it is CSV). */
export function downloadText(text: string, fileName: string, format: ExportFormat): void {
  const parts = format === 'csv' ? ['﻿', text] : [text];
  const blob = new Blob(parts, {
    type: format === 'csv' ? 'text/csv;charset=utf-8' : 'text/plain;charset=utf-8',
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.rel = 'noopener';
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Puts text on the clipboard; false when the browser refuses (no permission, an insecure page). */
export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
