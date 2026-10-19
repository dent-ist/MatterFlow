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
import { MatterResponse, MattersClient } from '../../../api/generated/api-client';
import { AuthStore } from '../../../core/auth/auth.store';
import { HasPermissionDirective } from '../../../shared/directives/has-permission.directive';
import { ColumnFilterRow } from '../../../shared/filters/column-filter-row';
import { matterColumnDefs } from '../../../shared/filters/common-defs';
import { FilterDef } from '../../../shared/filters/filter-def';
import { FiltersBar } from '../../../shared/filters/filters-bar';
import { ListFiltersButton } from '../../../shared/filters/list-filters-button';
import { ListFilters } from '../../../shared/filters/list-filters';
import { ActiveBadge, SensitiveBadge } from '../../../shared/ui/badge';
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
import { MatterRef } from '../../../shared/ui/matter-ref';
import { PageHeader } from '../../../shared/ui/page-header';
import { CopyButton } from '../../../shared/ui/copy-button';
import { Pager } from '../../../shared/ui/pager';
import { TaskCount } from '../../../shared/ui/task-count';
import { RowLink, registerTableSkip, restoreRowFocus } from '../../../shared/ui/row-nav';
import { viewportAtLeast } from '../../../shared/ui/viewport';

/** Below this width the Client column (the least informative one) leaves the table (#266). */
const CLIENT_COLUMN_MIN_PX = 900;

/** Bone widths of a skeleton row, per column key. */
const BONES: Record<string, string> = {
  matterRef: '7rem',
  name: '16rem',
  client: '14rem',
  openTasks: '3rem',
  overdue: '3rem',
  status: '5rem',
};

/**
 * Matters list (UX S06): Reference (plain text with a copy button), Name (the one link), Client (a link; from 900 px), Open tasks and Overdue
 * (counts that open the Task Queue; left out without Task.View), Status. Inline column filters (Matter reference, Name, Client, Status with Active by default, and Sensitive beside it),
 * open by default from 640 px; a link from a Client keeps `?clientId=` as a removable chip. State lives in the URL.
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
    ListFiltersButton,
    ColumnFilterRow,
    TaskCount,
    RecordCardList,
    RecordCardDef,
    RecordCard,
    RecordSort,
    CopyButton,
    RowLink,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: '../../../shared/ui/page.scss',
  template: `
    <mf-fixed-page>
      <mf-page-header heading="Matters">
        <mf-list-filters-button
          mfActions
          [filters]="filters"
          controls="matter-filter-row"
          [clearAlso]="['q']"
        />
        <p-button
          mfActions
          *mfHasPermission="'Matter.Create'"
          label="New matter"
          icon="pi pi-plus"
          (onClick)="go('/matters/new')"
        />
      </mf-page-header>

      <mf-filters-bar [bare]="true" [filters]="filters" [clearAlso]="['q']">
        <mf-record-sort
          mfSheetSort
          [options]="sortOptions()"
          [sort]="sort()"
          defaultSort="matterRef"
          (sorted)="pickSort($event)"
        />
      </mf-filters-bar>

      <div class="mf-fill">
        @if (phone()) {
          <mf-record-card-list
            noun="matters"
            label="Matters"
            [state]="state()"
            [empty]="rows().length === 0"
            [filtered]="filters.activeCount() > 0"
            (retry)="load()"
            (clear)="clear()"
          >
            <p-button
              mfEmptyAction
              *mfHasPermission="'Matter.Create'"
              label="New matter"
              (onClick)="go('/matters/new')"
            />
            <ng-template [mfRecordCard]="rows()" let-m>
              <mf-record-card
                [name]="m.name"
                [link]="['/matters', m.matterId]"
                list="matters"
                [rowKey]="m.matterId"
              >
                <mf-active-badge mfCardBadges [active]="m.isActive" />
                @if (m.isSensitive) {
                  <mf-sensitive-badge mfCardBadges />
                }
                <mf-copy-button
                  mfCardAside
                  [text]="m.matterRef"
                  label="matter number"
                  [rowStop]="true"
                />
                <p mfCardMeta class="rc-line" data-card-meta>
                  <span class="rc-ref">{{ m.matterRef }}</span>
                  <span class="rc-sep" aria-hidden="true">-</span><span class="mf-sr-only">, </span>
                  @if (clientLink()) {
                    <a
                      class="rc-text"
                      data-card-client
                      [routerLink]="['/clients', m.clientId]"
                      [title]="m.clientNumber + ' ' + m.clientName"
                      >{{ m.clientName }}</a
                    >
                  } @else {
                    <span class="rc-text" data-card-client>{{ m.clientName }}</span>
                  }
                </p>
                @if (counts()) {
                  <mf-task-count
                    mfCardCounts
                    kind="open"
                    scope="matter"
                    [word]="true"
                    [recordId]="m.matterId"
                    [name]="m.name"
                    [count]="m.openTaskCount ?? 0"
                  />
                }
                @if (counts() && (m.overdueTaskCount ?? 0) > 0) {
                  <mf-task-count
                    mfCardCounts
                    kind="overdue"
                    scope="matter"
                    [word]="true"
                    [recordId]="m.matterId"
                    [name]="m.name"
                    [count]="m.overdueTaskCount ?? 0"
                  />
                }
              </mf-record-card>
            </ng-template>
          </mf-record-card-list>
        } @else {
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
                    @if (showClient()) {
                      <th
                        mfSort="clientNumber"
                        [sort]="sort()"
                        [defaultSort]="defaultSort"
                        (sorted)="setSort($event)"
                      >
                        Client
                      </th>
                    }
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
                      id="matter-filter-row"
                      [filters]="filters"
                      [columns]="columns()"
                    ></tr>
                  }
                </thead>
                <tbody
                  mfGridBody
                  noun="matters"
                  [state]="state()"
                  [empty]="rows().length === 0"
                  [filtered]="filters.activeCount() > 0"
                  [columns]="columns().length"
                  [skeleton]="skeleton()"
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
                        <mf-matter-ref [value]="m.matterRef" [rowStop]="true" />
                      </td>
                      <td>
                        <div class="pg-namecell">
                          <a
                            class="pg-link pg-name"
                            [routerLink]="['/matters', m.matterId]"
                            mfRowLink="matters"
                            [rowKey]="m.matterId"
                            [title]="m.name"
                            >{{ m.name }}</a
                          >
                          @if (m.isSensitive) {
                            <mf-sensitive-badge />
                          }
                        </div>
                      </td>
                      @if (showClient()) {
                        <td>
                          @if (clientLink()) {
                            <a
                              class="pg-link pg-name"
                              [routerLink]="['/clients', m.clientId]"
                              [title]="m.clientNumber + ' ' + m.clientName"
                              ><span class="pg-mono">{{ m.clientNumber }}</span>
                              {{ m.clientName }}</a
                            >
                          } @else {
                            <span class="pg-name" [title]="m.clientNumber + ' ' + m.clientName"
                              ><span class="pg-mono">{{ m.clientNumber }}</span>
                              {{ m.clientName }}</span
                            >
                          }
                        </td>
                      }
                      @if (counts()) {
                        <td class="pg-num">
                          <mf-task-count
                            kind="open"
                            scope="matter"
                            [recordId]="m.matterId"
                            [name]="m.name"
                            [count]="m.openTaskCount ?? 0"
                          />
                        </td>
                        <td class="pg-num">
                          <mf-task-count
                            kind="overdue"
                            scope="matter"
                            [recordId]="m.matterId"
                            [name]="m.name"
                            [count]="m.overdueTaskCount ?? 0"
                          />
                        </td>
                      }
                      <td>
                        <mf-active-badge [active]="m.isActive" />
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
export class MattersListPage extends ServerListPage<MatterResponse> {
  protected override readonly emptyOffersClear = true;
  private readonly api = inject(MattersClient);
  private readonly scroll = viewChild<ElementRef<HTMLElement>>('scroll');

  private readonly auth = inject(AuthStore);
  private readonly wide = viewportAtLeast(CLIENT_COLUMN_MIN_PX);

  /** Below 640 px the list is cards, not a table (WP12). */
  protected readonly phone = phoneCards();
  /** The phone's Sort by select: the sortable columns, counts only with Task.View (the headers' keys). */
  protected readonly sortOptions = computed((): SortOption[] => [
    { value: 'matterRef', label: 'Reference' },
    { value: 'name', label: 'Name' },
    { value: 'clientNumber', label: 'Client' },
    ...(this.counts()
      ? [
          { value: 'openTasks', label: 'Open tasks', descFirst: true },
          { value: 'overdue', label: 'Overdue', descFirst: true },
        ]
      : []),
  ]);

  protected readonly defaultSort = 'matterRef';
  /** Counts are null without Task.View: the two columns are not rendered then. */
  protected readonly counts = computed(() => this.auth.has('Task.View'));
  protected readonly showClient = computed(() => this.wide());
  /** The client's name on a card is a link only with Client.View. */
  protected readonly clientLink = computed(() => this.auth.canLink('client'));
  /** The columns of the grid, in order; the keys the filter definitions point at. */
  protected readonly columns = computed(() => [
    'matterRef',
    'name',
    ...(this.showClient() ? ['client'] : []),
    ...(this.counts() ? ['openTasks', 'overdue'] : []),
    'status',
  ]);
  protected readonly skeleton = computed(() => this.columns().map((key) => BONES[key]));

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
    openByDefault: true,
    sheetBelow: 640,
  });

  constructor() {
    super();
    registerTableSkip({ copyButton: true });
    restoreRowFocus('matters', () => this.state() === 'ready');
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

  /** The inactive matters the default Active hides, under the same other filters (#271). */
  protected override fetchHidden() {
    return parseStatus(this.filters.text('status')) === 'active' ? this.list(false, 1, 1) : null;
  }

  private list(isActive: boolean | undefined, page: number, size: number) {
    const clientId = Number(this.filters.text('clientId'));
    const sensitive = this.filters.text('isSensitive');
    return firstValueFrom(
      this.api.listMatters(
        undefined,
        Number.isInteger(clientId) && clientId > 0 ? clientId : undefined,
        isActive,
        sensitive === '' ? undefined : sensitive === 'true',
        this.filters.text('matterRef') || undefined,
        this.filters.text('name') || undefined,
        this.filters.text('client') || undefined,
        page,
        size,
        this.sort() || undefined,
      ),
    );
  }
}
