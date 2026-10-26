/**
 * A column of the work tables (Task Queue, My Work, Pod Work). Ref and Title are locked: they cannot be hidden (UX 5.2).
 *
 * Column contract (#200): every column declares its width model in px (converted to `rem` at the app's 14 px root when applied, so text-only
 * zoom scales the columns, WCAG 1.4.4): the default `width`, the `minWidth` and `maxWidth` a user may resize it to (#204 to #207), and
 * `fill` for the one column (Title) that takes the space the others leave. A new column without these does not ship.
 */
export interface ColumnDef {
  key: string;
  label: string;
  locked?: boolean;
  /** The API `sort` value of a sortable column. */
  sortField?: string;
  /** Default width in px at the default zoom. For the `fill` column it is the minimum. */
  width: number;
  minWidth: number;
  maxWidth: number;
  /** The spring: no stored width, takes what the other columns leave (never narrower than `minWidth`). */
  fill?: boolean;
  /** False for a column the user cannot resize (the Title). */
  resizable?: boolean;
  /** Drops out of a narrow box when the Title would get too narrow (the order is `NARROW_DROP_ORDER`, `narrow-columns.ts`). */
  autoHide?: boolean;
}

export const WORK_COLUMNS: readonly ColumnDef[] = [
  // 112 and not the review's 96 (measured, PM ruling): the pause marker, a four-digit number (TSK-1008) and the New dot need 109 px.
  {
    key: 'ref',
    label: 'Ref',
    locked: true,
    sortField: 'number',
    width: 112,
    minWidth: 80,
    maxWidth: 120,
  },
  {
    key: 'title',
    label: 'Title',
    locked: true,
    sortField: 'title',
    width: 160,
    minWidth: 160,
    maxWidth: 160,
    fill: true,
    resizable: false,
  },
  // The reference only (one line); the storage key stays `matter` so stored columns, widths and sorts survive the rename (#348). 144 and not
  // the 160 of the two-line cell: the reference needs about 120 px and the room goes to Matter Name (measured, see docs/ux/task-queue-review).
  {
    key: 'matter',
    label: 'Matter Number',
    sortField: 'matter',
    width: 144,
    minWidth: 112,
    maxWidth: 320,
  },
  // The matter name in its own column (#348): one line, ellipsis, full text as the tooltip. 160 and not the planned 200 (measured): with 200 the
  // Task Queue default no longer fits a 1440 px window with a 200 px Title; it is the first column to drop out of a narrow box.
  {
    key: 'matterName',
    label: 'Matter Name',
    sortField: 'matterName',
    width: 160,
    minWidth: 112,
    maxWidth: 360,
    autoHide: true,
  },
  {
    key: 'client',
    label: 'Client',
    sortField: 'client',
    width: 140,
    minWidth: 96,
    maxWidth: 280,
    autoHide: true,
  },
  { key: 'project', label: 'Project', width: 140, minWidth: 96, maxWidth: 280, autoHide: true },
  { key: 'type', label: 'Task type', width: 140, minWidth: 96, maxWidth: 280, autoHide: true },
  { key: 'workflow', label: 'Workflow', width: 150, minWidth: 96, maxWidth: 280, autoHide: true },
  {
    key: 'progress',
    label: 'Workflow progress',
    width: 160,
    minWidth: 120,
    maxWidth: 320,
    autoHide: true,
  },
  // The Priority trigger (badge, label, chevron) is 106 px until #202 moves the chevron inside; it may spill 2 px into the cell padding (`_tables.scss`).
  {
    key: 'priority',
    label: 'Priority',
    sortField: 'priority',
    width: 112,
    minWidth: 96,
    maxWidth: 160,
  },
  { key: 'pod', label: 'Pod', width: 140, minWidth: 96, maxWidth: 280, autoHide: true },
  {
    key: 'assignee',
    label: 'Assignee',
    sortField: 'assignee',
    width: 136,
    minWidth: 112,
    maxWidth: 240,
  },
  { key: 'creator', label: 'Creator', width: 140, minWidth: 96, maxWidth: 280, autoHide: true },
  { key: 'requestor', label: 'Requestor', width: 140, minWidth: 96, maxWidth: 280, autoHide: true },
  // Due: 120 px is the least that holds "Overdue 120d" with its icon (PM ruling on #200).
  { key: 'due', label: 'Due', sortField: 'due', width: 136, minWidth: 120, maxWidth: 200 },
  { key: 'status', label: 'Status', sortField: 'status', width: 140, minWidth: 112, maxWidth: 200 },
  // PM v2 (#877): the structured reason of a hold and its age; in the chooser only, the first to drop out of a narrow box.
  {
    key: 'onHoldReason',
    label: 'On-hold reason',
    sortField: 'onHoldSince',
    width: 176,
    minWidth: 120,
    maxWidth: 280,
    autoHide: true,
  },
  { key: 'closed', label: 'Closed', sortField: 'closed', width: 104, minWidth: 88, maxWidth: 160 },
  {
    key: 'age',
    label: 'Age',
    sortField: 'age',
    width: 64,
    minWidth: 56,
    maxWidth: 100,
    autoHide: true,
  },
  {
    key: 'created',
    label: 'Created',
    sortField: 'created',
    width: 104,
    minWidth: 88,
    maxWidth: 160,
    autoHide: true,
  },
  {
    key: 'updated',
    label: 'Updated',
    sortField: 'updated',
    width: 120,
    minWidth: 96,
    maxWidth: 180,
    autoHide: true,
  },
];

const PAGE_SIZE_CHOICES: readonly number[] = [25, 50, 100];

export type WorkPage = 'queue' | 'my-work' | 'pod-work';

/**
 * Where a column choice lives (X1): a page, or a tab of a page. `taskQueue`, `myWork.<tab>`, `podWork.<tab>`. A missing tab key falls back to
 * the page's own key (`podWork`), and a missing page key to the page default.
 */
export type ColumnScope = string;

const PAGE_SCOPE: Readonly<Record<WorkPage, string>> = {
  queue: 'taskQueue',
  'my-work': 'myWork',
  'pod-work': 'podWork',
};

/** The API tab values whose scope name differs ("completed" is the Closed tab). */
const TAB_SCOPE: Readonly<Record<string, string>> = { completed: 'closed' };

/** The scope of a page and its tab (null or the default tab of the page: `active`, `queue`). */
export function columnScope(page: WorkPage, tab: string | null): ColumnScope {
  const base = PAGE_SCOPE[page];
  if (!tab) return base;
  return `${base}.${TAB_SCOPE[tab] ?? tab}`;
}

// Chosen to fit a 1280 px screen without sideways scrolling (UXR-09). Project is empty for most tasks and Task type repeats what the
// title says, so both live in the column chooser; so do Age, Pod (Task Queue and My Work) and Workflow progress (Pod Work).
const QUEUE_DEFAULT = [
  'ref',
  'title',
  'matter',
  'matterName',
  'priority',
  'assignee',
  'due',
  'status',
];
/** What the Task Queue and Pod Work showed before Matter Name (#348): a stored set equal to it was never customised. */
const QUEUE_BEFORE_NAME = ['ref', 'title', 'matter', 'priority', 'assignee', 'due', 'status'];
/** What My Work showed before X1 and WP6b: a stored set equal to it was never customised. */
const MY_WORK_LEGACY = ['ref', 'title', 'matter', 'priority', 'progress', 'due', 'status'];
/** Active and Due soon and overdue: Matter is back (WP6b #174 had dropped it, so stored sets without it are migrated) (#198), now a two-line cell (reference over name, #197). */
const MY_WORK_DEFAULT = [
  'ref',
  'title',
  'matter',
  'matterName',
  'priority',
  'progress',
  'due',
  'status',
];

/**
 * The default columns per scope, most specific first (X1). To give a tab its own set (C2, B1, B3, A2, A3), add its key here
 * (`'myWork.createdByMe': [...]`); every other tab keeps using the page default. Ref and Title are always added.
 */
export const DEFAULT_COLUMNS: Readonly<Record<string, readonly string[]>> = {
  taskQueue: QUEUE_DEFAULT,
  myWork: MY_WORK_DEFAULT,
  podWork: QUEUE_DEFAULT,
  // Closed (C2): finished work has no progress and no urgency; the date it closed (C1) and the outcome matter. Priority and Due are in the chooser.
  'myWork.closed': ['ref', 'title', 'matter', 'matterName', 'closed', 'status'],
  // Created by me (B1, B3): where did the work I handed off go: who has it, how urgent, when due, what state, how old.
  'myWork.createdByMe': [
    'ref',
    'title',
    'matter',
    'matterName',
    'priority',
    'assignee',
    'due',
    'status',
    'age',
  ],
};

/** The default set of a scope, normalized (table order, Ref and Title included). */
export function defaultColumns(scope: ColumnScope): string[] {
  const dot = scope.indexOf('.');
  const page = dot < 0 ? scope : scope.slice(0, dot);
  return normalizeColumns(DEFAULT_COLUMNS[scope] ?? DEFAULT_COLUMNS[page] ?? QUEUE_DEFAULT);
}

export type Density = 'comfortable' | 'compact';

export interface TablePrefs {
  columns: string[];
  density: Density;
}

/** Column keys in table order, locked ones always included. Unknown keys are dropped. */
export function normalizeColumns(keys: readonly string[]): string[] {
  const wanted = new Set(keys);
  return WORK_COLUMNS.filter((c) => c.locked || wanted.has(c.key)).map((c) => c.key);
}

/** The sets every screen showed before X1 (one for all tabs): a stored set equal to one of these was never customised. */
const LEGACY_DEFAULTS: Readonly<Record<WorkPage, readonly string[]>> = {
  queue: QUEUE_BEFORE_NAME,
  'my-work': MY_WORK_LEGACY,
  'pod-work': QUEUE_BEFORE_NAME,
};

/** The scope that inherits a set customised before X1 (one shared set): the page's main tab. */
const LEGACY_TARGET: Readonly<Record<WorkPage, ColumnScope>> = {
  queue: 'taskQueue',
  'my-work': 'myWork.active',
  'pod-work': 'podWork',
};

const PAGE_OF: Readonly<Record<string, WorkPage>> = {
  taskQueue: 'queue',
  myWork: 'my-work',
  podWork: 'pod-work',
};

const who = (userId: number | null) => userId ?? 'anon';
/** Density stays per page (and user), as before X1. */
const prefsKey = (page: WorkPage, userId: number | null) =>
  `mf.work-table.v3.${page}.${who(userId)}`;
/** The column choice: per user, page and tab; `v2` is the shape (an array of column keys). */
const columnsKey = (scope: ColumnScope, userId: number | null) =>
  `mf.work-columns.v2.${scope}.${who(userId)}`;
const migratedKey = (page: WorkPage, userId: number | null) =>
  `mf.work-columns.v2.migrated.${page}.${who(userId)}`;
/** The Matter default migration (#198): per page and user, 'notice' while the one-time notice waits, 'done' once dismissed. */
const v3Key = (page: WorkPage, userId: number | null) =>
  `mf.work-columns.v3.migrated.${page}.${who(userId)}`;

/** The Matter Name default migration (#348): per page and user, '1' once done. */
const v4Key = (page: WorkPage, userId: number | null) =>
  `mf.work-columns.v4.migrated.${page}.${who(userId)}`;

function storage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

function readJson(key: string): unknown {
  try {
    const raw = storage()?.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function strings(value: unknown): string[] | null {
  return Array.isArray(value) ? value.filter((c): c is string => typeof c === 'string') : null;
}

function sameSet(a: readonly string[], b: readonly string[]): boolean {
  const x = normalizeColumns(a);
  const y = normalizeColumns(b);
  return x.length === y.length && x.every((k, i) => k === y[i]);
}

/**
 * One-time move of the pre-X1 choice (one set for every tab): a set equal to the old default was never customised and is dropped, so the
 * new per-tab defaults apply; a customised set is kept for the page's main tab only. Other tabs show their defaults.
 */
function migrateLegacy(page: WorkPage, userId: number | null): void {
  try {
    const store = storage();
    if (!store || store.getItem(migratedKey(page, userId))) return;
    store.setItem(migratedKey(page, userId), '1');
    const legacy = strings(
      (readJson(prefsKey(page, userId)) as { columns?: unknown } | null)?.columns,
    );
    if (!legacy || sameSet(legacy, LEGACY_DEFAULTS[page])) return;
    const target = columnsKey(LEGACY_TARGET[page], userId);
    if (!store.getItem(target)) store.setItem(target, JSON.stringify(normalizeColumns(legacy)));
  } catch {
    // Blocked storage: nothing to migrate.
  }
}

/**
 * One-time Matter migration (#198), after the v2 move, per user and page. A stored set that lacks `matter` gets it after `title` on My Work
 * (except Closed, whose old default had it): the old default lacked it, the user relied on the subline. On Task Queue and Pod Work the old
 * default had Matter, so a user who removed it did so on purpose and keeps the choice. A user with a stored set gets a one-time notice
 * (`columnsNotice`); one without stores nothing and sees none. Idempotent; corrupt values go through `normalizeColumns`.
 */
/** The stored column choices of a page's scopes for a user: storage key and scope. */
function storedColumnKeys(page: WorkPage, userId: number | null): { key: string; scope: string }[] {
  const out: { key: string; scope: string }[] = [];
  const store = storage();
  if (!store) return out;
  const prefix = 'mf.work-columns.v2.';
  const suffix = `.${who(userId)}`;
  for (let i = 0; i < store.length; i++) {
    const k = store.key(i);
    if (!k || !k.startsWith(prefix + PAGE_SCOPE[page]) || !k.endsWith(suffix)) continue;
    const scope = k.slice(prefix.length, k.length - suffix.length);
    if (scope === PAGE_SCOPE[page] || scope.startsWith(`${PAGE_SCOPE[page]}.`))
      out.push({ key: k, scope });
  }
  return out;
}

/**
 * One-time Matter Name migration (#348), per user and page, before the Matter move. A stored set that equals the scope's default from before
 * Matter Name existed (the default without `matterName`) was never customised: it is dropped, so the new default (with Matter Name next to
 * Matter Number) applies. A customised set is left alone; Matter Name is then one click away in the Columns panel. Idempotent.
 */
function migrateMatterName(page: WorkPage, userId: number | null): void {
  try {
    const store = storage();
    if (!store || store.getItem(v4Key(page, userId))) return;
    store.setItem(v4Key(page, userId), '1');
    for (const { key, scope } of storedColumnKeys(page, userId)) {
      const cols = strings(readJson(key));
      if (!cols) continue;
      const before = defaultColumns(scope).filter((c) => c !== 'matterName');
      if (sameSet(cols, before)) store.removeItem(key);
    }
  } catch {
    // Blocked storage: defaults apply.
  }
}

function migrateMatter(page: WorkPage, userId: number | null): void {
  try {
    const store = storage();
    if (!store || store.getItem(v3Key(page, userId))) return;
    const stored = storedColumnKeys(page, userId).map((e) => e.key);
    for (const k of stored) {
      if (page !== 'my-work' || k.includes('.myWork.closed.')) continue;
      const cols = strings(readJson(k));
      if (!cols || cols.includes('matter')) continue;
      store.setItem(k, JSON.stringify(normalizeColumns([...cols, 'matter'])));
    }
    store.setItem(v3Key(page, userId), stored.length > 0 ? 'notice' : 'done');
  } catch {
    // Blocked storage: defaults apply, no notice.
  }
}

/** The one-time notice about the removed client and matter line: true until the user dismisses it. Never throws. */
export function columnsNoticePending(page: WorkPage, userId: number | null): boolean {
  migrateMatter(page, userId);
  try {
    return storage()?.getItem(v3Key(page, userId)) === 'notice';
  } catch {
    return false;
  }
}

export function dismissColumnsNotice(page: WorkPage, userId: number | null): void {
  try {
    storage()?.setItem(v3Key(page, userId), 'done');
  } catch {
    // Not persisted.
  }
}

/** The user's column choice for a scope, or that scope's default. Never throws; a corrupt value falls back silently. */
export function loadColumns(
  scope: ColumnScope,
  userId: number | null,
  /** What a person who never chose gets; a page that adapts its defaults to the window passes its own (Pod Work, #550). */
  fallback: readonly string[] = defaultColumns(scope),
): string[] {
  const page = PAGE_OF[scope.split('.')[0]];
  if (page) {
    migrateLegacy(page, userId);
    // Matter Name first: a set that only became equal to the old default because the Matter move added Matter was customised.
    migrateMatterName(page, userId);
    migrateMatter(page, userId);
  }
  const stored = strings(readJson(columnsKey(scope, userId)));
  return stored ? normalizeColumns(stored) : normalizeColumns(fallback);
}

/** Remembers the column choice of one scope; silently does nothing when storage is unavailable. */
export function saveColumns(
  scope: ColumnScope,
  userId: number | null,
  columns: readonly string[],
): void {
  try {
    storage()?.setItem(columnsKey(scope, userId), JSON.stringify(normalizeColumns(columns)));
  } catch {
    // Private window, blocked or full storage: the preference just does not persist.
  }
}

/** Forgets the column choice of one scope ("Reset columns"): the default returns. */
export function resetColumns(scope: ColumnScope, userId: number | null): void {
  try {
    storage()?.removeItem(columnsKey(scope, userId));
  } catch {
    // Not persisted.
  }
}

export function loadDensity(page: WorkPage, userId: number | null): Density {
  const d = (readJson(prefsKey(page, userId)) as { density?: unknown } | null)?.density;
  return d === 'compact' ? 'compact' : 'comfortable';
}

export function saveDensity(page: WorkPage, userId: number | null, density: Density): void {
  try {
    storage()?.setItem(prefsKey(page, userId), JSON.stringify({ density }));
  } catch {
    // Not persisted.
  }
}

/** The user's table preferences for a page and tab: that scope's columns and the page's density. */
export function loadPrefs(
  page: WorkPage,
  userId: number | null,
  tab: string | null = null,
): TablePrefs {
  return {
    columns: loadColumns(columnScope(page, tab), userId),
    density: loadDensity(page, userId),
  };
}

/** The remembered page size ("Rows per page") is its own preference per page and user, apart from the table preferences (#237). */
const sizeKey = (page: WorkPage, userId: number | null) =>
  `mf.work-table.v3.${page}.${who(userId)}.page-size`;

/** The page size the person chose on this page, or null (never chosen, corrupt or blocked storage). Only 25, 50 and 100 count. */
export function loadPageSize(page: WorkPage, userId: number | null): number | null {
  try {
    const n = Number(storage()?.getItem(sizeKey(page, userId)));
    return PAGE_SIZE_CHOICES.includes(n) ? n : null;
  } catch {
    return null;
  }
}

export function savePageSize(page: WorkPage, userId: number | null, size: number): void {
  try {
    storage()?.setItem(sizeKey(page, userId), String(size));
  } catch {
    // Not persisted.
  }
}

/** Remembers the last Pod chosen on Pod Work. */
export function loadLastPod(userId: number | null): number | null {
  try {
    const n = Number(storage()?.getItem(`mf.pod-work.last-pod.${userId ?? 'anon'}`));
    return Number.isInteger(n) && n > 0 ? n : null;
  } catch {
    return null;
  }
}

export function saveLastPod(userId: number | null, podId: number): void {
  try {
    storage()?.setItem(`mf.pod-work.last-pod.${userId ?? 'anon'}`, String(podId));
  } catch {
    // Not persisted.
  }
}
