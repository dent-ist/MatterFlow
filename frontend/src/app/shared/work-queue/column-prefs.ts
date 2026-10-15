/** A column of the work tables (Task Queue, My Work, Pod Work). Ref and Title are locked: they cannot be hidden (UX 5.2). */
export interface ColumnDef {
  key: string;
  label: string;
  locked?: boolean;
  /** The API `sort` value of a sortable column. */
  sortField?: string;
}

export const WORK_COLUMNS: readonly ColumnDef[] = [
  { key: 'ref', label: 'Ref', locked: true, sortField: 'number' },
  { key: 'title', label: 'Title', locked: true },
  { key: 'matter', label: 'Matter' },
  { key: 'client', label: 'Client' },
  { key: 'project', label: 'Project' },
  { key: 'type', label: 'Task type' },
  { key: 'workflow', label: 'Workflow' },
  { key: 'progress', label: 'Workflow progress' },
  { key: 'priority', label: 'Priority', sortField: 'priority' },
  { key: 'pod', label: 'Pod' },
  { key: 'assignee', label: 'Assignee' },
  { key: 'creator', label: 'Creator' },
  { key: 'requestor', label: 'Requestor' },
  { key: 'due', label: 'Due', sortField: 'due' },
  { key: 'status', label: 'Status', sortField: 'status' },
  { key: 'age', label: 'Age' },
  { key: 'created', label: 'Created', sortField: 'created' },
  { key: 'updated', label: 'Updated' },
];

export type WorkPage = 'queue' | 'my-work' | 'pod-work';

export const DEFAULT_COLUMNS: Readonly<Record<WorkPage, readonly string[]>> = {
  // Chosen to fit a 1280 px screen without sideways scrolling (UXR-09). Project is empty for most tasks and Task type repeats
  // what the title says, so both live in the column chooser; so do Age, Pod (Task Queue and My Work) and Workflow progress (Pod Work).
  queue: ['ref', 'title', 'matter', 'priority', 'assignee', 'due', 'status'],
  'my-work': ['ref', 'title', 'matter', 'priority', 'progress', 'due', 'status'],
  'pod-work': ['ref', 'title', 'matter', 'priority', 'assignee', 'due', 'status'],
};

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

function storageKey(page: WorkPage, userId: number | null): string {
  return `mf.work-table.v3.${page}.${userId ?? 'anon'}`;
}

function storage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

/** The user's saved table preferences (per user and screen), or the defaults. Never throws: storage can be blocked or empty. */
export function loadPrefs(page: WorkPage, userId: number | null): TablePrefs {
  const fallback: TablePrefs = {
    columns: normalizeColumns(DEFAULT_COLUMNS[page]),
    density: 'comfortable',
  };
  try {
    const raw = storage()?.getItem(storageKey(page, userId));
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as Partial<TablePrefs>;
    const columns = Array.isArray(parsed.columns)
      ? normalizeColumns(parsed.columns.filter((c): c is string => typeof c === 'string'))
      : fallback.columns;
    return {
      columns,
      density: parsed.density === 'compact' ? 'compact' : 'comfortable',
    };
  } catch {
    return fallback;
  }
}

/** Saves the preferences; silently does nothing when storage is unavailable. */
export function savePrefs(page: WorkPage, userId: number | null, prefs: TablePrefs): void {
  try {
    storage()?.setItem(storageKey(page, userId), JSON.stringify(prefs));
  } catch {
    // Private window, blocked or full storage: the preference just does not persist.
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
