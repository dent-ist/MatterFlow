/** How old the figures on screen must be before the page says so (P6): two missed 5-minute refreshes. */
export const STALE_AFTER_MS = 10 * 60_000;
/** How often the age is looked at again. */
export const STALE_CHECK_MS = 30_000;
/** A payload read less than this long ago is reused when the person switches tabs (P2). */
export const FRESH_FOR_MS = 60_000;

/**
 * The visible age text beside Refresh, or null while the figures are fresh enough (decision S stays: no visible timestamp in a normal
 * session). `lastOkAt` is the last successful read of the tab shown, `now` the clock; whole minutes, rounded down.
 */
export function staleAgeText(lastOkAt: number | null, now: number): string | null {
  if (lastOkAt === null) return null;
  const age = now - lastOkAt;
  if (age < STALE_AFTER_MS) return null;
  return `Updated ${Math.floor(age / 60_000)} min ago`;
}
