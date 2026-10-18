import { DestroyRef, Signal, inject, signal } from '@angular/core';

/**
 * True while the window is at least `px` wide (a `min-width` media query as a signal). Used by the record lists to leave the least
 * informative column out of a narrow table (WP9). Call in an injection context; true where `matchMedia` does not exist.
 */
export function viewportAtLeast(px: number): Signal<boolean> {
  const out = signal(true);
  if (typeof matchMedia !== 'function') return out;
  const query = matchMedia(`(min-width: ${px}px)`);
  out.set(query.matches);
  const update = () => out.set(query.matches);
  query.addEventListener('change', update);
  inject(DestroyRef).onDestroy(() => query.removeEventListener('change', update));
  return out;
}
