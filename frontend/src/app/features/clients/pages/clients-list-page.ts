import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Button } from 'primeng/button';
import { firstValueFrom } from 'rxjs';
import { ClientResponse, ClientsClient } from '../../../api/generated/api-client';
import { HasPermissionDirective } from '../../../shared/directives/has-permission.directive';
import { ActiveBadge } from '../../../shared/ui/badge';
import { ListState, SortHeader, StatusFilter } from '../../../shared/ui/data-table';
import { isActiveParam } from '../../../shared/ui/list-helpers';
import { ServerListPage } from '../../../shared/ui/list-query';
import { PageHeader } from '../../../shared/ui/page-header';
import { Pager } from '../../../shared/ui/pager';
import { SearchBox } from '../../../shared/ui/search-box';

/** Clients list (UX S05): search by number (padded or not) or name, status filter (Active by default), sortable, server paged. State lives in the URL. */
@Component({
  selector: 'mf-clients-list-page',
  imports: [
    PageHeader,
    ActiveBadge,
    RouterLink,
    Button,
    HasPermissionDirective,
    Pager,
    SearchBox,
    StatusFilter,
    SortHeader,
    ListState,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: '../../../shared/ui/page.scss',
  template: `
    <mf-page-header heading="Clients">
      <p-button
        mfActions
        *mfHasPermission="'Client.Create'"
        label="New client"
        icon="pi pi-plus"
        (onClick)="go('/clients/new')"
      />
    </mf-page-header>

    <div class="pg-filters" role="search">
      <mf-search-box
        inputId="client-search"
        placeholder="343 or Acme"
        [value]="q() ?? ''"
        (searchChange)="search($event)"
      />
      <mf-status-filter
        inputId="client-status"
        [value]="statusFilter()"
        (valueChange)="setStatus($event)"
      />
    </div>

    <mf-list-state
      noun="clients"
      [state]="state()"
      [empty]="rows().length === 0"
      [filtered]="hasFilter()"
      [columns]="4"
      (retry)="load()"
      (clear)="clear()"
    >
      <p-button
        mfEmptyAction
        *mfHasPermission="'Client.Create'"
        label="New client"
        (onClick)="go('/clients/new')"
      />
      <div class="mf-table-wrap">
        <table class="pg-table">
          <caption class="pg-sr">
            Clients
          </caption>
          <thead>
            <tr>
              <th
                mfSort="clientNumber"
                [sort]="sort()"
                [defaultSort]="defaultSort"
                (sorted)="setSort($event)"
              >
                Client number
              </th>
              <th
                mfSort="name"
                [sort]="sort()"
                [defaultSort]="defaultSort"
                (sorted)="setSort($event)"
              >
                Name
              </th>
              <th scope="col">Matters</th>
              <th scope="col">Status</th>
            </tr>
          </thead>
          <tbody>
            @for (c of rows(); track c.clientId) {
              <tr>
                <td class="pg-mono">
                  <a class="pg-link" [routerLink]="['/clients', c.clientId]">{{
                    c.clientNumber
                  }}</a>
                </td>
                <td>{{ c.name }}</td>
                <td>{{ c.matterCount }}</td>
                <td>
                  <mf-active-badge [active]="c.isActive" />
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
export class ClientsListPage extends ServerListPage<ClientResponse> {
  private readonly api = inject(ClientsClient);

  protected readonly defaultSort = 'clientNumber';

  protected override fetch() {
    return firstValueFrom(
      this.api.listClients(
        this.q()?.trim() || undefined,
        isActiveParam(this.statusFilter()),
        this.pageNumber(),
        this.pageSize(),
        this.sort() || undefined,
      ),
    );
  }
}
