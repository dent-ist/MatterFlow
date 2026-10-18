import { TaskActivityItem } from '../../../api/generated/api-client';
import {
  calendarDayInZone,
  dayIndex,
  formatInstantClock,
  formatCalendarDay,
} from '../../../core/time/time';

/** Fewest comment events one person adds in a run before the timeline folds them into one row (PM decision, #317). */
export const GROUP_MIN = 3;
/** Longest pause between two neighbouring comment events of the same run. */
export const GROUP_GAP_MS = 10 * 60 * 1000;

export interface ActivityEventRow {
  readonly kind: 'event';
  readonly event: TaskActivityItem;
}

export interface ActivityGroupRow {
  readonly kind: 'group';
  /** Stable while older events load: the id of the newest event of the run. */
  readonly key: number;
  readonly events: readonly TaskActivityItem[];
  /** The newest event, for the time column. */
  readonly latest: TaskActivityItem;
  readonly actorName: string;
}

export type ActivityRow = ActivityEventRow | ActivityGroupRow;

const time = (e: TaskActivityItem): number => Date.parse(e.occurredAtUtc);

/** Only a plain "Comment added" folds: edits, deletes and the Cancel / On Hold reasons stay rows of their own, and no other type is ever folded. */
export function isFoldable(e: TaskActivityItem): boolean {
  return e.eventType === 'COMMENT_ADDED' && e.commentId != null && e.summary === 'Comment added';
}

const actorKey = (e: TaskActivityItem): number | null => e.actor?.userId ?? null;

/**
 * Folds runs of 3 or more consecutive "Comment added" events by the same person (each at most 10 minutes after the previous one) into one
 * group row. `events` are newest first, as the API returns them; the order is kept. Events without a comment id (other pages' feeds, older
 * servers) are never folded.
 */
export function groupActivity(events: readonly TaskActivityItem[]): ActivityRow[] {
  const rows: ActivityRow[] = [];
  let i = 0;
  while (i < events.length) {
    const first = events[i];
    let end = i + 1;
    if (isFoldable(first)) {
      while (
        end < events.length &&
        isFoldable(events[end]) &&
        actorKey(events[end]) === actorKey(first) &&
        Math.abs(time(events[end - 1]) - time(events[end])) <= GROUP_GAP_MS
      ) {
        end++;
      }
    }
    if (end - i >= GROUP_MIN) {
      const run = events.slice(i, end);
      rows.push({
        kind: 'group',
        key: first.eventId,
        events: run,
        latest: first,
        actorName: first.actor?.displayName ?? 'System',
      });
    } else {
      for (let j = i; j < end; j++) rows.push({ kind: 'event', event: events[j] });
    }
    i = end;
  }
  return rows;
}

/**
 * "4:03 to 4:05 PM" for a run inside one half-day, "11:58 AM to 12:03 PM" across noon, "Oct 17, 11:58 PM to Oct 18, 12:03 AM" across
 * midnight, "4:03 PM" for a single minute. Times are in the viewer's zone.
 */
export function formatRange(oldest: string, newest: string, zone: string): string {
  const from = formatInstantClock(oldest, zone);
  const to = formatInstantClock(newest, zone);
  const fromDay = calendarDayInZone(oldest, zone);
  const toDay = calendarDayInZone(newest, zone);
  if (dayIndex(fromDay) !== dayIndex(toDay)) {
    const short = (d: typeof fromDay): string => formatCalendarDay(d).replace(/, \d{4}$/, '');
    return `${short(fromDay)}, ${from} to ${short(toDay)}, ${to}`;
  }
  if (from === to) return from;
  const [fromClock, fromHalf] = from.split(' ');
  const [, toHalf] = to.split(' ');
  return fromHalf === toHalf ? `${fromClock} to ${to}` : `${from} to ${to}`;
}
