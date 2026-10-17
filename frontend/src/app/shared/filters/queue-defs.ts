import { ALL_STATUSES, OPEN_STATUSES, QueueFilters } from '../work-queue/queue-filters';
import { FilterDef, FilterOption, FilterValue, paramsOf } from './filter-def';

/**
 * The filters of the work lists (Task Queue, My Work, Pod Work) as `FilterDef[]`, with exactly the URL parameter names of
 * `QueueFilters` / `GET /api/v1/task-queue` (shared/work-queue/queue-filters.ts). This is the adapter that lets the work lists move from
 * `QueueFilters` to `ListFilters` one screen at a time: `shared/filters/queue-defs.spec.ts` proves that both read every dashboard and
 * Advanced-search deep link to the same filters. Pages pass their lookups (priorities, pods, people, types, workflows) as options.
 *
 * Column of each filter (`ref` and `title` share one control that spans both): Title or Ref, Matter, Client, Project, Task type, Workflow,
 * Priority, Pod, Assignee, Creator, Requestor, Due, Status, Created, Updated. ASAP, Overdue and Closed (completed) have no column of
 * their own: they live in "More filters". `client`, `matter` and `project` (ids) are the link-only parameters of dashboard links.
 */
export interface QueueLookups {
  statuses?: readonly FilterOption[];
  priorities?: readonly FilterOption[];
  pods?: readonly FilterOption[];
  users?: readonly FilterOption[];
  types?: readonly FilterOption[];
  workflows?: readonly FilterOption[];
}

export interface QueueDefOptions {
  /** Keys left out: Pod Work has no Pod filter (the Pod is the scope of the page). */
  omit?: readonly string[];
  /** Why a filter is unavailable on the current tab (read on every render); the key of the definition. `due` covers ASAP and Overdue. */
  disabled?: Readonly<Record<string, () => string | null | undefined>>;
  /** The status choices (default: all five). My Work and Pod Work limit them per tab. */
  statuses?: () => readonly FilterOption[];
  /** The statuses a plain link starts on (Task Queue: the open ones). A link with other filters and no status asks for every status. */
  defaultStatus?: readonly string[];
  /** My Work, Closed tab: adds the "Closed: all time" chip of `closed=all` ("Show older"; removing it returns to the 90-day window). */
  closedWindow?: boolean;
  /** Names for the link-only record chips (`?matter=12` shows "Matter: 00343-00012"). */
  names?: {
    client?: (id: string) => string;
    matter?: (id: string) => string;
    project?: (id: string) => string;
  };
}

export const OPEN_GROUP = { label: 'Open', values: OPEN_STATUSES } as const;

const asId = (v: string): string | null => (/^[1-9]\d*$/.test(v) ? v : null);
const asStatus = (v: string): string | null =>
  ALL_STATUSES.includes(v.toUpperCase()) ? v.toUpperCase() : null;

const TRI = (any: string, yes: string, no: string): readonly FilterOption[] => [
  { value: '', label: any },
  { value: 'true', label: yes },
  { value: 'false', label: no },
];

export function queueFilterDefs(
  lookups: QueueLookups = {},
  options: QueueDefOptions = {},
): FilterDef[] {
  const list = (o?: readonly FilterOption[]) => () => o ?? [];
  const reason = (key: string) => options.disabled?.[key];
  const off = (key: string): Pick<FilterDef, 'disabledReason'> => {
    const r = reason(key);
    return r ? { disabledReason: r } : {};
  };
  const defs: FilterDef[] = [
    // Ref and Title share the control: it searches the title and the task number.
    { key: 'q', label: 'Title or Ref', column: 'ref', type: 'text', span: 2 },
    {
      key: 'status',
      label: 'Status',
      column: 'status',
      type: 'multiSelect',
      options: options.statuses ?? list(lookups.statuses),
      normalize: asStatus,
      valueGroups: [OPEN_GROUP],
      emptyLabel: 'All',
      ...(options.defaultStatus ? { default: options.defaultStatus, defaultOnlyBare: true } : {}),
      ...off('status'),
    },
    { key: 'matterText', label: 'Matter', column: 'matter', type: 'text' },
    { key: 'clientText', label: 'Client', column: 'client', type: 'text' },
    { key: 'projectText', label: 'Project', column: 'project', type: 'text' },
    {
      key: 'type',
      label: 'Task type',
      column: 'type',
      type: 'multiSelect',
      options: list(lookups.types),
      normalize: asId,
    },
    {
      key: 'workflow',
      label: 'Workflow',
      column: 'workflow',
      type: 'multiSelect',
      options: list(lookups.workflows),
      normalize: asId,
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
      ...off('pod'),
    },
    {
      key: 'assignee',
      label: 'Assignee',
      column: 'assignee',
      type: 'user',
      options: list(lookups.users),
      flagOptions: { unassigned: { param: 'unassigned', label: 'Unassigned' } },
      normalize: asId,
      ...off('assignee'),
    },
    {
      key: 'creator',
      label: 'Creator',
      column: 'creator',
      type: 'user',
      options: list(lookups.users),
      normalize: asId,
      ...off('creator'),
    },
    { key: 'requestor', label: 'Requestor', column: 'requestor', type: 'text' },
    {
      key: 'due',
      label: 'Due',
      column: 'due',
      type: 'dateRange',
      fromParam: 'dueFrom',
      toParam: 'dueTo',
      ...off('due'),
    },
    {
      key: 'created',
      label: 'Created',
      column: 'created',
      type: 'dateRange',
      fromParam: 'createdFrom',
      toParam: 'createdTo',
    },
    {
      key: 'updated',
      label: 'Updated',
      column: 'updated',
      type: 'dateRange',
      fromParam: 'updatedFrom',
      toParam: 'updatedTo',
    },
    // No column of their own: More filters.
    {
      key: 'completed',
      label: 'Closed',
      type: 'dateRange',
      fromParam: 'completedFrom',
      toParam: 'completedTo',
    },
    ...(options.closedWindow
      ? [
          {
            key: 'closedWindow',
            label: 'Closed',
            type: 'select',
            param: 'closed',
            noControl: true,
            options: [{ value: 'all', label: 'all time' }],
            normalize: (v: string) => (v.toLowerCase() === 'all' ? 'all' : null),
            ...off('closedWindow'),
          } satisfies FilterDef,
        ]
      : []),
    {
      key: 'asap',
      label: 'ASAP',
      type: 'triState',
      options: TRI('Any', 'ASAP only', 'Has a due date'),
      ...off('due'),
    },
    {
      key: 'overdue',
      label: 'Overdue',
      type: 'triState',
      options: TRI('Any', 'Overdue only', 'Not overdue'),
      ...off('due'),
    },
    // Link-only: dashboard and record pages link with ids; they show as removable chips.
    {
      key: 'client',
      label: 'Client',
      type: 'text',
      noControl: true,
      normalize: asId,
      valueLabel: options.names?.client,
    },
    {
      key: 'matter',
      label: 'Matter',
      type: 'text',
      noControl: true,
      normalize: asId,
      valueLabel: options.names?.matter,
    },
    {
      key: 'project',
      label: 'Project',
      type: 'text',
      noControl: true,
      normalize: asId,
      valueLabel: options.names?.project,
    },
  ];
  const omit = options.omit ?? [];
  return defs.filter((d) => !omit.includes(d.key));
}

/** The URL parameters of every work-list filter (also the ones a screen leaves out), to tell a plain link from one that carries filters. */
export const QUEUE_FILTER_PARAMS: readonly string[] = [
  ...new Set(queueFilterDefs().flatMap((d) => paramsOf(d))),
];

/** `QueueFilters` with the fields of the named filters cleared (what a tab that owns those columns does not send to the API). */
export function withoutFilters(f: QueueFilters, keys: readonly string[]): QueueFilters {
  const out = { ...f };
  for (const key of keys) {
    switch (key) {
      case 'status':
        out.status = [];
        break;
      case 'pod':
        out.pod = [];
        out.noPod = false;
        break;
      case 'assignee':
        out.assignee = [];
        out.unassigned = false;
        break;
      case 'creator':
        out.creator = [];
        break;
      case 'due':
        out.dueFrom = null;
        out.dueTo = null;
        break;
      case 'asap':
        out.asap = null;
        break;
      case 'overdue':
        out.overdue = null;
        break;
    }
  }
  return out;
}

/** The filter values of a `QueueFilters` (a quick view's filters), keyed like `queueFilterDefs`, for `ListFilters.applyPreset`. */
export function filtersToValues(f: QueueFilters): Record<string, FilterValue> {
  const str = (list: readonly number[]) => list.map(String);
  return {
    q: f.q,
    status: [...f.status],
    matterText: f.matterText,
    clientText: f.clientText,
    projectText: f.projectText,
    type: str(f.type),
    workflow: str(f.workflow),
    priority: str(f.priority),
    pod: [...str(f.pod), ...(f.noPod ? ['none'] : [])],
    assignee: [...str(f.assignee), ...(f.unassigned ? ['unassigned'] : [])],
    creator: str(f.creator),
    requestor: f.requestor,
    due: { from: f.dueFrom ?? '', to: f.dueTo ?? '' },
    created: { from: f.createdFrom ?? '', to: f.createdTo ?? '' },
    updated: { from: f.updatedFrom ?? '', to: f.updatedTo ?? '' },
    completed: { from: f.completedFrom ?? '', to: f.completedTo ?? '' },
    asap: f.asap === null ? '' : String(f.asap),
    overdue: f.overdue === null ? '' : String(f.overdue),
    client: f.client === null ? '' : String(f.client),
    matter: f.matter === null ? '' : String(f.matter),
    project: f.project === null ? '' : String(f.project),
  };
}
