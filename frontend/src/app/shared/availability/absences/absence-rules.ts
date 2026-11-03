import { NOTE_MAX } from '../../../core/availability/availability';
import { AbsenceEntry, AbsenceInput, AbsenceOverlap } from './absence-contract';

/** How far back a Sick entry may start (the rule is the server's; the form says it first). */
export const SICK_BACKDATE_DAYS = 14;

export interface AbsenceGroups {
  now: AbsenceEntry[];
  upcoming: AbsenceEntry[];
  past: AbsenceEntry[];
}

/** Now and Upcoming, earliest start first; Past, most recent first. */
export function groupAbsences(list: readonly AbsenceEntry[]): AbsenceGroups {
  const byStart = (a: AbsenceEntry, b: AbsenceEntry) => a.startDate.localeCompare(b.startDate);
  return {
    now: list.filter((e) => e.state === 'NOW').sort(byStart),
    upcoming: list.filter((e) => e.state === 'UPCOMING').sort(byStart),
    past: list.filter((e) => e.state === 'PAST').sort((a, b) => -byStart(a, b)),
  };
}

/** `yyyy-MM-dd` minus a number of days (floating dates, UTC arithmetic). */
export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export interface AbsenceProblems {
  startDate?: string;
  endDate?: string;
  note?: string;
}

export interface AbsenceRuleContext {
  /** Today in the person's zone, `yyyy-MM-dd`. */
  today: string;
  /** A manager editing someone else's entry may start in the past. */
  canBackdate: boolean;
}

/** The checks the form can make before it asks the server (which decides again): required start, end not before start, a past start, the note length. */
export function validateAbsence(
  input: Pick<AbsenceInput, 'type' | 'startDate' | 'endDate' | 'note'>,
  ctx: AbsenceRuleContext,
  editing: boolean,
): AbsenceProblems {
  const out: AbsenceProblems = {};
  if (!input.startDate) out.startDate = 'Choose the first day out.';
  else if (!editing && input.startDate < ctx.today && !ctx.canBackdate) {
    const earliest = addDays(ctx.today, -SICK_BACKDATE_DAYS);
    if (input.type !== 'SICK' || input.startDate < earliest) {
      out.startDate =
        input.type === 'SICK'
          ? `A sick day can start at most ${SICK_BACKDATE_DAYS} days ago.`
          : 'The first day cannot be in the past. Ask your manager to enter it for you.';
    }
  }
  if (input.startDate && input.endDate && input.endDate < input.startDate) {
    out.endDate = 'The last day cannot be before the first day.';
  } else if (!editing && input.startDate && !input.endDate && input.startDate !== ctx.today) {
    // The API accepts an open end only for an entry that starts today (the header quick action).
    out.endDate = 'Enter the last day. Leave it empty only for an entry that starts today.';
  }
  if ((input.note ?? '').trim().length > NOTE_MAX) {
    out.note = `The note can have at most ${NOTE_MAX} characters.`;
  }
  return out;
}

/** The sentence under an overlap error ("Overlaps your Vacation, 11/24 to 11/28"); the dates are formatted by the caller. */
export function overlapMessage(typeLabel: string, range: string): string {
  return `These dates overlap another entry: ${typeLabel}, ${range}. Change the dates or edit that entry.`;
}

export function isOverlap(value: unknown): value is { overlapsWith: AbsenceOverlap } {
  return !!value && typeof value === 'object' && 'overlapsWith' in value;
}
