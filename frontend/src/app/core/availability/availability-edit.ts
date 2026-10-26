import type { WorkHourDto } from '../../api/generated/api-client';
import { CalendarDay, dayIndex, parseDateOnly, partsInZone } from '../time/time';
import {
  AvailabilityDisplay,
  NOTE_MAX,
  addDays,
  availabilityDisplay,
  shortDay,
} from './availability';

/*
 * Editing an availability profile: the weekly grid, validation, the summary sentence, the time zone list and the live preview. Kept
 * apart from `availability.ts` (display only) because the header loads that one on every page and only the profile screens need this.
 */

// ---- Work hours -------------------------------------------------------------------------------------------------------------

export interface WeekDay {
  /** ISO weekday: 1 = Monday ... 7 = Sunday. */
  n: number;
  name: string;
  short: string;
}

export const WEEK_DAYS: readonly WeekDay[] = [
  { n: 1, name: 'Monday', short: 'Mon' },
  { n: 2, name: 'Tuesday', short: 'Tue' },
  { n: 3, name: 'Wednesday', short: 'Wed' },
  { n: 4, name: 'Thursday', short: 'Thu' },
  { n: 5, name: 'Friday', short: 'Fri' },
  { n: 6, name: 'Saturday', short: 'Sat' },
  { n: 7, name: 'Sunday', short: 'Sun' },
];

export const DEFAULT_START = '09:00';
export const DEFAULT_END = '17:00';

/** One row of the weekly grid. */
export interface DayHours {
  day: number;
  working: boolean;
  /** `HH:mm`; kept while the day is switched off so switching it back on restores the times. */
  start: string;
  end: string;
}

/** Monday to Friday 09:00-17:00, weekend off: what a person who never saved a schedule has. */
export function defaultWeek(): DayHours[] {
  return WEEK_DAYS.map((d) => ({
    day: d.n,
    working: d.n <= 5,
    start: DEFAULT_START,
    end: DEFAULT_END,
  }));
}

/** The grid for a saved list of work hours (an empty list = no working days). */
export function weekFromServer(hours: readonly WorkHourDto[] | null | undefined): DayHours[] {
  const byDay = new Map((hours ?? []).map((h) => [h.dayOfWeek, h]));
  return WEEK_DAYS.map((d) => {
    const h = byDay.get(d.n);
    return h
      ? { day: d.n, working: true, start: h.start.slice(0, 5), end: h.end.slice(0, 5) }
      : { day: d.n, working: false, start: DEFAULT_START, end: DEFAULT_END };
  });
}

/** The working days only, as the API wants them. */
export function weekToServer(week: readonly DayHours[]): WorkHourDto[] {
  return week
    .filter((d) => d.working)
    .map((d) => ({ dayOfWeek: d.day, start: d.start, end: d.end }));
}

/** True when the grid is exactly the default schedule (the API then stores "default" instead of seven rows). */
export function isDefaultWeek(week: readonly DayHours[]): boolean {
  return week.every((d) =>
    d.day <= 5 ? d.working && d.start === DEFAULT_START && d.end === DEFAULT_END : !d.working,
  );
}

/** The `workHours` field of a save request: null for the default schedule, the list otherwise ([] = no working days). */
export function workHoursForSave(week: readonly DayHours[]): WorkHourDto[] | null {
  return isDefaultWeek(week) ? null : weekToServer(week);
}

/** True when every working day has the same start and end (no working days counts): a week the compact control can show without loss. */
export function hasUniformHours(week: readonly DayHours[]): boolean {
  const working = week.filter((d) => d.working);
  return working.every((d) => d.start === working[0].start && d.end === working[0].end);
}

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

export function isTime(value: string): boolean {
  return TIME.test(value);
}

/** One problem per day (key = ISO weekday) for the working days whose times are missing or do not end after they start. */
export function validateWeek(week: readonly DayHours[]): Record<number, string> {
  const problems: Record<number, string> = {};
  for (const d of week) {
    if (!d.working) continue;
    const name = WEEK_DAYS[d.day - 1].name;
    if (!isTime(d.start) || !isTime(d.end)) {
      problems[d.day] = `${name}: enter a start and an end time.`;
    } else if (d.end <= d.start) {
      problems[d.day] = `${name}: the end time must be after the start time.`;
    }
  }
  return problems;
}

// ---- Out of office form ---------------------------------------------------------------------------------------------------

/** Problems with the out-of-office dates and note. Dates are `yyyy-MM-dd` or empty. */
export function validateRange(
  from: string | null | undefined,
  until: string | null | undefined,
  note: string,
): { from?: string; until?: string; note?: string } {
  const problems: { from?: string; until?: string; note?: string } = {};
  const f = from ? parseDateOnly(from) : null;
  const u = until ? parseDateOnly(until) : null;
  if (from && !f) problems.from = 'Enter a valid From date.';
  if (until && !u) problems.until = 'Enter a valid Until date.';
  if (f && u && dayIndex(u) < dayIndex(f)) problems.until = 'Until must be on or after From.';
  if (note.length > NOTE_MAX) problems.note = `Keep the note to ${NOTE_MAX} characters or fewer.`;
  return problems;
}

/**
 * The sentence under the dates: what everyone will see and when the person counts as available again.
 *   You will show as out of office from Oct 16 until Oct 20 and as available again on Oct 21.
 */
export function outOfOfficeSummary(
  from: string | null | undefined,
  until: string | null | undefined,
  options: { self?: boolean; name?: string; today?: CalendarDay | null } = {},
): string {
  const self = options.self ?? true;
  const who = self ? 'You' : (options.name ?? 'This person');
  const f = from ? parseDateOnly(from) : null;
  const u = until ? parseDateOnly(until) : null;
  const today = options.today ?? null;
  const when = f ? `from ${shortDay(f, today)}` : 'from now';
  if (!u) {
    const end = self ? 'you set yourself available again' : 'they are set available again';
    return `${who} will show as out of office ${when}, until ${end}.`;
  }
  const back = shortDay(addDays(u, 1), today);
  return `${who} will show as out of office ${when} until ${shortDay(u, today)} and as available again on ${back}.`;
}

// ---- Until presets (Set out of office dialog) --------------------------------------------------------------------------------

export type UntilPresetId = 'today' | 'tomorrow' | 'monday' | 'week';

export const UNTIL_PRESETS: readonly { id: UntilPresetId; label: string }[] = [
  { id: 'today', label: 'Rest of today' },
  { id: 'tomorrow', label: 'Until tomorrow' },
  { id: 'monday', label: 'Until Monday' },
  { id: 'week', label: '1 week' },
];

/**
 * The Until date (`yyyy-MM-dd`, the last day out) a quick choice stands for, counted from `today` (a calendar day in the profile time
 * zone, so a change of clocks cannot move it): today; tomorrow; the next Monday after today (a Monday asks for the following one);
 * today plus 7 days.
 */
export function presetUntil(id: UntilPresetId, today: CalendarDay): string {
  const weekday = new Date(Date.UTC(today.year, today.month - 1, today.day)).getUTCDay(); // 0 = Sunday
  const days = {
    today: 0,
    tomorrow: 1,
    monday: (1 - weekday + 7) % 7 || 7,
    week: 7,
  }[id];
  const d = addDays(today, days);
  return `${d.year}-${String(d.month).padStart(2, '0')}-${String(d.day).padStart(2, '0')}`;
}

// ---- Time zones -----------------------------------------------------------------------------------------------------------

/** The IANA zones the browser knows, plus `extra` (the person's own zone) when missing, sorted. */
export function timeZoneList(...extra: (string | null | undefined)[]): string[] {
  let zones: string[] = [];
  try {
    const intl = Intl as unknown as { supportedValuesOf?: (key: string) => string[] };
    zones = intl.supportedValuesOf?.('timeZone') ?? [];
  } catch {
    zones = [];
  }
  const all = new Set(zones);
  for (const z of extra) if (z) all.add(z);
  if (all.size === 0) all.add('UTC');
  return [...all].sort((a, b) => a.localeCompare(b));
}

/** The US zones the firm uses, in the order the Time zone select lists them (#540); everything else is behind "Other zones...". */
export const FRIENDLY_ZONES: readonly { label: string; id: string }[] = [
  { label: 'Eastern', id: 'America/New_York' },
  { label: 'Central', id: 'America/Chicago' },
  { label: 'Mountain', id: 'America/Denver' },
  { label: 'Pacific', id: 'America/Los_Angeles' },
  { label: 'Alaska', id: 'America/Anchorage' },
  { label: 'Hawaii', id: 'Pacific/Honolulu' },
  { label: 'Arizona (no daylight saving)', id: 'America/Phoenix' },
];

/** "9:41 AM" in `zone` (the viewer's locale), or null when the zone is not one the browser knows. */
export function localTimeIn(zone: string, now: Date): string | null {
  try {
    return new Intl.DateTimeFormat(undefined, {
      timeZone: zone,
      hour: 'numeric',
      minute: '2-digit',
    }).format(now);
  } catch {
    return null;
  }
}

// ---- Preview ----------------------------------------------------------------------------------------------------------------

export interface AvailabilityDraft {
  status: string;
  from: string | null;
  until: string | null;
  timeZone: string;
  week: readonly DayHours[];
}

/**
 * How the person shows up right now if the draft were saved (a preview while editing; after a save the API's own evaluation is shown).
 * Out of office covers whole local days From..Until in the person's zone; the end of a working day is exclusive. Null when the time zone
 * is unknown to the browser.
 */
export function previewDisplay(draft: AvailabilityDraft, now: Date): AvailabilityDisplay | null {
  let parts;
  try {
    parts = partsInZone(now, draft.timeZone);
  } catch {
    return null;
  }
  const today: CalendarDay = { year: parts.year, month: parts.month, day: parts.day };
  if (draft.status === 'OUT_OF_OFFICE') {
    const from = draft.from ? parseDateOnly(draft.from) : null;
    const until = draft.until ? parseDateOnly(draft.until) : null;
    const started = !from || dayIndex(today) >= dayIndex(from);
    const ended = !!until && dayIndex(today) > dayIndex(until);
    if (started && !ended) {
      return {
        state: 'OUT_OF_OFFICE',
        tone: 'warning',
        icon: 'pi-calendar-minus',
        label: until ? `Out of office until ${shortDay(until, today)}` : 'Out of office',
      };
    }
  }
  const weekday =
    ((new Date(Date.UTC(today.year, today.month - 1, today.day)).getUTCDay() + 6) % 7) + 1;
  const row = draft.week.find((d) => d.day === weekday);
  const time = `${String(parts.hour).padStart(2, '0')}:${String(parts.minute).padStart(2, '0')}`;
  const working = !!row && row.working && time >= row.start && time < row.end;
  return availabilityDisplay({ state: working ? 'AVAILABLE' : 'OFF_HOURS' }, draft.timeZone, now);
}
