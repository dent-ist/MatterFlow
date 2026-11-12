import { Routes } from '@angular/router';
import { permissionGuard } from '../../core/auth/guards';
import { unsavedChangesGuard } from '../../shared/guards/unsaved-changes.guard';

/** Matters (UX S06). `new` is matched before `:matterId`; it is the full-page New Matter form, `:matterId/edit` the full-page Edit Matter (same component and form). */
export const MATTERS_ROUTES: Routes = [
  {
    path: '',
    pathMatch: 'full',
    title: 'Matters',
    loadComponent: () => import('./pages/matters-list-page').then((m) => m.MattersListPage),
  },
  {
    // Epic #1368 (#1371): creating a matter is a full page (it was the pop-up of the list, MD-22). `?clientId=5` preselects the client (New Matter on a Client page).
    path: 'new',
    title: 'New Matter',
    canActivate: [permissionGuard('Matter.Create')],
    canDeactivate: [unsavedChangesGuard],
    loadComponent: () => import('./pages/matter-form-page').then((m) => m.MatterFormPage),
  },
  {
    // Epic #1368 (#1381): editing a matter is a full page too, like the Client pages (it was the pop-up on the Matter page).
    path: ':matterId/edit',
    title: 'Edit Matter',
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
