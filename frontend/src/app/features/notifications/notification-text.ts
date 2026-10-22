import {
  calendarDayInZone,
  dayIndex,
  formatCalendarDay,
  formatInstant,
  formatMonthDay,
} from '../../core/time/time';

/** The parts of a notification the text helpers need (the generated `NotificationItem` fits). */
export interface NotificationLike {
  readonly objectKind: string;
  readonly objectId: number;
  readonly message: string;
  readonly createdUtc: string;
  readonly isRead: boolean;
}

/**
 * The text a polite live region says for items a poll found after the first one (README section 10): one item reads "New notification:
 * <message>", several read "3 new notifications. Latest: <message>". `items` is newest first; nothing new gives an empty string.
 */
export function announcementText(items: readonly { message: string }[]): string {
  if (items.length === 0) return '';
  const latest = items[0].message;
  return items.length === 1
    ? `New notification: ${latest}`
    : `${items.length} new notifications. Latest: ${latest}`;
}

/**
 * "5 min ago", "1 h ago", "yesterday", then "Oct 18" (and "Oct 18, 2025" in another year) in the viewer's zone. Under a minute reads
 * "just now". The absolute time is the tooltip (`absoluteTime`).
 */
export function relativeTime(createdUtc: string, now: Date, zone: string): string {
  const created = new Date(createdUtc);
  if (Number.isNaN(created.getTime())) return '';
  const minutes = Math.floor((now.getTime() - created.getTime()) / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const today = calendarDayInZone(now, zone);
  const day = calendarDayInZone(created, zone);
  const daysAgo = dayIndex(today) - dayIndex(day);
  if (daysAgo <= 0) return `${Math.floor(minutes / 60)} h ago`;
  if (daysAgo === 1) return 'yesterday';
  return day.year === today.year ? formatMonthDay(day) : formatCalendarDay(day);
}

/** "Oct 28, 2026, 3:00 PM CDT" for the tooltip and the `<time>` title. */
export function absoluteTime(createdUtc: string, zone: string): string {
  const created = new Date(createdUtc);
  return Number.isNaN(created.getTime()) ? '' : formatInstant(created, zone);
}

/** Router commands for the object a notification is about; built from kind and id only, never from stored text. */
export function notificationLink(
  item: Pick<NotificationLike, 'objectKind' | 'objectId'>,
): unknown[] {
  return [item.objectKind === 'Matter' ? '/matters' : '/tasks', item.objectId];
}
