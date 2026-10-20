import { inject } from '@angular/core';
import { Router, UrlTree } from '@angular/router';
import { APP_PATHS } from '../../core/auth/guards';
import { AuthStore } from '../../core/auth/auth.store';
import { AdminTab, allowedAdminTabs, adminMenuTarget, resolveAdminTab } from './admin-tabs';

/** The two tabs of the Labels page; each permission is enough to read what it manages (AD-D #519, #523). */
export const LABEL_TABS: readonly AdminTab[] = [
  {
    id: 'priorities',
    label: 'Priorities',
    route: '/admin/priorities',
    permission: ['Priority.Manage'],
    countKey: 'priorities',
  },
  {
    id: 'status-labels',
    label: 'Status labels',
    route: '/admin/status-labels',
    permission: ['StatusLabel.Manage'],
    countKey: 'status-labels',
  },
];

export type LabelsTab = 'priorities' | 'status-labels';

/** Whether this person may use both Labels tabs (a lone tab needs no tab strip). */
export function hasBothLabelTabs(auth: AuthStore): boolean {
  return allowedAdminTabs(LABEL_TABS, (p) => auth.has(p)).length > 1;
}

/**
 * Route guard of one Labels tab (the denial rule of #416, the menu rule of #545): a tab the person may use opens; the other tab's
 * address (and with it the Labels menu item, whose path is the first tab) goes to the first tab the person may open
 * (`adminMenuTarget`); a person who may use neither sees the 403 page.
 */
export const labelsTabGuard = (requested: LabelsTab) => async (): Promise<boolean | UrlTree> => {
  const auth = inject(AuthStore);
  const router = inject(Router);
  await auth.ensureLoaded();
  if (!auth.isAuthenticated()) return router.createUrlTree([APP_PATHS.error]);
  if (auth.isRestricted()) return router.createUrlTree([APP_PATHS.accessPending]);
  const can = (p: string) => auth.has(p);
  const target = adminMenuTarget(LABEL_TABS, can);
  if (target === null) return router.createUrlTree([APP_PATHS.forbidden]);
  return resolveAdminTab(LABEL_TABS, requested, can)?.id === requested
    ? true
    : router.parseUrl(target);
};
