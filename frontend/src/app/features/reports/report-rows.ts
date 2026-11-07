import type {
  RunnableReportCategoryResponse,
  RunnableReportListItemResponse,
} from '../../api/generated/api-client';

/** One report of the listing with the category it sits in (the grid is flat; the category is the group). */
export interface ReportRow extends RunnableReportListItemResponse {
  readonly categoryId: number;
  readonly categoryName: string;
}

/** The categories and their reports as flat rows, in the order the server sent (category order, then the administrator's report order). */
export function flattenReports(categories: readonly RunnableReportCategoryResponse[]): ReportRow[] {
  return categories.flatMap((c) =>
    c.reports.map((r) => ({ ...r, categoryId: c.categoryId, categoryName: c.name })),
  );
}

/**
 * The rows that match the search text (name, description or category, case-insensitive; every word must match) and, when any category is chosen,
 * sit in one of the chosen categories. Both combine (AND). The order is kept, so the rows of one category stay next to each other.
 */
export function filterReports(
  rows: readonly ReportRow[],
  text: string,
  categoryIds: readonly string[],
): ReportRow[] {
  const words = text.toLowerCase().split(/\s+/).filter(Boolean);
  return rows.filter((r) => {
    if (categoryIds.length > 0 && !categoryIds.includes(String(r.categoryId))) return false;
    if (words.length === 0) return true;
    const hay = `${r.name} ${r.description ?? ''} ${r.categoryName}`.toLowerCase();
    return words.every((w) => hay.includes(w));
  });
}

/** "No parameters", "1 parameter" or "3 parameters": the Parameters column. */
export function parametersText(r: Pick<RunnableReportListItemResponse, 'parameterCount'>): string {
  if (r.parameterCount === 0) return 'No parameters';
  return r.parameterCount === 1 ? '1 parameter' : `${r.parameterCount} parameters`;
}
