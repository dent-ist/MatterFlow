import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  Injector,
  computed,
  effect,
  inject,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import {
  StepDefinitionsClient,
  TaskTypesClient,
  WorkflowListSummary,
  WorkflowSummary,
  WorkflowsClient,
} from '../../../api/generated/api-client';
import { AuthStore } from '../../../core/auth/auth.store';
import { ApiError } from '../../../core/http/api-error';
import { NotificationService } from '../../../core/notify/notification.service';
import { ColumnFilterRow } from '../../../shared/filters/column-filter-row';
import { statusDef, triBool } from '../../../shared/filters/common-defs';
import { FilterDef } from '../../../shared/filters/filter-def';
import { FiltersBar } from '../../../shared/filters/filters-bar';
import { ListFilters } from '../../../shared/filters/list-filters';
import { QuietRequests } from '../../../core/http/interceptors';
import { AdminCounts } from '../task-types/admin-counts';
import { AdminShellFilters } from '../task-types/shell-filters';
import { AssocFilter } from '../assoc-filter';
import { ActionMenu, MenuAction } from '../../../shared/ui/action-menu';
import { ActiveBadge, Badge } from '../../../shared/ui/badge';
import { ConfirmDialog } from '../../../shared/ui/confirm-dialog';
import { isActiveParam, parseStatus } from '../../../shared/ui/list-helpers';
import { ServerListPage } from '../../../shared/ui/list-query';
import { focusListAfterAction } from '../after-action';
import { RowLink, RowStop, registerTableSkip, restoreRowFocus } from '../../../shared/ui/row-nav';
import { DrillReturn } from '../../../shared/work-queue/drill';
import { ADMIN_LIST, AdminListLeave } from '../list-return';
import { NgTemplateOutlet } from '@angular/common';
import {
  RecordCell,
  RecordGrid,
  RecordGridColumn,
  RecordGridState,
} from '../../../shared/ui/record-grid';
import { MfDateLongPipe } from '../../../shared/pipes/mf-date-long.pipe';
import { Pager } from '../../../shared/ui/pager';
import {
  RecordCard,
  RecordCardDef,
  RecordCardList,
  phoneCards,
} from '../../../shared/ui/record-card-list';
import { RecordSort } from '../../../shared/ui/record-sort';
import { SortOption } from '../../../shared/work-queue/phone-sort';
import { stripChips } from '../../../shared/ui/strip-items';
import { FilterChips } from '../../../shared/ui/filter-chips';
import { WorkStripItem } from '../../../shared/work-queue/work-strip';
import { NumericDatePipe } from '../../../shared/ui/numeric-date';
import { IntPipe } from '../../../shared/ui/number-format';
import { Button } from 'primeng/button';

/** One skeleton bone per column, as wide as its usual content (#370: one definition of the columns for the table and its skeleton). */
const BONES: Record<string, string> = {
  name: '12rem',
  versions: '10rem',
  steps: '1.5rem',
  taskTypes: '1.5rem',
  lastPublished: '5rem',
  status: '4rem',
  actions: '1.5rem',
};

/**
 * Admin: the Workflows tab of the Workflows page (UX S16), the workflow list. Inline column filters (Name, Latest published, Draft,
 * Status with Active by default), sortable by name, server paged; state lives in the URL (`name`, `hasPublished`, `hasDraft`, `status`,
 * `taskType`, `step`, `sort`, `page`, `size`). Each row shows the latest published version and any draft in progress. Needs `Workflow.Manage` (route guard).
 */
@Component({
  selector: 'mf-workflows-list-page',
  imports: [
    NgTemplateOutlet,
    RecordGrid,
    RecordCell,
    Button,
    IntPipe,
    NumericDatePipe,
    Badge,
    ActiveBadge,
    ActionMenu,
    ConfirmDialog,
    RouterLink,
    RowLink,
    RowStop,
    Pager,
    FiltersBar,
    ColumnFilterRow,
    AssocFilter,
    RecordCardList,
    RecordCardDef,
    RecordCard,
    RecordSort,
    FilterChips,
    MfDateLongPipe,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'mf-fill' },
  styleUrls: ['../../../shared/ui/page.scss', './workflows.scss'],
  template: `
    <div class="pg-sr" role="status" aria-live="polite" data-announce>{{ announcement() }}</div>
    @if (failure()) {
      <p class="pg-alert" role="alert" data-failure>{{ failure() }}</p>
    }

    <mf-filter-chips
      label="Workflows summary"
      [strip]="true"
      [chips]="stripChipList()"
      [value]="stripActive()"
      (valueChange)="pickStrip($event)"
    />

    <mf-filters-bar [bare]="true" [filters]="filters" [clearAlso]="['q']">
      <mf-record-sort
        mfSheetSort
        [options]="sortOptions"
        [sort]="sort()"
        [defaultSort]="defaultSort"
        (sorted)="pickSort($event)"
      />
    </mf-filters-bar>

    @if (taskTypeId() !== undefined) {
      <mf-assoc-filter
        kind="task type"
        [name]="taskTypeName()"
        [count]="state() === 'ready' ? total() : null"
        [noun]="{ one: 'workflow', many: 'workflows' }"
      />
    } @else if (stepId() !== undefined) {
      <mf-assoc-filter
        kind="step"
        [name]="stepName()"
        [count]="state() === 'ready' ? total() : null"
        [noun]="{ one: 'workflow', many: 'workflows' }"
      />
    }

    @if (phone()) {
      <mf-record-card-list
        noun="workflows"
        label="Workflows"
        emptyText="No workflows yet."
        [state]="state()"
        [empty]="rows().length === 0"
        [filtered]="filters.activeCount() > 0"
        [hidden]="hiddenCount()"
        hiddenLabel="inactive"
        (retry)="load()"
        (clear)="clear()"
        (showAll)="showAll()"
      >
        <ng-template [mfRecordCard]="rows()" let-w>
          <mf-record-card
            [name]="w.name"
            [link]="['/admin/workflows', w.workflowDefinitionId]"
            [state]="leave.state()"
            [list]="listId"
            [rowKey]="w.workflowDefinitionId"
          >
            <mf-active-badge mfCardBadges [active]="w.isActive" />
            <p mfCardMeta class="rc-line" data-card-meta>
              <span class="rc-text">{{ publishedLine(w) }}</span>
            </p>
            <p mfCardMeta class="rc-line" data-card-meta>
              <span class="rc-text">{{ draftLine(w) }}</span>
            </p>
            <mf-action-menu
              mfCardAside
              [items]="menuFor(w)"
              [label]="'Actions for ' + w.name"
              [floating]="true"
            />
          </mf-record-card>
        </ng-template>
      </mf-record-card-list>
    } @else {
      <div class="mf-fill">
        <mf-record-grid
          #scroll
          data-workflows
          label="Workflows list"
          caption="Workflows"
          noun="workflows"
          [grid]="grid"
          [rows]="rows()"
          [rowKey]="workflowKey"
          [loadState]="state()"
          [empty]="rows().length === 0"
          [filtered]="filters.activeCount() > 0"
          [filters]="filters"
          emptyText="No workflows yet."
          [hidden]="hiddenCount()"
          hiddenLabel="inactive"
          [actions]="true"
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
              id="workflow-filter-row"
              [filters]="filters"
              [columns]="columns()"
            ></tr>
          }
          <p-button
            mfEmptyAction
            label="New Workflow"
            icon="pi pi-plus"
            (onClick)="newWorkflow()"
          />
          <ng-template mfCell="name" let-w>
            <td class="ad-name">
              <!-- Two lines of name, or one line of name and one of description: the row is 44 px; the full texts are the tooltips. -->
              <a
                class="mf-link pg-name"
                [class.pg-name--one]="!!w.description"
                [routerLink]="['/admin/workflows', w.workflowDefinitionId]"
                [mfRowLink]="listId"
                [rowKey]="w.workflowDefinitionId"
                [state]="leave.state()"
                [title]="w.name"
                >{{ w.name }}</a
              >
              @if (w.description) {
                <div class="pg-muted pg-clip" [title]="w.description">
                  {{ w.description }}
                </div>
              }
            </td>
          </ng-template>
          <ng-template mfCell="versions" let-w>
            <td class="ad-nowrap" data-versions>
              <span class="wl-versions">
                @if (w.publishedVersionNo) {
                  <mf-badge tone="success" icon="pi-check-circle"
                    >Published v{{ w.publishedVersionNo }}</mf-badge
                  >
                } @else {
                  <mf-badge
                    tone="neutral"
                    icon="pi-minus-circle"
                    data-not-published
                    [attr.title]="'No version is published: new tasks cannot use this workflow.'"
                    >Not Published</mf-badge
                  >
                }
                @if (w.draftVersionNo && w.draftVersionId) {
                  <!-- The badge is the way into the draft: one Tab stop, named "Open draft v3" (#377). -->
                  <a
                    class="wl-draft"
                    mfRowStop
                    data-draft-link
                    [routerLink]="[
                      '/admin/workflows',
                      w.workflowDefinitionId,
                      'versions',
                      w.draftVersionId,
                    ]"
                    [state]="leave.state()"
                    [attr.aria-label]="'Open draft v' + w.draftVersionNo"
                    [attr.title]="'Open draft v' + w.draftVersionNo"
                    (click)="leaveRow(w)"
                  >
                    <mf-badge tone="warning" icon="pi-pencil" data-draft-badge
                      >Draft v{{ w.draftVersionNo }}</mf-badge
                    >
                  </a>
                }
              </span>
            </td>
          </ng-template>
          <ng-template mfCell="steps" let-w>
            <td class="pg-num" data-steps>
              @if (stepCountOf(w); as n) {
                {{ n }}
              } @else {
                <span class="pg-muted" aria-label="No published version">&ndash;</span>
              }
            </td>
          </ng-template>
          <ng-template mfCell="taskTypes" let-w>
            <td class="pg-num" data-task-types>
              @if (w.taskTypeCount === 0) {
                <span class="pg-muted">0</span>
              } @else if (canOpenTaskTypes()) {
                <a
                  class="mf-link"
                  mfRowStop
                  data-task-types-link
                  routerLink="/admin/task-types"
                  [queryParams]="taskTypesQuery(w)"
                  [attr.aria-label]="
                    (w.taskTypeCount === 1 ? '1 task type' : w.taskTypeCount + ' task types') +
                    ' use ' +
                    w.name
                  "
                  >{{ w.taskTypeCount | mfInt }}</a
                >
              } @else {
                {{ w.taskTypeCount | mfInt }}
              }
            </td>
          </ng-template>
          <ng-template mfCell="lastPublished" let-w>
            <td class="ad-nowrap" data-last-published>
              @if (w.publishedAtUtc) {
                <span [attr.title]="w.publishedAtUtc | mfDateLong">{{
                  w.publishedAtUtc | mfNum: 'date'
                }}</span>
              } @else {
                <span class="pg-muted">&ndash;</span>
              }
            </td>
          </ng-template>
          <ng-template mfCell="status" let-w>
            <td class="ad-nowrap">
              <mf-active-badge [active]="w.isActive" />
            </td>
          </ng-template>
          <ng-template mfCell="actions" let-w>
            <td class="mf-col-actions" data-row-actions>
              <mf-action-menu
                [items]="menuFor(w)"
                [label]="'Actions for ' + w.name"
                [floating]="true"
              />
            </td>
          </ng-template>
          <div mfGridFoot>
            <ng-container *ngTemplateOutlet="pager" />
          </div>
        </mf-record-grid>
      </div>
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
    <mf-confirm-dialog
      title="Deactivate Workflow"
      confirmLabel="Deactivate Workflow"
      [danger]="true"
      [busy]="busy()"
      [error]="dialogError()"
      [(visible)]="deactivateOpen"
      (confirmed)="confirmDeactivate()"
    >
      <p>
        {{ deactivateTarget()?.name }} will no longer be offered when people create tasks. Tasks
        already running on it are not changed, and you can activate it again later.
      </p>
    </mf-confirm-dialog>
  `,
})
export class WorkflowsListPage extends ServerListPage<WorkflowSummary> {
  protected override readonly emptyOffersClear = true;
  private readonly api = inject(WorkflowsClient);
  private readonly injector = inject(Injector);
  private readonly auth = inject(AuthStore);
  private readonly notify = inject(NotificationService);
  private readonly quiet = inject(QuietRequests);
  private readonly drill = inject(DrillReturn);
  protected readonly leave = inject(AdminListLeave);
  protected readonly listId = ADMIN_LIST.workflows.id;

  protected readonly defaultSort = 'name';
  /** Below 640 px the list is cards, not a table (#375). */
  protected readonly phone = phoneCards();
  /** The columns (the shared record grid, #1241; #1203): Name is the spring, the others have fixed widths so the headings never move. */
  protected readonly gridDefs = signal<readonly RecordGridColumn[]>([
    { key: 'name', label: 'Name', locked: true, sort: 'name', minWidth: '240px' },
    { key: 'versions', label: 'Versions', width: '15rem', minWidth: '15rem' },
    {
      key: 'steps',
      label: 'Steps',
      num: true,
      width: 'var(--mf-col-count-w)',
      minWidth: 'var(--mf-col-count-w)',
    },
    {
      key: 'taskTypes',
      label: 'Task Types',
      sort: 'taskTypeCount',
      firstDesc: true,
      num: true,
      width: 'var(--mf-col-count-w)',
      minWidth: 'var(--mf-col-count-w)',
    },
    {
      key: 'lastPublished',
      label: 'Last Published',
      sort: 'publishedAtUtc',
      firstDesc: true,
      width: '9rem',
      minWidth: '9rem',
    },
    {
      key: 'status',
      label: 'Status',
      sort: 'status',
      width: 'var(--mf-col-status-w)',
      minWidth: 'var(--mf-col-status-w)',
    },
  ]);
  protected readonly grid = new RecordGridState('admin-workflows', this.gridDefs);
  protected readonly bones = BONES;
  /** The row key is the workflow id, never the name (names change): every row carries `data-record-id` (D-44m). */
  protected readonly workflowKey = (w: WorkflowSummary): number => w.workflowDefinitionId;
  /** The columns of the table in order, the row action last: what the filter row builds its cells from. */
  protected readonly columns = computed<readonly string[]>(() => [...this.grid.shown(), 'actions']);
  /** The phone's Sort by select: the sortable columns (the headers' keys). */
  protected readonly sortOptions: readonly SortOption[] = [
    { value: 'name', label: 'Name' },
    { value: 'publishedAtUtc', label: 'Last Published', descFirst: true },
    { value: 'taskTypeCount', label: 'Task Types', descFirst: true },
    { value: 'status', label: 'Status' },
  ];
  private readonly scroll = viewChild('scroll', { read: ElementRef });

  /**
   * Inline column filters: Name (`name`), Versions (one select over `hasPublished` and `hasDraft`) and Status (`status`, Active by default).
   * Besides these, `?taskType=<id>` (from a task type's Workflows chips) and `?step=<id>` (from a step's "Used in" link): no control, a removable
   * chip each, shown with a "Filtered by ..." line. The server filters (`taskTypeId`, `stepId`).
   */
  protected readonly filters: ListFilters = new ListFilters({
    screen: 'workflows',
    noun: 'workflows',
    openByDefault: true,
    sheetBelow: 640,
    visibleColumns: computed(() => (this.phone() ? null : this.columns())),
    defs: computed((): FilterDef[] => [
      { key: 'name', label: 'Name', column: 'name', type: 'text' },
      {
        // One control for the two parameters the health strip and old links use (`hasPublished`, `hasDraft`), so the cell is one labelled select.
        key: 'versions',
        label: 'Versions',
        column: 'versions',
        type: 'select',
        allLabel: 'Any',
        options: [
          { value: 'published', label: 'Published' },
          { value: 'draft', label: 'Draft in Progress' },
          { value: 'notPublished', label: 'Not Published' },
        ],
        paramMap: {
          published: { hasPublished: 'true' },
          draft: { hasDraft: 'true' },
          notPublished: { hasPublished: 'false' },
          both: { hasPublished: 'true', hasDraft: 'true' },
          noDraft: { hasDraft: 'false' },
        },
        valueLabel: (v) =>
          v === 'both'
            ? 'Published, with a draft'
            : v === 'noDraft'
              ? 'No draft'
              : v === 'other'
                ? 'Other combination'
                : v,
      },
      statusDef(),
      {
        key: 'taskType',
        label: 'Task Type',
        type: 'text',
        noControl: true,
        normalize: idOnly,
        valueLabel: () => this.taskTypeName(),
      },
      {
        key: 'step',
        label: 'Step',
        type: 'text',
        noControl: true,
        normalize: idOnly,
        valueLabel: () => this.stepName(),
      },
    ]),
  });
  protected readonly taskTypeId = computed(() => toId(this.filters.text('taskType')));
  protected readonly stepId = computed(() => toId(this.filters.text('step')));
  private readonly taskTypeTitle = signal<{ id: number; name: string } | null>(null);
  private readonly stepTitle = signal<{ id: number; name: string } | null>(null);
  protected readonly taskTypeName = computed(() => {
    const id = this.taskTypeId();
    const known = this.taskTypeTitle();
    if (known && known.id === id) return known.name;
    const fromRows = this.rows()
      .flatMap((w) => w.taskTypes)
      .find((t) => t.taskTypeId === id);
    return fromRows?.name ?? `Task type ${id}`;
  });
  protected readonly stepName = computed(() => {
    const known = this.stepTitle();
    return known && known.id === this.stepId() ? known.name : `Step ${this.stepId()}`;
  });
  protected readonly canOpenTaskTypes = computed(() => this.auth.has('TaskType.Manage'));
  /** The library-wide counts of the last answer (no filter applies to them). */
  protected readonly summary = signal<WorkflowListSummary | null>(null);
  /**
   * The health strip (#368): Published, Draft in progress, Not published and Inactive, only from the summary of the API answer (counted
   * over the whole library, whatever the filters), `--` until the first answer. A chip puts its filter in the address.
   */
  protected readonly stripItems = computed<WorkStripItem[]>(() => {
    const s = this.summary();
    return [
      { key: 'published', label: 'Published', count: s?.published ?? null },
      { key: 'draft', label: 'Draft in Progress', count: s?.draftInProgress ?? null },
      { key: 'notPublished', label: 'Not Published', count: s?.notPublished ?? null },
      { key: 'inactive', label: 'Inactive', count: s?.inactive ?? null },
    ];
  });

  /** The chip that matches the address exactly, or none. */
  protected readonly stripChipList = computed(() => stripChips(this.stripItems()));
  protected readonly stripActive = computed<string | null>(() => {
    const status = parseStatus(this.filters.text('status'));
    const versions = this.filters.text('versions');
    if (status === 'inactive') return !versions ? 'inactive' : null;
    if (status !== 'active') return null;
    return versions === 'published' || versions === 'draft' || versions === 'notPublished'
      ? versions
      : null;
  });

  /** A chip puts its filters in the address and takes the others off; the pressed chip again clears them. */
  protected pickStrip(key: string): void {
    const off = key === this.stripActive();
    this.navigate({
      status: !off && key === 'inactive' ? 'inactive' : null,
      hasPublished: off
        ? null
        : key === 'published'
          ? 'true'
          : key === 'notPublished'
            ? 'false'
            : null,
      hasDraft: !off && key === 'draft' ? 'true' : null,
      page: null,
    });
    const item = this.stripItems().find((i) => i.key === key);
    this.announcement.set(
      off ? 'Showing all active workflows.' : `${item?.label}: ${item?.count ?? 0} workflows.`,
    );
  }

  protected readonly busy = signal(false);
  protected readonly failure = signal('');
  protected readonly announcement = signal('');
  protected readonly deactivateOpen = signal(false);
  /** Why Deactivate failed, shown inside the dialog that stays open (#414). */
  protected readonly dialogError = signal('');
  protected readonly deactivateTarget = signal<WorkflowSummary | null>(null);
  /** The empty list's own New button (the same action as the page header's, spec 15.3). */
  protected newWorkflow(): void {
    void this.router.navigateByUrl('/admin/workflows/new');
  }

  /** The row menu of every row (#355): Open draft (a workflow that has one), then Deactivate or Activate. The page needs Workflow.Manage. */
  private readonly menus = computed(
    () => new Map(this.rows().map((w) => [w.workflowDefinitionId, this.menuOf(w)] as const)),
  );

  constructor() {
    super();
    AdminShellFilters.register({ filters: this.filters, controls: 'workflow-filter-row' });
    const report = AdminCounts.report('workflows');
    effect(() => report(this.summary()?.active));
    // Back (or a breadcrumb) from a record puts focus on the name link of the row that was left (#354).
    // "Skip to table" is the first Tab stop; a row has two stops, the name and its menu (#413).
    registerTableSkip({ rowLinks: true });
    restoreRowFocus(this.listId, () => this.state() === 'ready');
    // The controls move into the sheet while the grid scrolls sideways (the grid is not there while the phone shows cards).
    effect(() => {
      const area = this.scroll()?.nativeElement as HTMLElement | undefined;
      if (area) untracked(() => this.filters.watchOverflow(area));
    });
    // The names of the filter chips ("Task type: Data Processing"); the id stands in when the record cannot be read.
    effect(() => {
      const id = this.taskTypeId();
      untracked(() => {
        // The task type is read with Task.View or TaskType.Manage; a Workflow.Manage-only person gets the id (no request that would be refused).
        if (id === undefined || this.taskTypeTitle()?.id === id) return;
        if (!this.auth.hasAny(['TaskType.Manage', 'Task.View'])) return;
        void firstValueFrom(this.injector.get(TaskTypesClient).getTaskType(id))
          .then((t) => this.taskTypeTitle.set({ id, name: t.name }))
          .catch(() => undefined);
      });
    });
    effect(() => {
      const id = this.stepId();
      untracked(() => {
        if (id === undefined || this.stepTitle()?.id === id) return;
        void firstValueFrom(this.injector.get(StepDefinitionsClient).getStepDefinition(id))
          .then((s) => this.stepTitle.set({ id, name: s.title }))
          .catch(() => undefined);
      });
    });
  }

  protected override listFilters() {
    return this.filters;
  }

  /** The Task Types tab limited to a workflow (`?workflow=<id>`). */
  protected taskTypesQuery(w: WorkflowSummary): Record<string, number> {
    return { workflow: w.workflowDefinitionId };
  }

  /** The number of steps of the latest publication (the Steps column); 0 when the workflow was never published. */
  protected stepCountOf(w: WorkflowSummary): number {
    return w.stepCount ?? w.publishedStepCount ?? 0;
  }

  /** The draft link of a row leaves the row like the name link does: Back puts focus on the name again (#354). */
  protected leaveRow(w: WorkflowSummary): void {
    this.drill.leaveRow(this.listId, w.workflowDefinitionId);
  }

  private menuOf(w: WorkflowSummary): MenuAction[] {
    const busy = this.busy();
    const items: MenuAction[] = [];
    if (w.draftVersionId !== undefined && w.draftVersionId !== null) {
      const draft = w.draftVersionId;
      items.push({
        id: 'open-draft',
        label: `Open draft v${w.draftVersionNo}`,
        icon: 'pi-pencil',
        run: () => {
          this.drill.leaveRow(this.listId, w.workflowDefinitionId);
          void this.router.navigate(
            ['/admin/workflows', w.workflowDefinitionId, 'versions', draft],
            {
              state: this.leave.state(),
            },
          );
        },
      });
    }
    items.push(
      w.isActive
        ? {
            id: 'deactivate',
            label: 'Deactivate',
            icon: 'pi-ban',
            danger: true,
            separated: items.length > 0,
            disabled: busy,
            run: () => {
              this.deactivateTarget.set(w);
              this.dialogError.set('');
              this.deactivateOpen.set(true);
            },
          }
        : {
            id: 'activate',
            label: 'Activate',
            icon: 'pi-check-circle',
            separated: items.length > 0,
            disabled: busy,
            run: () => void this.setActive(w, true),
          },
    );
    return items;
  }

  protected menuFor(w: WorkflowSummary): readonly MenuAction[] {
    return this.menus().get(w.workflowDefinitionId) ?? [];
  }

  protected async confirmDeactivate(): Promise<void> {
    const w = this.deactivateTarget();
    const outcome = w ? await this.setActive(w, false) : 'done';
    // A failure keeps the dialog open with its message and focus on its button (#414); a conflict reloaded the list, so the question is stale.
    if (outcome !== 'failed') this.deactivateOpen.set(false);
  }

  private async setActive(
    w: WorkflowSummary,
    isActive: boolean,
  ): Promise<'done' | 'conflict' | 'failed'> {
    this.busy.set(true);
    this.failure.set('');
    this.dialogError.set('');
    try {
      await firstValueFrom(
        this.api.updateWorkflow(w.workflowDefinitionId, {
          name: w.name,
          description: w.description,
          isActive,
          rowVersion: w.rowVersion,
        }),
      );
      this.announcement.set(`${w.name} ${isActive ? 'activated' : 'deactivated'}.`);
      this.notify.success(isActive ? 'Workflow activated' : 'Workflow deactivated', w.name);
      await this.load();
      focusListAfterAction(this.injector, `Actions for ${w.name}`);
      return 'done';
    } catch (e) {
      if (e instanceof ApiError && e.code === 'CONCURRENCY_CONFLICT') {
        this.failure.set('Someone else changed this workflow. The list was reloaded; try again.');
        await this.load();
        return 'conflict';
      }
      const message = e instanceof ApiError ? e.message : 'Couldn’t save. Try again.';
      if (this.deactivateOpen()) this.dialogError.set(message);
      else this.failure.set(message);
      return 'failed';
    } finally {
      this.busy.set(false);
    }
  }

  /** The first fact line of a card: the latest published version and its steps. */
  protected publishedLine(w: WorkflowSummary): string {
    return w.publishedVersionNo
      ? `Published v${w.publishedVersionNo} (${this.stepsLabel(w.publishedStepCount)})`
      : 'Not Published';
  }

  /** The second fact line of a card: the draft in progress and how many task types may use the workflow. */
  protected draftLine(w: WorkflowSummary): string {
    const types = w.taskTypeCount;
    const used = types === 0 ? 'No task type' : types === 1 ? '1 task type' : `${types} task types`;
    return w.draftVersionNo ? `Draft v${w.draftVersionNo} - ${used}` : used;
  }

  protected stepsLabel(count: number | undefined): string {
    return count === 1 ? '1 step' : `${count ?? 0} steps`;
  }

  protected override async fetch() {
    const page = await this.list(
      isActiveParam(parseStatus(this.filters.text('status'))),
      this.pageNumber(),
      this.pageSize(),
    );
    // The library-wide counts of the answer: the tab's count (#364) and, later, the health strip.
    this.summary.set(page.summary ?? null);
    return page;
  }

  /** The inactive workflows the default Active hides, under the same filters (#369, one row, no API change). */
  protected override fetchHidden() {
    // A background request: its failure is no reason for a toast, the list shows its own message.
    return parseStatus(this.filters.text('status')) === 'active'
      ? this.quiet.run(() => this.list(false, 1, 1))
      : null;
  }

  private list(isActive: boolean | undefined, page: number, size: number) {
    return firstValueFrom(
      this.api.listWorkflows(
        this.sort() || undefined,
        undefined,
        this.filters.text('name') || undefined,
        isActive,
        triBool(this.filters.params().get('hasPublished') ?? ''),
        triBool(this.filters.params().get('hasDraft') ?? ''),
        this.taskTypeId(),
        this.stepId(),
        page,
        size,
      ),
    );
  }
}

/** A positive whole number from the address, or undefined. */
function toId(value: string): number | undefined {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : undefined;
}

function idOnly(value: string): string | null {
  return /^\d{1,9}$/.test(value) ? value : null;
}
