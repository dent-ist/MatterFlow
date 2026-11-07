import type { ReportRow } from './report-rows';

/** The toast when a star press fails (spec 7.1: the star went back; nothing is said when it worked). */
export const FAVOURITES_FAILED = "Couldn't update favourites.";

/** The most Recent chips the line shows (spec 7.2). */
export const RECENT_MAX = 5;

/** The tooltip of the star (spec section 10, Title Case: the button names an action). */
export function starTip(on: boolean): string {
  return on ? 'Remove from Favourites' : 'Add to Favourites';
}

/** The accessible name of the star: the action and the report, so a list of stars reads as "Add Overdue tasks to favourites". */
export function starLabel(name: string, on: boolean): string {
  return on ? `Remove ${name} from favourites` : `Add ${name} to favourites`;
}

/** What the live region says after a press (the star is the feedback for the eye, this is the feedback for a screen reader). */
export function starAnnouncement(name: string, on: boolean): string {
  return on ? `${name} added to favourites.` : `${name} removed from favourites.`;
}

/** The rows with one report's mark changed (the order and every other row stay as they are). */
export function withFavourite(
  rows: readonly ReportRow[],
  reportId: number,
  on: boolean,
): ReportRow[] {
  return rows.map((r) => (r.reportId === reportId ? { ...r, isFavourite: on } : r));
}
