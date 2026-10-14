import { Routes } from '@angular/router';
import { permissionGuard } from '../../core/auth/guards';
import { SEARCH_TYPES } from '../../shared/search/search-meta';

/** Search (UX S11): grouped results at `/search?q=` and Advanced Search at `/search/advanced`; both need at least one searchable type's View permission. */
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
    title: 'Advanced search',
    canActivate: [permissionGuard(...SEARCH_TYPES.map((t) => t.permission))],
    loadComponent: () => import('./advanced-search-page').then((m) => m.AdvancedSearchPage),
  },
];
