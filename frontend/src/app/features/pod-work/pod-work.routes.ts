import { Routes } from '@angular/router';

export const POD_WORK_ROUTES: Routes = [
  {
    path: '',
    title: 'Pod Work',
    // The page header has its own "New Task", so the shell hides the global one (#1167).
    data: { hidesGlobalCreateTask: true },
    loadComponent: () => import('./pages/pod-work-page').then((m) => m.PodWorkPage),
  },
];
