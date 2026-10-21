import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  viewChild,
} from '@angular/core';
import { Router } from '@angular/router';
import { HasUnsavedChanges } from '../../../shared/guards/unsaved-changes.guard';
import { FixedPage } from '../../../shared/ui/fixed-page';
import { PageHeader } from '../../../shared/ui/page-header';
import { MfTab, Tabs } from '../../../shared/ui/tabs';
import { AssetLinkRolesPage } from '../asset-link-roles/asset-link-roles-page';
import { AssetTypesPage } from './asset-types-page';

type AssetAdminTab = 'types' | 'link-roles';

/**
 * Administration: the Assets set-up page, reached from the "Assets" item of the Administration menu (not the Assets data records).
 * Two tabs, Asset Types and Asset Link Roles, kept in the address as `?tab=` (`link-roles` for the second; the old
 * `/admin/asset-link-roles` URL redirects there). Needs `AssetType.Manage`. Leaving either tab with half-typed text (a new role, an asset type form) asks first.
 */
@Component({
  selector: 'mf-asset-admin-page',
  imports: [FixedPage, PageHeader, Tabs, AssetTypesPage, AssetLinkRolesPage],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <mf-fixed-page>
      <mf-page-header
        heading="Asset Types"
        [crumbs]="[{ label: 'Administration' }, { label: 'Asset Types' }]"
      />
      <mf-tabs
        label="Asset set-up"
        idPrefix="assets-admin"
        [tabs]="tabs"
        [selected]="current()"
        (tabChange)="select($event)"
      />
      <div
        class="mf-fill"
        role="tabpanel"
        id="assets-admin-panel"
        [attr.aria-labelledby]="'assets-admin-tab-' + current()"
      >
        @if (current() === 'types') {
          <mf-asset-types-page #types />
        } @else {
          <mf-asset-link-roles-page #linkRoles />
        }
      </div>
    </mf-fixed-page>
  `,
})
export class AssetAdminPage implements HasUnsavedChanges {
  private readonly router = inject(Router);
  private readonly linkRoles = viewChild<AssetLinkRolesPage>('linkRoles');
  private readonly types = viewChild<AssetTypesPage>('types');

  /** The `tab` query parameter. */
  readonly tab = input<string>();

  protected readonly tabs: MfTab[] = [
    { key: 'types', label: 'Asset Types' },
    { key: 'link-roles', label: 'Asset Link Roles' },
  ];
  protected readonly current = computed<AssetAdminTab>(() =>
    this.tab() === 'link-roles' ? 'link-roles' : 'types',
  );

  hasUnsavedChanges(): boolean {
    return (
      (this.types()?.hasUnsavedChanges() ?? false) ||
      (this.linkRoles()?.hasUnsavedChanges() ?? false)
    );
  }

  /** The tab changes the address; the route's leave guard asks first when either tab holds text that is not saved (one question, Stay is the default). */
  protected async select(key: string): Promise<void> {
    await this.router.navigate([], {
      // The Asset Types filters belong to that tab only.
      queryParams: { tab: key === 'types' ? null : key, name: null, status: null },
      queryParamsHandling: 'merge',
    });
  }
}
