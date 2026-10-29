import {
  MyMattersActivityItem,
  MyMattersAwayWindow,
  MyMattersTaskItem,
} from '../../api/generated/api-client';
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
    case 'AT_RISK':
      return 'at risk';
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

/**
 * The fact of a row with the reason of a hold: "on hold 6 d - Waiting for client data". The reason is the structured one an administrator-managed list gives;
 * a hold without one reads as before.
 */
export function rowFactText(
  t: Pick<MyMattersTaskItem, 'factCode' | 'factDays'> & {
    onHold?: { reasonName?: string | undefined } | undefined;
  },
): string {
  const base = factText(t);
  const reason = t.factCode === 'ON_HOLD_DAYS' ? t.onHold?.reasonName : undefined;
  return reason ? `${base} - ${reason}` : base;
}

/** The Task Queue order of a link that means "overdue": the oldest due date first (the Due column header shows it; Priority is one click away). */
export const OLDEST_FIRST = { sort: 'due', dir: 'asc' } as const;

/** The second line of the strip's On hold cell: "oldest 12 days", "oldest 1 day"; nothing without a hold (the label never carries the age). */
export function holdHint(
  oldestDays: number | null | undefined,
  onHold: number | undefined,
): string {
  if (oldestDays == null || !onHold || onHold <= 0) return '';
  return `oldest ${oldestDays} ${oldestDays === 1 ? 'day' : 'days'}`;
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

/** "Today, 9:42 AM", "Yesterday, 9:10 AM", "Oct 21, 2:05 PM": the When cell of the Activity grid (date and time on one line; the full stamp is its tooltip). */
export function activityWhen(instant: string, now: Date, zone: string): string {
  const day = calendarDayInZone(instant, zone);
  const gap = dayIndex(calendarDayInZone(now, zone)) - dayIndex(day);
  const clock = formatInstantClock(instant, zone);
  if (gap <= 0) return `Today, ${clock}`;
  return `${gap === 1 ? 'Yesterday' : formatMonthDay(day)}, ${clock}`;
}

/** The Who cell of the Activity grid: the person's name, never the account; "System" when nobody did it. */
export function activityWho(e: Pick<MyMattersActivityItem, 'actorName'>): string {
  return e.actorName?.trim() || 'System';
}

/**
 * The What cell of the Activity grid: one short phrase, without the person (that is the Who cell) and without the task (the Task cell). "Created",
 * "Moved to In Progress", "Put on hold", "Completed", "Assigned to Dana Rao", "Reassigned from Dana Rao to Priya Rao", "Commented", "Dana Rao became
 * primary project manager". A comment is only ever "Commented": its text is never read or shown (privilege).
 */
export function activityWhat(e: MyMattersActivityItem): string {
  switch (e.kind) {
    case 'TASK_CREATED':
      return 'Created';
    case 'STATUS_CHANGED':
      if (e.to === 'ON_HOLD') return 'Put on hold';
      if (e.to === 'COMPLETED') return 'Completed';
      if (e.to === 'CANCELLED') return 'Cancelled';
      return e.to ? `Moved to ${statusWords(e.to)}` : 'Status changed';
    case 'REASSIGNED':
      return e.from
        ? `Reassigned from ${e.from} to ${e.to ?? 'nobody'}`
        : `Assigned to ${e.to ?? 'nobody'}`;
    case 'COMMENTED':
      return 'Commented';
    case 'MANAGER_CHANGED': {
      const place = e.managerPlace === 'secondary' ? 'secondary' : 'primary';
      if (e.to) return `${e.to} became ${place} project manager`;
      return e.from
        ? `${e.from} is no longer ${place} project manager`
        : `The ${place} project manager was cleared`;
    }
    default:
      return 'Changed';
  }
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

/**
 * The sentence of one event, composed from its structured fields (README 6.6). A comment is only ever "commented on <task>": the text is
 * never read or shown (privilege).
 */
export function activityText(e: MyMattersActivityItem): string {
  const who = e.actorName ?? 'Someone';
  const task = e.taskTitle ? `"${e.taskTitle}"` : 'a task';
  switch (e.kind) {
    case 'TASK_CREATED':
      return `${who} created ${task}`;
    case 'STATUS_CHANGED':
      return `${who} moved ${task} to ${statusWords(e.to)}`;
    case 'REASSIGNED':
      return e.from
        ? `${task} reassigned from ${e.from} to ${e.to ?? 'nobody'}`
        : `${task} assigned to ${e.to ?? 'nobody'}`;
    case 'COMMENTED':
      return `${who} commented on ${task}`;
    case 'MANAGER_CHANGED': {
      const place = e.managerPlace === 'secondary' ? 'secondary' : 'primary';
      if (e.to) return `${e.to} became ${place} project manager`;
      return e.from
        ? `${e.from} is no longer ${place} project manager`
        : `The ${place} project manager was cleared`;
    }
    default:
      return `${who} changed ${task}`;
  }
}

/** The words of an away window: "Away Oct 26 to Oct 30", "Away until Oct 30", "Away from Oct 26" (whole days, never a reason in free text). */
export function awayText(away: MyMattersAwayWindow, year: number): string {
  const from = away.from ? shortDate(away.from, year, '') : '';
  const to = away.to ? shortDate(away.to, year, '') : '';
  if (from && to) return from === to ? `Away ${from}` : `Away ${from} to ${to}`;
  if (to) return `Away until ${to}`;
  if (from) return `Away from ${from}, no end date`;
  return 'Away, no end date';
}
