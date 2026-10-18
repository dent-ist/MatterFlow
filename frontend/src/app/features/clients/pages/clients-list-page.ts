import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  Injector,
  afterNextRender,
  computed,
  inject,
  viewChild,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { Button } from 'primeng/button';
import { firstValueFrom } from 'rxjs';
import { ClientResponse, ClientsClient } from '../../../api/generated/api-client';
import { HasPermissionDirective } from '../../../shared/directives/has-permission.directive';
import { ColumnFilterRow } from '../../../shared/filters/column-filter-row';
import { statusDef } from '../../../shared/filters/common-defs';
import { FilterDef } from '../../../shared/filters/filter-def';
import { FiltersBar } from '../../../shared/filters/filters-bar';
import { ListFilters } from '../../../shared/filters/list-filters';
import { ActiveBadge } from '../../../shared/ui/badge';
import { SortHeader } from '../../../shared/ui/data-table';
import { FixedPage, ScrollArea } from '../../../shared/ui/fixed-page';
import { GridBody } from '../../../shared/ui/grid-body';
import { isActiveParam, parseStatus } from '../../../shared/ui/list-helpers';
import { ServerListPage } from '../../../shared/ui/list-query';
import { PageHeader } from '../../../shared/ui/page-header';
import { Pager } from '../../../shared/ui/pager';

/** The columns of the grid, in order; the keys the filter definitions point at. */
const COLUMNS = ['clientNumber', 'name', 'matters', 'status'] as const;

/**
 * Clients list (UX S05): inline column filters (Client number, Name, Status with Active by default), sortable, server paged. State lives
 * in the URL (`clientNumber`, `name`, `status`, `page`, `size`, `sort`).
 */
@Component({
  selector: 'mf-clients-list-page',
  imports: [
    FixedPage,
    ScrollArea,
    PageHeader,
    ActiveBadge,
    RouterLink,
    Button,
    HasPermissionDirective,
    Pager,
    SortHeader,
    GridBody,
    FiltersBar,
    ColumnFilterRow,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: '../../../shared/ui/page.scss',
  template: `
    <mf-fixed-page>
      <mf-page-header heading="Clients">
        <p-button
          mfActions
          *mfHasPermission="'Client.Create'"
          label="New client"
          icon="pi pi-plus"
          (onClick)="go('/clients/new')"
        />
      </mf-page-header>

      <mf-filters-bar [filters]="filters" controls="client-filter-row" [clearAlso]="['q']" />

      <div class="mf-fill">
        <div class="mf-table-wrap" mfScrollArea="Clients list" #scroll>
          <div class="mf-scroll">
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
                @if (filters.rowVisible()) {
                  <tr
                    mfColumnFilterRow
                    id="client-filter-row"
                    [filters]="filters"
                    [columns]="columns"
                  ></tr>
                }
              </thead>
              <tbody
                mfGridBody
                noun="clients"
                [state]="state()"
                [empty]="rows().length === 0"
                [filtered]="filters.activeCount() > 0"
                [columns]="4"
                [skeleton]="['6rem', '16rem', '3rem', '5rem']"
                (retry)="load()"
                (clear)="clear()"
              >
                <p-button
                  mfEmptyAction
                  *mfHasPermission="'Client.Create'"
                  label="New client"
                  (onClick)="go('/clients/new')"
                />
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
        </div>
        @if (state() === 'ready' && total() > 0) {
          <mf-pager
            [page]="pageNumber()"
            [pageSize]="pageSize()"
            [pageSizes]="pageSizes"
            [total]="total()"
            (pageChange)="goToPage($event)"
            (pageSizeChange)="setPageSize($event)"
          />
        }
      </div>
    </mf-fixed-page>
  `,
})
export class ClientsListPage extends ServerListPage<ClientResponse> {
  private readonly api = inject(ClientsClient);
  private readonly injector = inject(Injector);
  private readonly scroll = viewChild<ElementRef<HTMLElement>>('scroll');

  protected readonly defaultSort = 'clientNumber';
  protected readonly columns = COLUMNS;

  /** One definition per filter: the row, the sheet, the chips, the count, the URL and the API arguments all come from it. */
  private readonly defs = computed((): FilterDef[] => [
    { key: 'clientNumber', label: 'Client number', column: 'clientNumber', type: 'text' },
    { key: 'name', label: 'Name', column: 'name', type: 'text' },
    statusDef(),
  ]);

  protected readonly filters: ListFilters = new ListFilters({
    screen: 'clients',
    noun: 'clients',
    defs: this.defs,
  });

  constructor() {
    super();
    // The controls move into the sheet while the grid scrolls sideways.
    afterNextRender(() => this.filters.watchOverflow(this.scroll()?.nativeElement), {
      injector: this.injector,
    });
  }

  protected override listFilters() {
    return this.filters;
  }

  protected override fetch() {
    return firstValueFrom(
      this.api.listClients(
        undefined,
        isActiveParam(parseStatus(this.filters.text('status'))),
        this.filters.text('clientNumber') || undefined,
        this.filters.text('name') || undefined,
        this.pageNumber(),
        this.pageSize(),
        this.sort() || undefined,
      ),
    );
  }
}
