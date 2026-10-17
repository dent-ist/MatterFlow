import {
  CoverageBoard,
  CoverageTaskType,
  CoverageTypePerson,
  CoverageUser,
} from '../../../api/generated/api-client';

// ---- colour steps

/** The five steps of the heat map: 0 (none, blank), 1-2, 3-5, 6-10 and 11 or more completed (absolute scale). */
export type Step = 0 | 1 | 2 | 3 | 4;
export type Scale = 'relative' | 'absolute';
export const SCALES: readonly Scale[] = ['relative', 'absolute'];
export const isScale = (v: unknown): v is Scale => v === 'relative' || v === 'absolute';

/**
 * Fill and text of the non-zero steps (one blue family, light to dark). The numbers are always written in the cell, so colour is never the
 * only cue; every pair reaches 4.5:1 (checked in the spec). Step 0 (no completions) is a blank cell on a light neutral background: no hatch and no dashed edge (C2, #135).
 */
export const STEP_COLORS: Record<Exclude<Step, 0>, { bg: string; fg: string }> = {
  1: { bg: '#E8F0FB', fg: '#1B1F27' },
  2: { bg: '#BBD2F3', fg: '#1B1F27' },
  3: { bg: '#7FAAE6', fg: '#1B1F27' },
  4: { bg: '#1F4E9C', fg: '#FFFFFF' },
};

export const STEP_LABELS: Record<Step, string> = {
  0: 'None (0)',
  1: '1 to 2',
  2: '3 to 5',
  3: '6 to 10',
  4: '11 or more',
};

export const RELATIVE_LABELS: Record<Step, string> = {
  0: 'None (0)',
  1: 'Up to a quarter of the row high',
  2: 'Up to half',
  3: 'Up to three quarters',
  4: 'Most in the row',
};

export function absoluteStep(n: number): Step {
  return n <= 0 ? 0 : n <= 2 ? 1 : n <= 5 ? 2 : n <= 10 ? 3 : 4;
}

/** Relative to the task type: the share of the highest count in its row (so each type shows who handles it more or less). */
export function relativeStep(n: number, rowMax: number): Step {
  if (n <= 0 || rowMax <= 0) return 0;
  const share = n / rowMax;
  return share <= 0.25 ? 1 : share <= 0.5 ? 2 : share <= 0.75 ? 3 : 4;
}

export function stepOf(n: number, scale: Scale, rowMax: number): Step {
  return scale === 'absolute' ? absoluteStep(n) : relativeStep(n, rowMax);
}

// ---- the matrix

export type TypeOrder = 'name' | 'total';
export type UserOrder = 'name' | 'total';
export const isOrder = (v: unknown): v is TypeOrder => v === 'name' || v === 'total';

export interface MatrixCell {
  userId: number;
  taskTypeId: number;
  count: number;
  step: Step;
  /** Zero for a person who completed something else in the period: a possible training gap. */
  gap: boolean;
}

export interface MatrixRow {
  type: CoverageTaskType;
  cells: MatrixCell[];
  total: number;
  /** People (of those shown) who completed at least one. */
  people: number;
  status: HandledStatus;
}

export interface Matrix {
  rows: MatrixRow[];
  cols: CoverageUser[];
  /** Per column (same order as `cols`): completed over the rows shown. */
  colTotals: number[];
  grand: number;
  gapCount: number;
}

export interface MatrixOptions {
  q: string;
  scale: Scale;
  typeOrder: TypeOrder;
  userOrder: UserOrder;
}

const byName = (a: string, b: string) => a.localeCompare(b, undefined, { sensitivity: 'base' });

/**
 * The heat map from the API's sparse cells: zeros are filled in, the people are filtered by name, totals follow what is shown, and the order is
 * by name or by total (neutral labels; there is no "best" or "worst"). A cell is flagged `gap` when it is a zero for someone who completed
 * something else; the view outlines those only when the "Training gaps" toggle is on.
 */
export function buildMatrix(board: CoverageBoard, opts: MatrixOptions): Matrix {
  const term = opts.q.trim().toLowerCase();
  const people = board.users.filter((u) => !term || u.displayName.toLowerCase().includes(term));
  const counts = new Map<string, number>();
  for (const c of board.cells) counts.set(`${c.userId}:${c.taskTypeId}`, c.completed);
  const countOf = (u: number, t: number) => counts.get(`${u}:${t}`) ?? 0;

  const totalOfUser = new Map<number, number>();
  const totalOfType = new Map<number, number>();
  for (const u of people) {
    for (const t of board.taskTypes) {
      const n = countOf(u.userId, t.taskTypeId);
      totalOfUser.set(u.userId, (totalOfUser.get(u.userId) ?? 0) + n);
      totalOfType.set(t.taskTypeId, (totalOfType.get(t.taskTypeId) ?? 0) + n);
    }
  }

  const types = [...board.taskTypes];
  types.sort((a, b) =>
    opts.typeOrder === 'total'
      ? (totalOfType.get(b.taskTypeId) ?? 0) - (totalOfType.get(a.taskTypeId) ?? 0) ||
        byName(a.name, b.name)
      : byName(a.name, b.name),
  );
  const cols = [...people];
  cols.sort((a, b) =>
    opts.userOrder === 'total'
      ? (totalOfUser.get(b.userId) ?? 0) - (totalOfUser.get(a.userId) ?? 0) ||
        byName(a.displayName, b.displayName)
      : byName(a.displayName, b.displayName) || a.userId - b.userId,
  );

  const active = (u: CoverageUser) => (totalOfUser.get(u.userId) ?? 0) > 0;
  const makeRow = (type: CoverageTaskType, shown: CoverageUser[]): MatrixRow => {
    const rowCounts = shown.map((u) => countOf(u.userId, type.taskTypeId));
    const rowMax = Math.max(0, ...rowCounts);
    const cells = shown.map((u, i) => ({
      userId: u.userId,
      taskTypeId: type.taskTypeId,
      count: rowCounts[i],
      step: stepOf(rowCounts[i], opts.scale, rowMax),
      gap: rowCounts[i] === 0 && active(u),
    }));
    const peopleCount = rowCounts.filter((n) => n > 0).length;
    return {
      type,
      cells,
      total: rowCounts.reduce((a, b) => a + b, 0),
      people: peopleCount,
      status: handledStatus(peopleCount),
    };
  };

  const rows = types.map((t) => makeRow(t, cols));
  const colTotals = cols.map((_, i) => rows.reduce((n, r) => n + r.cells[i].count, 0));
  return {
    rows,
    cols,
    colTotals,
    grand: colTotals.reduce((a, b) => a + b, 0),
    gapCount: rows.reduce((n, r) => n + r.cells.filter((c) => c.gap).length, 0),
  };
}

export function plural(n: number, one: string, many = one + 's'): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** The accessible name and tooltip of a cell: "Priya: 7 Relativity Production tasks completed in the last 90 days". */
export function cellLabel(
  user: Pick<CoverageUser, 'displayName'>,
  type: Pick<CoverageTaskType, 'name'>,
  count: number,
  phrase: string,
): string {
  if (count === 0) return `${user.displayName}, ${type.name}: 0 completed ${phrase}`;
  return `${user.displayName}: ${count} ${type.name} ${count === 1 ? 'task' : 'tasks'} completed ${phrase}`;
}

// ---- orientations

/** The two orientations of Coverage: by task type (default; the planning view) and the matrix (detail). The address carries `cov=matrix` only for the latter. */
export const ORIENTATIONS = ['type', 'matrix'] as const;
export type Orientation = (typeof ORIENTATIONS)[number];
export const isOrientation = (v: unknown): v is Orientation =>
  ORIENTATIONS.includes(v as Orientation);
export const DEFAULT_ORIENTATION: Orientation = 'type';
export const ORIENTATION_PARAM = 'cov';

/** Bounded rendering: the matrix draws this many people and task types at first, "Show more" adds the same again (500 people x 30 types stays quick). */
export const MATRIX_COLS = 30;
export const MATRIX_ROWS = 60;
export const TYPE_ROWS = 60;

// ---- by task type

/** The row orders of the type view. Neutral labels: no rank of people exists; the names inside a row are always alphabetical. */
export const TYPE_ROW_ORDERS = ['fewest', 'name', 'completed'] as const;
export type TypeRowOrder = (typeof TYPE_ROW_ORDERS)[number];
export const isTypeRowOrder = (v: unknown): v is TypeRowOrder =>
  TYPE_ROW_ORDERS.includes(v as TypeRowOrder);
export const TYPE_ROW_ORDER_LABELS: Record<TypeRowOrder, string> = {
  fewest: 'Fewest people first',
  name: 'Type name',
  completed: 'Most completed',
};

/** How many people handled a task type: nobody (informational), exactly one (amber) or two or more (nothing to say). */
export type HandledStatus = 'none' | 'one' | 'many';
export const handledStatus = (people: number): HandledStatus =>
  people <= 0 ? 'none' : people === 1 ? 'one' : 'many';
export const STATUS_TEXT: Record<Exclude<HandledStatus, 'many'>, string> = {
  none: 'No one',
  one: 'One person',
};

export interface TypeRow {
  type: CoverageTaskType;
  /** Everyone who completed at least one, alphabetical (never by count). */
  people: CoverageTypePerson[];
  status: HandledStatus;
  /** The first names (at most `NAMES_SHOWN`) and how many more there are. */
  names: string[];
  more: number;
}

export const NAMES_SHOWN = 5;

const typeByName = (a: CoverageTaskType, b: CoverageTaskType) =>
  byName(a.name, b.name) || a.taskTypeId - b.taskTypeId;

/** One row per task type of the board, ordered by the chosen (neutral) order; ties by type name. */
export function buildTypeRows(board: CoverageBoard, order: TypeRowOrder): TypeRow[] {
  const groups = new Map((board.byType ?? []).map((g) => [g.taskTypeId, g.people]));
  const rows = board.taskTypes.map((type) => {
    const people = [...(groups.get(type.taskTypeId) ?? [])].sort(
      (a, b) => byName(a.displayName, b.displayName) || a.userId - b.userId,
    );
    return {
      type,
      people,
      status: handledStatus(people.length),
      names: people.slice(0, NAMES_SHOWN).map((p) => p.displayName),
      more: Math.max(0, people.length - NAMES_SHOWN),
    };
  });
  rows.sort((a, b) => {
    const by =
      order === 'fewest'
        ? a.people.length - b.people.length
        : order === 'completed'
          ? b.type.total - a.type.total
          : 0;
    return by || typeByName(a.type, b.type);
  });
  return rows;
}

/** Scope people (the pod's roster) who did not handle the type: names only, alphabetical. */
export function notHandledBy(
  roster: readonly { userId: number; displayName: string }[],
  row: Pick<TypeRow, 'people'>,
): string[] {
  const done = new Set(row.people.map((p) => p.userId));
  return roster
    .filter((p) => !done.has(p.userId))
    .map((p) => p.displayName)
    .sort(byName);
}

// ---- the two statements (C3, #136)

export interface CoverageNotes {
  /** Task types with no completed task in the period (informational). */
  none: CoverageTaskType[];
  /** Task types handled by exactly one person (a warning). */
  one: CoverageTaskType[];
}

export function coverageNotes(taskTypes: readonly CoverageTaskType[]): CoverageNotes {
  const sorted = [...taskTypes].sort(typeByName);
  return {
    none: sorted.filter((t) => handledStatus(t.peopleWhoHandledIt) === 'none'),
    one: sorted.filter((t) => handledStatus(t.peopleWhoHandledIt) === 'one'),
  };
}

export const NOTE_HINT = 'Rarely used types can be empty in a short period. Try a longer period.';

/** "17 task types had no completed tasks in this period." */
export function noneNoteText(n: number): string {
  return `${plural(n, 'task type')} had no completed tasks in this period.`;
}

/** "2 task types were handled by only one person in this period: A, B. Consider cross-training." Names of types only. */
export function oneNoteText(names: readonly string[], max = 6): string {
  const shown = names.slice(0, max).join(', ');
  const rest = names.length > max ? ` and ${names.length - max} more` : '';
  return `${plural(names.length, 'task type')} ${names.length === 1 ? 'was' : 'were'} handled by only one person in this period: ${shown}${rest}. Consider cross-training.`;
}

/** "Ana, Ben, +3 more" for the row; the full list sits in the details. */
export function namesText(row: Pick<TypeRow, 'names' | 'more'>): string {
  return row.names.join(', ') + (row.more > 0 ? `, +${row.more}` : '');
}
