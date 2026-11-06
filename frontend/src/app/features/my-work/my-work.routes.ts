import { Routes } from '@angular/router';

export const MY_WORK_ROUTES: Routes = [
  {
    path: '',
    title: 'My Work',
    // The page header has its own "New Task", so the shell hides the global one (#1167).
    data: { hidesGlobalCreateTask: true },
    loadComponent: () => import('./pages/my-work-page').then((m) => m.MyWorkPage),
  },
];
