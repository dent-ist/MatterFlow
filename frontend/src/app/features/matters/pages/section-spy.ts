/**
 * Which section of the long Matter page is "in view" (the highlighted jump link; D-03b). Pure, so it can be tested without a browser.
 *
 * The plain rule is "the last section whose top is above the activation line". It gives a short section no turn when the page cannot scroll far enough for the sections at its
 * end to reach the line (an empty Productions above a short Notes: the page ends first, so the highlight would jump from Projects or Assets straight to the last section). So the
 * sections whose top can never reach the line share the last stretch of the scroll, in order, and the last one is current at the very bottom.
 */
export interface SpyInput {
  /** The top of every section in the page (not the window), in page order. */
  docTops: readonly number[];
  /** The activation line, in window pixels from the top of the window (just under the top bar and the sticky strip). */
  line: number;
  scrollY: number;
  /** The largest scrollY the page allows. */
  maxScroll: number;
}

/** Pixels of tolerance for "at the bottom" (fractional scroll positions). */
const BOTTOM = 2;

/** The index of the section in view, or -1 when there are none. */
export function pickSection(input: SpyInput): number {
  const { docTops, line, scrollY, maxScroll } = input;
  const n = docTops.length;
  if (n === 0) return -1;
  if (scrollY <= 0) return 0;
  let natural = 0;
  for (let i = 0; i < n; i++) if (docTops[i] - scrollY <= line) natural = i;
  // The first section whose top cannot reach the line even at the bottom of the page.
  let first = -1;
  for (let i = 0; i < n; i++) {
    if (docTops[i] - maxScroll > line) {
      first = i;
      break;
    }
  }
  if (first < 0) return natural;
  if (scrollY >= maxScroll - BOTTOM) return n - 1;
  // The last section that can reach the line shares the stretch with the unreachable ones (its own top passes the line at `start`).
  const base = Math.max(first - 1, 0);
  const start = Math.max(docTops[base] - line, 0);
  if (scrollY < start) return natural;
  const span = maxScroll - start;
  if (span <= 0) return natural;
  const slice = Math.floor(((scrollY - start) / span) * (n - base));
  return Math.max(natural, Math.min(n - 1, base + slice));
}
