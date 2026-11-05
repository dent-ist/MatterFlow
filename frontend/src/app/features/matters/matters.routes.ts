import { inject } from '@angular/core';
import { Router, Routes } from '@angular/router';
import { permissionGuard } from '../../core/auth/guards';
import { unsavedChangesGuard } from '../../shared/guards/unsaved-changes.guard';

/** Matters (UX S06). `new` is matched before `:matterId`; it opens the New matter dialog of the list (MD-22). */
export const MATTERS_ROUTES: Routes = [
  {
    path: '',
    pathMatch: 'full',
    title: 'Matters',
    loadComponent: () => import('./pages/matters-list-page').then((m) => m.MattersListPage),
  },
  {
    // MD-22 (#1026): creating a matter is a pop-up dialog on the list; the old address (Client pages, bookmarks) opens it there.
    path: 'new',
    redirectTo: ({ queryParams }) => {
      const client = Number(queryParams['clientId']);
      return inject(Router).createUrlTree(['/matters'], {
        queryParams: {
          newMatter: 1,
          newClient: Number.isInteger(client) && client > 0 ? client : null,
        },
      });
    },
  },
  {
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
