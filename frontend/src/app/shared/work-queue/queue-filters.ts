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
}

export type SortDirection = 'asc' | 'desc';

export interface QueueState {
  filters: QueueFilters;
  /** API sort field (`priority`, `priorityAge`, `due`, `created`, `number`, `status`, `completed`); null = the default queue order. */
  sort: string | null;
  dir: SortDirection | null;
  page: number;
  pageSize: number;
  /** Tab of My Work / Pod Work. */
  view: string | null;
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
export function parseQueueState(params: ParamMap): QueueState {
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
    },
    sort: sort && SORT_FIELDS.includes(sort) ? sort : null,
    dir: dir === 'asc' || dir === 'desc' ? dir : null,
    page: Number.isInteger(page) && page >= 1 ? page : 1,
    pageSize: PAGE_SIZES.includes(size) ? size : DEFAULT_PAGE_SIZE,
    view: params.get('view'),
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
  options: { explicitStatus?: boolean } = {},
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
    sort: state.sort,
    dir: state.sort && state.dir ? state.dir : null,
    page: state.page > 1 ? String(state.page) : null,
    pageSize: state.pageSize === DEFAULT_PAGE_SIZE ? null : String(state.pageSize),
    view: state.view,
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
  ].filter(Boolean).length;
}

export function sameSet(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && b.every((x) => a.includes(x));
}

// ---- built-in views (baseline 12.6)

export type BuiltInViewKey =
  'allOpen' | 'unassigned' | 'myPod' | 'createdByMe' | 'overdue' | 'recentlyCompleted';

export interface BuiltInView {
  key: BuiltInViewKey;
  label: string;
}

export const BUILT_IN_VIEWS: readonly BuiltInView[] = [
  { key: 'allOpen', label: 'All open' },
  { key: 'unassigned', label: 'Unassigned' },
  { key: 'myPod', label: 'My pod' },
  { key: 'createdByMe', label: 'Created by me' },
  { key: 'overdue', label: 'Overdue' },
  { key: 'recentlyCompleted', label: 'Recently completed' },
];

export interface ViewContext {
  userId: number | null;
  primaryPodId: number | null;
  /** `yyyy-MM-dd` of the day 30 days ago in the viewer's zone, for "Recently completed". */
  recentFrom: string;
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
      return { ...f, creator: ctx.userId ? [ctx.userId] : [] };
    case 'overdue':
      return { ...f, status: [...OPEN_STATUSES], overdue: true };
    case 'recentlyCompleted':
      return { ...f, status: ['COMPLETED'], completedFrom: ctx.recentFrom };
  }
}

/** The built-in view whose filters equal the current ones, if any (to mark it pressed). */
export function activeBuiltIn(f: QueueFilters, ctx: ViewContext): BuiltInViewKey | null {
  const target = JSON.stringify(normalize(f));
  for (const view of BUILT_IN_VIEWS) {
    if (view.key === 'myPod' && !ctx.primaryPodId) continue;
    if (JSON.stringify(normalize(builtInFilters(view.key, ctx))) === target) return view.key;
  }
  return null;
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
    state.sort ?? undefined,
    state.sort ? (state.dir ?? undefined) : undefined,
    state.page,
    state.pageSize,
  ];
}

/** `yyyy-MM-dd` of today minus `days`, in the given zone. */
export function dateDaysAgo(now: Date, days: number, zone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: zone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(now.getTime() - days * 86_400_000));
  return parts;
}
