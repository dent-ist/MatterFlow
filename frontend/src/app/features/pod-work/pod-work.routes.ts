import { Routes } from '@angular/router';

export const POD_WORK_ROUTES: Routes = [
  {
    path: '',
    title: 'Pod Work',
    loadComponent: () => import('./pages/pod-work-page').then((m) => m.PodWorkPage),
  },
];
