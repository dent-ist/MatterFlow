import { NgTemplateOutlet } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  computed,
  effect,
  inject,
  input,
  signal,
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
import { ListToolbar } from '../../../shared/filters/list-toolbar';
import { ListFilters } from '../../../shared/filters/list-filters';
import { ActiveBadge, SensitiveBadge } from '../../../shared/ui/badge';
import { StateBlock } from '../../../shared/ui/state-block';
import { ActionMenu } from '../../../shared/ui/action-menu';
import { AddCommentDialog } from '../../../shared/matter-actions/add-comment-dialog';
import { matterActionMenu } from '../../../shared/matter-actions/matter-actions';
import {
  RecordCell,
  RecordColumns,
  RecordGrid,
  RecordGridColumn,
  RecordGridState,
} from '../../../shared/ui/record-grid';
import { SortedLine, sortLabelsOf } from '../../../shared/ui/sorted-line';
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
 * Name, Status defaulting to Active with Sensitive stacked under it; the row is open by default; sortable columns (Reference, Name, Open tasks and Overdue; the two counts are left out without Task.View), paging, loading / empty / error states).
 * New matter lives in the page header (the empty state keeps its own button) and prefills the client. The filters (`matterRef`, `name`, `status`, `isSensitive`) are read from the address
 * by `ListFilters`; the page binds `status`, `page`, `size` and `sort` like every other list. Needs `Matter.View`.
 */
@Component({
  selector: 'mf-client-matters',
  imports: [
    StateBlock,
    NgTemplateOutlet,
    HasPermissionDirective,
    ActiveBadge,
    SensitiveBadge,
    MatterRef,
    RouterLink,
    TaskCount,
    Pager,
    ListToolbar,
    SortedLine,
    RecordGrid,
    RecordCell,
    RecordColumns,
    ActionMenu,
    AddCommentDialog,
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
    /* Matter Name is the spring of the table: one line with an ellipsis (D-45); the floor is on the heading (the column definition). */
    td.cm-name {
      width: 100%;
      max-width: 0;
    }
  `,
  template: `
    @if (!canView()) {
      <div data-no-access="matters">
        <mf-state-block icon="pi-lock">You don't have access to matters.</mf-state-block>
      </div>
    } @else {
      <mf-list-toolbar [filters]="filters" controls="client-matter-filter-row" [clearAlso]="['q']">
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
          defaultSort="matterRef"
          (sorted)="pickSort($event)"
        />
      </mf-list-toolbar>

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
          [hidden]="hiddenCount()"
          hiddenLabel="inactive"
          (showAll)="showAll()"
        >
          <span mfEmptyAction *mfHasPermission="'Matter.Create'">
            @if (clientActive()) {
              <button type="button" class="mf-btn" data-empty-new-matter (click)="newMatter()">
                New Matter
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
        <mf-record-grid
          #scroll
          label="Matters list"
          [caption]="'Matters of ' + clientName()"
          noun="matters"
          emptyText="No matters yet for this client."
          [grid]="grid"
          [rows]="rows()"
          [rowKey]="matterKey"
          [loadState]="state()"
          [empty]="rows().length === 0"
          [filtered]="filters.activeCount() > 0"
          [filters]="filters"
          [hidden]="hiddenCount()"
          hiddenLabel="inactive"
          [bones]="bones"
          [actions]="hasActions()"
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
              id="client-matter-filter-row"
              [filters]="filters"
              [columns]="columns()"
            ></tr>
          }
          <span mfEmptyAction *mfHasPermission="'Matter.Create'">
            @if (clientActive()) {
              <button type="button" class="mf-btn" data-empty-new-matter (click)="newMatter()">
                New Matter
              </button>
            } @else {
              <span class="cm-reason">{{ INACTIVE_REASON }}</span>
            }
          </span>
          <ng-template mfCell="matterRef" let-m>
            <td>
              <mf-matter-ref [value]="m.matterRef" [rowStop]="true" />
            </td>
          </ng-template>
          <ng-template mfCell="name" let-m>
            <td class="cm-name">
              <div class="pg-namecell">
                <a
                  class="mf-link pg-clip"
                  [routerLink]="['/matters', m.matterId]"
                  mfRowLink="client-matters"
                  [rowKey]="m.matterId"
                  [title]="m.name"
                  >{{ m.name }}</a
                >
                @if (m.isSensitive) {
                  <mf-sensitive-badge [compact]="true" />
                }
              </div>
            </td>
          </ng-template>
          <ng-template mfCell="openTasks" let-m>
            <td class="pg-num">
              <mf-task-count
                kind="open"
                scope="matter"
                [recordId]="m.matterId"
                [name]="m.name"
                [count]="m.openTaskCount ?? 0"
              />
            </td>
          </ng-template>
          <ng-template mfCell="overdue" let-m>
            <td class="pg-num">
              <mf-task-count
                kind="overdue"
                scope="matter"
                [recordId]="m.matterId"
                [name]="m.name"
                [count]="m.overdueTaskCount ?? 0"
              />
            </td>
          </ng-template>
          <ng-template mfCell="status" let-m>
            <td><mf-active-badge [active]="m.isActive" /></td>
          </ng-template>
          <ng-template mfCell="actions" let-m>
            <td class="mf-col-actions" data-row-actions>
              <mf-action-menu
                [floating]="true"
                [label]="menus().get(m.matterId)!.label"
                [items]="menus().get(m.matterId)!.items"
              />
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
      @if (commentRow(); as row) {
        <mf-add-comment-dialog
          [matterId]="row.matterId"
          [matterLabel]="row.matterRef + ' ' + row.name"
          [(visible)]="commentOpen"
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

  private readonly scroll = viewChild('scroll', { read: ElementRef });

  protected readonly canView = computed(() => this.auth.has('Matter.View'));
  /** Below 640 px the list is cards, not a table (WP12). */
  protected readonly phone = phoneCards();
  /** The phone's Sort by select: the sortable columns, counts only with Task.View (the headers' keys). */
  protected readonly sortOptions = computed((): SortOption[] => [
    { value: 'matterRef', label: 'CM Number' },
    { value: 'name', label: 'Matter Name' },
    ...(this.counts()
      ? [
          { value: 'openTasks', label: 'Open Tasks', descFirst: true },
          { value: 'overdue', label: 'Overdue', descFirst: true },
        ]
      : []),
  ]);

  protected readonly defaultSort = 'matterRef';
  /** Counts are null without Task.View: the two columns are not rendered then. */
  protected readonly counts = computed(() => this.auth.has('Task.View'));
  protected readonly sortLabels = computed(() => sortLabelsOf(this.sortOptions()));
  /** The row menu (New Task, Bulk Update, Add Comment, Open Task List) exists for people who can see tasks, as on the Matters list. */
  protected readonly hasActions = computed(() => this.auth.has('Task.View'));
  /** The columns this person may have, in the default order (the counts need Task.View). Widths are fixed, Matter Name is the one spring (D-43; #1270). */
  protected readonly gridDefs = computed((): RecordGridColumn[] => [
    {
      key: 'matterRef',
      // 157 px: the Number filter field of the filter row is 133 px wide plus the cell's 24 px of padding.
      label: 'CM Number',
      locked: true,
      sort: 'matterRef',
      width: '157px',
      minWidth: '157px',
    },
    { key: 'name', label: 'Matter Name', locked: true, sort: 'name', minWidth: '200px' },
    ...(this.counts()
      ? [
          {
            key: 'openTasks',
            label: 'Open Tasks',
            sort: 'openTasks',
            firstDesc: true,
            num: true,
            width: '125px',
            minWidth: '125px',
          },
          {
            key: 'overdue',
            label: 'Overdue',
            sort: 'overdue',
            firstDesc: true,
            num: true,
            width: '105px',
            minWidth: '105px',
          },
        ]
      : []),
    {
      key: 'status',
      label: 'Status',
      // 160 px, the Matters list value: the filter row's Status cell stacks the Active dropdown above the Sensitive one, and the column must not move when the row is open (#1272).
      width: '160px',
      minWidth: '160px',
    },
  ]);
  /** The grid state (shared record grid, #1241): order, visibility and stored widths per person under the id "client-matters". */
  protected readonly grid = new RecordGridState('client-matters', this.gridDefs);
  protected readonly bones = BONES;
  protected readonly matterKey = (m: MatterResponse): number => m.matterId;
  /** Every column of the table, in order, the action one included (its filter cell is empty but grey): the keys the filter definitions point at. */
  protected readonly columns = computed(() => [
    ...this.grid.shown(),
    ...(this.hasActions() ? ['actions'] : []),
  ]);
  /** The matter the Add Comment dialog works on. */
  protected readonly commentRow = signal<MatterResponse | null>(null);
  protected readonly commentOpen = signal(false);
  /** The quick actions of a row, built once per page of rows (the Matters list's menu). */
  protected readonly menus = computed(
    () => new Map(this.rows().map((m) => [m.matterId, this.buildMenu(m)] as const)),
  );

  private buildMenu(m: MatterResponse) {
    return matterActionMenu(
      { matterId: m.matterId, matterRef: m.matterRef, name: m.name, isActive: m.isActive },
      (p) => this.auth.has(p),
      {
        newTask: () =>
          void this.router.navigate(['/tasks/new'], { queryParams: { matterId: m.matterId } }),
        bulk: () =>
          void this.router.navigate(['/matters', m.matterId], {
            queryParams: { tab: 'tasks' },
            state: { selectTasks: true },
          }),
        addComment: () => {
          this.commentRow.set(m);
          this.commentOpen.set(true);
        },
        openTasks: () =>
          void this.router.navigate(['/matters', m.matterId], { queryParams: { tab: 'tasks' } }),
      },
    );
  }
  protected readonly INACTIVE_REASON = INACTIVE_REASON;

  /** One definition per filter (the Matters list's, without the Client column). */
  private readonly defs = computed((): FilterDef[] =>
    // The input says the short heading word (D-44d): the column is CM Number, so "Number", not "Matter".
    matterColumnDefs('Matter').map((d) =>
      d.key === 'matterRef' ? { ...d, placeholder: 'Number' } : d,
    ),
  );

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
      this.state();
      const area = this.scroll()?.nativeElement.querySelector(
        '.mf-scroll-area',
      ) as HTMLElement | null;
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
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        page,
        size,
        this.sort() || undefined,
      ),
    );
  }
}
