import { Injectable, inject, signal } from '@angular/core';
import { ActivatedRouteSnapshot, Router, RouterStateSnapshot, UrlTree } from '@angular/router';
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
export const accessGuard = async (
  _route?: ActivatedRouteSnapshot,
  state?: RouterStateSnapshot,
): Promise<boolean | UrlTree> => {
  const store = inject(AuthStore);
  const router = inject(Router);
  const failed = inject(ErrorRequest);
  await store.ensureLoaded();
  if (!store.isAuthenticated()) return errorPage(router, failed, state);
  if (store.isRestricted()) return router.createUrlTree([APP_PATHS.accessPending]);
  return true;
};

/** Alias for places that only need "signed in and allowed in at all". */
export const authenticatedGuard = accessGuard;

/**
 * The address that was open when /me could not be loaded and a guard sent the person to the error page (`/error`): its Retry reloads that address
 * instead of the home page (S11, #608). Kept in memory only, never in storage.
 */
@Injectable({ providedIn: 'root' })
export class ErrorRequest {
  readonly url = signal<string | null>(null);
}

/** The redirect to `/error`, remembering the address the person asked for. */
function errorPage(router: Router, failed: ErrorRequest, state?: RouterStateSnapshot): UrlTree {
  const asked = state?.url ?? router.getCurrentNavigation()?.extractedUrl.toString() ?? null;
  failed.url.set(asked && !asked.startsWith(APP_PATHS.error) ? asked : null);
  return router.createUrlTree([APP_PATHS.error]);
}

/**
 * The address a permission guard turned away (`/admin/users?x=1`), kept for the 403 page, which shows it ("You asked for ...") and puts it
 * back in the address bar, so a reload retries it and the link can be copied (#598). Empty when the 403 page was opened directly.
 */
@Injectable({ providedIn: 'root' })
export class ForbiddenRequest {
  readonly url = signal<string | null>(null);
}

/** Builds a guard from a permission test: pending users go to Access Pending, the others to /403 (with the address they asked for). */
const guardWhen = (allowed: (store: AuthStore) => boolean) => {
  return async (
    _route?: ActivatedRouteSnapshot,
    state?: RouterStateSnapshot,
  ): Promise<boolean | UrlTree> => {
    const store = inject(AuthStore);
    const router = inject(Router);
    const forbidden = inject(ForbiddenRequest);
    const failed = inject(ErrorRequest);
    await store.ensureLoaded();
    if (!store.isAuthenticated()) return errorPage(router, failed, state);
    if (store.isRestricted()) return router.createUrlTree([APP_PATHS.accessPending]);
    if (allowed(store)) return true;
    forbidden.url.set(state?.url ?? router.getCurrentNavigation()?.extractedUrl.toString() ?? null);
    return router.createUrlTree([APP_PATHS.forbidden]);
  };
};

/**
 * Permission guard for `canMatch`/`canActivate`: allowed when the user holds ANY of the codes.
 * Pending users are redirected to Access Pending, others without permission to /403 (which shows the address they asked for, see
 * `ForbiddenRequest`).
 */
export const permissionGuard = (...codes: Permission[]) =>
  guardWhen((store) => store.hasAny(codes));

/** Like `permissionGuard`, but the user must hold ALL of the codes (Pod Work needs Pod.View and Task.View, #549). */
export const permissionAllGuard = (...codes: Permission[]) =>
  guardWhen((store) => codes.every((c) => store.has(c)));

/** Guards the Access Pending route: only restricted users stay; everyone else goes to landing. */
export const pendingOnlyGuard = async (
  _route?: ActivatedRouteSnapshot,
  state?: RouterStateSnapshot,
): Promise<boolean | UrlTree> => {
  const store = inject(AuthStore);
  const router = inject(Router);
  const failed = inject(ErrorRequest);
  await store.ensureLoaded();
  if (!store.isAuthenticated()) return errorPage(router, failed, state);
  return store.isRestricted() ? true : router.createUrlTree([defaultLandingPath(store)]);
};

/** Redirects `/` to the user's default landing page. */
export const landingGuard = async (
  _route?: ActivatedRouteSnapshot,
  state?: RouterStateSnapshot,
): Promise<UrlTree> => {
  const store = inject(AuthStore);
  const router = inject(Router);
  const failed = inject(ErrorRequest);
  await store.ensureLoaded();
  if (!store.isAuthenticated()) return errorPage(router, failed, state);
  if (store.isRestricted()) return router.createUrlTree([APP_PATHS.accessPending]);
  return router.createUrlTree([defaultLandingPath(store)]);
};
