import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  computed,
  effect,
  inject,
  input,
  untracked,
  viewChild,
} from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { MatterResponse, MattersClient } from '../../../api/generated/api-client';
import { AuthStore } from '../../../core/auth/auth.store';
import { RouterLink } from '@angular/router';
import { HasPermissionDirective } from '../../../shared/directives/has-permission.directive';
import { ColumnFilterRow } from '../../../shared/filters/column-filter-row';
import { matterColumnDefs } from '../../../shared/filters/common-defs';
import { FilterDef } from '../../../shared/filters/filter-def';
import { FiltersBar } from '../../../shared/filters/filters-bar';
import { ListFilters } from '../../../shared/filters/list-filters';
import { ActiveBadge, SensitiveBadge } from '../../../shared/ui/badge';
import { SortHeader } from '../../../shared/ui/data-table';
import { ScrollArea } from '../../../shared/ui/fixed-page';
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
import { CopyButton } from '../../../shared/ui/copy-button';
import { RowLink, registerTableSkip, restoreRowFocus } from '../../../shared/ui/row-nav';
import { Pager } from '../../../shared/ui/pager';
import { TaskCount } from '../../../shared/ui/task-count';

/** Why New matter is unavailable for an inactive client (the server refuses with ClientInactive); shown beside the button and as its tooltip. */
const INACTIVE_REASON = 'This client is inactive. Set it active to add matters.';

/** Bone widths of a skeleton row, per column key. */
const BONES: Record<string, string> = {
  matterRef: '7rem',
  name: '16rem',
  openTasks: '3rem',
  overdue: '3rem',
  status: '5rem',
};

/**
 * The main area of the Client detail page: the client's Matters as a list in the shared pattern (inline column filters for Matter and
 * Name, Status defaulting to Active, Sensitive beside Status; the row is open by default; sortable columns (Reference, Name, Open tasks and Overdue; the two counts are left out without Task.View), paging, loading / empty / error states).
 * New matter lives in the page header (the empty state keeps its own button) and prefills the client. The filters (`matterRef`, `name`, `status`, `isSensitive`) are read from the address
 * by `ListFilters`; the page binds `status`, `page`, `size` and `sort` like every other list. Needs `Matter.View`.
 */
@Component({
  selector: 'mf-client-matters',
  imports: [
    ScrollArea,
    HasPermissionDirective,
    ActiveBadge,
    SensitiveBadge,
    MatterRef,
    RouterLink,
    TaskCount,
    Pager,
    SortHeader,
    GridBody,
    FiltersBar,
    ColumnFilterRow,
    RecordCardList,
    RecordCardDef,
    RecordCard,
    RecordSort,
    CopyButton,
    RowLink,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'mf-fill' },
  styleUrl: '../../../shared/ui/page.scss',
  styles: `
    .cm-reason {
      color: var(--mf-text-muted);
      font-size: var(--mf-fs-sm);
    }
  `,
  template: `
    @if (!canView()) {
      <div class="pg-state" data-no-access="matters">
        You don't have permission to view matters.
      </div>
    } @else {
      <mf-filters-bar [filters]="filters" controls="client-matter-filter-row" [clearAlso]="['q']">
        <mf-record-sort
          mfSheetSort
          [options]="sortOptions()"
          [sort]="sort()"
          defaultSort="matterRef"
          (sorted)="pickSort($event)"
        />
      </mf-filters-bar>

      @if (phone()) {
        <mf-record-card-list
          noun="matters"
          emptyText="No matters yet for this client."
          [label]="'Matters of ' + clientName()"
          [state]="state()"
          [empty]="rows().length === 0"
          [filtered]="filters.activeCount() > 0"
          (retry)="load()"
          (clear)="clear()"
        >
          <span mfEmptyAction *mfHasPermission="'Matter.Create'">
            @if (clientActive()) {
              <button type="button" class="mf-btn" data-empty-new-matter (click)="newMatter()">
                New matter
              </button>
            } @else {
              <span class="cm-reason">{{ INACTIVE_REASON }}</span>
            }
          </span>
          <ng-template [mfRecordCard]="rows()" let-m>
            <mf-record-card
              [name]="m.name"
              [link]="['/matters', m.matterId]"
              list="client-matters"
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
                Matters of
                {{
                  clientName()
                }}
              </caption>
              <thead>
                <tr>
                  <th
                    mfSort="matterRef"
                    [sort]="sort()"
                    [defaultSort]="defaultSort"
                    (sorted)="setSort($event)"
                  >
                    Matter
                  </th>
                  <th
                    mfSort="name"
                    [sort]="sort()"
                    [defaultSort]="defaultSort"
                    (sorted)="setSort($event)"
                  >
                    Name
                  </th>
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
                    id="client-matter-filter-row"
                    [filters]="filters"
                    [columns]="columns()"
                  ></tr>
                }
              </thead>
              <tbody
                mfGridBody
                noun="matters"
                emptyText="No matters yet for this client."
                [state]="state()"
                [empty]="rows().length === 0"
                [filtered]="filters.activeCount() > 0"
                [columns]="columns().length"
                [skeleton]="skeleton()"
                (retry)="load()"
                (clear)="clear()"
              >
                <span mfEmptyAction *mfHasPermission="'Matter.Create'">
                  @if (clientActive()) {
                    <button
                      type="button"
                      class="mf-btn"
                      data-empty-new-matter
                      (click)="newMatter()"
                    >
                      New matter
                    </button>
                  } @else {
                    <span class="cm-reason">{{ INACTIVE_REASON }}</span>
                  }
                </span>
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
                          mfRowLink="client-matters"
                          [rowKey]="m.matterId"
                          [title]="m.name"
                          >{{ m.name }}</a
                        >
                        @if (m.isSensitive) {
                          <mf-sensitive-badge />
                        }
                      </div>
                    </td>
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
                    <td><mf-active-badge [active]="m.isActive" /></td>
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
    }
  `,
})
export class ClientMatters extends ServerListPage<MatterResponse> {
  protected override readonly emptyOffersClear = true;
  readonly clientId = input.required<number>();
  readonly clientName = input('');
  /** False for an inactive client: New matter is disabled with a visible reason. */
  readonly clientActive = input(true);

  private readonly api = inject(MattersClient);
  private readonly auth = inject(AuthStore);

  private readonly scroll = viewChild<ElementRef<HTMLElement>>('scroll');

  protected readonly canView = computed(() => this.auth.has('Matter.View'));
  /** Below 640 px the list is cards, not a table (WP12). */
  protected readonly phone = phoneCards();
  /** The phone's Sort by select: the sortable columns, counts only with Task.View (the headers' keys). */
  protected readonly sortOptions = computed((): SortOption[] => [
    { value: 'matterRef', label: 'Reference' },
    { value: 'name', label: 'Name' },
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
  /** The columns of the grid, in order; the keys the filter definitions point at (the Matters list's, without Client). */
  protected readonly columns = computed(() => [
    'matterRef',
    'name',
    ...(this.counts() ? ['openTasks', 'overdue'] : []),
    'status',
  ]);
  protected readonly skeleton = computed(() => this.columns().map((key) => BONES[key]));
  protected readonly INACTIVE_REASON = INACTIVE_REASON;

  /** One definition per filter (the Matters list's, without the Client column). */
  private readonly defs = computed((): FilterDef[] => matterColumnDefs('Matter'));

  protected readonly filters: ListFilters = new ListFilters({
    screen: 'client-matters',
    noun: 'matters',
    defs: this.defs,
    openByDefault: true,
    sheetBelow: 640,
  });

  constructor() {
    super();
    registerTableSkip({ copyButton: true });
    restoreRowFocus('client-matters', () => this.state() === 'ready');
    // The controls move into the sheet while the grid scrolls sideways (the grid is not there while the phone shows cards).
    effect(() => {
      const area = this.scroll()?.nativeElement;
      if (area) untracked(() => this.filters.watchOverflow(area));
    });
  }

  /** Opens the New matter form for this client; does nothing for an inactive one (the button is `aria-disabled`, not disabled). */
  protected newMatter(): void {
    if (this.clientActive()) this.go('/matters/new?clientId=' + this.clientId());
  }

  protected override listFilters() {
    return this.filters;
  }

  protected override watch(): void {
    this.clientId();
    this.canView();
    super.watch();
  }

  protected override fetch() {
    if (!this.canView()) return Promise.resolve({ items: [], total: 0 });
    return this.list(
      isActiveParam(parseStatus(this.filters.text('status'))),
      this.pageNumber(),
      this.pageSize(),
    );
  }

  /** The inactive matters the default Active hides, under the same other filters (#271). */
  protected override fetchHidden() {
    if (!this.canView() || parseStatus(this.filters.text('status')) !== 'active') return null;
    return this.list(false, 1, 1);
  }

  private list(isActive: boolean | undefined, page: number, size: number) {
    const sensitive = this.filters.text('isSensitive');
    return firstValueFrom(
      this.api.listMatters(
        undefined,
        this.clientId(),
        isActive,
        sensitive === '' ? undefined : sensitive === 'true',
        this.filters.text('matterRef') || undefined,
        this.filters.text('name') || undefined,
        undefined,
        page,
        size,
        this.sort() || undefined,
      ),
    );
  }
}
