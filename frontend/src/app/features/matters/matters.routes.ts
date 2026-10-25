import { Routes } from '@angular/router';
import { permissionGuard } from '../../core/auth/guards';
import { unsavedChangesGuard } from '../../shared/guards/unsaved-changes.guard';

/** Matters (UX S06). `new` is matched before `:matterId`. */
export const MATTERS_ROUTES: Routes = [
  {
    path: '',
    pathMatch: 'full',
    title: 'Matters',
    loadComponent: () => import('./pages/matters-list-page').then((m) => m.MattersListPage),
  },
  {
    path: 'new',
    title: 'New matter',
    canActivate: [permissionGuard('Matter.Create')],
    canDeactivate: [unsavedChangesGuard],
    loadComponent: () => import('./pages/matter-form-page').then((m) => m.MatterFormPage),
  },
  {
    path: ':matterId/edit',
    title: 'Edit matter',
    canActivate: [permissionGuard('Matter.Edit', 'Matter.EditNumber')],
    canDeactivate: [unsavedChangesGuard],
    loadComponent: () => import('./pages/matter-form-page').then((m) => m.MatterFormPage),
  },
  {
    path: ':matterId',
    title: 'Matter',
    // The record header has its own "Create task" (prefilled with the record), so the shell hides the global one (#625).
    data: { hidesGlobalCreateTask: true },
    loadComponent: () => import('./pages/matter-detail-page').then((m) => m.MatterDetailPage),
  },
];
