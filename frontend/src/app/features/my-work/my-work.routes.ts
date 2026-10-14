import { Routes } from '@angular/router';

export const MY_WORK_ROUTES: Routes = [
  {
    path: '',
    title: 'My Work',
    loadComponent: () => import('./pages/my-work-page').then((m) => m.MyWorkPage),
  },
];
