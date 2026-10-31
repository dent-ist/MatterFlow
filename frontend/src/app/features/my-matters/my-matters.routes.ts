import { Routes } from '@angular/router';

export const MY_MATTERS_ROUTES: Routes = [
  {
    path: '',
    title: 'My Matters',
    loadComponent: () => import('./ui/shell').then((m) => m.MyMattersPage),
  },
];
