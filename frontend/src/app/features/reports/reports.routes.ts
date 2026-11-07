import { Routes } from '@angular/router';

/**
 * The people-facing Reports pages (epic #671, issues #718 and #719). Both are lazy chunks of this one lazy feature, and nothing here is imported
 * by the shell, so the initial bundle does not grow. The guard of the parent route (`Report.Run`) already refused a person without the
 * permission; whether a report is assigned to one of the person's roles is the server's decision (404 for all three of unknown, inactive and not
 * assigned), which the run page words as "You don't have access to this report."
 */
export const REPORTS_ROUTES: Routes = [
  {
    path: '',
    title: 'Reports',
    loadComponent: () => import('./reports-list-page').then((m) => m.ReportsListPage),
  },
];
