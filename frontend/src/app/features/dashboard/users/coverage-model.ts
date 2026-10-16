import { CoverageBoard, CoverageTaskType, CoverageUser } from '../../../api/generated/api-client';

// ---- colour steps

/** The five steps of the heat map: 0 (none, hatched), 1-2, 3-5, 6-10 and 11 or more completed (absolute scale). */
export type Step = 0 | 1 | 2 | 3 | 4;
export type Scale = 'relative' | 'absolute';
export const SCALES: readonly Scale[] = ['relative', 'absolute'];
export const isScale = (v: unknown): v is Scale => v === 'relative' || v === 'absolute';

/**
 * Fill and text of the non-zero steps (one blue family, light to dark). The numbers are always written in the cell, so colour is never the
 * only cue; every pair reaches 4.5:1 (checked in the spec). Step 0 is drawn with a hatched pattern and a dashed edge instead of a fill.
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
  /** Fewer than two people handled it. */
  thin: boolean;
}

export interface Matrix {
  rows: MatrixRow[];
  cols: CoverageUser[];
  /** Per column (same order as `cols`): completed over the rows shown. */
  colTotals: number[];
  grand: number;
  /** Task types (of all, before the gaps filter) with fewer than two people who handled them. */
  thinTypes: number;
  gapCount: number;
}

export interface MatrixOptions {
  q: string;
  scale: Scale;
  typeOrder: TypeOrder;
  userOrder: UserOrder;
  gapsOnly: boolean;
}

const byName = (a: string, b: string) => a.localeCompare(b, undefined, { sensitivity: 'base' });

/**
 * The heat map from the API's sparse cells: zeros are filled in, the people are filtered by name, totals follow what is shown, and the order is
 * by name or by total (neutral labels; there is no "best" or "worst"). The gaps filter keeps the task types with a zero for someone who
 * completed something else and the people who have such a zero.
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

  let types = [...board.taskTypes];
  types.sort((a, b) =>
    opts.typeOrder === 'total'
      ? (totalOfType.get(b.taskTypeId) ?? 0) - (totalOfType.get(a.taskTypeId) ?? 0) ||
        byName(a.name, b.name)
      : byName(a.name, b.name),
  );
  let cols = [...people];
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
      thin: peopleCount < 2,
    };
  };

  const thinTypes = types.filter(
    (t) => people.filter((u) => countOf(u.userId, t.taskTypeId) > 0).length < 2,
  ).length;

  if (opts.gapsOnly) {
    const everyone = cols.filter(active);
    const gapTypes = types.filter((t) =>
      everyone.some((u) => countOf(u.userId, t.taskTypeId) === 0),
    );
    cols = everyone.filter((u) => gapTypes.some((t) => countOf(u.userId, t.taskTypeId) === 0));
    types = gapTypes;
  }

  const rows = types.map((t) => makeRow(t, cols));
  const colTotals = cols.map((_, i) => rows.reduce((n, r) => n + r.cells[i].count, 0));
  return {
    rows,
    cols,
    colTotals,
    grand: colTotals.reduce((a, b) => a + b, 0),
    thinTypes,
    gapCount: rows.reduce((n, r) => n + r.cells.filter((c) => c.gap).length, 0),
  };
}

export function plural(n: number, one: string, many = one + 's'): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** "3 task types have fewer than 2 people who handled them" (and "Every task type has at least 2 people..."). */
export function thinText(n: number): string {
  if (n === 0) return 'Every task type was handled by at least 2 people.';
  return `${plural(n, 'task type')} ${n === 1 ? 'has' : 'have'} fewer than 2 people who handled them.`;
}

/** The accessible name and tooltip of a cell: "Priya: 7 Relativity Production tasks completed in the last 90 days". */
export function cellLabel(
  user: Pick<CoverageUser, 'displayName'>,
  type: Pick<CoverageTaskType, 'name'>,
  count: number,
  phrase: string,
): string {
  return `${user.displayName}: ${count} ${type.name} ${count === 1 ? 'task' : 'tasks'} completed ${phrase}`;
}
