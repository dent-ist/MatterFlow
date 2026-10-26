import { ParamMap } from '@angular/router';

/**
 * Filter, sort and paging state shared by the Task Queue, My Work and Pod Work. It round-trips through the URL query string
 * (the same parameter names as `GET /api/v1/task-queue`), so every view is shareable, back-button safe, and dashboard links such as
 * `/tasks?overdue=true&status=NEW&status=IN_PROGRESS` just work.
 */
export interface QueueFilters {
  q: string;
  status: string[];
  priority: number[];
  pod: number[];
  /** Tasks without a Pod (combined with `pod` as either/or, like `unassigned` with `assignee`). */
  noPod: boolean;
  assignee: number[];
  unassigned: boolean;
  creator: number[];
  client: number | null;
  matter: number | null;
  project: number | null;
  type: number[];
  workflow: number[];
  createdFrom: string | null;
  createdTo: string | null;
  dueFrom: string | null;
  dueTo: string | null;
  asap: boolean | null;
  overdue: boolean | null;
  requestor: string;
  completedFrom: string | null;
  completedTo: string | null;
  /** Column text filters: contained in the Matter reference or name / the Client name or number / the Project name. */
  matterText: string;
  clientText: string;
  projectText: string;
  updatedFrom: string | null;
  updatedTo: string | null;
  /**
   * Project Manager epic (#667): only tasks on matters the viewer manages (`managedByMe=true`), or on matters `managerId` manages (needs
   * Matter.AssignManagers). `role` narrows it to the Primary or the Secondary place ('' = either). `dueWithin` (3 or 7) is open, not overdue,
   * due within that many days. Link-only filters: removable chips, no column.
   */
  managedByMe: boolean;
  managerId: number | null;
  role: '' | 'primary' | 'secondary';
  dueWithin: 3 | 7 | null;
  /** PM v2: only open tasks that are At risk (`atRisk=true`; the target-turnaround rule of the server). Link-only, a removable chip. */
  atRisk: boolean;
  /** PM v2: On Hold tasks with one of these on-hold reasons (`onHoldReason=<id>`, repeatable; `0` = no reason chosen). Link-only, a removable chip. */
  onHoldReason: number[];
}

export type SortDirection = 'asc' | 'desc';

export interface QueueState {
  filters: QueueFilters;
  /** API sort field (`priority`, `priorityAge`, `due`, `created`, `number`, `status`, `completed`, `closed`, `title`, `matter`, `updated`, `age`); null = the default queue order. */
  sort: string | null;
  dir: SortDirection | null;
  page: number;
  pageSize: number;
  /** Tab of My Work / Pod Work. */
  view: string | null;
  /** My Work, Closed tab: "Show older" is an explicit all-time state (`closed=all`), not a date. A closed-date range wins over it. */
  closedAll: boolean;
  /** My Work: only tasks assigned since the start of the viewer's visit (`new=1`). The address carries the flag, never the instant. */
  newOnly: boolean;
  /** My Work, Active tab: `due` groups the rows by due bucket (`group=due`); null is the plain list. Only My Work reads it. */
  group: 'due' | null;
  podId: number | null;
}

export const OPEN_STATUSES: readonly string[] = ['NEW', 'IN_PROGRESS', 'ON_HOLD'];
export const CLOSED_STATUSES: readonly string[] = ['COMPLETED', 'CANCELLED'];
export const ALL_STATUSES: readonly string[] = [...OPEN_STATUSES, ...CLOSED_STATUSES];
export const SORT_FIELDS: readonly string[] = [
  'priority',
  'due',
  'created',
  'number',
  'status',
  'completed',
  'priorityAge',
  'closed',
  'title',
  'matter',
  'matterName',
  'updated',
  'age',
  'assignee',
  'client',
  'onHoldSince',
  'type',
];
export const PAGE_SIZES: readonly number[] = [25, 50, 100];
export const DEFAULT_PAGE_SIZE = 50;

export function emptyFilters(): QueueFilters {
  return {
    q: '',
    status: [],
    priority: [],
    pod: [],
    noPod: false,
    assignee: [],
    unassigned: false,
    creator: [],
    client: null,
    matter: null,
    project: null,
    type: [],
    workflow: [],
    createdFrom: null,
    createdTo: null,
    dueFrom: null,
    dueTo: null,
    asap: null,
    overdue: null,
    requestor: '',
    completedFrom: null,
    completedTo: null,
    matterText: '',
    clientText: '',
    projectText: '',
    updatedFrom: null,
    updatedTo: null,
    managedByMe: false,
    managerId: null,
    role: '',
    dueWithin: null,
    atRisk: false,
    onHoldReason: [],
  };
}

export function emptyState(): QueueState {
  return {
    filters: emptyFilters(),
    sort: null,
    dir: null,
    page: 1,
    pageSize: DEFAULT_PAGE_SIZE,
    view: null,
    closedAll: false,
    newOnly: false,
    group: null,
    podId: null,
  };
}

// ---- URL <-> state

function ids(params: ParamMap, key: string): number[] {
  const out: number[] = [];
  for (const raw of params.getAll(key)) {
    for (const part of raw.split(',')) {
      const n = Number(part.trim());
      if (Number.isInteger(n) && n > 0 && !out.includes(n)) out.push(n);
    }
  }
  return out;
}

function id(params: ParamMap, key: string): number | null {
  return ids(params, key)[0] ?? null;
}

function bool(params: ParamMap, key: string): boolean | null {
  const v = params.get(key)?.toLowerCase();
  return v === 'true' ? true : v === 'false' ? false : null;
}

function date(params: ParamMap, key: string): string | null {
  const v = params.get(key);
  return v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null;
}

function managerRole(value: string | null): '' | 'primary' | 'secondary' {
  const v = value?.trim().toLowerCase();
  return v === 'primary' || v === 'secondary' ? v : '';
}

function dueWithin(value: string | null): 3 | 7 | null {
  return value === '3' ? 3 : value === '7' ? 7 : null;
}

/** `onHoldReason=<id>` (repeatable): ids of reasons; `0` means On Hold with no reason. Anything else is ignored. */
function reasonIds(params: ParamMap): number[] {
  const out: number[] = [];
  for (const raw of params.getAll('onHoldReason')) {
    for (const part of raw.split(',')) {
      const n = Number(part.trim());
      if (part.trim() !== '' && Number.isInteger(n) && n >= 0 && !out.includes(n)) out.push(n);
    }
  }
  return out;
}

function statuses(params: ParamMap): string[] {
  const out: string[] = [];
  for (const raw of params.getAll('status')) {
    for (const part of raw.split(',')) {
      const code = part.trim().toUpperCase();
      if (ALL_STATUSES.includes(code) && !out.includes(code)) out.push(code);
    }
  }
  return out;
}

/** Reads the query string into a state; unknown or malformed values are ignored. */
export function parseQueueState(
  params: ParamMap,
  /** The size when the address names none: the person's remembered one (#237). An explicit `pageSize` always wins. */
  defaultSize: number = DEFAULT_PAGE_SIZE,
): QueueState {
  const sort = params.get('sort');
  const dir = params.get('dir');
  const page = Number(params.get('page'));
  const size = Number(params.get('pageSize'));
  return {
    filters: {
      q: params.get('q')?.trim() ?? '',
      status: statuses(params),
      priority: ids(params, 'priority'),
      pod: ids(params, 'pod'),
      noPod: bool(params, 'noPod') === true,
      assignee: ids(params, 'assignee'),
      unassigned: bool(params, 'unassigned') === true,
      creator: ids(params, 'creator'),
      client: id(params, 'client'),
      matter: id(params, 'matter'),
      project: id(params, 'project'),
      type: ids(params, 'type'),
      workflow: ids(params, 'workflow'),
      createdFrom: date(params, 'createdFrom'),
      createdTo: date(params, 'createdTo'),
      dueFrom: date(params, 'dueFrom'),
      dueTo: date(params, 'dueTo'),
      asap: bool(params, 'asap'),
      overdue: bool(params, 'overdue'),
      requestor: params.get('requestor')?.trim() ?? '',
      completedFrom: date(params, 'completedFrom'),
      completedTo: date(params, 'completedTo'),
      matterText: params.get('matterText')?.trim() ?? '',
      clientText: params.get('clientText')?.trim() ?? '',
      projectText: params.get('projectText')?.trim() ?? '',
      updatedFrom: date(params, 'updatedFrom'),
      updatedTo: date(params, 'updatedTo'),
      managedByMe: bool(params, 'managedByMe') === true,
      managerId: id(params, 'managerId'),
      role: managerRole(params.get('role')),
      dueWithin: dueWithin(params.get('dueWithin')),
      atRisk: bool(params, 'atRisk') === true,
      onHoldReason: reasonIds(params),
    },
    sort: sort && SORT_FIELDS.includes(sort) ? sort : null,
    dir: dir === 'asc' || dir === 'desc' ? dir : null,
    page: Number.isInteger(page) && page >= 1 ? page : 1,
    pageSize: PAGE_SIZES.includes(size) ? size : defaultSize,
    view: params.get('view'),
    closedAll: params.get('closed')?.toLowerCase() === 'all',
    newOnly: params.get('new') === '1',
    group: params.get('group') === 'due' ? 'due' : null,
    podId: id(params, 'podId'),
  };
}

export type QueryParamValue = string | string[] | null;

/**
 * The query string for a state: a `null` removes the parameter (use with `queryParamsHandling: 'merge'`). With `explicitStatus` an empty
 * status list is written as `status=` ("every status"): a screen whose plain link starts on the open statuses (Task Queue) must not read
 * a link that says nothing about status as that default.
 */
export function toQueryParams(
  state: QueueState,
  options: { explicitStatus?: boolean; defaultSize?: number } = {},
): Record<string, QueryParamValue> {
  const f = state.filters;
  const list = (values: readonly (string | number)[]): QueryParamValue =>
    values.length ? values.map(String) : null;
  return {
    q: f.q || null,
    status: f.status.length === 0 && options.explicitStatus ? '' : list(f.status),
    priority: list(f.priority),
    pod: list(f.pod),
    noPod: f.noPod ? 'true' : null,
    assignee: list(f.assignee),
    unassigned: f.unassigned ? 'true' : null,
    creator: list(f.creator),
    client: f.client === null ? null : String(f.client),
    matter: f.matter === null ? null : String(f.matter),
    project: f.project === null ? null : String(f.project),
    type: list(f.type),
    workflow: list(f.workflow),
    createdFrom: f.createdFrom,
    createdTo: f.createdTo,
    dueFrom: f.dueFrom,
    dueTo: f.dueTo,
    asap: f.asap === null ? null : String(f.asap),
    overdue: f.overdue === null ? null : String(f.overdue),
    requestor: f.requestor || null,
    completedFrom: f.completedFrom,
    completedTo: f.completedTo,
    matterText: f.matterText || null,
    clientText: f.clientText || null,
    projectText: f.projectText || null,
    updatedFrom: f.updatedFrom,
    updatedTo: f.updatedTo,
    managedByMe: f.managedByMe ? 'true' : null,
    managerId: f.managerId === null ? null : String(f.managerId),
    role: f.role || null,
    dueWithin: f.dueWithin === null ? null : String(f.dueWithin),
    atRisk: f.atRisk ? 'true' : null,
    onHoldReason: list(f.onHoldReason),
    sort: state.sort,
    dir: state.sort && state.dir ? state.dir : null,
    page: state.page > 1 ? String(state.page) : null,
    // Left out only when it is the standard 50 and nothing else is remembered, so a link never depends on someone's preference.
    pageSize:
      state.pageSize === DEFAULT_PAGE_SIZE &&
      (options.defaultSize ?? DEFAULT_PAGE_SIZE) === DEFAULT_PAGE_SIZE
        ? null
        : String(state.pageSize),
    view: state.view,
    closed: state.closedAll ? 'all' : null,
    new: state.newOnly ? '1' : null,
    group: state.group,
    podId: state.podId === null ? null : String(state.podId),
  };
}

/** True when any filter (not sort or paging) is set. */
export function hasFilters(f: QueueFilters): boolean {
  return filterCount(f) > 0;
}

/** Number of distinct active filters (a repeated parameter counts once). */
export function filterCount(f: QueueFilters): number {
  return [
    f.q,
    f.status.length,
    f.priority.length,
    f.pod.length || f.noPod,
    f.assignee.length || f.unassigned,
    f.creator.length,
    f.client,
    f.matter,
    f.project,
    f.type.length,
    f.workflow.length,
    f.createdFrom || f.createdTo,
    f.dueFrom || f.dueTo,
    f.asap !== null,
    f.overdue !== null,
    f.requestor,
    f.completedFrom || f.completedTo,
    f.matterText,
    f.clientText,
    f.projectText,
    f.updatedFrom || f.updatedTo,
    f.managedByMe || f.managerId,
    f.role,
    f.dueWithin,
    f.atRisk,
    f.onHoldReason.length,
  ].filter(Boolean).length;
}

export function sameSet(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && b.every((x) => a.includes(x));
}

// ---- built-in views (baseline 12.6)

export type BuiltInViewKey =
  | 'allOpen'
  | 'unassigned'
  | 'overdue'
  | 'dueSoon'
  | 'asap'
  | 'onHold'
  | 'myPod'
  | 'createdByMe'
  | 'recentlyCompleted';

export interface BuiltInView {
  key: BuiltInViewKey;
  label: string;
}

/**
 * The quick views in the order of the row (#220): the first six mirror the Dashboard tiles (All open, Unassigned, Overdue, Due soon, ASAP,
 * On hold), then My pod and Created by me; Recently completed is last and lives in the "More" menu.
 */
export const BUILT_IN_VIEWS: readonly BuiltInView[] = [
  { key: 'allOpen', label: 'All open' },
  { key: 'unassigned', label: 'Unassigned' },
  { key: 'overdue', label: 'Overdue' },
  { key: 'dueSoon', label: 'Due soon' },
  { key: 'asap', label: 'ASAP' },
  { key: 'onHold', label: 'On hold' },
  { key: 'myPod', label: 'My pod' },
  { key: 'createdByMe', label: 'Created by me' },
  { key: 'recentlyCompleted', label: 'Recently completed' },
];

/** The view that is always kept behind the "More" menu, whatever the width. */
export const MORE_VIEW: BuiltInViewKey = 'recentlyCompleted';

export interface ViewContext {
  userId: number | null;
  primaryPodId: number | null;
  /** `yyyy-MM-dd` of the first day of the 30-day window of "Recently completed" (today minus 29: the Dashboard's Completed tile), in the viewer's zone. */
  recentFrom: string;
  /** `yyyy-MM-dd` of the last day of the Due soon window (today plus 2), in the viewer's zone. */
  dueSoonTo: string;
  /** The viewer holds Task.Create: without it "Created by me" is not offered (a viewer who cannot create tasks has created none). */
  canCreate: boolean;
}

/** The views offered to this viewer: My pod needs a primary Pod, Created by me needs Task.Create (hidden, not disabled: #223). */
export function availableViews(ctx: ViewContext): readonly BuiltInView[] {
  return BUILT_IN_VIEWS.filter(
    (v) => (v.key !== 'myPod' || !!ctx.primaryPodId) && (v.key !== 'createdByMe' || ctx.canCreate),
  );
}

/** The filters a built-in view stands for; sort and paging are reset by the caller. */
export function builtInFilters(key: BuiltInViewKey, ctx: ViewContext): QueueFilters {
  const f = emptyFilters();
  switch (key) {
    case 'allOpen':
      return { ...f, status: [...OPEN_STATUSES] };
    case 'unassigned':
      return { ...f, status: [...OPEN_STATUSES], unassigned: true };
    case 'myPod':
      return { ...f, status: [...OPEN_STATUSES], pod: ctx.primaryPodId ? [ctx.primaryPodId] : [] };
    case 'createdByMe':
      // Open like My Work's Created by me (#222); the Status chip widens it.
      return { ...f, status: [...OPEN_STATUSES], creator: ctx.userId ? [ctx.userId] : [] };
    case 'overdue':
      return { ...f, status: [...OPEN_STATUSES], overdue: true };
    case 'dueSoon':
      // The Dashboard's Due soon link: open, explicit due date (not ASAP), not overdue, due by today plus 2.
      return {
        ...f,
        status: [...OPEN_STATUSES],
        asap: false,
        overdue: false,
        dueTo: ctx.dueSoonTo,
      };
    case 'asap':
      return { ...f, status: [...OPEN_STATUSES], asap: true };
    case 'onHold':
      return { ...f, status: ['ON_HOLD'] };
    case 'recentlyCompleted':
      return { ...f, status: ['COMPLETED'], completedFrom: ctx.recentFrom };
  }
}

/**
 * The filter groups (keys of the column filters) each view owns: they ARE the view, so a pressed view hides their chips and does not count
 * them in "Filters (n)" (#221). Groups are whole: Due is `dueFrom` and `dueTo`, Assignee holds `unassigned`, Closed is both dates.
 */
export const VIEW_OWNED: Readonly<Record<BuiltInViewKey, readonly string[]>> = {
  allOpen: ['status'],
  unassigned: ['status', 'assignee'],
  overdue: ['status', 'overdue'],
  dueSoon: ['status', 'asap', 'overdue', 'due'],
  asap: ['status', 'asap'],
  onHold: ['status'],
  myPod: ['status', 'pod'],
  createdByMe: ['status', 'creator'],
  recentlyCompleted: ['status', 'completed'],
};

/** The `QueueFilters` fields of each owned filter group, to compare a link with a view by shape. */
const GROUP_FIELDS: Readonly<Record<string, readonly (keyof QueueFilters)[]>> = {
  status: ['status'],
  assignee: ['assignee', 'unassigned'],
  pod: ['pod', 'noPod'],
  creator: ['creator'],
  overdue: ['overdue'],
  asap: ['asap'],
  due: ['dueFrom', 'dueTo'],
  completed: ['completedFrom', 'completedTo'],
};

/** The built-in view whose filters equal the current ones exactly, if any. */
export function activeBuiltIn(f: QueueFilters, ctx: ViewContext): BuiltInViewKey | null {
  const target = JSON.stringify(normalize(f));
  for (const view of availableViews(ctx)) {
    if (JSON.stringify(normalize(builtInFilters(view.key, ctx))) === target) return view.key;
  }
  return null;
}

/**
 * The view a set of filters shows, by shape (#221): its owned filters equal the view's and anything else is an extra filter on top of it
 * (`extra`). A Dashboard "Due soon" link with `priority=1` added is still Due soon, with one extra filter. All open is matched exactly only
 * (every link with the open statuses would otherwise be "All open").
 */
export function matchBuiltIn(
  f: QueueFilters,
  ctx: ViewContext,
): { key: BuiltInViewKey; extra: boolean } | null {
  const exact = activeBuiltIn(f, ctx);
  if (exact) return { key: exact, extra: false };
  const mine = normalize(f);
  let best: BuiltInViewKey | null = null;
  let bestSize = 0;
  for (const view of availableViews(ctx)) {
    if (view.key === 'allOpen') continue;
    const wanted = normalize(builtInFilters(view.key, ctx));
    const owned = VIEW_OWNED[view.key];
    const same = owned.every((group) =>
      (GROUP_FIELDS[group] ?? []).every(
        (field) => JSON.stringify(mine[field]) === JSON.stringify(wanted[field]),
      ),
    );
    if (same && owned.length > bestSize) {
      best = view.key;
      bestSize = owned.length;
    }
  }
  return best ? { key: best, extra: true } : null;
}

function normalize(f: QueueFilters): QueueFilters {
  const sorted = <T extends string | number>(list: T[]) => [...list].sort();
  return {
    ...f,
    status: sorted(f.status),
    priority: sorted(f.priority),
    pod: sorted(f.pod),
    assignee: sorted(f.assignee),
    creator: sorted(f.creator),
    type: sorted(f.type),
    workflow: sorted(f.workflow),
  };
}

// ---- API arguments

/**
 * The filter arguments of the generated clients, in the order they follow the leading arguments (`view`/`podId`), ending with
 * sort and paging. Spread after the leading ones: `client.getMyWork(view, ...queueArgs(state))`.
 */
export function queueArgs(
  state: QueueState,
  options: { omitPod?: boolean } = {},
): [
  q: string | undefined,
  status: string[] | undefined,
  priority: number[] | undefined,
  pod: number[] | undefined,
  noPod: boolean | undefined,
  assignee: number[] | undefined,
  unassigned: boolean | undefined,
  creator: number[] | undefined,
  client: number | undefined,
  matter: number | undefined,
  project: number | undefined,
  type: number[] | undefined,
  workflow: number[] | undefined,
  createdFrom: string | undefined,
  createdTo: string | undefined,
  dueFrom: string | undefined,
  dueTo: string | undefined,
  asap: boolean | undefined,
  overdue: boolean | undefined,
  requestor: string | undefined,
  completedFrom: string | undefined,
  completedTo: string | undefined,
  matterText: string | undefined,
  clientText: string | undefined,
  projectText: string | undefined,
  updatedFrom: string | undefined,
  updatedTo: string | undefined,
  managedByMe: boolean | undefined,
  managerId: number | undefined,
  role: string | undefined,
  dueWithin: number | undefined,
  atRisk: boolean | undefined,
  onHoldReason: number[] | undefined,
  sort: string | undefined,
  dir: string | undefined,
  page: number | undefined,
  pageSize: number | undefined,
] {
  const f = state.filters;
  const some = <T>(list: T[]): T[] | undefined => (list.length ? list : undefined);
  return [
    f.q || undefined,
    some(f.status),
    some(f.priority),
    options.omitPod ? undefined : some(f.pod),
    options.omitPod || !f.noPod ? undefined : true,
    some(f.assignee),
    f.unassigned ? true : undefined,
    some(f.creator),
    f.client ?? undefined,
    f.matter ?? undefined,
    f.project ?? undefined,
    some(f.type),
    some(f.workflow),
    f.createdFrom ?? undefined,
    f.createdTo ?? undefined,
    f.dueFrom ?? undefined,
    f.dueTo ?? undefined,
    f.asap ?? undefined,
    f.overdue ?? undefined,
    f.requestor || undefined,
    f.completedFrom ?? undefined,
    f.completedTo ?? undefined,
    f.matterText || undefined,
    f.clientText || undefined,
    f.projectText || undefined,
    f.updatedFrom ?? undefined,
    f.updatedTo ?? undefined,
    f.managedByMe ? true : undefined,
    f.managerId ?? undefined,
    f.role || undefined,
    f.dueWithin ?? undefined,
    f.atRisk ? true : undefined,
    some(f.onHoldReason),
    state.sort ?? undefined,
    state.sort ? (state.dir ?? undefined) : undefined,
    state.page,
    state.pageSize,
  ];
}

/**
 * The arguments of `getTaskQueue`: the endpoint's own `group` comes first in the generated client, then the shared filters, sort and paging
 * (`queueArgs`). `group: 'due'` asks for the due buckets of a Due-sorted list; omit it for a plain page.
 */
export function taskQueueArgs(
  state: QueueState,
  group?: 'due',
): [group: string | undefined, ...rest: ReturnType<typeof queueArgs>] {
  return [group, ...queueArgs(state)];
}

/**
 * `yyyy-MM-dd` of the viewer's today minus `days` (a negative number looks ahead), in the given zone. The calendar day of `now` in the zone
 * is found first and the days are counted on the calendar, so a daylight saving change inside the span never moves the result.
 */
export function dateDaysAgo(now: Date, days: number, zone: string): string {
  const today = new Intl.DateTimeFormat('en-CA', {
    timeZone: zone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
  const [y, m, d] = today.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d - days)).toISOString().slice(0, 10);
}
