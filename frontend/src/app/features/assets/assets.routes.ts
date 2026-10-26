import { inject } from '@angular/core';
import { ActivatedRouteSnapshot, Router, Routes } from '@angular/router';
import { MF_ASSET_PICKER } from 'form-engine';
import { permissionGuard } from '../../core/auth/guards';
import { pageTab } from '../../core/title/page-title';
import { unsavedChangesGuard } from '../../shared/guards/unsaved-changes.guard';
import { AssetPicker } from '../../shared/ui/asset-picker';

/**
 * Assets (UX S08). `/assets/:id` is the record page (#490); `new` is matched before it. An older link `/assets?selected=<id>` (bookmarks, the
 * master-detail panel it opened) is sent once to `/assets/<id>` (#494). ASSET_REF fields of an Asset type's form use the Matter-scoped asset
 * picker; it is provided here (not app-wide) so the form engine stays out of the initial bundle.
 */

/** `/assets?selected=<id>` becomes `/assets/<id>`; any other address of the list opens the list. */
export function selectedRedirect(
  route: ActivatedRouteSnapshot,
): true | ReturnType<Router['createUrlTree']> {
  const value = route.queryParamMap.get('selected');
  const id = Number(value);
  return value && Number.isInteger(id) && id > 0
    ? inject(Router).createUrlTree(['/assets', id])
    : true;
}
export const ASSETS_ROUTES: Routes = [
  {
    path: '',
    providers: [{ provide: MF_ASSET_PICKER, useValue: AssetPicker }],
    children: [
      {
        path: '',
        pathMatch: 'full',
        title: 'Assets',
        canActivate: [selectedRedirect],
        loadComponent: () => import('./pages/assets-list-page').then((m) => m.AssetsListPage),
      },
      {
        // The asset report builder (epic #851): reached from the Assets list and the My Matters Data tab, not from the menu. Lazy.
        path: 'reports',
        title: pageTab('Assets', 'Reports'),
        canActivate: [permissionGuard('Asset.View')],
        loadComponent: () => import('./reports/asset-reports-page').then((m) => m.AssetReportsPage),
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
        pathMatch: 'full',
        title: 'Asset',
        loadComponent: () => import('./pages/asset-record-page').then((m) => m.AssetRecordPage),
      },
    ],
  },
];
