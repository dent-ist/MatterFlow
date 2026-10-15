import { inject } from '@angular/core';
import { Router, UrlTree } from '@angular/router';
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
  { path: APP_PATHS.dashboard, permissions: ['Dashboard.View'] },
  { path: '/pods/work', permissions: ['Pod.View'] },
  { path: '/clients', permissions: ['Client.View'] },
  { path: '/matters', permissions: ['Matter.View'] },
  { path: '/projects', permissions: ['Project.View'] },
  { path: '/assets', permissions: ['Asset.View'] },
  {
    path: '/admin',
    permissions: [
      'User.View',
      'User.Manage',
      'Role.Manage',
      'Pod.Manage',
      'Pod.ManageMembers',
      'TaskType.Manage',
      'Workflow.Manage',
      'AssetType.Manage',
      'CustomField.Manage',
      'Priority.Manage',
      'StatusLabel.Manage',
      'Audit.View',
    ],
  },
];

/**
 * Default landing: My Work if the user has pod/assignments, else Task Queue (UX 2.2). The Dashboard is not for everyone (Dashboard.View), so it
 * is only a landing page for people without Task.View who hold it; otherwise the first screen they may open.
 */
export function defaultLandingPath(store: AuthStore): string {
  if (store.has('Task.View')) {
    return store.profile()?.hasWork ? APP_PATHS.myWork : APP_PATHS.taskQueue;
  }
  return LANDING_FALLBACKS.find((f) => store.hasAny(f.permissions))?.path ?? APP_PATHS.forbidden;
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
