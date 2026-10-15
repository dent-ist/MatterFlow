import { FilterDef, FilterOption } from './filter-def';

/**
 * The filters of the work lists (Task Queue, My Work, Pod Work) as `FilterDef[]`, with exactly the URL parameter names of
 * `QueueFilters` / `GET /api/v1/task-queue` (shared/work-queue/queue-filters.ts). This is the adapter that lets the work lists move from
 * `QueueFilters` to `ListFilters` one screen at a time: `shared/filters/queue-defs.spec.ts` proves that both read every dashboard and
 * Advanced-search deep link to the same filters. Pages pass their lookups (priorities, pods, people, types, workflows) as options.
 */
export interface QueueLookups {
  statuses?: readonly FilterOption[];
  priorities?: readonly FilterOption[];
  pods?: readonly FilterOption[];
  users?: readonly FilterOption[];
  types?: readonly FilterOption[];
  workflows?: readonly FilterOption[];
}

const OPEN_CODES = ['NEW', 'IN_PROGRESS', 'ON_HOLD', 'COMPLETED', 'CANCELLED'];
const asId = (v: string): string | null => (/^[1-9]\d*$/.test(v) ? v : null);
const asStatus = (v: string): string | null =>
  OPEN_CODES.includes(v.toUpperCase()) ? v.toUpperCase() : null;

export function queueFilterDefs(lookups: QueueLookups = {}): FilterDef[] {
  const list = (o?: readonly FilterOption[]) => () => o ?? [];
  return [
    { key: 'q', label: 'Title or Ref', column: 'title', type: 'text', span: 2 },
    {
      key: 'status',
      label: 'Status',
      column: 'status',
      type: 'multiSelect',
      options: list(lookups.statuses),
      normalize: asStatus,
    },
    {
      key: 'priority',
      label: 'Priority',
      column: 'priority',
      type: 'multiSelect',
      options: list(lookups.priorities),
      normalize: asId,
    },
    {
      key: 'pod',
      label: 'Pod',
      column: 'pod',
      type: 'multiSelect',
      options: list(lookups.pods),
      flagOptions: { none: { param: 'noPod', label: 'No pod' } },
      normalize: asId,
    },
    {
      key: 'assignee',
      label: 'Assignee',
      column: 'assignee',
      type: 'user',
      options: list(lookups.users),
      flagOptions: { unassigned: { param: 'unassigned', label: 'Unassigned' } },
      normalize: asId,
    },
    {
      key: 'creator',
      label: 'Creator',
      type: 'user',
      options: list(lookups.users),
      normalize: asId,
    },
    {
      key: 'type',
      label: 'Task type',
      type: 'multiSelect',
      options: list(lookups.types),
      normalize: asId,
    },
    {
      key: 'workflow',
      label: 'Workflow',
      type: 'multiSelect',
      options: list(lookups.workflows),
      normalize: asId,
    },
    { key: 'client', label: 'Client', type: 'text', noControl: true, normalize: asId },
    { key: 'matter', label: 'Matter', type: 'text', noControl: true, normalize: asId },
    { key: 'project', label: 'Project', type: 'text', noControl: true, normalize: asId },
    {
      key: 'due',
      label: 'Due',
      column: 'due',
      type: 'dateRange',
      fromParam: 'dueFrom',
      toParam: 'dueTo',
    },
    {
      key: 'created',
      label: 'Created',
      type: 'dateRange',
      fromParam: 'createdFrom',
      toParam: 'createdTo',
    },
    {
      key: 'completed',
      label: 'Closed',
      type: 'dateRange',
      fromParam: 'completedFrom',
      toParam: 'completedTo',
    },
    {
      key: 'asap',
      label: 'ASAP',
      type: 'triState',
      options: [
        { value: '', label: 'Any' },
        { value: 'true', label: 'ASAP only' },
        { value: 'false', label: 'Has a due date' },
      ],
    },
    {
      key: 'overdue',
      label: 'Overdue',
      type: 'triState',
      options: [
        { value: '', label: 'Any' },
        { value: 'true', label: 'Overdue only' },
        { value: 'false', label: 'Not overdue' },
      ],
    },
    { key: 'requestor', label: 'Requestor', type: 'text' },
  ];
}
