import { Routes } from '@angular/router';
import { permissionGuard } from '../../core/auth/guards';
import { unsavedChangesGuard } from '../../shared/guards/unsaved-changes.guard';

/** Matters (UX S06). `new` is matched before `:matterId`. */
export const MATTERS_ROUTES: Routes = [
  {
    path: '',
    pathMatch: 'full',
    loadComponent: () => import('./pages/matters-list-page').then((m) => m.MattersListPage),
  },
  {
    path: 'new',
    canActivate: [permissionGuard('Matter.Create')],
    canDeactivate: [unsavedChangesGuard],
    loadComponent: () => import('./pages/matter-form-page').then((m) => m.MatterFormPage),
  },
  {
    path: ':matterId/edit',
    canActivate: [permissionGuard('Matter.Edit', 'Matter.EditNumber')],
    canDeactivate: [unsavedChangesGuard],
    loadComponent: () => import('./pages/matter-form-page').then((m) => m.MatterFormPage),
  },
  {
    path: ':matterId',
    loadComponent: () => import('./pages/matter-detail-page').then((m) => m.MatterDetailPage),
  },
];
