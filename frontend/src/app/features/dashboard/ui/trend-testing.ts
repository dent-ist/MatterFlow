import {
  DashboardTrend,
  DashboardTrendDay,
  DashboardTrendType,
} from '../../../api/generated/api-client';

/** Test data of the Trends tab: three days, four task types (one inactive with a completion, one active without tasks). */
const DATES = ['2026-10-12', '2026-10-13', '2026-10-14'];

interface Cols {
  created: number[];
  completed: number[];
  overdue: number[];
  open: number[];
  onTime: number[];
  late: number[];
}

const COLS: Record<number, Cols> = {
  5: {
    created: [3, 0, 3],
    completed: [1, 2, 1],
    overdue: [1, 1, 2],
    open: [6, 5, 6],
    onTime: [0, 1, 0],
    late: [0, 1, 0],
  },
  7: {
    created: [1, 0, 2],
    completed: [1, 0, 0],
    overdue: [0, 1, 1],
    open: [2, 2, 4],
    onTime: [0, 0, 1],
    late: [0, 0, 0],
  },
  9: {
    created: [0, 0, 0],
    completed: [0, 1, 0],
    overdue: [0, 0, 0],
    open: [0, 0, 0],
    onTime: [0, 0, 0],
    late: [0, 0, 0],
  },
  11: {
    created: [0, 0, 0],
    completed: [0, 0, 0],
    overdue: [0, 0, 0],
    open: [0, 0, 0],
    onTime: [0, 0, 0],
    late: [0, 0, 0],
  },
};
const ALL: Cols = {
  created: [4, 0, 5],
  completed: [2, 3, 1],
  overdue: [1, 2, 3],
  open: [20, 22, 25],
  onTime: [0, 1, 1],
  late: [0, 1, 0],
};

const points = (c: Cols): DashboardTrendDay[] =>
  DATES.map((date, i) => ({
    date,
    created: c.created[i],
    completed: c.completed[i],
    overdue: c.overdue[i],
    open: c.open[i],
    onTime: c.onTime[i],
    late: c.late[i],
  })) as DashboardTrendDay[];

const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);

function typeOf(id: number, name: string, isActive: boolean): DashboardTrendType {
  const c = COLS[id];
  return {
    id,
    name,
    iconKey: 'file-text',
    isActive,
    created: sum(c.created),
    completed: sum(c.completed),
    overdue: c.overdue[2],
    open: c.open[2],
    onTime: sum(c.onTime),
    late: sum(c.late),
    createdQuery: `createdFrom=2026-10-12&type=${id}`,
    completedQuery: `status=COMPLETED&completedFrom=2026-10-12&type=${id}`,
    overdueQuery: `status=NEW&status=IN_PROGRESS&status=ON_HOLD&overdue=true&type=${id}`,
    openQuery: `status=NEW&status=IN_PROGRESS&status=ON_HOLD&type=${id}`,
  } as DashboardTrendType;
}

/** The answer of `GET /api/v1/dashboard/trend` for the requested task type ids. */
export function aTrend(
  ids: readonly number[] = [],
  extraTypes: DashboardTrendType[] = [],
  granularity: 'day' | 'week' = 'day',
): DashboardTrend {
  return {
    period: { days: 3, from: '2026-10-12', to: '2026-10-14' },
    timeZone: 'UTC',
    generatedAtUtc: '2026-10-14T15:42:00Z',
    metric: undefined,
    granularity,
    all: points(ALL),
    byTaskType: ids.map((id) => ({ taskTypeId: id, points: points(COLS[id] ?? COLS[11]) })),
    types: [
      typeOf(5, 'Alpha', true),
      typeOf(7, 'Beta', true),
      typeOf(9, 'Gamma retired', false),
      typeOf(11, 'Delta idle', true),
      ...extraTypes,
    ],
    createdQuery: 'createdFrom=2026-10-12',
    completedQuery: 'status=COMPLETED&completedFrom=2026-10-12',
    overdueQuery: 'status=NEW&status=IN_PROGRESS&status=ON_HOLD&overdue=true',
    openQuery: 'status=NEW&status=IN_PROGRESS&status=ON_HOLD',
  } as DashboardTrend;
}

/** A catalogue of `count` active task types named Type 1..n with decreasing totals (for the search box and the limit of eight). */
export function manyTypes(count: number): DashboardTrendType[] {
  return Array.from({ length: count }, (_, i) => ({
    ...typeOf(5, 'x', true),
    id: 100 + i,
    name: `Type ${String(i + 1).padStart(2, '0')}`,
    created: 50 - i,
    completed: i,
    overdue: 0,
    open: 0,
    onTime: 0,
    late: 0,
    createdQuery: `createdFrom=2026-10-12&type=${100 + i}`,
    completedQuery: `status=COMPLETED&completedFrom=2026-10-12&type=${100 + i}`,
    overdueQuery: `overdue=true&type=${100 + i}`,
  })) as DashboardTrendType[];
}
