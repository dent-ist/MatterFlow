import { inject } from '@angular/core';
import { NavigationError } from '@angular/router';
import { NotificationService } from '../../core/notify/notification.service';
import { ADMIN_NAV_ITEMS, NAV_ITEMS } from './nav-items';

/** Seam for tests: loads the address afresh (a new document gets a clean module map). */
export const hardNavigation = { go: (url: string): void => location.assign(url) };

const RETRY_KEY = 'mf-chunk-retry';
const RETRY_WINDOW_MS = 15000;

/** True once per address and window, so a page that really cannot load never reloads in a loop. */
function mayReloadFor(url: string): boolean {
  try {
    const [prevUrl, prevAt] = (sessionStorage.getItem(RETRY_KEY) ?? '').split('|');
    if (prevUrl === url && Date.now() - Number(prevAt) < RETRY_WINDOW_MS) return false;
    sessionStorage.setItem(RETRY_KEY, `${url}|${Date.now()}`);
    return true;
  } catch {
    return false;
  }
}

/** True for a page that could not be fetched (a lazy chunk or a request that never reached the server), not a bug in the route. */
export function isLoadFailure(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const e = error as { name?: string; message?: string; status?: number };
  if (e.name === 'ChunkLoadError' || e.status === 0) return true;
  return /Failed to fetch dynamically imported module|error loading dynamically imported module|Importing a module script failed|Loading chunk [^ ]+ failed|NetworkError|Failed to fetch|Load failed/i.test(
    e.message ?? '',
  );
}

/** The rail label of the page a URL belongs to ("Task Queue"), else a plain "that page". */
export function destinationLabel(url: string): string {
  const path = url.split(/[?#]/)[0];
  const items = [...NAV_ITEMS, ...ADMIN_NAV_ITEMS]
    .filter((i) => path === i.path || path.startsWith(i.path + '/'))
    .sort((a, b) => b.path.length - a.path.length);
  return items[0]?.label ?? 'that page';
}

/**
 * Router error handler (#590): offline, a click on a rail item whose lazy page is not loaded yet fails inside the router and looked dead.
 * Say so once, by the item's label; focus and the address stay where they were because the navigation never started. Any other
 * route error is thrown again, so real errors keep their own handling. With the connection back and the page still failing (the browser
 * keeps a failed module fetch for the life of the document), the address is loaded afresh, once.
 * Register with `withNavigationErrorHandler(handleNavigationError)`.
 */
export function handleNavigationError(event: NavigationError): void {
  if (!isLoadFailure(event.error)) throw event.error;
  // Online again but the page still fails: the browser keeps a failed module fetch for the life of the document (or a new release
  // replaced the files), so the click would stay dead. Load that address afresh, once.
  if (typeof navigator !== 'undefined' && navigator.onLine && mayReloadFor(event.url)) {
    hardNavigation.go(event.url);
    return;
  }
  const notify = inject(NotificationService);
  const message = `Couldn't open ${destinationLabel(event.url)}. Check your connection and try again.`;
  // Repeated clicks fold into one toast (the notification service de-duplicates identical messages, BUG-4).
  notify.error(message);
}

/** Test seam: forget the reload guard. */
export function resetNavigationErrorMemory(): void {
  try {
    sessionStorage.removeItem(RETRY_KEY);
  } catch {
    /* ignore */
  }
}
