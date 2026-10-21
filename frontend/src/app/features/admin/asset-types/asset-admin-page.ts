import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  viewChild,
} from '@angular/core';
import { Router } from '@angular/router';
import { Button } from 'primeng/button';
import { firstValueFrom } from 'rxjs';
import { AssetLinkRolesClient, AssetTypesClient } from '../../../api/generated/api-client';
import { AuthStore } from '../../../core/auth/auth.store';
import { HasUnsavedChanges } from '../../../shared/guards/unsaved-changes.guard';
import { AdminListShell } from '../../../shared/ui/admin-list-shell';
import { MfTab } from '../../../shared/ui/tabs';
import { AdminTabCounts, adminTabItems, resolveAdminTab } from '../admin-tabs';
import { AdminListLeave } from '../list-return';
import { AdminShellFilters } from '../task-types/shell-filters';
import { AssetLinkRolesPage } from '../asset-link-roles/asset-link-roles-page';
import { ASSET_TABS, ASSET_TAB_TEXT, AssetAdminTab } from './asset-tabs';
import { AssetTypesPage } from './asset-types-page';

/**
 * Administration: Asset Types (#633), reached from the "Asset Types" item of the Administration menu (not the Assets data records). One page on
 * the admin list shell with two counted tabs, `Asset Types (n)` and `Link Roles (n)` (the number of ACTIVE records), kept in the address as
 * `?tab=` (`link-roles` for the second; the old `/admin/asset-link-roles` URL redirects there). The header holds the crumb, the one-line
 * description, Filters with their count (the Asset Types tab's) and the primary action, New asset type. Needs `AssetType.Manage`. Leaving the Link
 * Roles tab with a half-typed role asks first.
 */
@Component({
  selector: 'mf-asset-admin-page',
  imports: [AdminListShell, Button, AssetTypesPage, AssetLinkRolesPage],
  providers: [AdminShellFilters, AdminTabCounts],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <mf-admin-list-shell
      heading="Asset Types"
      icon="pi pi-tags"
      [description]="description()"
      [tabs]="tabs()"
      [tab]="current()"
      tabsLabel="Asset types and link roles"
      idPrefix="assets-admin"
      [filters]="current() === 'types' ? (shell.current()?.filters ?? null) : null"
      [controls]="shell.current()?.controls ?? ''"
      [clearAlso]="['q']"
      [tableId]="current() === 'types' ? 'asset-types-table' : 'link-roles-table'"
      (tabChange)="select($event)"
    >
      @if (current() === 'types') {
        <p-button
          mfPrimary
          label="New asset type"
          icon="pi pi-plus"
          data-new
          (onClick)="newType()"
        />
      }
      @if (current() === 'link-roles') {
        <p-button
          mfPrimary
          label="New link role"
          icon="pi pi-plus"
          data-new-role
          (onClick)="newRole()"
        />
      }
      @if (current() === 'types') {
        <mf-asset-types-page [status]="status()" [page]="page()" [size]="size()" [sort]="sort()" />
      } @else {
        <mf-asset-link-roles-page #linkRoles [edit]="edit()" />
      }
    </mf-admin-list-shell>
  `,
})
export class AssetAdminPage implements HasUnsavedChanges {
  private readonly auth = inject(AuthStore);
  private readonly router = inject(Router);
  private readonly listLeave = inject(AdminListLeave);
  private readonly counts = inject(AdminTabCounts);
  private readonly typesApi = inject(AssetTypesClient);
  private readonly rolesApi = inject(AssetLinkRolesClient);
  protected readonly shell = inject(AdminShellFilters);
  private readonly linkRoles = viewChild<AssetLinkRolesPage>('linkRoles');

  /** The `tab` query parameter, and the list state the Asset Types tab keeps in the address. */
  readonly tab = input<string>();
  readonly status = input<string>();
  readonly page = input<string>();
  readonly size = input<string>();
  readonly sort = input<string>();
  /** `?edit=<id>` / `?edit=new`: the dialog the Link Roles tab shows. */
  readonly edit = input<string>();

  private readonly can = (permission: string) => this.auth.has(permission);

  /** `Asset Types (9)`, `Link Roles (5)` (`--` while the count is on its way). */
  protected readonly tabs = computed<MfTab[]>(() =>
    adminTabItems(ASSET_TABS, this.can, this.counts.snapshot()),
  );
  protected readonly current = computed<AssetAdminTab>(
    () => (resolveAdminTab(ASSET_TABS, this.tab(), this.can)?.id as AssetAdminTab) ?? 'types',
  );
  protected readonly description = computed(() => ASSET_TAB_TEXT[this.current()]);

  constructor() {
    void this.counts.start(
      ASSET_TABS,
      {
        types: () =>
          firstValueFrom(this.typesApi.listAssetTypes(undefined, undefined, true, 1, 1)).then(
            (page) => page.total,
          ),
        'link-roles': () =>
          firstValueFrom(this.rolesApi.listAssetLinkRoles()).then(
            (list) => list.filter((r) => r.isActive).length,
          ),
      },
      this.can,
    );
  }

  hasUnsavedChanges(): boolean {
    return this.linkRoles()?.hasUnsavedChanges() ?? false;
  }

  protected newType(): void {
    void this.router.navigate(['/admin/asset-types/new'], { state: this.listLeave.state() });
  }

  protected newRole(): void {
    void this.router.navigate([], {
      queryParams: { tab: 'link-roles', edit: 'new' },
      queryParamsHandling: 'merge',
    });
  }

  /** The tab changes the address; the route's leave guard asks first when a tab holds text that is not saved (one question, Stay is the default). */
  protected async select(key: string): Promise<void> {
    await this.router.navigate([], {
      // The Asset Types filters and list state belong to that tab only.
      queryParams: {
        tab: key === 'types' ? null : key,
        name: null,
        status: null,
        fields: null,
        page: null,
        size: null,
        sort: null,
        edit: null,
      },
      queryParamsHandling: 'merge',
    });
  }
}
