import { Routes } from '@angular/router';
import { MF_ASSET_PICKER } from 'form-engine';
import { permissionGuard } from '../../core/auth/guards';
import { unsavedChangesGuard } from '../../shared/guards/unsaved-changes.guard';
import { AssetPicker } from '../../shared/ui/asset-picker';

/**
 * Assets (UX S08). `new` is matched before `:assetId`. ASSET_REF fields of an Asset type's form use the Matter-scoped asset picker;
 * it is provided here (not app-wide) so the form engine stays out of the initial bundle.
 */
export const ASSETS_ROUTES: Routes = [
  {
    path: '',
    providers: [{ provide: MF_ASSET_PICKER, useValue: AssetPicker }],
    children: [
      {
        path: '',
        pathMatch: 'full',
        title: 'Assets',
        loadComponent: () => import('./pages/assets-list-page').then((m) => m.AssetsListPage),
      },
      {
        path: 'new',
        title: 'New asset',
        canActivate: [permissionGuard('Asset.Create')],
        canDeactivate: [unsavedChangesGuard],
        loadComponent: () => import('./pages/asset-form-page').then((m) => m.AssetFormPage),
      },
      {
        path: ':assetId/edit',
        title: 'Edit asset',
        canActivate: [permissionGuard('Asset.Edit')],
        canDeactivate: [unsavedChangesGuard],
        loadComponent: () => import('./pages/asset-form-page').then((m) => m.AssetFormPage),
      },
      {
        path: ':assetId',
        title: 'Asset',
        loadComponent: () => import('./pages/asset-detail-page').then((m) => m.AssetDetailPage),
      },
    ],
  },
];
