import { NgTemplateOutlet } from '@angular/common';
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
import { ListToolbar } from '../../../shared/filters/list-toolbar';
import { SortedLine, sortLabelsOf } from '../../../shared/ui/sorted-line';
import { ListFilters } from '../../../shared/filters/list-filters';
import { ActiveBadge } from '../../../shared/ui/badge';
import {
  RecordCell,
  RecordColumns,
  RecordGrid,
  RecordGridColumn,
  RecordGridState,
} from '../../../shared/ui/record-grid';
import { FixedPage } from '../../../shared/ui/fixed-page';
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
import { PageScope } from '../../../shared/scope/page-scope';
import { scopeLine } from '../../../shared/scope/scope-line';
import { ScopeSwitch } from '../../../shared/scope/scope-switch';
import { Pager } from '../../../shared/ui/pager';
import { TaskCount } from '../../../shared/ui/task-count';
import { RowLink, registerTableSkip, restoreRowFocus } from '../../../shared/ui/row-nav';
import { IntPipe } from '../../../shared/ui/number-format';

/** Bone widths of a skeleton row, per column key. */
const BONES: Record<string, string> = {
  clientNumber: '6rem',
  name: '16rem',
  matters: '3rem',
  myMatters: '3rem',
  openTasks: '3rem',
  overdue: '3rem',
  status: '5rem',
};

/**
 * Clients list (UX S05): Client number, Name (the one link), Matters, My matters (scoped view of a person who can manage matters), Open tasks and Overdue (counts that open the Task Queue; left out
 * without Task.View), Status. Inline column filters (Client number, Name, Status with Active by default), sortable, server paged. State lives
 * in the URL (`clientNumber`, `name`, `status`, `page`, `size`, `sort`).
 */
@Component({
  selector: 'mf-clients-list-page',
  imports: [
    IntPipe,
    FixedPage,
    NgTemplateOutlet,
    PageHeader,
    ScopeSwitch,
    ActiveBadge,
    RouterLink,
    Button,
    HasPermissionDirective,
    Pager,
    RecordGrid,
    RecordCell,
    RecordColumns,
    ListToolbar,
    SortedLine,
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
  styles: `
    /* Client Name is the spring of the table: one line with an ellipsis (D-45); the floor is on the heading (the column definition). */
    td.cl-name {
      width: 100%;
      max-width: 0;
    }
  `,
  template: `
    <mf-fixed-page>
      <mf-page-header
        heading="Clients"
        [count]="state() === 'ready' ? total() : null"
        [countPending]="state() !== 'ready'"
      >
        <mf-scope-switch
          mfActions
          [scope]="scope.value()"
          [canAll]="scope.canAll()"
          announceMine="Showing clients with a matter you manage"
          announceAll="Showing all clients"
          (scopeChange)="scope.set($event)"
        />
        @if (scopeText()) {
          <span mfDescription class="sl-line" data-scope-line>{{ scopeText() }}</span>
        }
        <p-button
          mfActions
          *mfHasPermission="'Client.Create'"
          label="New Client"
          icon="pi pi-plus"
          (onClick)="go('/clients/new')"
        />
      </mf-page-header>

      <mf-list-toolbar
        [filters]="filters"
        controls="client-filter-row"
        searchLabel="Search clients"
        [clearAlso]="['q']"
      >
        @if (!phone()) {
          <mf-record-columns mfColumns [grid]="grid" />
        }
        <mf-sorted-line
          mfBarEnd
          [sort]="sort()"
          [defaultSort]="defaultSort"
          [labels]="sortLabels()"
          (resetSort)="pickSort(null)"
        />
        <mf-record-sort
          mfSheetSort
          [options]="sortOptions()"
          [sort]="sort()"
          defaultSort="clientNumber"
          (sorted)="pickSort($event)"
        />
      </mf-list-toolbar>

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
            [emptyText]="emptyText()"
            (showAll)="showAll()"
          >
            @if (scope.mine() && scope.canAll()) {
              <button
                mfEmptyAction
                type="button"
                class="mf-btn"
                data-show-all-matters
                (click)="scope.set('all')"
              >
                Show All Matters
              </button>
            }
            <p-button
              mfEmptyAction
              *mfHasPermission="'Client.Create'"
              label="New Client"
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
                    >{{ c.matterCount | mfInt }} {{ c.matterCount === 1 ? 'matter' : 'matters'
                    }}{{ myCount() ? ', ' + (c.myMatterCount ?? 0) + ' mine' : '' }}</span
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
          <mf-record-grid
            #scroll
            label="Clients list"
            caption="Clients"
            noun="clients"
            [grid]="grid"
            [rows]="rows()"
            [rowKey]="clientKey"
            [loadState]="state()"
            [empty]="rows().length === 0"
            [filtered]="filters.activeCount() > 0"
            [emptyText]="emptyText()"
            [hidden]="hiddenCount()"
            hiddenLabel="inactive"
            [bones]="bones"
            [sort]="sort()"
            [defaultSort]="defaultSort"
            (sorted)="setSort($event)"
            (retry)="load()"
            (clear)="clear()"
            (showAll)="showAll()"
          >
            @if (filters.rowVisible()) {
              <tr
                mfGridFilterRow
                mfColumnFilterRow
                id="client-filter-row"
                [filters]="filters"
                [columns]="columns()"
              ></tr>
            }
            @if (scope.mine() && scope.canAll()) {
              <button
                mfEmptyAction
                type="button"
                class="mf-btn"
                data-show-all-matters
                (click)="scope.set('all')"
              >
                Show All Matters
              </button>
            }
            <p-button
              mfEmptyAction
              *mfHasPermission="'Client.Create'"
              label="New Client"
              (onClick)="go('/clients/new')"
            />
            <ng-template mfCell="clientNumber" let-c>
              <td class="pg-mono pg-nowrap">{{ c.clientNumber }}</td>
            </ng-template>
            <ng-template mfCell="name" let-c>
              <td class="cl-name">
                <a
                  class="mf-link pg-clip"
                  [routerLink]="['/clients', c.clientId]"
                  mfRowLink="clients"
                  [rowKey]="c.clientId"
                  [title]="c.name"
                  >{{ c.name }}</a
                >
              </td>
            </ng-template>
            <ng-template mfCell="matters" let-c>
              <td class="pg-num">{{ c.matterCount | mfInt }}</td>
            </ng-template>
            <ng-template mfCell="myMatters" let-c>
              <td class="pg-num" data-my-matters-cell>{{ c.myMatterCount ?? 0 }}</td>
            </ng-template>
            <ng-template mfCell="openTasks" let-c>
              <td class="pg-num">
                <mf-task-count
                  kind="open"
                  scope="client"
                  [recordId]="c.clientId"
                  [name]="c.name"
                  [count]="c.openTaskCount ?? 0"
                />
              </td>
            </ng-template>
            <ng-template mfCell="overdue" let-c>
              <td class="pg-num">
                <mf-task-count
                  kind="overdue"
                  scope="client"
                  [recordId]="c.clientId"
                  [name]="c.name"
                  [count]="c.overdueTaskCount ?? 0"
                />
              </td>
            </ng-template>
            <ng-template mfCell="status" let-c>
              <td>
                <mf-active-badge [active]="c.isActive" />
              </td>
            </ng-template>
            <div mfGridFoot>
              <ng-container *ngTemplateOutlet="pager" />
            </div>
          </mf-record-grid>
        }
        @if (phone()) {
          <ng-container *ngTemplateOutlet="pager" />
        }
        <ng-template #pager>
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
        </ng-template>
      </div>
    </mf-fixed-page>
  `,
})
export class ClientsListPage extends ServerListPage<ClientResponse> {
  protected override readonly emptyOffersClear = true;
  private readonly api = inject(ClientsClient);
  private readonly scroll = viewChild('scroll', { read: ElementRef });

  private readonly auth = inject(AuthStore);

  /** "My matters / All" (epic #758): people who can be a project manager open the list on the matters they manage, with a remembered switch. */
  protected readonly scope = new PageScope('clients', () => !this.filters.isDeepLink());
  /** "Clients with a matter you manage (63 of 1,204)" / "1,204 clients". */
  protected readonly scopeText = computed(() =>
    scopeLine({
      scope: this.scope.value(),
      noun: 'clients',
      phrase: 'Clients with a matter you manage',
      shown: this.state() === 'ready' ? this.total() : null,
      all: this.unscopedTotal(),
    }),
  );
  protected readonly emptyText = computed(() =>
    this.scope.mine() ? 'You do not manage any matter yet.' : '',
  );

  /** Below 640 px the list is cards, not a table (WP12). */
  protected readonly phone = phoneCards();
  /** The phone's Sort by select: the sortable columns, counts only with Task.View (the headers' keys). */
  protected readonly sortOptions = computed((): SortOption[] => [
    { value: 'clientNumber', label: 'Client Number' },
    { value: 'name', label: 'Client Name' },
    ...(this.counts()
      ? [
          { value: 'openTasks', label: 'Open Tasks', descFirst: true },
          { value: 'overdue', label: 'Overdue', descFirst: true },
        ]
      : []),
  ]);

  protected readonly defaultSort = 'clientNumber';
  protected readonly sortLabels = computed(() => sortLabelsOf(this.sortOptions()));
  /** Counts are null without Task.View: the two columns are not rendered then. */
  protected readonly counts = computed(() => this.auth.has('Task.View'));
  /** "My matters" per client: only in the scoped view of a person who can manage matters (the API sends null otherwise). */
  protected readonly myCount = computed(
    () => this.scope.mine() && this.auth.has('Matter.BeManager'),
  );
  /** The columns this person may have, in the default order (Client Number and Client Name cannot be hidden). */
  protected readonly gridDefs = computed((): RecordGridColumn[] => [
    {
      key: 'clientNumber',
      label: 'Client Number',
      locked: true,
      sort: 'clientNumber',
      width: '11rem',
      minWidth: '11rem',
    },
    // The spring: no width, so it takes the free room in every state (#1245).
    { key: 'name', label: 'Client Name', locked: true, sort: 'name', minWidth: '200px' },
    {
      key: 'matters',
      label: 'Matters',
      num: true,
      width: 'var(--mf-col-count-w)',
      minWidth: 'var(--mf-col-count-w)',
    },
    ...(this.myCount()
      ? [
          {
            key: 'myMatters',
            label: 'My Matters',
            num: true,
            width: 'var(--mf-col-count-w)',
            minWidth: 'var(--mf-col-count-w)',
          },
        ]
      : []),
    ...(this.counts()
      ? [
          {
            key: 'openTasks',
            label: 'Open Tasks',
            sort: 'openTasks',
            firstDesc: true,
            num: true,
            width: 'var(--mf-col-count-w)',
            minWidth: 'var(--mf-col-count-w)',
          },
          {
            key: 'overdue',
            label: 'Overdue',
            sort: 'overdue',
            firstDesc: true,
            num: true,
            width: 'var(--mf-col-count-w)',
            minWidth: 'var(--mf-col-count-w)',
          },
        ]
      : []),
    {
      key: 'status',
      label: 'Status',
      width: 'var(--mf-col-status-w)',
      minWidth: 'var(--mf-col-status-w)',
    },
  ]);
  /** The grid state (shared record grid, #1241): order, visibility and stored widths per person under the id "clients". */
  protected readonly grid = new RecordGridState('clients', this.gridDefs);
  protected readonly bones = BONES;
  protected readonly clientKey = (c: ClientResponse): number => c.clientId;
  /** The columns of the grid, in order; the keys the filter definitions point at. */
  protected readonly columns = computed(() => this.grid.shown());

  /** One definition per filter: the row, the sheet, the chips, the count, the URL and the API arguments all come from it. */
  private readonly defs = computed((): FilterDef[] => [
    { key: 'clientNumber', label: 'Client Number', column: 'clientNumber', type: 'text' },
    { key: 'name', label: 'Client Name', column: 'name', type: 'text', search: true },
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
      this.state();
      const area = this.scroll()?.nativeElement.querySelector(
        '.mf-scroll-area',
      ) as HTMLElement | null;
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

  protected override watch(): void {
    super.watch();
    this.scope.value();
  }

  /** The same list without the scope: the "of 1,204". */
  protected override fetchUnscoped() {
    return this.scope.mine()
      ? this.list(isActiveParam(parseStatus(this.filters.text('status'))), 1, 1, false)
      : null;
  }

  private list(isActive: boolean | undefined, page: number, size: number, scoped = true) {
    return firstValueFrom(
      this.api.listClients(
        // Search finds the name or the number (the API's `q`, decision of 2026-11-02); the URL parameter stays `name`.
        this.filters.text('name') || undefined,
        isActive,
        this.filters.text('clientNumber') || undefined,
        undefined,
        scoped && this.scope.mine() ? true : undefined,
        undefined,
        page,
        size,
        this.sort() || undefined,
      ),
    );
  }
}
