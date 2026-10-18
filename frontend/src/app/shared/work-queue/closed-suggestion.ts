import { CLOSED_STATUSES } from './queue-filters';
import { normalizeColumns } from './column-prefs';

const DISMISSED_KEY = 'mf.work-closed-suggestion.v1.dismissed';

/** True when the Status filter names only Completed and/or Cancelled tasks: the Due column then shows old dates (#231). */
export function isFinishedOnly(status: readonly string[]): boolean {
  return status.length > 0 && status.every((s) => CLOSED_STATUSES.includes(s));
}

/** The suggestion is due when the shown set has Due; with Due hidden there is nothing to swap. */
export function canSuggestClosed(columns: readonly string[]): boolean {
  return columns.includes('due');
}

/** Replaces Due by Closed (the user's saved set, one click); the rest of the set stays as it is. */
export function swapDueForClosed(columns: readonly string[]): string[] {
  return normalizeColumns([...columns.filter((c) => c !== 'due'), 'closed']);
}

/** Puts Due back and removes Closed ("Restore Due"). */
export function swapClosedForDue(columns: readonly string[]): string[] {
  return normalizeColumns([...columns.filter((c) => c !== 'closed'), 'due']);
}

function storage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

/** Whether the user dismissed the suggestion line for good. Never throws. */
export function loadSuggestionDismissed(): boolean {
  try {
    return storage()?.getItem(DISMISSED_KEY) === '1';
  } catch {
    return false;
  }
}

export function saveSuggestionDismissed(): void {
  try {
    storage()?.setItem(DISMISSED_KEY, '1');
  } catch {
    // Not remembered.
  }
}
