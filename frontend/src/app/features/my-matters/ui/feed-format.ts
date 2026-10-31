import { dayIndex, formatDateOnly, parseDateOnly } from '../../../core/time/time';
import { FEED_KINDS, FeedItem, FeedKind } from './mm-models';

export interface KindLook {
  label: string;
  icon: string;
  /** The tone class: `--mf-feed-<tone>` colours (info, success, neutral, danger, warning). */
  tone: 'info' | 'accent' | 'neutral' | 'danger' | 'warning';
}

/** Icon and tone of each activity kind. Colour is never alone: every item carries the icon and the kind's word. */
export const KIND_LOOK: Readonly<Record<FeedKind, KindLook>> = {
  NEW_ASSETS: { label: 'New assets', icon: 'pi-box', tone: 'info' },
  NEW_COMMENTS: { label: 'New comments', icon: 'pi-comment', tone: 'neutral' },
  NEW_STATUS_UPDATES: { label: 'New status updates', icon: 'pi-sync', tone: 'accent' },
  ON_HOLD: { label: 'On hold', icon: 'pi-pause-circle', tone: 'neutral' },
  OVERDUE: { label: 'Overdue', icon: 'pi-exclamation-circle', tone: 'danger' },
  DUE_DATE_UPDATED: { label: 'Due date updated', icon: 'pi-calendar-clock', tone: 'warning' },
};

export const KIND_ORDER: readonly FeedKind[] = FEED_KINDS.map((k) => k.kind);

const STATUS_WORDS: Record<string, string> = {
  NEW: 'New',
  IN_PROGRESS: 'In Progress',
  ON_HOLD: 'On Hold',
  COMPLETED: 'Completed',
  CANCELLED: 'Cancelled',
};
const word = (code: string | null): string => (code ? (STATUS_WORDS[code] ?? code) : '');
const days = (n: number): string => `${n} ${n === 1 ? 'day' : 'days'}`;

/** What happened, in one line without the task title ("Moved from New to In Progress"). */
export function feedWhat(i: FeedItem): string {
  switch (i.kind) {
    case 'NEW_ASSETS':
      return `Asset added: ${i.assetName ?? 'asset'}${i.assetTypeName ? ` (${i.assetTypeName})` : ''}`;
    case 'NEW_COMMENTS':
      return `${i.actorName ?? 'Someone'} commented`;
    case 'NEW_STATUS_UPDATES':
      return `${word(i.fromStatus)} to ${word(i.toStatus)}${i.actorName ? ` by ${i.actorName}` : ''}`;
    case 'ON_HOLD':
      return `On hold${i.onHoldDays != null ? ` for ${days(i.onHoldDays)}` : ''}${i.onHoldReason ? `: ${i.onHoldReason}` : ''}`;
    case 'OVERDUE':
      return i.daysOverdue != null ? `${days(i.daysOverdue)} overdue` : 'Overdue';
    case 'DUE_DATE_UPDATED':
      return dueMove(i);
  }
}

/** "Due date moved 3 days later (Nov 4 to Nov 7)". A null date is ASAP. */
export function dueMove(i: FeedItem): string {
  const a = i.oldDueDate ? parseDateOnly(i.oldDueDate) : null;
  const b = i.newDueDate ? parseDateOnly(i.newDueDate) : null;
  const text = (d: string | null): string => (d ? formatDateOnly(d) : 'ASAP');
  const range = `${text(i.oldDueDate)} to ${text(i.newDueDate)}`;
  if (!a || !b) return `Due date changed (${range})`;
  const n = dayIndex(b) - dayIndex(a);
  if (n === 0) return `Due date changed (${range})`;
  return `Due date moved ${days(Math.abs(n))} ${n > 0 ? 'later' : 'earlier'} (${range})`;
}

/** The title line: the task for a task item, the asset for an asset item. */
export function feedTitle(i: FeedItem): string {
  return i.taskId != null
    ? `${i.taskNumber ?? ''} ${i.taskTitle ?? ''}`.trim()
    : (i.assetName ?? 'Asset');
}

/** "Today", "Yesterday", "3 days ago" or the short date. */
export function agoShort(iso: string, now: Date): string {
  const then = new Date(iso);
  const n = Math.floor((now.getTime() - then.getTime()) / 86_400_000);
  if (n <= 0) return 'Today';
  if (n === 1) return 'Yesterday';
  if (n < 7) return `${n} days ago`;
  return iso.slice(0, 10);
}
