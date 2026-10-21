import { AuditSearchItem } from '../../../api/generated/api-client';
import {
  CalendarDay,
  calendarDayInZone,
  dayIndex,
  formatCalendarDay,
  formatInstant,
  formatInstantClock,
  formatMonthDay,
} from '../../../core/time/time';
import { friendlyText } from '../../../shared/ui/audit-format';
import { AuditGroup } from './audit-links';

/** One top-level row of the log: an event or a group of one operation, with the day divider that goes above it when a new day starts. */
export interface AuditBlock {
  group: AuditGroup;
  /** "Today", "Oct 19" or "Oct 19, 2025" on the first row of each day (in the viewer's zone); null on the others. */
  day: string | null;
}

/** "Today" for the viewer's today, "Oct 19" within this year, "Oct 19, 2025" before (#655). */
export function dayLabel(day: CalendarDay, today: CalendarDay): string {
  if (dayIndex(day) === dayIndex(today)) return 'Today';
  return day.year === today.year ? formatMonthDay(day) : formatCalendarDay(day);
}

/** Puts a day label on the first block of each calendar day of the viewer's zone. A day that continues in the next page of results is not repeated. */
export function withDayDividers(
  groups: readonly AuditGroup[],
  zone: string,
  now: Date,
): AuditBlock[] {
  const today = calendarDayInZone(now, zone);
  let previous = -1;
  return groups.map((group) => {
    const day = calendarDayInZone(group.items[0].occurredAtUtc, zone);
    const index = dayIndex(day);
    const first = index !== previous;
    previous = index;
    return { group, day: first ? dayLabel(day, today) : null };
  });
}

/** The time of an event alone ("12:27 AM"): the day is the divider above it (#655). */
export function clockText(item: AuditSearchItem, zone: string): string {
  return formatInstantClock(item.occurredAtUtc, zone);
}

/** The whole stamp for the tooltip ("Oct 20, 2026, 12:27 AM EDT"). */
export function stampText(item: AuditSearchItem, zone: string): string {
  return formatInstant(item.occurredAtUtc, zone);
}

/** What happened and who did it, in one phrase: "Comment added by Test User 50" (the accessible name of the details toggle, #652). */
export function eventPhrase(item: AuditSearchItem): string {
  const what = friendlyText(item.summary) || 'Event';
  return `${what} by ${item.actor.displayName}`;
}

/** A value longer than this starts clamped with "Show full" (#652). */
export const LONG_VALUE = 200;

/** True when a value should start clamped: long text, or text the server shortened. */
export function isLongValue(value: string | undefined | null, truncated: boolean): boolean {
  return truncated || (value?.length ?? 0) > LONG_VALUE;
}
