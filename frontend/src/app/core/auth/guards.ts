import { inject } from '@angular/core';
import { Router, UrlTree } from '@angular/router';
import { ADMIN_NAV_ITEMS, NAV_ITEMS } from '../../shared/layout/nav-items';
import { AuthStore } from './auth.store';
import { Permission } from './permissions';

export const APP_PATHS = {
  accessPending: '/access-pending',
  forbidden: '/403',
  error: '/error',
  dashboard: '/dashboard',
  myWork: '/my-work',
  taskQueue: '/tasks',
} as const;

/** Screens a user can land on when they have no Task.View, in navigation order (first permitted wins). */
const LANDING_FALLBACKS: readonly { path: string; permissions: Permission[] }[] = [
  // The Dashboard only when a tab is turned on (see AuthStore.hasAnyDashboardTab); handled in defaultLandingPath.
  { path: APP_PATHS.dashboard, permissions: ['Dashboard.View'] },
  { path: '/pods/work', permissions: ['Pod.View'] },
  { path: '/clients', permissions: ['Client.View'] },
  { path: '/matters', permissions: ['Matter.View'] },
  { path: '/projects', permissions: ['Project.View'] },
  { path: '/assets', permissions: ['Asset.View'] },
  // The Administration section is a landing page for anyone who may open any of its menu items.
  { path: '/admin', permissions: ADMIN_NAV_ITEMS.flatMap((i) => i.permissions) },
];

/**
 * Default landing: My Work if the user has pod/assignments, else Task Queue (UX 2.2). The Dashboard is not for everyone (Dashboard.View), so it
 * is only a landing page for people without Task.View who hold it; otherwise the first screen they may open.
 */
export function defaultLandingPath(store: AuthStore): string {
  if (store.has('Task.View')) {
    return store.profile()?.hasWork ? APP_PATHS.myWork : APP_PATHS.taskQueue;
  }
  return (
    LANDING_FALLBACKS.find((f) =>
      f.path === APP_PATHS.dashboard ? store.hasAnyDashboardTab() : store.hasAny(f.permissions),
    )?.path ?? APP_PATHS.forbidden
  );
}

/** A link to a page the person can open. */
export interface LandingLink {
  path: string;
  /** The page's name as the navigation shows it ("Clients", "My Work"); the link reads "Go to <name>". */
  name: string;
}

/**
 * The link the 403 and 404 pages offer: the page the landing rule picks, named as the navigation names it. `null` when the person can
 * open nothing (no link is better than one to a page that answers 403 again; BUG-4).
 */
export function landingLink(store: AuthStore): LandingLink | null {
  const path = defaultLandingPath(store);
  const name =
    NAV_ITEMS.find((i) => i.path === path)?.label ?? (path === '/admin' ? 'Administration' : null);
  return name ? { path, name } : null;
}

/**
 * Root access guard: loads /me, sends pending or disabled users to Access Pending (the only
 * route they can reach) and anything unrecoverable to /error.
 */
export const accessGuard = async (): Promise<boolean | UrlTree> => {
  const store = inject(AuthStore);
  const router = inject(Router);
  await store.ensureLoaded();
  if (!store.isAuthenticated()) return router.createUrlTree([APP_PATHS.error]);
  if (store.isRestricted()) return router.createUrlTree([APP_PATHS.accessPending]);
  return true;
};

/** Alias for places that only need "signed in and allowed in at all". */
export const authenticatedGuard = accessGuard;

/**
 * Permission guard for `canMatch`/`canActivate`: allowed when the user holds ANY of the codes.
 * Pending users are redirected to Access Pending, others without permission to /403.
 */
export const permissionGuard = (...codes: Permission[]) => {
  return async (): Promise<boolean | UrlTree> => {
    const store = inject(AuthStore);
    const router = inject(Router);
    await store.ensureLoaded();
    if (!store.isAuthenticated()) return router.createUrlTree([APP_PATHS.error]);
    if (store.isRestricted()) return router.createUrlTree([APP_PATHS.accessPending]);
    return store.hasAny(codes) ? true : router.createUrlTree([APP_PATHS.forbidden]);
  };
};

/** Guards the Access Pending route: only restricted users stay; everyone else goes to landing. */
export const pendingOnlyGuard = async (): Promise<boolean | UrlTree> => {
  const store = inject(AuthStore);
  const router = inject(Router);
  await store.ensureLoaded();
  if (!store.isAuthenticated()) return router.createUrlTree([APP_PATHS.error]);
  return store.isRestricted() ? true : router.createUrlTree([defaultLandingPath(store)]);
};

/** Redirects `/` to the user's default landing page. */
export const landingGuard = async (): Promise<UrlTree> => {
  const store = inject(AuthStore);
  const router = inject(Router);
  await store.ensureLoaded();
  if (!store.isAuthenticated()) return router.createUrlTree([APP_PATHS.error]);
  if (store.isRestricted()) return router.createUrlTree([APP_PATHS.accessPending]);
  return router.createUrlTree([defaultLandingPath(store)]);
};
