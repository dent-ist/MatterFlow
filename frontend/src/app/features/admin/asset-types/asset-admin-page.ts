import { ChangeDetectionStrategy, Component, inject, input } from '@angular/core';
import { Router } from '@angular/router';
import { Button } from 'primeng/button';
import { AdminListShell } from '../../../shared/ui/admin-list-shell';
import { AdminListLeave } from '../list-return';
import { AdminShellFilters } from '../task-types/shell-filters';
import { AssetTypesPage } from './asset-types-page';

/** The one-line description of the page (90 characters at most; the header shows it on one line). */
export const ASSET_TYPES_TEXT =
  'Each type has its own fields. Fields are versioned; publishing never changes saved values.';

/**
 * Administration: Asset Types (#633), reached from the "Asset Types" item of the Administration menu (not the Assets data records). One page on the admin list shell with no tab strip:
 * Link Roles, its former second tab, is a list of Administration > Lists now (epic #1314; the old `?tab=link-roles` address redirects there). The header holds the crumb, the one-line
 * description, Filters with their count and the primary action, New Asset Type. Needs `AssetType.Manage`.
 */
@Component({
  selector: 'mf-asset-admin-page',
  imports: [AdminListShell, Button, AssetTypesPage],
  providers: [AdminShellFilters],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <mf-admin-list-shell
      heading="Asset Types"
      icon="pi pi-tags"
      [description]="description"
      [filters]="shell.current()?.filters ?? null"
      [controls]="shell.current()?.controls ?? ''"
      [clearAlso]="['q']"
      tableId="asset-types-table"
    >
      <p-button mfPrimary label="New Asset Type" icon="pi pi-plus" data-new (onClick)="newType()" />
      <mf-asset-types-page [status]="status()" [page]="page()" [size]="size()" [sort]="sort()" />
    </mf-admin-list-shell>
  `,
})
export class AssetAdminPage {
  private readonly router = inject(Router);
  private readonly listLeave = inject(AdminListLeave);
  protected readonly shell = inject(AdminShellFilters);

  /** The list state the page keeps in the address. */
  readonly status = input<string>();
  readonly page = input<string>();
  readonly size = input<string>();
  readonly sort = input<string>();

  protected readonly description = ASSET_TYPES_TEXT;

  protected newType(): void {
    void this.router.navigate(['/admin/asset-types/new'], { state: this.listLeave.state() });
  }
}
