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
import { MatterResponse, MattersClient } from '../../../api/generated/api-client';
import { HasPermissionDirective } from '../../../shared/directives/has-permission.directive';
import { ColumnFilterRow } from '../../../shared/filters/column-filter-row';
import { matterColumnDefs } from '../../../shared/filters/common-defs';
import { FilterDef } from '../../../shared/filters/filter-def';
import { FiltersBar } from '../../../shared/filters/filters-bar';
import { ListFilters } from '../../../shared/filters/list-filters';
import { ActiveBadge, SensitiveBadge } from '../../../shared/ui/badge';
import { SortHeader } from '../../../shared/ui/data-table';
import { FixedPage, ScrollArea } from '../../../shared/ui/fixed-page';
import { GridBody } from '../../../shared/ui/grid-body';
import { isActiveParam, parseStatus } from '../../../shared/ui/list-helpers';
import { ServerListPage } from '../../../shared/ui/list-query';
import { MatterRef } from '../../../shared/ui/matter-ref';
import { PageHeader } from '../../../shared/ui/page-header';
import { Pager } from '../../../shared/ui/pager';

/** The columns of the grid, in order; the keys the filter definitions point at. */
const COLUMNS = ['matterRef', 'name', 'client', 'projects', 'status'] as const;

/**
 * Matters list (UX S06): inline column filters (Matter reference, Name, Client, Status with Active by default, and Sensitive under
 * "Other filters"); a link from a Client keeps `?clientId=` as a removable chip. State lives in the URL.
 */
@Component({
  selector: 'mf-matters-list-page',
  imports: [
    FixedPage,
    ScrollArea,
    PageHeader,
    ActiveBadge,
    SensitiveBadge,
    RouterLink,
    Button,
    HasPermissionDirective,
    Pager,
    MatterRef,
    SortHeader,
    GridBody,
    FiltersBar,
    ColumnFilterRow,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: '../../../shared/ui/page.scss',
  template: `
    <mf-fixed-page>
      <mf-page-header heading="Matters">
        <p-button
          mfActions
          *mfHasPermission="'Matter.Create'"
          label="New matter"
          icon="pi pi-plus"
          (onClick)="go('/matters/new')"
        />
      </mf-page-header>

      <mf-filters-bar [filters]="filters" controls="matter-filter-row" [clearAlso]="['q']" />

      <div class="mf-fill">
        <div class="mf-table-wrap" mfScrollArea="Matters list" #scroll>
          <div class="mf-scroll">
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
                @if (filters.rowVisible()) {
                  <tr
                    mfColumnFilterRow
                    id="matter-filter-row"
                    [filters]="filters"
                    [columns]="columns"
                  ></tr>
                }
              </thead>
              <tbody
                mfGridBody
                noun="matters"
                [state]="state()"
                [empty]="rows().length === 0"
                [filtered]="filters.activeCount() > 0"
                [columns]="5"
                [skeleton]="['7rem', '16rem', '14rem', '3rem', '5rem']"
                (retry)="load()"
                (clear)="clear()"
              >
                <p-button
                  mfEmptyAction
                  *mfHasPermission="'Matter.Create'"
                  label="New matter"
                  (onClick)="go('/matters/new')"
                />
                @for (m of rows(); track m.matterId) {
                  <tr>
                    <td>
                      <mf-matter-ref [value]="m.matterRef" [link]="['/matters', m.matterId]" />
                    </td>
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
export class MattersListPage extends ServerListPage<MatterResponse> {
  private readonly api = inject(MattersClient);
  private readonly injector = inject(Injector);
  private readonly scroll = viewChild<ElementRef<HTMLElement>>('scroll');

  protected readonly defaultSort = 'matterRef';
  protected readonly columns = COLUMNS;

  protected readonly clientChip = computed(() => {
    const first = this.rows()[0];
    const id = this.filters.text('clientId');
    return first && String(first.clientId) === id
      ? `${first.clientNumber} ${first.clientName}`
      : `Client ${id}`;
  });

  /** One definition per filter: the row, the sheet, the chips, the count, the URL and the API arguments all come from it. */
  private readonly defs = computed((): FilterDef[] => {
    const [ref, name, status, sensitive] = matterColumnDefs();
    return [
      ref,
      name,
      { key: 'client', label: 'Client', column: 'client', type: 'text' },
      status,
      sensitive,
      // `?clientId=` (a link from a client): no control, a removable chip.
      {
        key: 'clientId',
        label: 'Client',
        type: 'text',
        noControl: true,
        valueLabel: (): string => this.clientChip(),
      },
    ];
  });

  protected readonly filters: ListFilters = new ListFilters({
    screen: 'matters',
    noun: 'matters',
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
    const clientId = Number(this.filters.text('clientId'));
    const sensitive = this.filters.text('isSensitive');
    return firstValueFrom(
      this.api.listMatters(
        undefined,
        Number.isInteger(clientId) && clientId > 0 ? clientId : undefined,
        isActiveParam(parseStatus(this.filters.text('status'))),
        sensitive === '' ? undefined : sensitive === 'true',
        this.filters.text('matterRef') || undefined,
        this.filters.text('name') || undefined,
        this.filters.text('client') || undefined,
        this.pageNumber(),
        this.pageSize(),
        this.sort() || undefined,
      ),
    );
  }
}
