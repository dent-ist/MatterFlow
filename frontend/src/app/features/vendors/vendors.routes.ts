import { Routes } from '@angular/router';

/** Vendors (epic #1373, #1378): one list page; the vendor opens in a pop-up (tabs Overview, Contacts, Matters), so there is no detail route. */
export const VENDORS_ROUTES: Routes = [
  {
    path: '',
    title: 'Vendors',
    pathMatch: 'full',
    loadComponent: () => import('./vendors-page').then((m) => m.VendorsPage),
  },
];
