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
import { FormVersionStatus } from '../../../api/generated/api-client';
import { AuthStore } from '../../../core/auth/auth.store';
import { ApiError } from '../../../core/http/api-error';
import { WorkflowLookup, WorkflowOption } from '../../../core/lookups/workflow-lookup';
import { NotificationService } from '../../../core/notify/notification.service';
import { TaskTypeView, TaskTypesApi } from './task-types-api';
import { ActiveBadge, Badge } from '../../../shared/ui/badge';
import { ActionMenu, MenuAction } from '../../../shared/ui/action-menu';
import { ConfirmDialog } from '../../../shared/ui/confirm-dialog';
import { SortHeader } from '../../../shared/ui/data-table';
import { LocalListPage } from '../../../shared/ui/list-query';
import { focusListAfterAction } from '../after-action';
import { RowLink, RowStop, registerTableSkip, restoreRowFocus } from '../../../shared/ui/row-nav';
import { DrillReturn } from '../../../shared/work-queue/drill';
import { ADMIN_LIST, AdminListLeave } from '../list-return';
import { ScrollArea } from '../../../shared/ui/fixed-page';
import { AdminColumn, adminListState } from '../../../shared/ui/admin-list-state';
import { GridBody } from '../../../shared/ui/grid-body';
import { StripDef, stripActiveKey, stripItems, stripPick } from '../../../shared/ui/strip-items';
import { ColumnFilterRow } from '../../../shared/filters/column-filter-row';
import { statusDef } from '../../../shared/filters/common-defs';
import { FilterDef } from '../../../shared/filters/filter-def';
import { FiltersBar } from '../../../shared/filters/filters-bar';
import { ListFilters } from '../../../shared/filters/list-filters';
import { AdminCounts } from './admin-counts';
import { AdminShellFilters } from './shell-filters';
import { AssocFilter } from '../assoc-filter';
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
import { TaskCount } from '../../../shared/ui/task-count';
import { DIALOG_COPY, impactLine, listNames } from '../shared/dialog-copy';
import { WorkStrip, WorkStripItem } from '../../../shared/work-queue/work-strip';
import { parseStatus } from '../../../shared/ui/list-helpers';
import { TaskTypeIcon } from '../../../shared/icons/task-type-icon';

/** The columns of the grid, in order; the keys the filter definitions point at. */
const COLUMNS = [
  'name',
  'defaultWorkflow',
  'form',
  'workflows',
  'openTasks',
  'status',
  'actions',
] as const;

/**
 * The skeleton rows of the loading state: one bone per column, as wide as the column's usual content, so the table that replaces them
 * keeps its shape (#370: one definition of the columns for the table and its skeleton).
 */
const BONES: Record<(typeof COLUMNS)[number], string> = {
  name: '12rem',
  defaultWorkflow: '9rem',
  form: '5rem',
  workflows: '1.5rem',
  openTasks: '1.5rem',
  status: '4rem',
  actions: '1.5rem',
};

/** The class of each loaded cell that sizes it, repeated on its skeleton cell (#370). */
const SKELETON_CELL: Record<(typeof COLUMNS)[number], string> = {
  name: 'tt-namecell',
  defaultWorkflow: '',
  form: 'tt-nowrap',
  workflows: 'num',
  openTasks: 'num',
  status: 'tt-nowrap',
  actions: 'mf-col-actions mf-col-menu',
};

/** Request form filter values (the `form` parameter) and the form statuses they match. */
const FORM_OPTIONS = [
  { value: 'published', label: 'Published' },
  { value: 'draft', label: 'Draft' },
  { value: 'retired', label: 'Retired' },
  { value: 'none', label: 'No form' },
] as const;

/**
 * Admin: the Task Types tab of the Task Types page (UX S14). Name, request form status and the Workflows column: the eligible workflows
 * as chips linking to the workflow (the default one with a star and the text "default", three chips and then "+n more"; a type with
 * none says "No workflow"), plus a warning chip for types users can not create Tasks of. `?workflow=<id>` limits the list to the types
 * a workflow is eligible for (a removable chip). A Task Type is never deleted, only deactivated (and reactivated). Needs
 * `TaskType.Manage` (the page offers the tab to people who hold it).
 */
@Component({
  selector: 'mf-task-types-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'mf-fill' },
  imports: [
    ScrollArea,
    ConfirmDialog,
    ActiveBadge,
    Badge,
    ActionMenu,
    RouterLink,
    RowLink,
    RowStop,
    Pager,
    SortHeader,
    GridBody,
    FiltersBar,
    ColumnFilterRow,
    TaskTypeIcon,
    AssocFilter,
    RecordCardList,
    RecordCardDef,
    RecordCard,
    RecordSort,
    WorkStrip,
    TaskCount,
  ],
  templateUrl: './task-types-page.html',
  styleUrls: ['../admin-lookup.scss', './task-types-page.scss'],
})
export class TaskTypesPage extends LocalListPage<TaskTypeView> {
  private readonly api = inject(TaskTypesApi);
  private readonly workflows = inject(WorkflowLookup);
  private readonly notify = inject(NotificationService);
  private readonly auth = inject(AuthStore);
  private readonly drill = inject(DrillReturn);
  private readonly injector = inject(Injector);
  protected readonly leave = inject(AdminListLeave);
  protected readonly listId = ADMIN_LIST.taskTypes.id;

  protected readonly defaultSort = 'name';
  protected readonly workflowOptions = signal<ReadonlyMap<number, WorkflowOption>>(new Map());
  protected readonly workflowNames = computed<ReadonlyMap<number, string>>(
    () => new Map([...this.workflowOptions()].map(([id, w]) => [id, w.name])),
  );

  private readonly scroll = viewChild<ElementRef<HTMLElement>>('scroll');
  /** Below 640 px the list is cards, not a table (#374). */
  protected readonly phone = phoneCards();
  /**
   * The optional columns drop in a fixed order as the window narrows, so the grid never scrolls sideways and the row menu stays in view
   * (#374): Open tasks below 1280 px, Workflows (the count) below 1100 px, then Request form below 900 px; Name, Default workflow and
   * Status stay. The open Task count is null in the API without Task.View, so that column is not there for a person without it.
   */
  private readonly formRoom = viewportAtLeast(900);
  private readonly workflowsRoom = viewportAtLeast(1100);
  private readonly tasksRoom = viewportAtLeast(1280);
  protected readonly canViewTasks = computed(() => this.auth.has('Task.View'));
  protected readonly formRoomShown = this.formRoom;
  protected readonly workflowsShown = this.workflowsRoom;
  protected readonly tasksShown = computed(() => this.tasksRoom() && this.canViewTasks());
  protected readonly columns = computed<readonly string[]>(() =>
    COLUMNS.filter(
      (c) =>
        (c !== 'form' || this.formRoom()) &&
        (c !== 'workflows' || this.workflowsRoom()) &&
        (c !== 'openTasks' || this.tasksShown()),
    ),
  );
  /** The real columns for the skeleton (#370, #575): the bone and the sizing class of each shown column. */
  protected readonly columnSpec = computed<readonly AdminColumn[]>(() =>
    this.columns().map((c) => ({
      bone: BONES[c as keyof typeof BONES],
      cls: SKELETON_CELL[c as keyof typeof SKELETON_CELL],
    })),
  );
  /** The phone's Sort by select: the sortable columns (the headers' keys). */
  protected readonly sortOptions: readonly SortOption[] = [
    { value: 'name', label: 'Name' },
    { value: 'defaultWorkflow', label: 'Default workflow' },
    { value: 'form', label: 'Request form' },
    { value: 'workflows', label: 'Workflows' },
    { value: 'openTasks', label: 'Open tasks', descFirst: true },
    { value: 'status', label: 'Status' },
  ];

  /**
   * Inline column filters: Name (`name`), Request form (`form`) and Status (`status`, Active by default), all applied here because the
   * list loads whole. `?workflow=<id>` (a link from a workflow's page or the Workflows tab) has no control: a removable chip, and the
   * server limits the list to the types that workflow is eligible for.
   */
  protected readonly filters: ListFilters = new ListFilters({
    screen: 'task-types',
    noun: 'task types',
    openByDefault: true,
    sheetBelow: 640,
    visibleColumns: computed(() => (this.phone() ? null : this.columns())),
    defs: computed((): FilterDef[] => [
      { key: 'name', label: 'Name', column: 'name', type: 'text' },
      {
        key: 'form',
        label: 'Request form',
        column: 'form',
        type: 'select',
        allLabel: 'All forms',
        options: FORM_OPTIONS,
      },
      statusDef(),
      {
        // The health strip's "Not usable" (#367): no control, a removable chip.
        key: 'usable',
        label: 'Can create tasks',
        type: 'text',
        noControl: true,
        normalize: (v) => (v === 'no' ? v : null),
        valueLabel: () => 'No',
      },
      {
        key: 'workflow',
        label: 'Workflow',
        type: 'text',
        noControl: true,
        normalize: (v) => (/^\d{1,9}$/.test(v) ? v : null),
        valueLabel: (v) => this.workflowName(Number(v)),
      },
    ]),
  });
  /** The four list states of the table and of the cards, derived once (#575). */
  protected readonly ls = adminListState({
    state: this.state,
    rows: this.rows,
    filters: this.filters,
    hidden: this.hiddenCount,
  });
  protected readonly workflowId = computed<number | undefined>(() => {
    const id = Number(this.filters.text('workflow'));
    return Number.isInteger(id) && id > 0 ? id : undefined;
  });
  /** People without Workflow.Manage cannot open a workflow page: the chips are plain text for them. */
  protected readonly canOpenWorkflows = computed(() => this.auth.has('Workflow.Manage'));
  /** The row menu of every row (#355): Edit form, then Deactivate or Activate. The page needs TaskType.Manage, which both need. */
  protected readonly menus = computed(
    () => new Map(this.all().map((t) => [t.id, this.menuOf(t)] as const)),
  );
  protected readonly busy = signal(false);
  protected readonly failure = signal('');
  protected readonly announcement = signal('');
  protected readonly deactivateOpen = signal(false);
  /** Why Deactivate failed, shown inside the dialog that stays open (#414). */
  protected readonly dialogError = signal('');
  protected readonly deactivateTarget = signal<TaskTypeView | null>(null);
  protected readonly deactivateCopy = DIALOG_COPY.deactivateTaskType;

  /**
   * The active workflows that would be left without an active task type if the one in the dialog went (#379), from the list that is
   * loaded. A list limited to a workflow (`?workflow=`) is not the whole set, so nothing is claimed then.
   */
  private readonly workflowsLeftBare = computed<string[]>(() => {
    const t = this.deactivateTarget();
    if (!t || this.workflowId() !== undefined) return [];
    const others = this.all().filter((o) => o.id !== t.id && o.isActive);
    return t.eligibleWorkflowIds
      .filter(
        (id) =>
          this.workflowOptions().get(id)?.isActive !== false &&
          !others.some((o) => o.eligibleWorkflowIds.includes(id)),
      )
      .map((id) => this.workflowName(id))
      .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
  });

  /** What the Deactivate dialog adds to its first sentence: the open tasks that keep the type and the workflows left bare. */
  protected readonly deactivateImpact = computed(() => {
    const t = this.deactivateTarget();
    const impact = impactLine('deactivateTaskType', {
      openTasks: t?.openTaskCount ?? null,
      names: this.workflowsLeftBare(),
    });
    return { text: impact.text, names: listNames(impact.names) };
  });

  constructor() {
    super();
    AdminShellFilters.register({ filters: this.filters, controls: 'task-type-filter-row' });
    // The tab's count is the number of active types; a list limited to a workflow (?workflow=) is not the whole set and reports nothing.
    const report = AdminCounts.report('task-types');
    effect(() => {
      if (this.state() === 'ready' && this.workflowId() === undefined) {
        report(this.all().filter((t) => t.isActive).length);
      }
    });
    // Back (or a breadcrumb) from a record puts focus on the name link of the row that was left (#354).
    // "Skip to table" is the first Tab stop; a row has two stops, the name and its menu (#413).
    registerTableSkip({ rowLinks: true });
    restoreRowFocus(this.listId, () => this.state() === 'ready');
    // Loads the list, and again when the workflow filter changes.
    effect(() => {
      this.workflowId();
      untracked(() => void this.load());
    });
    // The controls move into the sheet while the grid scrolls sideways (the grid is not there while the phone shows cards).
    effect(() => {
      const area = this.scroll()?.nativeElement;
      if (area) untracked(() => this.filters.watchOverflow(area));
    });
  }

  protected override listFilters() {
    return this.filters;
  }

  protected override matchesFilters(t: TaskTypeView): boolean {
    const name = this.filters.text('name').trim().toLowerCase();
    if (name && !t.name.toLowerCase().includes(name)) return false;
    if (this.filters.text('usable') === 'no' && !this.isNotUsable(t)) return false;
    const form = this.filters.text('form');
    return !form || this.formKey(t) === form;
  }

  /** An active type users cannot create tasks of (the red line of its row, the "Not usable" of the strip). */
  private isNotUsable(t: TaskTypeView): boolean {
    return t.isActive && t.usabilityIssues.some((i) => i !== 'INACTIVE');
  }

  /**
   * The health strip (#367): Active, Not usable, Form in draft, Inactive, counted over the whole list (no filter applies) in the browser,
   * where it is loaded whole. The chips are toggles that put the matching filters in the address (the kit's `stripItems`, #581).
   */
  private readonly stripDefs: readonly StripDef<TaskTypeView>[] = [
    { key: 'active', label: 'Active', matches: (t) => t.isActive, params: { status: null } },
    {
      key: 'notUsable',
      label: 'Not usable',
      hint: "Active task types users can't create tasks of",
      matches: (t) => this.isNotUsable(t),
      params: { status: null, usable: 'no' },
    },
    {
      key: 'formDraft',
      label: 'Form in draft',
      hint: 'Active task types whose request form is a draft',
      matches: (t) => t.isActive && this.formKey(t) === 'draft',
      params: { status: null, form: 'draft' },
    },
    {
      key: 'inactive',
      label: 'Inactive',
      matches: (t) => !t.isActive,
      params: { status: 'inactive' },
    },
  ];
  protected readonly stripItems = computed<WorkStripItem[]>(() =>
    stripItems(this.state() === 'ready' ? this.all() : null, this.stripDefs),
  );

  /** The chip that matches the address exactly (the one the list shows), or none when the filters are something else. */
  protected readonly stripActive = computed<string | null>(() =>
    stripActiveKey(this.stripDefs, (p) => {
      if (p !== 'status') return this.filters.text(p) || null;
      const status = parseStatus(this.filters.text('status'));
      return status === 'active' ? null : status;
    }),
  );

  /** A chip puts its filters in the address and takes the others off; the pressed chip again goes back to Active. */
  protected pickStrip(key: string): void {
    const to = stripPick(this.stripDefs, key, this.stripActive());
    if (!to) return;
    this.navigate({ ...to.params, page: null });
    const item = this.stripItems().find((i) => i.key === to.key);
    if (item) this.announcement.set(`${item.label}: ${item.count ?? 0} task types.`);
  }

  private formKey(t: TaskTypeView): string {
    switch (t.formStatus) {
      case FormVersionStatus.Published:
        return 'published';
      case FormVersionStatus.Draft:
        return 'draft';
      case FormVersionStatus.Retired:
        return 'retired';
      default:
        return 'none';
    }
  }

  protected override searchText(t: TaskTypeView): string {
    return `${t.name} ${t.description ?? ''}`;
  }

  protected override isActiveRow(t: TaskTypeView): boolean {
    return t.isActive;
  }

  protected override sortValue(t: TaskTypeView, field: string): string | number {
    switch (field) {
      case 'form':
        return this.formStatus(t);
      case 'defaultWorkflow':
        return this.defaultWorkflowName(t);
      case 'workflows':
        return t.eligibleWorkflowIds.length;
      case 'openTasks':
        return t.openTaskCount ?? 0;
      case 'status':
        return t.isActive ? 'Active' : 'Inactive';
      default:
        return t.name;
    }
  }

  protected async load(): Promise<void> {
    this.state.set('loading');
    try {
      const [rows, workflows] = await Promise.all([
        firstValueFrom(this.api.list(this.workflowId())),
        // Names are a nicety: without Workflow.Manage the chips fall back to "Workflow 7" and are not links.
        firstValueFrom(this.workflows.list()).catch((): WorkflowOption[] => []),
      ]);
      this.all.set(rows);
      this.workflowOptions.set(new Map(workflows.map((w) => [w.id, w])));
      this.state.set('ready');
    } catch {
      this.state.set('error');
    }
  }

  /** The facts line of a card: `Published v1 - Quick Request +1` (the form, then the default workflow and how many more may be used). */
  protected cardLine(t: TaskTypeView): string {
    const form = [this.formStatus(t), this.formVersion(t)].filter(Boolean).join(' ');
    const ids = t.eligibleWorkflowIds;
    if (ids.length === 0) return `${form} - No workflow`;
    const name = this.workflowName(t.defaultWorkflowDefinitionId ?? ids[0]);
    return `${form} - ${name}${ids.length > 1 ? ` +${ids.length - 1}` : ''}`;
  }

  protected formStatus(t: TaskTypeView): string {
    switch (t.formStatus) {
      case FormVersionStatus.Published:
        return 'Published';
      case FormVersionStatus.Draft:
        return 'Draft';
      case FormVersionStatus.Retired:
        return 'Retired';
      default:
        return 'No form';
    }
  }

  /** Current form version shown next to the status: published number, else the draft's. */
  protected formVersion(t: TaskTypeView): string {
    if (t.publishedFormVersionNo) return `v${t.publishedFormVersionNo}`;
    if (t.draftFormVersionNo) return `v${t.draftFormVersionNo} (draft)`;
    return '';
  }

  protected workflowName(id: number | undefined): string {
    if (id === undefined || id === null) return 'None';
    return this.workflowNames().get(id) ?? `Workflow ${id}`;
  }

  /** The eligible workflows of a type by name: the default first, then the active ones, the deactivated ones last. */
  private eligibleNames(t: TaskTypeView): string[] {
    return [...t.eligibleWorkflowIds]
      .sort(
        (a, b) =>
          Number(b === t.defaultWorkflowDefinitionId) -
            Number(a === t.defaultWorkflowDefinitionId) ||
          Number(this.workflowOptions().get(a)?.isActive === false) -
            Number(this.workflowOptions().get(b)?.isActive === false) ||
          this.workflowName(a).localeCompare(this.workflowName(b), undefined, {
            sensitivity: 'base',
          }),
      )
      .map((id) => this.workflowName(id));
  }

  /** The default workflow's name, "" when the type has none to use (the cell then says "No workflow", muted). */
  protected defaultWorkflowName(t: TaskTypeView): string {
    return this.eligibleNames(t)[0] ?? '';
  }

  /** The cell of the Default workflow column: the name and "+2" when more may be used. */
  protected defaultWorkflowCell(t: TaskTypeView): { name: string; more: number; all: string } {
    const names = this.eligibleNames(t);
    return { name: names[0] ?? '', more: Math.max(0, names.length - 1), all: names.join(', ') };
  }

  /** Why an active type cannot be used for new tasks (the tooltip and the spoken description of its "Not usable" badge). */
  protected notUsableReason(t: TaskTypeView): string {
    return this.warning(t);
  }

  /** The Workflows tab limited to a type (`?taskType=<id>`). */
  protected workflowsQuery(t: TaskTypeView): Record<string, number> {
    return { taskType: t.id };
  }

  private menuOf(t: TaskTypeView): MenuAction[] {
    const busy = this.busy();
    return [
      {
        id: 'edit-form',
        label: 'Edit form',
        icon: 'pi-file-edit',
        run: () => this.open(t, ['/admin/task-types', t.id, 'form']),
      },
      t.isActive
        ? {
            id: 'deactivate',
            label: 'Deactivate',
            icon: 'pi-ban',
            danger: true,
            separated: true,
            disabled: busy,
            run: () => this.askDeactivate(t),
          }
        : {
            id: 'activate',
            label: 'Activate',
            icon: 'pi-check-circle',
            separated: true,
            disabled: busy,
            run: () => void this.setActive(t, true),
          },
    ];
  }

  /** A row menu entry that opens a page of the record: remembers the row and the list address like the name link does. */
  private open(t: TaskTypeView, commands: unknown[]): void {
    this.drill.leaveRow(this.listId, t.id);
    void this.router.navigate(commands, { state: this.leave.state() });
  }

  protected menuFor(t: TaskTypeView): readonly MenuAction[] {
    return this.menus().get(t.id) ?? [];
  }

  protected warning(t: TaskTypeView): string {
    if (!t.isActive) return '';
    if (t.usabilityIssues.includes('NO_ELIGIBLE_WORKFLOW')) {
      return "No eligible published workflow: users can't create tasks of this type.";
    }
    if (t.usabilityIssues.includes('FORM_NOT_PUBLISHED')) {
      return "The request form isn't published: users can't create tasks of this type.";
    }
    return '';
  }

  protected askDeactivate(t: TaskTypeView): void {
    this.deactivateTarget.set(t);
    this.dialogError.set('');
    this.deactivateOpen.set(true);
  }

  protected async confirmDeactivate(): Promise<void> {
    const t = this.deactivateTarget();
    const outcome = t ? await this.setActive(t, false) : 'done';
    // A failure keeps the dialog open with its message and focus on its button (#414); a conflict reloaded the list, so the question is stale.
    if (outcome !== 'failed') this.deactivateOpen.set(false);
  }

  protected async setActive(
    t: TaskTypeView,
    isActive: boolean,
  ): Promise<'done' | 'conflict' | 'failed'> {
    this.busy.set(true);
    this.failure.set('');
    this.dialogError.set('');
    try {
      const updated = await firstValueFrom(
        this.api.update(t.id, {
          name: t.name,
          description: t.description,
          iconKey: t.iconKey,
          isActive,
          eligibleWorkflowIds: t.eligibleWorkflowIds,
          defaultWorkflowDefinitionId: t.defaultWorkflowDefinitionId,
          rowVersion: t.rowVersion,
        }),
      );
      this.all.set(this.all().map((r) => (r.id === updated.id ? updated : r)));
      this.announcement.set(`${t.name} ${isActive ? 'activated' : 'deactivated'}.`);
      this.notify.success('Saved.');
      focusListAfterAction(this.injector, `Actions for ${t.name}`);
      return 'done';
    } catch (e) {
      if (e instanceof ApiError && e.code === 'CONCURRENCY_CONFLICT') {
        this.failure.set('Someone else changed this task type. The list was reloaded; try again.');
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
}
