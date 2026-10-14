import { Routes } from '@angular/router';
import { permissionGuard } from '../../core/auth/guards';
import { unsavedChangesGuard } from '../../shared/guards/unsaved-changes.guard';

/** Clients (UX S05). `new` is matched before `:clientId`; create/edit need their own permission. */
export const CLIENTS_ROUTES: Routes = [
  {
    path: '',
    pathMatch: 'full',
    loadComponent: () => import('./pages/clients-list-page').then((m) => m.ClientsListPage),
  },
  {
    path: 'new',
    canActivate: [permissionGuard('Client.Create')],
    canDeactivate: [unsavedChangesGuard],
    loadComponent: () => import('./pages/client-form-page').then((m) => m.ClientFormPage),
  },
  {
    path: ':clientId/edit',
    canActivate: [permissionGuard('Client.Edit', 'Client.EditNumber')],
    canDeactivate: [unsavedChangesGuard],
    loadComponent: () => import('./pages/client-form-page').then((m) => m.ClientFormPage),
  },
  {
    path: ':clientId',
    loadComponent: () => import('./pages/client-detail-page').then((m) => m.ClientDetailPage),
  },
];
