import { inject } from '@angular/core';
import {
  ActivatedRouteSnapshot,
  CanActivateFn,
  RedirectFunction,
  Router,
  UrlMatchResult,
  UrlSegment,
  UrlTree,
} from '@angular/router';
import { AuthStore } from '../../../core/auth/auth.store';
import { APP_PATHS } from '../../../core/auth/guards';
import { pageTab } from '../../../core/title/page-title';
import { adminMenuTarget, resolveAdminTab } from '../admin-tabs';
import { ADMIN_LIST_TABS, AdminListKey, adminListByKey } from './admin-lists';

/** The query parameter an old address adds so that the Lists page can say once that the list has moved (UI spec 6.3). */
export const MOVED_PARAM = 'moved';

/** `/admin/lists` and `/admin/lists/<key>` are one route, so the page stays alive when the list changes; `:list` is the second segment (if any). */
export function listsMatcher(segments: UrlSegment[]): UrlMatchResult | null {
  if (segments.length < 1 || segments.length > 2 || segments[0].path !== 'lists') return null;
  return segments.length === 2
    ? { consumed: segments, posParams: { list: segments[1] } }
    : { consumed: segments };
}

/** Document title: `Lists: <List name>` (like `Users: Roles`); plain `Lists` for an address without a (known) list. */
export function listsTitle(route: ActivatedRouteSnapshot): string {
  const def = adminListByKey(route.params['list']);
  return def ? pageTab('Lists', def.label) : 'Lists';
}

/**
 * Route guard of the Lists page (the denial rule of #416): a list the person may manage opens; `/admin/lists`, an unknown key and a list
 * they may not manage go to the first list they may manage, and a person who manages none sees the 403 page (access pending: that page).
 */
export const listsGuard: CanActivateFn = async (
  route: ActivatedRouteSnapshot,
): Promise<boolean | UrlTree> => {
  const auth = inject(AuthStore);
  const router = inject(Router);
  await auth.ensureLoaded();
  if (!auth.isAuthenticated()) return router.createUrlTree([APP_PATHS.error]);
  if (auth.isRestricted()) return router.createUrlTree([APP_PATHS.accessPending]);
  const can = (p: string) => auth.has(p);
  const target = adminMenuTarget(ADMIN_LIST_TABS, can);
  if (target === null) return router.createUrlTree([APP_PATHS.forbidden]);
  const requested = route.params['list'] as string | undefined;
  return resolveAdminTab(ADMIN_LIST_TABS, requested, can)?.id === requested
    ? true
    : router.parseUrl(target);
};

/** The new address of an old one: `edit` is the only query parameter these lists use and is kept; `moved` is the one-time marker. */
export function movedListUrl(
  router: Router,
  key: AdminListKey,
  queryParams: Readonly<Record<string, unknown>>,
): UrlTree {
  const edit = queryParams['edit'];
  return router.createUrlTree(['/admin/lists', key], {
    queryParams: {
      ...(typeof edit === 'string' && edit ? { edit } : {}),
      [MOVED_PARAM]: key,
    },
  });
}

/** `redirectTo` of an old address (`/admin/priorities`): the same list under Lists. */
export const redirectToList =
  (key: AdminListKey): RedirectFunction =>
  ({ queryParams }) =>
    movedListUrl(inject(Router), key, queryParams);

/**
 * Guard of the Asset Types route: the old Link Roles tab (`/admin/asset-types?tab=link-roles`) goes to the Link Roles list; every other
 * Asset Types address is unchanged.
 */
export const legacyLinkRolesRedirect: CanActivateFn = (route: ActivatedRouteSnapshot) =>
  route.queryParams['tab'] === 'link-roles'
    ? movedListUrl(inject(Router), 'link-roles', route.queryParams)
    : true;
