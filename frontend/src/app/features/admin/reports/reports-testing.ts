import {
  AnalyzeResponse,
  PreviewResponse,
  ReportCategoryResponse,
  ReportDetailResponse,
  ReportListItemResponse,
} from '../../../api/generated/api-client';

/** Fixtures for the Reports specs: complete responses of the generated client with the fields a test cares about overridden. */
export const aCategory = (over: Partial<ReportCategoryResponse> = {}): ReportCategoryResponse =>
  ({
    categoryId: 1,
    name: 'Task follow-up',
    sortOrder: 1,
    isActive: true,
    reportCount: 2,
    rowVersion: 'CAT1',
    ...over,
  }) as ReportCategoryResponse;

export const aReport = (over: Partial<ReportDetailResponse> = {}): ReportDetailResponse =>
  ({
    reportId: 5,
    name: 'Overdue tasks',
    categoryId: 1,
    categoryName: 'Task follow-up',
    description: 'Tasks past due',
    helpText: undefined,
    sortOrder: 1,
    isActive: false,
    timeoutSeconds: undefined,
    maxRows: undefined,
    versionId: 31,
    versionNo: 3,
    sql: 'SELECT 1 AS one',
    parameters: [],
    changeNote: undefined,
    canActivate: false,
    roleCount: 0,
    createdAtUtc: '2026-10-01T10:00:00Z',
    createdByName: 'Ann',
    modifiedAtUtc: undefined,
    modifiedByName: undefined,
    rowVersion: 'RV1',
    ...over,
  }) as ReportDetailResponse;

export const aListItem = (over: Partial<ReportListItemResponse> = {}): ReportListItemResponse =>
  ({
    reportId: 5,
    name: 'Overdue tasks',
    categoryId: 1,
    categoryName: 'Task follow-up',
    sortOrder: 1,
    description: 'Tasks past due',
    isActive: true,
    versionNo: 3,
    previewed: true,
    roleCount: 2,
    lastRunAtUtc: undefined,
    modifiedAtUtc: undefined,
    rowVersion: 'RV1',
    ...over,
  }) as ReportListItemResponse;

export interface Found {
  name: string;
  line?: number;
  column?: number;
  builtIn?: boolean;
}

/** An analysis of a query that is valid and holds the given placeholders, or the given problems. */
export function anAnalysis(
  found: Found[] = [],
  problems: { line: number; column: number; message: string }[] = [],
): AnalyzeResponse {
  const errors = problems.map((p, i) => ({
    code: 'SYNTAX_ERROR',
    message: p.message,
    position: i,
    line: p.line,
    column: p.column,
  }));
  return {
    placeholders: found.map((f, i) => ({
      name: f.name,
      displayName: f.name,
      position: i * 10,
      line: f.line ?? 1,
      column: f.column ?? 1,
      occurrences: 1,
      isBuiltIn: !!f.builtIn,
    })),
    occurrences: found.map((f, i) => ({
      name: f.name,
      start: i * 10,
      length: f.name.length + 1,
      line: 1,
      column: 1,
    })),
    issues: [],
    dateRangeCandidates: [],
    validation: { isValid: errors.length === 0, errors, sqlHash: 'AA' },
  } as AnalyzeResponse;
}

export const aPreview = (over: Partial<PreviewResponse> = {}): PreviewResponse =>
  ({
    success: true,
    status: 'Succeeded',
    columns: [{ name: 'one', type: 'integer' }],
    rows: [[1]],
    rowCount: 1,
    exceedsCap: false,
    durationMs: 5,
    validationErrors: [],
    parameterErrors: [],
    sqlError: undefined,
    sqlErrorLine: undefined,
    countsForActivation: false,
    rowVersion: undefined,
    ...over,
  }) as PreviewResponse;
