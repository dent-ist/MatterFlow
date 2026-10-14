import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Button } from 'primeng/button';
import { firstValueFrom } from 'rxjs';
import { MatterResponse, MattersClient } from '../../../api/generated/api-client';
import { HasPermissionDirective } from '../../../shared/directives/has-permission.directive';
import { ActiveBadge, SensitiveBadge } from '../../../shared/ui/badge';
import { ListState, SortHeader, StatusFilter } from '../../../shared/ui/data-table';
import { isActiveParam } from '../../../shared/ui/list-helpers';
import { ServerListPage } from '../../../shared/ui/list-query';
import { MatterRef } from '../../../shared/ui/matter-ref';
import { PageHeader } from '../../../shared/ui/page-header';
import { Pager } from '../../../shared/ui/pager';
import { SearchBox } from '../../../shared/ui/search-box';

/** Matters list (UX S06): search by `343-12`, `00343-00012`, a number or a name; client and status filters; state lives in the URL. */
@Component({
  selector: 'mf-matters-list-page',
  imports: [
    PageHeader,
    ActiveBadge,
    SensitiveBadge,
    RouterLink,
    Button,
    HasPermissionDirective,
    Pager,
    MatterRef,
    SearchBox,
    StatusFilter,
    SortHeader,
    ListState,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: '../../../shared/ui/page.scss',
  template: `
    <mf-page-header heading="Matters">
      <p-button
        mfActions
        *mfHasPermission="'Matter.Create'"
        label="New matter"
        icon="pi pi-plus"
        (onClick)="go('/matters/new')"
      />
    </mf-page-header>

    <div class="pg-filters" role="search">
      <mf-search-box
        inputId="matter-search"
        placeholder="343-12, 00343-00012 or name"
        [value]="q() ?? ''"
        (searchChange)="search($event)"
      />
      <mf-status-filter
        inputId="matter-status"
        [value]="statusFilter()"
        (valueChange)="setStatus($event)"
      />
      @if (clientId()) {
        <div class="pg-filter">
          <span class="pg-label">Client</span>
          <span data-client-chip>
            {{ clientChip() }}
            <button type="button" (click)="clearClient()" aria-label="Remove client filter">
              Remove
            </button>
          </span>
        </div>
      }
    </div>

    <mf-list-state
      noun="matters"
      [state]="state()"
      [empty]="rows().length === 0"
      [filtered]="hasFilter()"
      [columns]="5"
      (retry)="load()"
      (clear)="clear()"
    >
      <p-button
        mfEmptyAction
        *mfHasPermission="'Matter.Create'"
        label="New matter"
        (onClick)="go('/matters/new')"
      />
      <div class="mf-table-wrap">
        <table class="pg-table">
          <caption class="pg-sr">
            Matters
          </caption>
          <thead>
            <tr>
              <th
                mfSort="matterRef"
                [sort]="sort()"
                [defaultSort]="defaultSort"
                (sorted)="setSort($event)"
              >
                Matter reference
              </th>
              <th
                mfSort="name"
                [sort]="sort()"
                [defaultSort]="defaultSort"
                (sorted)="setSort($event)"
              >
                Name
              </th>
              <th
                mfSort="clientNumber"
                [sort]="sort()"
                [defaultSort]="defaultSort"
                (sorted)="setSort($event)"
              >
                Client
              </th>
              <th scope="col">Projects</th>
              <th scope="col">Status</th>
            </tr>
          </thead>
          <tbody>
            @for (m of rows(); track m.matterId) {
              <tr>
                <td><mf-matter-ref [value]="m.matterRef" [link]="['/matters', m.matterId]" /></td>
                <td>
                  {{ m.name }}
                  @if (m.isSensitive) {
                    <mf-sensitive-badge />
                  }
                </td>
                <td>
                  <a class="pg-link" [routerLink]="['/clients', m.clientId]"
                    ><span class="pg-mono">{{ m.clientNumber }}</span> {{ m.clientName }}</a
                  >
                </td>
                <td>{{ m.projectCount }}</td>
                <td>
                  <mf-active-badge [active]="m.isActive" />
                </td>
              </tr>
            }
          </tbody>
        </table>
      </div>
      <mf-pager
        [page]="pageNumber()"
        [pageSize]="pageSize()"
        [pageSizes]="pageSizes"
        [total]="total()"
        (pageChange)="goToPage($event)"
        (pageSizeChange)="setPageSize($event)"
      />
    </mf-list-state>
  `,
})
export class MattersListPage extends ServerListPage<MatterResponse> {
  /** Query parameter `clientId` (bound by the router). */
  readonly clientId = input<string>();

  private readonly api = inject(MattersClient);

  protected readonly defaultSort = 'matterRef';

  protected readonly clientChip = computed(() => {
    const first = this.rows()[0];
    return first && String(first.clientId) === this.clientId()
      ? `${first.clientNumber} ${first.clientName}`
      : `Client ${this.clientId()}`;
  });

  protected override extraFilters() {
    return { clientId: this.clientId() };
  }

  protected override watch(): void {
    this.clientId();
  }

  protected override fetch() {
    const clientId = Number(this.clientId());
    return firstValueFrom(
      this.api.listMatters(
        this.q()?.trim() || undefined,
        Number.isInteger(clientId) && clientId > 0 ? clientId : undefined,
        isActiveParam(this.statusFilter()),
        undefined,
        this.pageNumber(),
        this.pageSize(),
        this.sort() || undefined,
      ),
    );
  }

  protected clearClient(): void {
    this.navigate({ clientId: null, page: null });
  }
}
