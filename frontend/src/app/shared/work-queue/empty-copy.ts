import { CopyPart } from '../ui/copy-parts';
import { DUE_SOON_DAYS, EMPTY_TEXT } from './work-vocabulary';

export type EmptyTab = 'active' | 'dueSoon' | 'completed' | 'createdByMe';

export interface EmptyContext {
  tab: EmptyTab;
  /** My Work, Closed: the default 90-day window applies (not "all time" and no closed-date range). */
  windowed?: boolean;
  /**
   * How many Pods the user belongs to; null while unknown. Only asked of a user with Pod.View (without it there is no Pod Work to point at).
   */
  podCount?: number | null;
  /** Created by me on its Open default (no filter set): the user may still have closed tasks. */
  openOnly?: boolean;
}

export interface EmptyCopy {
  parts: readonly CopyPart[];
  /** Offer the "Create task" action under the text (Created by me, only with Task.Create). */
  createTask?: boolean;
}

const NOTHING = 'Nothing is assigned to you right now.';

/**
 * The text of an empty list (BUG-8, B4, D4), worked out from what the user may open: a screen the user cannot open is never named. Pod Work
 * appears (as a link) on the Active tab only with Pod.View and a Pod; Due soon and overdue and Closed never name another screen.
 */
export function emptyCopy(ctx: EmptyContext, has: (code: string) => boolean): EmptyCopy {
  switch (ctx.tab) {
    case 'active': {
      if (!has('Pod.View')) return { parts: [NOTHING] };
      if (ctx.podCount === 0) {
        return { parts: [`${NOTHING} You are not in a Pod yet; ask an administrator.`] };
      }
      if (ctx.podCount == null) return { parts: [NOTHING] };
      return {
        parts: [
          `${NOTHING} Check `,
          { label: 'Pod Work', to: '/pods/work' },
          ' for unassigned tasks.',
        ],
      };
    }
    case 'dueSoon':
      return { parts: [EMPTY_TEXT.dueSoon] };
    case 'completed':
      return {
        parts: [
          ctx.windowed === false ? 'No tasks were closed in this period.' : EMPTY_TEXT.completed,
        ],
      };
    default:
      return {
        parts: [
          ctx.openOnly ? 'You have no open tasks you created.' : 'You have not created any tasks.',
        ],
        ...(has('Task.Create') ? { createTask: true } : {}),
      };
  }
}

/** The line under the last rows of a short Active list: "That's everything on your plate." with only the screens the user can open. */
export function nearEmptyCopy(has: (code: string) => boolean): readonly CopyPart[] {
  const queue = { label: 'Task Queue', to: '/tasks' };
  return has('Pod.View')
    ? [
        "That's everything on your plate. Look for more in ",
        { label: 'Pod Work', to: '/pods/work' },
        ' or the ',
        queue,
        '.',
      ]
    : ["That's everything on your plate. Look for more in the ", queue, '.'];
}

/**
 * The empty text of a Task Queue quick view (TQ33): a view with nothing in it is news, not a failed search, so it says what is true
 * ("Nothing is overdue.") and offers no Clear filters. Keyed by the view's key; views without a text (All open) use the generic ones.
 */
export const QUEUE_VIEW_EMPTY: Readonly<Record<string, string>> = {
  unassigned: 'Every open task has an owner.',
  overdue: 'Nothing is overdue.',
  dueSoon: `Nothing is due in the next ${DUE_SOON_DAYS} days.`,
  asap: 'No ASAP tasks.',
  onHold: 'Nothing is on hold.',
  myPod: 'Your pod has no open tasks.',
  recentlyCompleted: 'Nothing was completed in the last 30 days.',
  createdByMe: 'You have no open tasks you created.',
};

/** What an empty Task Queue shows: the text, whether it is the "no match" kind (Clear filters) and whether Create task is offered. */
export interface QueueEmpty {
  text: string;
  /** Filters are applied that the list cannot do without: the generic text with Clear filters. */
  noMatch: boolean;
  createTask: boolean;
}

/**
 * @param view the quick view the filters equal exactly (null: none, or All open), so extra filters on top of a view give `noMatch`.
 * @param filtered any filter beyond the page defaults is set.
 * @param canCreate the user holds Task.Create.
 */
export function queueEmpty(view: string | null, filtered: boolean, canCreate: boolean): QueueEmpty {
  const text = view ? QUEUE_VIEW_EMPTY[view] : undefined;
  if (text) return { text, noMatch: false, createTask: view === 'createdByMe' && canCreate };
  if (filtered) return { text: 'No tasks match these filters.', noMatch: true, createTask: false };
  return { text: 'No tasks yet.', noMatch: false, createTask: canCreate };
}
