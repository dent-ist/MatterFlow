import type {
  RunnableParameterResponse,
  RunnableReportCategoryResponse,
  RunnableReportListItemResponse,
  RunnableReportResponse,
} from '../../api/generated/api-client';

/** Fixtures for the people-facing Reports specs: complete responses of the generated client with the fields a test cares about overridden. */
export const aListItem = (
  over: Partial<RunnableReportListItemResponse> = {},
): RunnableReportListItemResponse =>
  ({
    reportId: 5,
    name: 'Overdue tasks',
    description: 'Tasks past their due date',
    sortOrder: 1,
    parameterCount: 0,
    hasParameters: false,
    parameterLabels: [],
    lastRunAtUtc: undefined,
    ...over,
  }) as RunnableReportListItemResponse;

export const aCategory = (
  over: Partial<RunnableReportCategoryResponse> = {},
): RunnableReportCategoryResponse =>
  ({
    categoryId: 1,
    name: 'Task follow-up',
    sortOrder: 1,
    reports: [aListItem()],
    ...over,
  }) as RunnableReportCategoryResponse;

/** One parameter of the run page (a text parameter unless `type` says otherwise). */
export const aParam = (over: Partial<RunnableParameterResponse> = {}): RunnableParameterResponse =>
  ({
    name: 'NAME',
    type: 'text',
    label: 'Name',
    helpText: undefined,
    required: false,
    default: undefined,
    multiple: false,
    lookupKind: undefined,
    valueType: undefined,
    choicesSource: undefined,
    options: [],
    min: undefined,
    max: undefined,
    integerOnly: false,
    maxLength: undefined,
    maxSelected: undefined,
    ...over,
  }) as RunnableParameterResponse;

export const aRunnable = (over: Partial<RunnableReportResponse> = {}): RunnableReportResponse =>
  ({
    reportId: 5,
    name: 'Overdue tasks',
    description: 'Tasks past their due date',
    helpText: undefined,
    categoryId: 1,
    categoryName: 'Task follow-up',
    versionNo: 2,
    timeoutSeconds: 60,
    maxRows: 50000,
    parameters: [],
    ...over,
  }) as RunnableReportResponse;
