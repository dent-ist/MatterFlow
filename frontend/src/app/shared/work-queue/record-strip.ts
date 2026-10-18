import { Params } from '@angular/router';
import { OPEN_STATUSES } from './queue-filters';
import { VIEW_TIPS } from './work-vocabulary';
import { WorkStripItem } from './work-strip';

/** The record a strip is about; the Task Queue scopes by the same ids (`client=`, `matter=`, `project=`). */
export interface RecordScope {
  kind: 'client' | 'matter' | 'project';
  id: number;
}

/** The numbers of a record's `GET .../summary` that the strip needs; a count is absent without `Task.View`. */
export interface RecordSummaryCounts {
  openTasks?: number | null;
  overdue?: number | null;
  dueSoon?: number | null;
  asap?: number | null;
  onHold?: number | null;
}

/** What the links need from the viewer's clock: the last day of the Due soon window (`yyyy-MM-dd`, today plus 2 in the viewer's zone). */
export interface RecordStripContext {
  dueSoonTo: string;
  /** Where the links go; the Task Queue by default. */
  path?: string;
}

export type RecordStripKey = 'open' | 'overdue' | 'dueSoon' | 'asap' | 'onHold';

/**
 * The Task Queue query of each strip item for a scope. They are the Dashboard's queries (open = New, In Progress, On Hold, plus the
 * item's own filter) with the scope added, so the Task Queue shows the matching quick view as pressed (#221, by shape) and its total equals
 * the summary number (the integration tests of the counts API assert the equality).
 */
export function recordStripQuery(
  key: RecordStripKey,
  scope: RecordScope,
  dueSoonTo: string,
): Params {
  const open = [...OPEN_STATUSES];
  const scoped: Params = { [scope.kind]: String(scope.id) };
  switch (key) {
    case 'open':
      return { ...scoped, status: open };
    case 'overdue':
      return { ...scoped, status: open, overdue: 'true' };
    case 'dueSoon':
      return { ...scoped, status: open, asap: 'false', overdue: 'false', dueTo: dueSoonTo };
    case 'asap':
      return { ...scoped, status: open, asap: 'true' };
    case 'onHold':
      return { ...scoped, status: ['ON_HOLD'] };
  }
}

const ITEMS: readonly {
  key: RecordStripKey;
  label: string;
  hint: string;
  count: (s: RecordSummaryCounts) => number | null | undefined;
  alert?: boolean;
}[] = [
  { key: 'open', label: 'Open', hint: VIEW_TIPS.allOpen, count: (s) => s.openTasks },
  {
    key: 'overdue',
    label: 'Overdue',
    hint: VIEW_TIPS.overdue,
    count: (s) => s.overdue,
    alert: true,
  },
  { key: 'dueSoon', label: 'Due soon', hint: VIEW_TIPS.dueSoon, count: (s) => s.dueSoon },
  { key: 'asap', label: 'ASAP', hint: VIEW_TIPS.asap, count: (s) => s.asap },
  { key: 'onHold', label: 'On hold', hint: VIEW_TIPS.onHold, count: (s) => s.onHold },
];

/**
 * The summary strip of a record (#260): Open, Overdue, Due soon, ASAP, On hold (the Dashboard's words, in this order), each a link to the
 * Task Queue scoped to the record. A summary without the numbers (the viewer lacks `Task.View`, the API sends none) gives no items, so the
 * strip is absent rather than showing zeros. A null summary (still loading) gives the items with unknown counts (`--`).
 */
export function recordStripItems(
  summary: RecordSummaryCounts | null,
  scope: RecordScope,
  ctx: RecordStripContext,
): WorkStripItem[] {
  if (summary && ITEMS.every((i) => i.count(summary) == null)) return [];
  return ITEMS.map((i) => ({
    key: i.key,
    label: i.label,
    hint: i.hint,
    count: summary ? (i.count(summary) ?? null) : null,
    ...(i.alert ? { alert: true } : {}),
    link: {
      path: ctx.path ?? '/tasks',
      queryParams: recordStripQuery(i.key, scope, ctx.dueSoonTo),
    },
  }));
}
