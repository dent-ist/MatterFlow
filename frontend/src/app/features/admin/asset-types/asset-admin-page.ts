import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  viewChild,
} from '@angular/core';
import { Router } from '@angular/router';
import {
  HasUnsavedChanges,
  LeaveConfirmService,
} from '../../../shared/guards/unsaved-changes.guard';
import { FixedPage } from '../../../shared/ui/fixed-page';
import { PageHeader } from '../../../shared/ui/page-header';
import { MfTab, Tabs } from '../../../shared/ui/tabs';
import { AssetLinkRolesPage } from '../asset-link-roles/asset-link-roles-page';
import { AssetTypesPage } from './asset-types-page';

type AssetAdminTab = 'types' | 'link-roles';

/**
 * Administration: the Assets set-up page, reached from the "Assets" item of the Administration menu (not the Assets data records).
 * Two tabs, Asset Types and Asset Link Roles, kept in the address as `?tab=` (`link-roles` for the second; the old
 * `/admin/asset-link-roles` URL redirects there). Needs `AssetType.Manage`. Leaving the second tab with a half-typed role asks first.
 */
@Component({
  selector: 'mf-asset-admin-page',
  imports: [FixedPage, PageHeader, Tabs, AssetTypesPage, AssetLinkRolesPage],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <mf-fixed-page>
      <mf-page-header
        heading="Asset Types & Link Roles"
        [crumbs]="[{ label: 'Administration' }, { label: 'Assets' }]"
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
          <mf-asset-types-page />
        } @else {
          <mf-asset-link-roles-page #linkRoles />
        }
      </div>
    </mf-fixed-page>
  `,
})
export class AssetAdminPage implements HasUnsavedChanges {
  private readonly router = inject(Router);
  private readonly leave = inject(LeaveConfirmService);
  private readonly linkRoles = viewChild<AssetLinkRolesPage>('linkRoles');

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
    return this.linkRoles()?.hasUnsavedChanges() ?? false;
  }

  protected async select(key: string): Promise<void> {
    if (this.hasUnsavedChanges() && !(await this.leave.ask())) return;
    await this.router.navigate([], {
      // The Asset Types filters belong to that tab only.
      queryParams: { tab: key === 'types' ? null : key, name: null, status: null },
      queryParamsHandling: 'merge',
    });
  }
}
