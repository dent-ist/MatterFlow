import { inject } from '@angular/core';
import { Router, Routes } from '@angular/router';
import { permissionGuard } from '../../core/auth/guards';
import { SEARCH_TYPES } from '../../shared/search/search-meta';

/**
 * Search (UX S11): results with counted tabs at `/search?q=`. The old Advanced search page is gone (Search review S6, #477): its address stays as a
 * redirect for good, so bookmarks and links keep working. `/search/advanced?type=asset&q=review&client=3` opens
 * `/search?type=asset&q=review&client=3&filters=open` (every old key is kept, the Filters panel is open; no type opens the All tab).
 */
export const SEARCH_ROUTES: Routes = [
  {
    path: '',
    pathMatch: 'full',
    title: 'Search results',
    canActivate: [permissionGuard(...SEARCH_TYPES.map((t) => t.permission))],
    loadComponent: () => import('./search-results-page').then((m) => m.SearchResultsPage),
  },
  {
    path: 'advanced',
    pathMatch: 'full',
    redirectTo: (route) =>
      inject(Router).createUrlTree(['/search'], {
        queryParams: { ...route.queryParams, filters: route.queryParams['type'] ? 'open' : null },
      }),
  },
];
