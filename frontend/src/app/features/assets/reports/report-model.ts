import {
  AssetReportColumn,
  AssetReportDefinition,
  AssetReportResult,
} from '../../../api/generated/api-client';
import { ChartFormat, ChartRow } from '../../../shared/charts/chart-types';
import { formatDecimal } from '../../../shared/ui/number-format';
import {
  DISPOSITIONS as DISPOSITION_OPTIONS,
  dispositionLabel,
} from '../disposition/asset-disposition';

/** What the form holds; `typeId` null is "All asset types". */
export interface ReportDraft {
  name: string;
  typeId: number | null;
  measure: 'count' | 'sum' | 'average';
  numberField: string;
  numberUnit: string;
  groupBy: string;
  scope: 'mine' | 'all';
  /** A disposition code, or '' for any. */
  disposition: string;
}

export const MEASURES: readonly { value: ReportDraft['measure']; label: string }[] = [
  { value: 'count', label: 'Count' },
  { value: 'sum', label: 'Sum' },
  { value: 'average', label: 'Average' },
];

/** "Any Disposition" and the four dispositions, worded by the shared table (`asset-disposition.ts`), never typed again here. */
export const DISPOSITIONS: readonly { value: string; label: string }[] = [
  { value: '', label: 'Any Disposition' },
  ...DISPOSITION_OPTIONS.map((d) => ({ value: d.code, label: d.label })),
];

export const NEW_DRAFT: ReportDraft = {
  name: '',
  typeId: null,
  measure: 'count',
  numberField: '',
  numberUnit: '',
  groupBy: 'disposition',
  scope: 'mine',
  disposition: '',
};

/** The definition the API runs and saves. A count has no number field; for all asset types the default size of each type is used. */
export function toDefinition(
  draft: ReportDraft,
  chart: 'table' | 'pie' | 'bar',
  defaultSizeKey: string | null,
): AssetReportDefinition {
  const measured = draft.measure !== 'count' && draft.typeId !== null;
  const field = measured && draft.numberField ? draft.numberField : undefined;
  return {
    v: 1,
    assetTypeId: draft.typeId ?? undefined,
    measure: draft.measure,
    numberField: field,
    numberUnit:
      field && field !== defaultSizeKey && draft.numberUnit ? draft.numberUnit : undefined,
    groupBy: draft.groupBy,
    scope: draft.scope,
    dispositions: draft.disposition ? [draft.disposition] : undefined,
    chart,
  };
}

/** The form for a saved definition (the name comes from the saved report). */
export function toDraft(name: string, def: AssetReportDefinition): ReportDraft {
  const measure = def.measure === 'sum' || def.measure === 'average' ? def.measure : 'count';
  return {
    name,
    typeId: def.assetTypeId ?? null,
    measure,
    numberField: def.numberField ?? '',
    numberUnit: def.numberUnit ?? '',
    groupBy: def.groupBy ?? 'disposition',
    scope: def.scope === 'all' ? 'all' : 'mine',
    disposition: def.dispositions?.length === 1 ? def.dispositions[0] : '',
  };
}

/** "1,240" or "412.5": whole numbers without decimals, others with at most one. */
export const formatCell: ChartFormat = (value) => formatDecimal(value);

/** The cell text of a result table ("" where no asset of the group had a value). */
export function cellText(value: number | null | undefined): string {
  return value === null || value === undefined ? '' : formatDecimal(value);
}

/** The columns a graph can draw (all of them: the count, and each measure column). */
export function graphColumns(result: AssetReportResult): AssetReportColumn[] {
  return result.columns;
}

/** The rows of one result column as chart rows; groups without a value in that column are left out (the table lists them). */
export function chartRows(result: AssetReportResult, column: number): ChartRow[] {
  return result.rows
    .filter((r) => r.cells[column] !== null && r.cells[column] !== undefined)
    .map((r) => ({ label: r.label || '(none)', value: r.cells[column] as number, link: null }));
}

/** The grouping choices the API offers by itself, worded in Title Case (D-20: dropdown options and column headings); a custom field's name is shown as stored. */
export const GROUP_BY_LABELS: Readonly<Record<string, string>> = {
  disposition: 'Disposition',
  matter: 'Matter',
  client: 'Client',
  assetType: 'Asset Type',
};

/** The label of a grouping choice: our Title Case word for a built-in one, the API's own text for a field. */
export function groupByLabel(key: string, apiLabel: string): string {
  return GROUP_BY_LABELS[key] ?? apiLabel;
}

/**
 * The result worded as everywhere else (D-20, #1262): the disposition groups use the fixed chip words of `dispositionLabel` ("Pending Disposition"; the API
 * writes "Pending disposition") and a built-in grouping heading is Title Case ("Asset Type"). The table, the chart legends and the export all read these
 * labels, so they are set once, here.
 */
export function withStandardLabels(result: AssetReportResult): AssetReportResult {
  const heading = groupByLabel(result.groupBy, result.groupByLabel);
  const named =
    result.groupBy !== 'disposition'
      ? result.rows
      : result.rows.map((row) =>
          DISPOSITION_OPTIONS.some((d) => d.code === row.key)
            ? { ...row, label: dispositionLabel(row.key) }
            : row,
        );
  return named === result.rows && heading === result.groupByLabel
    ? result
    : { ...result, groupByLabel: heading, rows: named };
}

/** How many groups have no value in the column (not drawn by a chart). */
export function undrawnGroups(result: AssetReportResult, column: number): number {
  return result.rows.filter((r) => r.cells[column] === null || r.cells[column] === undefined)
    .length;
}
