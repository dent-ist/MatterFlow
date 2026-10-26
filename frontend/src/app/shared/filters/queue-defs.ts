import { ALL_STATUSES, OPEN_STATUSES, QueueFilters } from '../work-queue/queue-filters';
import { DUE_PRESETS } from './date-presets';
import { FilterDef, FilterOption, FilterValue, PlainLink, paramsOf } from './filter-def';

/**
 * The filters of the work lists (Task Queue, My Work, Pod Work) as `FilterDef[]`, with exactly the URL parameter names of
 * `QueueFilters` / `GET /api/v1/task-queue` (shared/work-queue/queue-filters.ts). This is the adapter that lets the work lists move from
 * `QueueFilters` to `ListFilters` one screen at a time: `shared/filters/queue-defs.spec.ts` proves that both read every dashboard and
 * Advanced-search deep link to the same filters. Pages pass their lookups (priorities, pods, people, types, workflows) as options.
 *
 * Column of each filter (`ref` and `title` share one control that spans both): Title or Ref, Matter, Client, Project, Task type, Workflow,
 * Priority, Pod, Assignee, Creator, Requestor, Due, Status, Created, Updated. ASAP, Overdue and Closed (completed) have no column of
 * their own: they live in "Other filters". `client`, `matter` and `project` (ids) are the link-only parameters of dashboard links.
 */
export interface QueueLookups {
  statuses?: readonly FilterOption[];
  priorities?: readonly FilterOption[];
  pods?: readonly FilterOption[];
  users?: readonly FilterOption[];
  types?: readonly FilterOption[];
  workflows?: readonly FilterOption[];
  /** The on-hold reasons (PM v2, #877); "No reason given" (`0`) is added in front. */
  onHoldReasons?: readonly FilterOption[];
}

export interface QueueDefOptions {
  /** Keys left out: Pod Work has no Pod filter (the Pod is the scope of the page). */
  omit?: readonly string[];
  /** Why a filter is unavailable on the current tab (read on every render); the key of the definition. `due` covers ASAP and Overdue. */
  disabled?: Readonly<Record<string, () => string | null | undefined>>;
  /** What a tab-owned filter reads in its disabled cell (`Me`, `Next 2 days and overdue`); the key of the definition. */
  fixed?: Readonly<Record<string, () => string | null | undefined>>;
  /** The status choices (default: all five). My Work and Pod Work limit them per tab. */
  statuses?: () => readonly FilterOption[];
  /** The statuses a plain link starts on (Task Queue: the open ones). A link with other filters and no status asks for every status. */
  defaultStatus?: readonly string[];
  /** My Work, Closed tab: adds the "Closed: all time" chip of `closed=all` ("Show older"; removing it returns to the 90-day window). */
  closedWindow?: boolean;
  /** My Work: adds the "New since your last visit" chip of `new=1` (the strip's New item; removing the chip lists every task again). */
  newSince?: boolean;
  /** Names for the link-only record chips (`?matter=12` shows "Matter: 00343-00012"). */
  names?: {
    client?: (id: string) => string;
    matter?: (id: string) => string;
    project?: (id: string) => string;
    /** The person a `managerId` link names (`?managerId=12` shows "Project manager: Dana Director"). */
    manager?: (id: string) => string;
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
  const off = (key: string): Pick<FilterDef, 'disabledReason' | 'fixedValue'> => {
    const r = reason(key);
    if (!r) return {};
    const fixedValue = options.fixed?.[key];
    return fixedValue ? { disabledReason: r, fixedValue } : { disabledReason: r };
  };
  const defs: FilterDef[] = [
    // Ref and Title share the control: it searches the title and the task number.
    {
      key: 'q',
      label: 'Title or Ref',
      placeholder: 'Title or ref',
      column: 'ref',
      type: 'text',
      span: 2,
    },
    {
      key: 'status',
      label: 'Status',
      column: 'status',
      type: 'multiSelect',
      options: options.statuses ?? list(lookups.statuses),
      normalize: asStatus,
      valueGroups: [OPEN_GROUP],
      // A link or restored view may carry a status the tab does not offer (NEW on Active): its chip still reads "New".
      valueLabel: (v) => lookups.statuses?.find((o) => o.value === v)?.label ?? v,
      emptyLabel: 'All',
      ...(options.defaultStatus ? { default: options.defaultStatus, defaultOnlyBare: true } : {}),
      ...off('status'),
    },
    { key: 'matterText', label: 'Matter Number', column: 'matter', type: 'text' },
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
      // Due dates look ahead: Today, Tomorrow, Next 7 days, This week, Next week, This month (G2). Overdue is not a preset: a date range
      // cannot say "timed earlier today", so it would not match the Overdue filter and the strip.
      presets: DUE_PRESETS,
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
    // No column of their own: Other filters.
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
    ...(options.newSince
      ? [
          {
            key: 'newSince',
            label: 'New',
            type: 'select',
            param: 'new',
            noControl: true,
            bareChip: true,
            options: [{ value: '1', label: 'New since your last visit' }],
            normalize: (v: string) => (v === '1' ? '1' : null),
            ...off('newSince'),
          } satisfies FilterDef,
        ]
      : []),
    {
      key: 'asap',
      label: 'ASAP',
      type: 'triState',
      options: TRI('Any', 'ASAP only', 'Has a due date'),
      bareChip: true,
      ...off('due'),
    },
    {
      key: 'overdue',
      label: 'Overdue',
      type: 'triState',
      options: TRI('Any', 'Overdue only', 'Not overdue'),
      bareChip: true,
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
    // Project Manager epic (#667), link-only: tasks on matters a person manages. A removable chip, never a column; a matter without a manager
    // is not matched and nothing says so.
    {
      key: 'managedByMe',
      label: 'Managed by me',
      type: 'select',
      param: 'managedByMe',
      noControl: true,
      bareChip: true,
      options: [{ value: 'true', label: 'On matters I manage' }],
      normalize: (v: string) => (v.toLowerCase() === 'true' ? 'true' : null),
    },
    {
      key: 'managerId',
      label: 'Project manager',
      type: 'text',
      noControl: true,
      normalize: asId,
      valueLabel: (id: string) =>
        options.names?.manager?.(id) ??
        lookups.users?.find((o) => o.value === id)?.label ??
        'selected person',
    },
    {
      key: 'role',
      label: 'As',
      type: 'select',
      param: 'role',
      noControl: true,
      options: [
        { value: 'primary', label: 'Primary manager' },
        { value: 'secondary', label: 'Secondary manager' },
      ],
      normalize: (v: string) => (v === 'primary' || v === 'secondary' ? v : null),
    },
    {
      key: 'dueWithin',
      label: 'Due within',
      type: 'select',
      param: 'dueWithin',
      noControl: true,
      options: [
        { value: '3', label: '3 days' },
        { value: '7', label: '7 days' },
      ],
      normalize: (v: string) => (v === '3' || v === '7' ? v : null),
    },
    // PM v2 (#877, #878): the At risk rule (open, not overdue, 80 percent of the type's target used; Other filters) and the structured
    // reason of a hold (the On-hold reason column, beside Status).
    {
      key: 'atRisk',
      label: 'At risk',
      type: 'select',
      param: 'atRisk',
      allLabel: 'Any',
      bareChip: true,
      options: [{ value: 'true', label: 'At risk only' }],
      normalize: (v: string) => (v.toLowerCase() === 'true' ? 'true' : null),
    },
    {
      key: 'onHoldReason',
      label: 'On-hold reason',
      column: 'onHoldReason',
      type: 'multiSelect',
      param: 'onHoldReason',
      options: () => [{ value: '0', label: 'No reason given' }, ...(lookups.onHoldReasons ?? [])],
      normalize: (v: string) => (/^\d+$/.test(v) ? v : null),
      valueLabel: (id: string) =>
        id === '0'
          ? 'No reason given'
          : (lookups.onHoldReasons?.find((o) => o.value === id)?.label ?? 'selected reason'),
    },
  ];
  const omit = options.omit ?? [];
  return defs.filter((d) => !omit.includes(d.key));
}

/** The URL parameters of every work-list filter (also the ones a screen leaves out), to tell a plain link from one that carries filters. */
export const QUEUE_FILTER_PARAMS: readonly string[] = [
  ...new Set(queueFilterDefs().flatMap((d) => paramsOf(d))),
];

/**
 * `?creator=<viewer>` alone is the Created by me view: for the status default it counts as a plain link, so the view starts on Open like
 * My Work's and the address needs no `status=` (#222). Any other filter, or another creator, means what it says; `status=` widens it.
 */
export function createdByMeLink(userId: number | null): PlainLink {
  return (link) => {
    if (userId === null) return false;
    const present = QUEUE_FILTER_PARAMS.filter((p) => link.has(p));
    if (present.length !== 1 || present[0] !== 'creator') return false;
    const wanted = link
      .getAll('creator')
      .flatMap((v) => v.split(','))
      .map((v) => v.trim())
      .filter(Boolean);
    return wanted.length === 1 && wanted[0] === String(userId);
  };
}

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
    managedByMe: f.managedByMe ? 'true' : '',
    managerId: f.managerId === null ? '' : String(f.managerId),
    role: f.role,
    dueWithin: f.dueWithin === null ? '' : String(f.dueWithin),
    atRisk: f.atRisk ? 'true' : '',
    onHoldReason: str(f.onHoldReason),
  };
}
