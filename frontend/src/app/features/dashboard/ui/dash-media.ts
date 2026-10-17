import { DestroyRef, Signal, inject, signal } from '@angular/core';

/**
 * The fixed-height layout of the Dashboard (issue #137) is on when the window is at least 768 x 561 CSS px: the same query as
 * `mf-fixed-page` (`FIXED_MODE_QUERY`, `styles/_fixed-page.scss`). Below it the page scrolls normally (reflow, 200% zoom).
 */
export const DASH_FIXED_QUERY = '(min-width: 768px) and (min-height: 561px)';
/** The fixed layout on a window wide enough for the Summary lists to sit beside the tiles (the three lists then scroll one by one). */
export const DASH_FIXED_WIDE_QUERY = '(min-width: 1280px) and (min-height: 561px)';

/** A phone: the Trends tab folds its task type list behind a button and draws the chart 16:9 (#121). */
export const DASH_PHONE_QUERY = '(max-width: 480px)';

/** A signal that follows a media query (false where `matchMedia` does not exist). Call in an injection context. */
export function mediaMatch(query: string): Signal<boolean> {
  const out = signal(false);
  if (typeof matchMedia !== 'function') return out;
  const list = matchMedia(query);
  out.set(list.matches);
  const onChange = (e: MediaQueryListEvent) => out.set(e.matches);
  list.addEventListener('change', onChange);
  inject(DestroyRef).onDestroy(() => list.removeEventListener('change', onChange));
  return out;
}
