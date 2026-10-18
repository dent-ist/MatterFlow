import { Params } from '@angular/router';
import { OPEN_STATUSES, QueueFilters } from './queue-filters';
import { WorkStripItem } from './work-strip';

/** The summary views of a Matter's or Project's Tasks grid (`?view=`); "Open" is the grid's default and is not in the address. */
export type ScopedView = 'overdue' | 'dueSoon' | 'asap' | 'onHold';

export const SCOPED_VIEWS: readonly ScopedView[] = ['overdue', 'dueSoon', 'asap', 'onHold'];

/** Reads `view` from the address; an unknown value is ignored (the plain open list). */
export function parseScopedView(value: string | null | undefined): ScopedView | null {
  return SCOPED_VIEWS.find((v) => v === value) ?? null;
}

/**
 * The filters a view stands for, the same as the Task Queue's quick views (and the strip numbers): open tasks plus the view's own filter.
 * Only the fields of the view are returned; the caller lays them over the grid's filters.
 */
export function scopedViewFilters(view: ScopedView, dueSoonTo: string): Partial<QueueFilters> {
  switch (view) {
    case 'overdue':
      return { status: [...OPEN_STATUSES], overdue: true };
    case 'dueSoon':
      return {
        status: [...OPEN_STATUSES],
        asap: false,
        overdue: false,
        dueFrom: null,
        dueTo: dueSoonTo,
      };
    case 'asap':
      return { status: [...OPEN_STATUSES], asap: true };
    case 'onHold':
      return { status: ['ON_HOLD'] };
  }
}

/** The grid's column filters that a view decides itself (they show disabled while it is pressed): Status always, Due for Due soon. */
export function scopedViewOwns(view: ScopedView | null): readonly ('status' | 'due')[] {
  if (view === null) return [];
  return view === 'dueSoon' ? ['status', 'due'] : ['status'];
}

/** What the disabled Status and Due controls say while a view is pressed. */
export const VIEW_FIXED: Readonly<Record<ScopedView, { status: string; due?: string }>> = {
  overdue: { status: 'Open' },
  dueSoon: { status: 'Open', due: 'Next 2 days' },
  asap: { status: 'Open' },
  onHold: { status: 'On hold' },
};

/** The empty-grid sentence of a pressed view. */
export const VIEW_EMPTY: Readonly<Record<ScopedView, string>> = {
  overdue: 'No overdue tasks.',
  dueSoon: 'Nothing is due in the next 2 days.',
  asap: 'No open ASAP tasks.',
  onHold: 'No tasks on hold.',
};

/**
 * Strip items whose links stay on the record's own Tasks tab (`?tab=tasks&view=overdue`, Open is `?tab=tasks`), so the Overview keeps the
 * person on the page. Counts, labels and tooltips are the strip's own.
 */
export function ownTabItems(items: readonly WorkStripItem[], path: string): WorkStripItem[] {
  return items.map((item) => {
    const queryParams: Params =
      item.key === 'open' ? { tab: 'tasks' } : { tab: 'tasks', view: item.key };
    return { ...item, link: { path, queryParams } };
  });
}
