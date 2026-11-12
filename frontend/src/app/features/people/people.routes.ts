import { Routes } from '@angular/router';

/** People (epic #1373, #1375): one list page; the person opens in a dialog, so there is no detail route. */
export const PEOPLE_ROUTES: Routes = [
  {
    path: '',
    title: 'People',
    pathMatch: 'full',
    loadComponent: () => import('./people-page').then((m) => m.PeoplePage),
  },
];
