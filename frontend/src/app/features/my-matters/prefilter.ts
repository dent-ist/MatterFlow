import { MyMattersSummary } from '../../api/generated/api-client';

/**
 * The pre-filter of the Overview's grid (issue #942): what the six tiles used to be, as one dropdown above the grid. `open` is the default (every open task); the others
 * narrow the grid in place. Each one maps to a filter of `GET /task-queue` and to a count of `GET /my-matters/summary`, so the number in its option is the grid's total.
 */
export type MmPrefilter = 'open' | 'overdue' | 'atRisk' | 'unassigned' | 'onHold' | 'dueSoon';

export const PREFILTER_KEYS: readonly MmPrefilter[] = [
  'open',
  'overdue',
  'atRisk',
  'unassigned',
  'onHold',
  'dueSoon',
];

interface PrefilterInfo {
  /** The option's words ("Overdue"), then its count in brackets. */
  label: string;
  /** What the grid says it shows, after the number ("16 overdue tasks"); `one` is for exactly one task. */
  noun: string;
  one: string;
  /** The count cell of the summary. */
  cell: keyof Pick<
    MyMattersSummary,
    'openTasks' | 'overdue' | 'atRisk' | 'unassigned' | 'onHold' | 'dueIn7Days'
  >;
}

export const PREFILTERS: Readonly<Record<MmPrefilter, PrefilterInfo>> = {
  open: { label: 'All open', noun: 'open tasks', one: 'open task', cell: 'openTasks' },
  overdue: { label: 'Overdue', noun: 'overdue tasks', one: 'overdue task', cell: 'overdue' },
  atRisk: { label: 'At risk', noun: 'tasks at risk', one: 'task at risk', cell: 'atRisk' },
  unassigned: {
    label: 'Unassigned',
    noun: 'unassigned tasks',
    one: 'unassigned task',
    cell: 'unassigned',
  },
  onHold: { label: 'On hold', noun: 'tasks on hold', one: 'task on hold', cell: 'onHold' },
  dueSoon: {
    label: 'Due soon (within 7 days)',
    noun: 'tasks due within 7 days',
    one: 'task due within 7 days',
    cell: 'dueIn7Days',
  },
};

export function parsePrefilter(value: string | null): MmPrefilter {
  return PREFILTER_KEYS.find((k) => k === value) ?? 'open';
}

/** The Task Queue filters that make a pre-filter (the open statuses are the grid's own, except On hold, which is one status). */
export function prefilterParams(key: MmPrefilter): Record<string, string | string[]> {
  switch (key) {
    case 'overdue':
      return { overdue: 'true' };
    case 'atRisk':
      return { atRisk: 'true' };
    case 'unassigned':
      return { unassigned: 'true' };
    case 'onHold':
      return { status: ['ON_HOLD'] };
    case 'dueSoon':
      return { dueWithin: '7' };
    default:
      return {};
  }
}
