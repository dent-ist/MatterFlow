import { MyMattersTaskItem } from '../../api/generated/api-client';
import {
  CalendarDay,
  calendarDayInZone,
  dayIndex,
  formatCalendarDay,
  formatInstantClock,
  formatMonthDay,
  parseDateOnly,
} from '../../core/time/time';

/** The one fact an attention or deadline row states, in plain words ("3 d overdue", "due tomorrow", "no assignee", "on hold 12 d"). */
export function factText(t: Pick<MyMattersTaskItem, 'factCode' | 'factDays'>): string {
  const n = t.factDays ?? 0;
  switch (t.factCode) {
    case 'OVERDUE':
      return n <= 0 ? 'overdue' : `${n} d overdue`;
    case 'DUE_TODAY':
      return 'due today';
    case 'DUE_IN_DAYS':
      return n === 1 ? 'due tomorrow' : `due in ${n} d`;
    case 'NO_ASSIGNEE':
      return 'no assignee';
    case 'ON_HOLD_DAYS':
      return `on hold ${n} d`;
    default:
      return '';
  }
}

const STATUS_WORDS: Record<string, string> = {
  NEW: 'New',
  IN_PROGRESS: 'In Progress',
  ON_HOLD: 'On Hold',
  COMPLETED: 'Completed',
  CANCELLED: 'Cancelled',
};

/** A status code as the people read it ("ON_HOLD" is "On Hold"). */
export function statusWords(code: string | undefined): string {
  return code ? (STATUS_WORDS[code] ?? code) : '';
}

const WEEKDAY = new Intl.DateTimeFormat('en-US', { weekday: 'short', timeZone: 'UTC' });
const MONTH_DAY = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  timeZone: 'UTC',
});

/** "Mon Oct 26" for a calendar day. */
export function dayHeading(d: CalendarDay): string {
  const at = new Date(Date.UTC(d.year, d.month - 1, d.day));
  return `${WEEKDAY.format(at)} ${MONTH_DAY.format(at)}`;
}

/** The calendar day a deadline row falls on: its explicit date, else the day of its due instant in the viewer's zone. */
export function dueDay(
  t: Pick<MyMattersTaskItem, 'dueDate' | 'dueAtUtc'>,
  zone: string,
): CalendarDay | null {
  if (t.dueDate) return parseDateOnly(t.dueDate);
  return t.dueAtUtc ? calendarDayInZone(t.dueAtUtc, zone) : null;
}

export interface DayGroup<T> {
  key: string;
  heading: string;
  items: T[];
}

/** Deadlines grouped by day, in the order given (the API sorts soonest first). Rows without a day (cannot happen) are left out. */
export function groupByDay(
  items: readonly MyMattersTaskItem[],
  zone: string,
): DayGroup<MyMattersTaskItem>[] {
  const groups: DayGroup<MyMattersTaskItem>[] = [];
  for (const t of items) {
    const day = dueDay(t, zone);
    if (!day) continue;
    const key = String(dayIndex(day));
    const last = groups[groups.length - 1];
    if (last && last.key === key) last.items.push(t);
    else groups.push({ key, heading: dayHeading(day), items: [t] });
  }
  return groups;
}

/** "9:42 AM" for today, "Yesterday", else "Oct 21": the time an activity event is shown with (the full stamp is its tooltip). */
export function activityTime(instant: string, now: Date, zone: string): string {
  const day = calendarDayInZone(instant, zone);
  const gap = dayIndex(calendarDayInZone(now, zone)) - dayIndex(day);
  if (gap <= 0) return formatInstantClock(instant, zone);
  return gap === 1 ? 'Yesterday' : formatMonthDay(day);
}

const SHORT_DATE = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  timeZone: 'UTC',
});

/** "Oct 26" for a `yyyy-MM-dd` date in the current year, "Oct 26, 2027" in another one, or the fallback; `year` is the current year. */
export function shortDate(
  value: string | undefined | null,
  year: number,
  fallback: string,
): string {
  const d = value ? parseDateOnly(value) : null;
  if (!d) return fallback;
  return d.year === year
    ? SHORT_DATE.format(new Date(Date.UTC(d.year, d.month - 1, d.day)))
    : formatCalendarDay(d);
}
