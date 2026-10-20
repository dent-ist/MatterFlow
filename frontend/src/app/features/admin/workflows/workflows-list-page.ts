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
import { SortHeader } from '../../../shared/ui/data-table';
import { isActiveParam, parseStatus } from '../../../shared/ui/list-helpers';
import { ServerListPage } from '../../../shared/ui/list-query';
import { RowLink, restoreRowFocus } from '../../../shared/ui/row-nav';
import { DrillReturn } from '../../../shared/work-queue/drill';
import { ADMIN_LIST, AdminListLeave } from '../list-return';
import { ScrollArea } from '../../../shared/ui/fixed-page';
import { GridBody } from '../../../shared/ui/grid-body';
import { MfDatePipe } from '../../../shared/pipes/mf-date.pipe';
import { Pager } from '../../../shared/ui/pager';
import {
  RecordCard,
  RecordCardDef,
  RecordCardList,
  phoneCards,
} from '../../../shared/ui/record-card-list';
import { RecordSort } from '../../../shared/ui/record-sort';
import { viewportAtLeast } from '../../../shared/ui/viewport';
import { SortOption } from '../../../shared/work-queue/phone-sort';
import { WorkStrip, WorkStripItem } from '../../../shared/work-queue/work-strip';

/** The columns of the grid, in order; the keys the filter definitions point at. */
const COLUMNS = [
  'name',
  'versions',
  'steps',
  'taskTypes',
  'lastPublished',
  'status',
  'actions',
] as const;

/** One skeleton bone per column, as wide as its usual content (#370: one definition of the columns for the table and its skeleton). */
const BONES: Record<(typeof COLUMNS)[number], string> = {
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
    ScrollArea,
    Badge,
    ActiveBadge,
    ActionMenu,
    ConfirmDialog,
    RouterLink,
    RowLink,
    Pager,
    SortHeader,
    GridBody,
    FiltersBar,
    ColumnFilterRow,
    AssocFilter,
    RecordCardList,
    RecordCardDef,
    RecordCard,
    RecordSort,
    WorkStrip,
    MfDatePipe,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'mf-fill' },
  styleUrls: ['../../../shared/ui/page.scss', './workflows.scss'],
  template: `
    <div class="pg-sr" role="status" aria-live="polite" data-announce>{{ announcement() }}</div>
    @if (failure()) {
      <p class="pg-alert" role="alert" data-failure>{{ failure() }}</p>
    }

    <mf-work-strip
      label="Workflows summary"
      [items]="stripItems()"
      [interactive]="true"
      [active]="stripActive()"
      (pick)="pickStrip($event)"
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
        emptyText="No workflows yet. Use New workflow above to add the first one."
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
      <div class="mf-table-wrap" mfScrollArea="Workflows list" #scroll>
        <div class="mf-scroll">
          <table class="pg-table mf-has-menu" data-workflows>
            <caption class="pg-sr">
              Workflows
            </caption>
            <thead>
              <tr>
                <th
                  mfSort="name"
                  [sort]="sort()"
                  [defaultSort]="defaultSort"
                  (sorted)="setSort($event)"
                >
                  Name
                </th>
                <th scope="col">Versions</th>
                @if (stepsShown()) {
                  <th scope="col" class="pg-num">Steps</th>
                }
                @if (taskTypesShown()) {
                  <th
                    class="pg-num"
                    mfSort="taskTypeCount"
                    [firstDesc]="true"
                    [sort]="sort()"
                    [defaultSort]="defaultSort"
                    (sorted)="setSort($event)"
                  >
                    Task types
                  </th>
                }
                @if (publishedShown()) {
                  <th
                    mfSort="publishedAtUtc"
                    [firstDesc]="true"
                    [sort]="sort()"
                    [defaultSort]="defaultSort"
                    (sorted)="setSort($event)"
                  >
                    Last published
                  </th>
                }
                <th
                  mfSort="status"
                  [sort]="sort()"
                  [defaultSort]="defaultSort"
                  (sorted)="setSort($event)"
                >
                  Status
                </th>
                <th scope="col" class="mf-col-menu"><span class="pg-sr">Actions</span></th>
              </tr>
              @if (filters.rowVisible()) {
                <tr
                  mfColumnFilterRow
                  id="workflow-filter-row"
                  [filters]="filters"
                  [columns]="columns()"
                ></tr>
              }
            </thead>
            <tbody
              mfGridBody
              noun="workflows"
              emptyText="No workflows yet. Use New workflow above to add the first one."
              [state]="state()"
              [empty]="rows().length === 0"
              [filtered]="filters.activeCount() > 0"
              [columns]="columns().length"
              [skeleton]="skeleton()"
              [skeletonCells]="skeletonCells()"
              (retry)="load()"
              (clear)="clear()"
              [hidden]="hiddenCount()"
              hiddenLabel="inactive"
              (showAll)="showAll()"
            >
              @for (w of rows(); track w.workflowDefinitionId) {
                <tr [attr.data-row]="w.name">
                  <td class="ad-name">
                    <!-- Two lines of name, or one line of name and one of description: the row is 44 px; the full texts are the tooltips. -->
                    <a
                      class="pg-link pg-name"
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
                          >Not published</mf-badge
                        >
                      }
                      @if (w.draftVersionNo && w.draftVersionId) {
                        <!-- The badge is the way into the draft: one Tab stop, named "Open draft v3" (#377). -->
                        <a
                          class="wl-draft"
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
                  @if (stepsShown()) {
                    <td class="pg-num" data-steps>
                      @if (stepCountOf(w); as n) {
                        {{ n }}
                      } @else {
                        <span class="pg-muted" aria-label="No published version">&ndash;</span>
                      }
                    </td>
                  }
                  @if (taskTypesShown()) {
                    <td class="pg-num" data-task-types>
                      @if (w.taskTypeCount === 0) {
                        <span class="pg-muted">0</span>
                      } @else if (canOpenTaskTypes()) {
                        <a
                          class="pg-link"
                          data-task-types-link
                          routerLink="/admin/task-types"
                          [queryParams]="taskTypesQuery(w)"
                          [attr.aria-label]="
                            (w.taskTypeCount === 1
                              ? '1 task type'
                              : w.taskTypeCount + ' task types') +
                            ' use ' +
                            w.name
                          "
                          >{{ w.taskTypeCount }}</a
                        >
                      } @else {
                        {{ w.taskTypeCount }}
                      }
                    </td>
                  }
                  @if (publishedShown()) {
                    <td class="ad-nowrap" data-last-published>
                      @if (w.publishedAtUtc) {
                        <span [attr.title]="w.publishedAtUtc | mfDate">{{
                          w.publishedAtUtc | mfDate: 'date'
                        }}</span>
                      } @else {
                        <span class="pg-muted">&ndash;</span>
                      }
                    </td>
                  }
                  <td class="ad-nowrap">
                    <mf-active-badge [active]="w.isActive" />
                  </td>
                  <td class="mf-col-menu">
                    <mf-action-menu
                      [items]="menuFor(w)"
                      [label]="'Actions for ' + w.name"
                      [floating]="true"
                    />
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
    <mf-confirm-dialog
      title="Deactivate workflow?"
      confirmLabel="Deactivate workflow"
      cancelLabel="Keep active"
      [danger]="true"
      [busy]="busy()"
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
  /**
   * The optional columns drop in a fixed order as the window narrows, so the grid never scrolls sideways and the row menu stays in view
   * (#375): Last published below 1280 px, Task types (the count) below 1100 px, Steps below 900 px; Name, Versions and Status stay.
   */
  private readonly stepsRoom = viewportAtLeast(900);
  private readonly taskTypesRoom = viewportAtLeast(1100);
  private readonly publishedRoom = viewportAtLeast(1280);
  protected readonly stepsShown = this.stepsRoom;
  protected readonly taskTypesShown = this.taskTypesRoom;
  protected readonly publishedShown = this.publishedRoom;
  protected readonly columns = computed<readonly string[]>(() =>
    COLUMNS.filter(
      (c) =>
        (c !== 'steps' || this.stepsRoom()) &&
        (c !== 'taskTypes' || this.taskTypesRoom()) &&
        (c !== 'lastPublished' || this.publishedRoom()),
    ),
  );
  protected readonly skeleton = computed(() =>
    this.columns().map((c) => BONES[c as keyof typeof BONES]),
  );
  /** The class of each loaded cell that sizes it, for the skeleton cells (#370). */
  protected readonly skeletonCells = computed(() =>
    this.columns().map((c) =>
      c === 'name' ? 'ad-name' : c === 'actions' ? 'mf-col-menu' : 'ad-nowrap',
    ),
  );
  /** The phone's Sort by select: the sortable columns (the headers' keys). */
  protected readonly sortOptions: readonly SortOption[] = [
    { value: 'name', label: 'Name' },
    { value: 'publishedAtUtc', label: 'Last published', descFirst: true },
    { value: 'taskTypeCount', label: 'Task types', descFirst: true },
    { value: 'status', label: 'Status' },
  ];
  private readonly scroll = viewChild<ElementRef<HTMLElement>>('scroll');

  /**
   * Inline column filters: Name (`name`), Latest published (`hasPublished`), Draft (`hasDraft`) and Status (`status`, Active by default).
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
        key: 'hasPublished',
        label: 'Latest published',
        column: 'versions',
        type: 'triState',
        options: [
          { value: '', label: 'Any' },
          { value: 'true', label: 'Published' },
          { value: 'false', label: 'Not published' },
        ],
      },
      {
        key: 'hasDraft',
        label: 'Draft',
        column: 'versions',
        type: 'triState',
        options: [
          { value: '', label: 'Any' },
          { value: 'true', label: 'Has a draft' },
          { value: 'false', label: 'No draft' },
        ],
      },
      statusDef(),
      {
        key: 'taskType',
        label: 'Task type',
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
      { key: 'draft', label: 'Draft in progress', count: s?.draftInProgress ?? null },
      { key: 'notPublished', label: 'Not published', count: s?.notPublished ?? null },
      { key: 'inactive', label: 'Inactive', count: s?.inactive ?? null },
    ];
  });

  /** The chip that matches the address exactly, or none. */
  protected readonly stripActive = computed<string | null>(() => {
    const status = parseStatus(this.filters.text('status'));
    const published = this.filters.text('hasPublished');
    const draft = this.filters.text('hasDraft');
    if (status === 'inactive') return !published && !draft ? 'inactive' : null;
    if (status !== 'active') return null;
    if (published === 'true' && !draft) return 'published';
    if (draft === 'true' && !published) return 'draft';
    return published === 'false' && !draft ? 'notPublished' : null;
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
  protected readonly deactivateTarget = signal<WorkflowSummary | null>(null);
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
    restoreRowFocus(this.listId, () => this.state() === 'ready');
    // The controls move into the sheet while the grid scrolls sideways (the grid is not there while the phone shows cards).
    effect(() => {
      const area = this.scroll()?.nativeElement;
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
    this.deactivateOpen.set(false);
    if (w) await this.setActive(w, false);
  }

  private async setActive(w: WorkflowSummary, isActive: boolean): Promise<void> {
    this.busy.set(true);
    this.failure.set('');
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
      this.notify.success('Saved.');
      await this.load();
    } catch (e) {
      if (e instanceof ApiError && e.code === 'CONCURRENCY_CONFLICT') {
        this.failure.set('Someone else changed this workflow. The list was reloaded; try again.');
        await this.load();
      } else {
        this.failure.set(e instanceof ApiError ? e.message : 'Couldn’t save. Try again.');
      }
    } finally {
      this.busy.set(false);
    }
  }

  /** The first fact line of a card: the latest published version and its steps. */
  protected publishedLine(w: WorkflowSummary): string {
    return w.publishedVersionNo
      ? `Published v${w.publishedVersionNo} (${this.stepsLabel(w.publishedStepCount)})`
      : 'Not published';
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
        triBool(this.filters.text('hasPublished')),
        triBool(this.filters.text('hasDraft')),
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
