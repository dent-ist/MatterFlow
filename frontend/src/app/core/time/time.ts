/**
 * Local-time utilities (addendum M). Instants (UTC) render in the viewer's zone with the zone
 * abbreviation; date-only values are floating calendar dates with no zone. Overdue is judged in
 * the viewer's zone. All functions take the zone explicitly so they are deterministic in tests.
 */

const LOCALE = 'en-US';

export interface ZonedParts {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number;
  minute: number;
  second: number;
}

export interface CalendarDay {
  year: number;
  month: number; // 1-12
  day: number;
}

const formatterCache = new Map<string, Intl.DateTimeFormat>();

function formatter(zone: string, options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const key = zone + JSON.stringify(options);
  let f = formatterCache.get(key);
  if (!f) {
    f = new Intl.DateTimeFormat(LOCALE, { timeZone: zone, ...options });
    formatterCache.set(key, f);
  }
  return f;
}

/** Narrow no-break spaces in newer ICU output become plain spaces. */
const NBSP = new RegExp('[\\u202f\\u00a0]', 'g');
const clean = (s: string) => s.replace(NBSP, ' ');

function toDate(value: Date | string | number): Date {
  return value instanceof Date ? value : new Date(value);
}

/** Wall-clock parts of an instant in `zone`. */
export function partsInZone(instant: Date | string | number, zone: string): ZonedParts {
  const parts = formatter(zone, {
    hourCycle: 'h23',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
  }).formatToParts(toDate(instant));
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  return {
    year: get('year'),
    month: get('month'),
    day: get('day'),
    hour: get('hour') % 24,
    minute: get('minute'),
    second: get('second'),
  };
}

/** Offset (zone minus UTC) in ms at the given instant. */
export function zoneOffsetMs(instant: Date | string | number, zone: string): number {
  const d = toDate(instant);
  const p = partsInZone(d, zone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - Math.floor(d.getTime() / 1000) * 1000;
}

/** The UTC instant at which the wall clock in `zone` reads the given local time. */
export function zonedLocalToUtc(
  local: {
    year: number;
    month: number;
    day: number;
    hour?: number;
    minute?: number;
    second?: number;
  },
  zone: string,
): Date {
  const guess = Date.UTC(
    local.year,
    local.month - 1,
    local.day,
    local.hour ?? 0,
    local.minute ?? 0,
    local.second ?? 0,
  );
  const first = guess - zoneOffsetMs(guess, zone);
  const second = guess - zoneOffsetMs(first, zone);
  return new Date(second);
}

/** The calendar day an instant falls on in `zone`. */
export function calendarDayInZone(instant: Date | string | number, zone: string): CalendarDay {
  const { year, month, day } = partsInZone(instant, zone);
  return { year, month, day };
}

/** Parse `yyyy-MM-dd` (floating date). Returns null when malformed. */
export function parseDateOnly(value: string): CalendarDay | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return null;
  const [year, month, day] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const check = new Date(Date.UTC(year, month - 1, day));
  if (
    check.getUTCFullYear() !== year ||
    check.getUTCMonth() !== month - 1 ||
    check.getUTCDate() !== day
  ) {
    return null;
  }
  return { year, month, day };
}

/** Whole-day index for calendar arithmetic (no DST involvement). */
export function dayIndex(d: CalendarDay): number {
  return Math.round(Date.UTC(d.year, d.month - 1, d.day) / 86_400_000);
}

/** "Oct 28, 2026" for a floating calendar date. */
export function formatCalendarDay(d: CalendarDay): string {
  return clean(
    formatter('UTC', { year: 'numeric', month: 'short', day: 'numeric' }).format(
      new Date(Date.UTC(d.year, d.month - 1, d.day)),
    ),
  );
}

/** "Oct 28, 2026" for a `yyyy-MM-dd` string (no zone conversion); echoes the input if invalid. */
export function formatDateOnly(value: string): string {
  const d = parseDateOnly(value);
  return d ? formatCalendarDay(d) : value;
}

/** Zone abbreviation at that instant, e.g. `CDT` (DST aware). */
export function zoneAbbreviation(instant: Date | string | number, zone: string): string {
  const part = formatter(zone, { timeZoneName: 'short' })
    .formatToParts(toDate(instant))
    .find((p) => p.type === 'timeZoneName');
  return part?.value ?? zone;
}

/** "Oct 28, 2026" for an instant in the viewer's zone. */
export function formatInstantDate(instant: Date | string | number, zone: string): string {
  return formatCalendarDay(calendarDayInZone(instant, zone));
}

/** "3:00 PM CDT" for an instant in the viewer's zone. */
export function formatInstantTime(instant: Date | string | number, zone: string): string {
  return clean(
    formatter(zone, {
      hour: 'numeric',
      minute: '2-digit',
      timeZoneName: 'short',
    }).format(toDate(instant)),
  );
}

/** "Oct 28, 2026, 3:00 PM CDT": the standard timestamp rendering (comments, activity, audit, due). */
export function formatInstant(instant: Date | string | number, zone: string): string {
  return `${formatInstantDate(instant, zone)}, ${formatInstantTime(instant, zone)}`;
}

export type MfDateKind = 'auto' | 'date' | 'datetime';

/**
 * The one date formatter of the app (UXR-08, addendum M). Every screen shows dates through this function or the `mfDate` pipe:
 *  - a floating calendar date (`2026-10-12`) renders as `Oct 12, 2026` and never shifts with the viewer's zone;
 *  - an instant renders in the viewer's zone as `Oct 12, 2026, 10:23 PM EDT` (`kind: 'datetime'`, the default for instants)
 *    or as just `Oct 12, 2026` (`kind: 'date'`).
 * Empty or unreadable input renders as an empty string; an unreadable string is never echoed as a guess.
 */
export function mfDate(
  value: Date | string | number | null | undefined,
  zone: string,
  kind: MfDateKind = 'auto',
): string {
  if (value === null || value === undefined || value === '') return '';
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const day = parseDateOnly(value);
    return day ? formatCalendarDay(day) : '';
  }
  const instant = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(instant.getTime())) return '';
  return kind === 'date' ? formatInstantDate(instant, zone) : formatInstant(instant, zone);
}

// ---------------------------------------------------------------------------------------------
// Due dates
// ---------------------------------------------------------------------------------------------

export interface DueInput {
  /** Floating calendar date `yyyy-MM-dd`; set whenever the task has a due date. */
  dueDate?: string | null;
  /** Absolute instant (ISO-8601 UTC), set only when a time was chosen. */
  dueAtUtc?: string | null;
}

export type DueKind = 'asap' | 'future' | 'soon' | 'overdue' | 'closed';

export interface DueState {
  kind: DueKind;
  /** Display string, e.g. `ASAP`, `Oct 28, 2026, 3:00 PM CDT`, `Oct 28, 2026 · Overdue 4d`. */
  label: string;
  /** The date/time part only (empty for ASAP). */
  dateText: string;
  /** `Overdue 4d` / `Due soon` suffix, when applicable. */
  badge?: string;
  tooltip?: string;
  overdue: boolean;
  hasTime: boolean;
  /** Whole calendar days from today (viewer's zone) to the due day: 0 today, 1 tomorrow. Set for open, not overdue tasks with a due date. */
  daysUntil?: number;
}

export const CLOSED_STATUSES: readonly string[] = ['COMPLETED', 'CANCELLED'];
export const DUE_SOON_DAYS = 2;

/**
 * Computes the due display state (UX 4.6 + addendum M).
 * - no due date: ASAP, never overdue;
 * - `dueAtUtc`: overdue once `now` is past that instant (same for every viewer);
 * - `dueDate` only: overdue once the viewer's local calendar day is after that date.
 */
export function describeDue(
  due: DueInput | null | undefined,
  now: Date,
  zone: string,
  status?: string | null,
): DueState {
  const dueAt = due?.dueAtUtc ? new Date(due.dueAtUtc) : null;
  const dueDay = due?.dueDate ? parseDateOnly(due.dueDate) : null;
  const validAt = dueAt && !Number.isNaN(dueAt.getTime()) ? dueAt : null;

  if (!validAt && !dueDay) {
    return {
      kind: 'asap',
      label: 'ASAP',
      dateText: '',
      tooltip: 'No due date set. Handle promptly.',
      overdue: false,
      hasTime: false,
    };
  }

  const hasTime = !!validAt;
  const dateText = validAt
    ? formatInstant(validAt, zone)
    : formatCalendarDay(dueDay as CalendarDay);
  const closed = !!status && CLOSED_STATUSES.includes(status);
  const today = dayIndex(calendarDayInZone(now, zone));
  const dueIdx = validAt
    ? dayIndex(calendarDayInZone(validAt, zone))
    : dayIndex(dueDay as CalendarDay);

  if (closed) {
    return { kind: 'closed', label: dateText, dateText, overdue: false, hasTime };
  }

  const overdue = validAt ? now.getTime() > validAt.getTime() : today > dueIdx;
  if (overdue) {
    const badge = `Overdue ${overdueDuration(validAt, today - dueIdx, now)}`;
    return {
      kind: 'overdue',
      label: `${dateText} · ${badge}`,
      dateText,
      badge,
      overdue: true,
      hasTime,
    };
  }
  if (dueIdx - today <= DUE_SOON_DAYS) {
    return {
      kind: 'soon',
      label: `${dateText} · Due soon`,
      dateText,
      badge: 'Due soon',
      overdue: false,
      hasTime,
      daysUntil: dueIdx - today,
    };
  }
  return {
    kind: 'future',
    label: dateText,
    dateText,
    overdue: false,
    hasTime,
    daysUntil: dueIdx - today,
  };
}

function overdueDuration(instant: Date | null, calendarDays: number, now: Date): string {
  if (!instant) return `${calendarDays}d`;
  const ms = now.getTime() - instant.getTime();
  const days = Math.floor(ms / 86_400_000);
  if (days >= 1) return `${days}d`;
  const hours = Math.floor(ms / 3_600_000);
  return hours >= 1 ? `${hours}h` : '<1h';
}
