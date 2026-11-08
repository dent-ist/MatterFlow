import { inject } from '@angular/core';
import { ActivatedRouteSnapshot, Router, UrlTree } from '@angular/router';
import { APP_PATHS } from '../../../core/auth/guards';
import { AuthStore } from '../../../core/auth/auth.store';
import { AdminTab, adminMenuTarget, resolveAdminTab } from '../admin-tabs';

export type MatterListKind = 'matter-types' | 'current-states' | 'team-titles';

/** The three tabs of Administration > Matter Lists (epic #1298): one permission, `MatterList.Manage`, opens all of them. */
export const MATTER_LIST_TABS: readonly AdminTab[] = [
  {
    id: 'matter-types',
    label: 'Matter Types',
    route: '/admin/matter-types',
    permission: ['MatterList.Manage'],
    countKey: 'matter-types',
  },
  {
    id: 'current-states',
    label: 'Current States',
    route: '/admin/current-states',
    permission: ['MatterList.Manage'],
    countKey: 'current-states',
  },
  {
    id: 'team-titles',
    label: 'Team Titles',
    route: '/admin/team-titles',
    permission: ['MatterList.Manage'],
    countKey: 'team-titles',
  },
];

/** One line per tab, 90 characters at most (the header shows it on one line). */
export const MATTER_LIST_TEXT =
  'The choices offered for Matter Type, Current State and Team Title.';

/**
 * Route guard of the Matter Lists page (the denial rule of #416): a person with `MatterList.Manage` opens the tab of the address; anyone else sees the 403 page
 * (and a person without access at all, the access-pending page).
 */
export const matterListsTabGuard =
  (requested?: MatterListKind) =>
  async (route?: ActivatedRouteSnapshot): Promise<boolean | UrlTree> => {
    const tab = (requested ?? route?.params['tab']) as MatterListKind;
    const auth = inject(AuthStore);
    const router = inject(Router);
    await auth.ensureLoaded();
    if (!auth.isAuthenticated()) return router.createUrlTree([APP_PATHS.error]);
    if (auth.isRestricted()) return router.createUrlTree([APP_PATHS.accessPending]);
    const can = (p: string) => auth.has(p);
    const target = adminMenuTarget(MATTER_LIST_TABS, can);
    if (target === null) return router.createUrlTree([APP_PATHS.forbidden]);
    return resolveAdminTab(MATTER_LIST_TABS, tab, can)?.id === tab ? true : router.parseUrl(target);
  };
