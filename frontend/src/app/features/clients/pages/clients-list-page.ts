import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  computed,
  effect,
  inject,
  untracked,
  viewChild,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { Button } from 'primeng/button';
import { firstValueFrom } from 'rxjs';
import { ClientResponse, ClientsClient } from '../../../api/generated/api-client';
import { AuthStore } from '../../../core/auth/auth.store';
import { HasPermissionDirective } from '../../../shared/directives/has-permission.directive';
import { ColumnFilterRow } from '../../../shared/filters/column-filter-row';
import { statusDef } from '../../../shared/filters/common-defs';
import { FilterDef } from '../../../shared/filters/filter-def';
import { FiltersBar } from '../../../shared/filters/filters-bar';
import { ListFiltersButton } from '../../../shared/filters/list-filters-button';
import { ListFilters } from '../../../shared/filters/list-filters';
import { ActiveBadge } from '../../../shared/ui/badge';
import { SortHeader } from '../../../shared/ui/data-table';
import { FixedPage, ScrollArea } from '../../../shared/ui/fixed-page';
import { GridBody } from '../../../shared/ui/grid-body';
import { isActiveParam, parseStatus } from '../../../shared/ui/list-helpers';
import { ServerListPage } from '../../../shared/ui/list-query';
import {
  RecordCard,
  RecordCardDef,
  RecordCardList,
  phoneCards,
} from '../../../shared/ui/record-card-list';
import { RecordSort } from '../../../shared/ui/record-sort';
import { SortOption } from '../../../shared/work-queue/phone-sort';
import { PageHeader } from '../../../shared/ui/page-header';
import { Pager } from '../../../shared/ui/pager';
import { TaskCount } from '../../../shared/ui/task-count';
import { RowLink, registerTableSkip, restoreRowFocus } from '../../../shared/ui/row-nav';

/** Bone widths of a skeleton row, per column key. */
const BONES: Record<string, string> = {
  clientNumber: '6rem',
  name: '16rem',
  matters: '3rem',
  openTasks: '3rem',
  overdue: '3rem',
  status: '5rem',
};

/**
 * Clients list (UX S05): Client number, Name (the one link), Matters, Open tasks and Overdue (counts that open the Task Queue; left out
 * without Task.View), Status. Inline column filters (Client number, Name, Status with Active by default), sortable, server paged. State lives
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
    ListFiltersButton,
    ColumnFilterRow,
    TaskCount,
    RecordCardList,
    RecordCardDef,
    RecordCard,
    RecordSort,
    RowLink,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: '../../../shared/ui/page.scss',
  template: `
    <mf-fixed-page>
      <mf-page-header heading="Clients">
        <mf-list-filters-button
          mfActions
          [filters]="filters"
          controls="client-filter-row"
          [clearAlso]="['q']"
        />
        <p-button
          mfActions
          *mfHasPermission="'Client.Create'"
          label="New client"
          icon="pi pi-plus"
          (onClick)="go('/clients/new')"
        />
      </mf-page-header>

      <mf-filters-bar [bare]="true" [filters]="filters" [clearAlso]="['q']">
        <mf-record-sort
          mfSheetSort
          [options]="sortOptions()"
          [sort]="sort()"
          defaultSort="clientNumber"
          (sorted)="pickSort($event)"
        />
      </mf-filters-bar>

      <div class="mf-fill">
        @if (phone()) {
          <mf-record-card-list
            noun="clients"
            label="Clients"
            [state]="state()"
            [empty]="rows().length === 0"
            [filtered]="filters.activeCount() > 0"
            (retry)="load()"
            (clear)="clear()"
            [hidden]="hiddenCount()"
            hiddenLabel="inactive"
            (showAll)="showAll()"
          >
            <p-button
              mfEmptyAction
              *mfHasPermission="'Client.Create'"
              label="New client"
              (onClick)="go('/clients/new')"
            />
            <ng-template [mfRecordCard]="rows()" let-c>
              <mf-record-card
                [name]="c.name"
                [link]="['/clients', c.clientId]"
                list="clients"
                [rowKey]="c.clientId"
              >
                <mf-active-badge mfCardBadges [active]="c.isActive" />
                <p mfCardMeta class="rc-line" data-card-meta>
                  <span class="rc-ref">{{ c.clientNumber }}</span>
                  <span class="rc-sep" aria-hidden="true">-</span><span class="mf-sr-only">, </span>
                  <span class="rc-text"
                    >{{ c.matterCount }} {{ c.matterCount === 1 ? 'matter' : 'matters' }}</span
                  >
                </p>
                @if (counts()) {
                  <mf-task-count
                    mfCardCounts
                    kind="open"
                    scope="client"
                    [word]="true"
                    [recordId]="c.clientId"
                    [name]="c.name"
                    [count]="c.openTaskCount ?? 0"
                  />
                }
                @if (counts() && (c.overdueTaskCount ?? 0) > 0) {
                  <mf-task-count
                    mfCardCounts
                    kind="overdue"
                    scope="client"
                    [word]="true"
                    [recordId]="c.clientId"
                    [name]="c.name"
                    [count]="c.overdueTaskCount ?? 0"
                  />
                }
              </mf-record-card>
            </ng-template>
          </mf-record-card-list>
        } @else {
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
                    <th scope="col" class="pg-num">Matters</th>
                    @if (counts()) {
                      <th
                        class="pg-num"
                        mfSort="openTasks"
                        [firstDesc]="true"
                        [sort]="sort()"
                        [defaultSort]="defaultSort"
                        (sorted)="setSort($event)"
                      >
                        Open tasks
                      </th>
                      <th
                        class="pg-num"
                        mfSort="overdue"
                        [firstDesc]="true"
                        [sort]="sort()"
                        [defaultSort]="defaultSort"
                        (sorted)="setSort($event)"
                      >
                        Overdue
                      </th>
                    }
                    <th scope="col">Status</th>
                  </tr>
                  @if (filters.rowVisible()) {
                    <tr
                      mfColumnFilterRow
                      id="client-filter-row"
                      [filters]="filters"
                      [columns]="columns()"
                    ></tr>
                  }
                </thead>
                <tbody
                  mfGridBody
                  noun="clients"
                  [state]="state()"
                  [empty]="rows().length === 0"
                  [filtered]="filters.activeCount() > 0"
                  [columns]="columns().length"
                  [skeleton]="skeleton()"
                  (retry)="load()"
                  (clear)="clear()"
                  [hidden]="hiddenCount()"
                  hiddenLabel="inactive"
                  (showAll)="showAll()"
                >
                  <p-button
                    mfEmptyAction
                    *mfHasPermission="'Client.Create'"
                    label="New client"
                    (onClick)="go('/clients/new')"
                  />
                  @for (c of rows(); track c.clientId) {
                    <tr>
                      <td class="pg-mono pg-nowrap">{{ c.clientNumber }}</td>
                      <td>
                        <a
                          class="pg-link pg-name"
                          [routerLink]="['/clients', c.clientId]"
                          mfRowLink="clients"
                          [rowKey]="c.clientId"
                          [title]="c.name"
                          >{{ c.name }}</a
                        >
                      </td>
                      <td class="pg-num">{{ c.matterCount }}</td>
                      @if (counts()) {
                        <td class="pg-num">
                          <mf-task-count
                            kind="open"
                            scope="client"
                            [recordId]="c.clientId"
                            [name]="c.name"
                            [count]="c.openTaskCount ?? 0"
                          />
                        </td>
                        <td class="pg-num">
                          <mf-task-count
                            kind="overdue"
                            scope="client"
                            [recordId]="c.clientId"
                            [name]="c.name"
                            [count]="c.overdueTaskCount ?? 0"
                          />
                        </td>
                      }
                      <td>
                        <mf-active-badge [active]="c.isActive" />
                      </td>
                    </tr>
                  }
                </tbody>
              </table>
            </div>
          </div>
        }
        @if (state() === 'ready' && total() > 0) {
          <mf-pager
            [page]="pageNumber()"
            [pageSize]="pageSize()"
            [pageSizes]="pageSizes"
            [total]="total()"
            [hidden]="hiddenCount()"
            hiddenLabel="inactive"
            (showAll)="showAll()"
            (pageChange)="goToPage($event)"
            (pageSizeChange)="setPageSize($event)"
          />
        }
      </div>
    </mf-fixed-page>
  `,
})
export class ClientsListPage extends ServerListPage<ClientResponse> {
  protected override readonly emptyOffersClear = true;
  private readonly api = inject(ClientsClient);
  private readonly scroll = viewChild<ElementRef<HTMLElement>>('scroll');

  private readonly auth = inject(AuthStore);

  /** Below 640 px the list is cards, not a table (WP12). */
  protected readonly phone = phoneCards();
  /** The phone's Sort by select: the sortable columns, counts only with Task.View (the headers' keys). */
  protected readonly sortOptions = computed((): SortOption[] => [
    { value: 'clientNumber', label: 'Client number' },
    { value: 'name', label: 'Name' },
    ...(this.counts()
      ? [
          { value: 'openTasks', label: 'Open tasks', descFirst: true },
          { value: 'overdue', label: 'Overdue', descFirst: true },
        ]
      : []),
  ]);

  protected readonly defaultSort = 'clientNumber';
  /** Counts are null without Task.View: the two columns are not rendered then. */
  protected readonly counts = computed(() => this.auth.has('Task.View'));
  /** The columns of the grid, in order; the keys the filter definitions point at. */
  protected readonly columns = computed(() => [
    'clientNumber',
    'name',
    'matters',
    ...(this.counts() ? ['openTasks', 'overdue'] : []),
    'status',
  ]);
  protected readonly skeleton = computed(() => this.columns().map((key) => BONES[key]));

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
    openByDefault: true,
    sheetBelow: 640,
  });

  constructor() {
    super();
    registerTableSkip();
    restoreRowFocus('clients', () => this.state() === 'ready');
    // The controls move into the sheet while the grid scrolls sideways (the grid is not there while the phone shows cards).
    effect(() => {
      const area = this.scroll()?.nativeElement;
      if (area) untracked(() => this.filters.watchOverflow(area));
    });
  }

  protected override listFilters() {
    return this.filters;
  }

  protected override fetch() {
    return this.list(
      isActiveParam(parseStatus(this.filters.text('status'))),
      this.pageNumber(),
      this.pageSize(),
    );
  }

  /** The inactive clients the default Active hides, under the same name and number filters (#271). */
  protected override fetchHidden() {
    return parseStatus(this.filters.text('status')) === 'active' ? this.list(false, 1, 1) : null;
  }

  private list(isActive: boolean | undefined, page: number, size: number) {
    return firstValueFrom(
      this.api.listClients(
        undefined,
        isActive,
        this.filters.text('clientNumber') || undefined,
        this.filters.text('name') || undefined,
        undefined,
        undefined,
        page,
        size,
        this.sort() || undefined,
      ),
    );
  }
}
