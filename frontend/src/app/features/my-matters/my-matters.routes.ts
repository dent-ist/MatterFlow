import { Routes } from '@angular/router';

export const MY_MATTERS_ROUTES: Routes = [
  {
    path: '',
    title: 'My Matters',
    loadComponent: () => import('./pages/my-matters-page').then((m) => m.MyMattersPage),
  },
];
