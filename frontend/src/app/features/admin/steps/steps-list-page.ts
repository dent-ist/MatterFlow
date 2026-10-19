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
  StepDefinitionSummary,
  StepDefinitionsClient,
  StepListSummary,
} from '../../../api/generated/api-client';
import { ApiError } from '../../../core/http/api-error';
import { NotificationService } from '../../../core/notify/notification.service';
import { ColumnFilterRow } from '../../../shared/filters/column-filter-row';
import { statusDef, triBool } from '../../../shared/filters/common-defs';
import { FilterDef, FilterOption } from '../../../shared/filters/filter-def';
import { FiltersBar } from '../../../shared/filters/filters-bar';
import { ListFilters } from '../../../shared/filters/list-filters';
import { QuietRequests } from '../../../core/http/interceptors';
import { AdminCounts } from '../task-types/admin-counts';
import { AdminShellFilters } from '../task-types/shell-filters';
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
import { TagChips } from '../../../shared/ui/tag-chips';

/** The columns of the grid, in order; the keys the filter definitions point at. */
const COLUMNS = ['title', 'description', 'tags', 'usedIn', 'inputs', 'status', 'actions'] as const;

/** One skeleton bone per column, as wide as its usual content (#370: one definition of the columns for the table and its skeleton). */
const BONES: Record<(typeof COLUMNS)[number], string> = {
  title: '12rem',
  description: '14rem',
  tags: '8rem',
  usedIn: '2rem',
  inputs: '4rem',
  status: '4rem',
  actions: '1.5rem',
};

/** The class that sizes the loaded cell of each column, repeated on its skeleton cell so the columns keep their widths while loading. */
const CELL_CLASS: Record<(typeof COLUMNS)[number], string> = {
  title: 'ad-spring',
  description: 'ad-desc',
  tags: 'st-tags ad-tags',
  usedIn: 'pg-num',
  inputs: 'ad-nowrap',
  status: 'ad-nowrap',
  actions: 'mf-col-menu',
};

/**
 * Admin: the Workflow Steps tab of the Workflows page (UX S15), the step library list. Inline column filters: Title (`title`),
 * Description (`description`), Tags (`tags`, several; with `tagMatch` all or any under it), Used in (`used`) and Status (`status`,
 * Active by default). Sortable, server paged; state lives in the URL (`sort`, `page`, `size` are handed down by the page). Each row
 * opens the step editor. Needs `Workflow.Manage` (route guard).
 */
@Component({
  selector: 'mf-steps-list-page',
  imports: [
    ScrollArea,
    ActiveBadge,
    Badge,
    ActionMenu,
    ConfirmDialog,
    RouterLink,
    RowLink,
    Pager,
    SortHeader,
    GridBody,
    FiltersBar,
    ColumnFilterRow,
    TagChips,
    RecordCardList,
    RecordCardDef,
    RecordCard,
    RecordSort,
    WorkStrip,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'mf-fill' },
  styleUrl: '../../../shared/ui/page.scss',
  template: `
    <div class="pg-sr" role="status" aria-live="polite" data-announce>{{ announcement() }}</div>
    @if (failure()) {
      <p class="pg-alert" role="alert" data-failure>{{ failure() }}</p>
    }

    <mf-work-strip
      label="Steps summary"
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

    @if (phone()) {
      <mf-record-card-list
        noun="steps"
        label="Workflow Steps"
        emptyText="No steps yet. Use New step above to add the first reusable one."
        [state]="state()"
        [empty]="rows().length === 0"
        [filtered]="filters.activeCount() > 0"
        [hidden]="hiddenCount()"
        hiddenLabel="inactive"
        (retry)="load()"
        (clear)="clear()"
        (showAll)="showAll()"
      >
        <ng-template [mfRecordCard]="rows()" let-s>
          <mf-record-card
            [name]="s.title"
            [link]="['/admin/steps', s.stepDefinitionId]"
            [state]="leave.state()"
            [list]="listId"
            [rowKey]="s.stepDefinitionId"
          >
            <mf-active-badge mfCardBadges [active]="s.isActive" />
            @if (s.description) {
              <p mfCardMeta class="rc-line" data-card-meta>
                <span class="rc-text">{{ s.description }}</span>
              </p>
            }
            <p mfCardMeta class="rc-line" data-card-meta>
              @if (s.usedInWorkflows === 0) {
                <span class="rc-text">Not used in a workflow</span>
              } @else {
                <a
                  data-used-in-link
                  [routerLink]="['/admin/workflows']"
                  [queryParams]="workflowsQuery(s)"
                  >{{ usedLabel(s) }}</a
                >
              }
            </p>
            @if (inputsState(s) === 'draft') {
              <p mfCardMeta class="rc-line" data-card-meta data-card-inputs>
                <span class="rc-text"
                  >Inputs in draft ({{
                    s.draftFormFieldCount === 1 ? '1 field' : s.draftFormFieldCount + ' fields'
                  }})</span
                >
              </p>
            }
            <mf-action-menu
              mfCardAside
              [items]="menuFor(s)"
              [label]="'Actions for ' + s.title"
              [floating]="true"
            />
          </mf-record-card>
        </ng-template>
      </mf-record-card-list>
    } @else {
      <div class="mf-table-wrap" mfScrollArea="Steps list" #scroll>
        <div class="mf-scroll">
          <table class="pg-table mf-has-menu" data-steps>
            <caption class="pg-sr">
              Workflow Steps
            </caption>
            <thead>
              <tr>
                <th
                  mfSort="title"
                  [sort]="sort()"
                  [defaultSort]="defaultSort"
                  (sorted)="setSort($event)"
                >
                  Title
                </th>
                @if (showDescription()) {
                  <th scope="col">Description</th>
                }
                @if (showTags()) {
                  <th scope="col">Tags</th>
                }
                <th
                  class="pg-num"
                  mfSort="usedInWorkflows"
                  [sort]="sort()"
                  [defaultSort]="defaultSort"
                  (sorted)="setSort($event)"
                >
                  Used in
                </th>
                @if (showInputs()) {
                  <th scope="col">Inputs</th>
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
                  id="step-filter-row"
                  [filters]="filters"
                  [columns]="columns()"
                ></tr>
              }
            </thead>
            <tbody
              mfGridBody
              noun="steps"
              emptyText="No steps yet. Use New step above to add the first reusable one."
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
              @for (s of rows(); track s.stepDefinitionId) {
                <tr [attr.data-row]="s.title">
                  <td class="ad-spring">
                    <a
                      class="pg-link pg-name"
                      [routerLink]="['/admin/steps', s.stepDefinitionId]"
                      [mfRowLink]="listId"
                      [rowKey]="s.stepDefinitionId"
                      [state]="leave.state()"
                      [title]="s.title"
                      >{{ s.title }}</a
                    >
                  </td>
                  @if (showDescription()) {
                    <td class="ad-desc">
                      <span class="pg-clip pg-muted" [title]="s.description ?? ''">{{
                        s.description
                      }}</span>
                    </td>
                  }
                  @if (showTags()) {
                    <td class="st-tags ad-tags">
                      <mf-tag-chips [tags]="s.tags" [max]="2" />
                    </td>
                  }
                  <td data-used-in class="pg-num">
                    @if (s.usedInWorkflows === 0) {
                      <span class="pg-muted">Not used</span>
                    } @else {
                      <a
                        class="pg-link"
                        data-used-in-link
                        [routerLink]="['/admin/workflows']"
                        [queryParams]="workflowsQuery(s)"
                        [attr.aria-label]="
                          'Used in ' +
                          (s.usedInWorkflows === 1
                            ? '1 workflow'
                            : s.usedInWorkflows + ' workflows')
                        "
                        >{{ s.usedInWorkflows }}</a
                      >
                    }
                  </td>
                  @if (showInputs()) {
                    <td class="ad-nowrap" data-inputs>
                      @if (inputsState(s); as state) {
                        @if (state === 'draft') {
                          <mf-badge
                            tone="neutral"
                            icon="pi-file-edit"
                            data-inputs-draft
                            [attr.title]="draftTitle(s)"
                            >Draft</mf-badge
                          >
                        } @else {
                          <span class="pg-muted" [attr.data-inputs-state]="state">{{
                            state === 'published' ? 'Published' : 'None'
                          }}</span>
                        }
                      }
                    </td>
                  }
                  <td class="ad-nowrap">
                    <mf-active-badge [active]="s.isActive" />
                  </td>
                  <td class="mf-col-menu">
                    <mf-action-menu
                      [items]="menuFor(s)"
                      [label]="'Actions for ' + s.title"
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
      title="Deactivate step?"
      confirmLabel="Deactivate step"
      cancelLabel="Keep active"
      [danger]="true"
      [busy]="busy()"
      [(visible)]="deactivateOpen"
      (confirmed)="confirmDeactivate()"
    >
      <p>
        {{ deactivateTarget()?.title }} will be hidden from new workflow drafts. Published workflows
        that already use it are not changed, and you can activate it again later.
      </p>
    </mf-confirm-dialog>
  `,
})
export class StepsListPage extends ServerListPage<StepDefinitionSummary> {
  protected override readonly emptyOffersClear = true;
  private readonly api = inject(StepDefinitionsClient);
  private readonly injector = inject(Injector);
  private readonly notify = inject(NotificationService);
  private readonly quiet = inject(QuietRequests);
  private readonly drill = inject(DrillReturn);
  protected readonly leave = inject(AdminListLeave);
  protected readonly listId = ADMIN_LIST.steps.id;
  private readonly scroll = viewChild<ElementRef<HTMLElement>>('scroll');

  protected readonly defaultSort = 'title';
  /**
   * The Description column is left out below 1600 px (its filter then sits under "Other filters"): with the Tags and Inputs columns it
   * would make the Title narrower than the Description, and Title is the spring (#356, #378).
   */
  protected readonly showDescription = viewportAtLeast(1600);
  /** Below 640 px the list is cards, not a table (#375). */
  protected readonly phone = phoneCards();
  /** The phone's Sort by select: the sortable columns (the headers' keys); the count sorts descending first, like its header. */
  protected readonly sortOptions: readonly SortOption[] = [
    { value: 'title', label: 'Title' },
    { value: 'usedInWorkflows', label: 'Used in', descFirst: true },
    { value: 'status', label: 'Status' },
  ];
  /** The Tags column (two chips and "+n") is left out below 1100 px, its filter moving under "Other filters", so the grid fits a 768 px window (#375). */
  protected readonly showTags = viewportAtLeast(1180);
  /** The Inputs column (none, published or a Draft badge) is left out below 1024 px (#378). */
  protected readonly showInputs = viewportAtLeast(1024);
  protected readonly columns = computed(() =>
    COLUMNS.filter(
      (c) =>
        (c !== 'description' || this.showDescription()) &&
        (c !== 'tags' || this.showTags()) &&
        (c !== 'inputs' || this.showInputs()),
    ),
  );
  protected readonly skeleton = computed(() => this.columns().map((c) => BONES[c]));
  /** The class of each loaded cell that sizes it, for the skeleton cells (#370). */
  protected readonly skeletonCells = computed(() => this.columns().map((c) => CELL_CLASS[c]));
  /** The tags to choose from, with how many steps of the chosen status carry each. */
  protected readonly tagOptions = signal<FilterOption[]>([]);
  /** The library-wide counts of the last answer (no filter applies to them). */
  protected readonly summary = signal<StepListSummary | null>(null);
  /**
   * The health strip (#368): Active, Not used, Inputs in draft and Inactive, only from the summary of the API answer (counted over the whole
   * library, whatever the filters), `--` until the first answer. Active, Not used and Inactive put their filter in the address; Inputs in
   * draft is a plain count, because the API has no filter for it yet.
   */
  protected readonly stripItems = computed<WorkStripItem[]>(() => {
    const s = this.summary();
    return [
      { key: 'active', label: 'Active', count: s?.active ?? null },
      { key: 'notUsed', label: 'Not used', count: s?.notUsed ?? null },
      {
        key: 'inputsDraft',
        label: 'Inputs in draft',
        count: s?.inputsInDraft ?? null,
        inert: true,
      },
      { key: 'inactive', label: 'Inactive', count: s?.inactive ?? null },
    ];
  });

  /** The chip that matches the address exactly, or none. */
  protected readonly stripActive = computed<string | null>(() => {
    const status = parseStatus(this.filters.text('status'));
    const used = this.filters.text('used');
    if (status === 'inactive') return !used ? 'inactive' : null;
    if (status !== 'active') return null;
    if (used === 'false') return 'notUsed';
    return !used ? 'active' : null;
  });

  /** A chip puts its filters in the address and takes the others off; the pressed chip again goes back to Active. */
  protected pickStrip(key: string): void {
    const to = key === this.stripActive() ? 'active' : key;
    this.navigate({
      status: to === 'inactive' ? 'inactive' : null,
      used: to === 'notUsed' ? 'false' : null,
      page: null,
    });
    const item = this.stripItems().find((i) => i.key === to);
    if (item) this.announcement.set(`${item.label}: ${item.count ?? 0} steps.`);
  }

  protected readonly busy = signal(false);
  protected readonly failure = signal('');
  protected readonly announcement = signal('');
  protected readonly deactivateOpen = signal(false);
  protected readonly deactivateTarget = signal<StepDefinitionSummary | null>(null);
  /** The row menu of every row (#355): Edit inputs, then Deactivate or Activate. The page needs Workflow.Manage, which both need. */
  private readonly menus = computed(
    () => new Map(this.rows().map((s) => [s.stepDefinitionId, this.menuOf(s)] as const)),
  );

  protected readonly filters: ListFilters = new ListFilters({
    screen: 'steps',
    noun: 'steps',
    openByDefault: true,
    sheetBelow: 640,
    visibleColumns: computed(() => (this.phone() ? null : this.columns())),
    defs: computed((): FilterDef[] => [
      { key: 'title', label: 'Title', column: 'title', type: 'text' },
      { key: 'description', label: 'Description', column: 'description', type: 'text' },
      {
        key: 'tags',
        label: 'Tags',
        column: 'tags',
        type: 'multiSelect',
        emptyLabel: 'Any tag',
        options: this.tagOptions(),
      },
      {
        // Under the Tags control: whether a step must carry all the chosen tags or any of them. Idle until a tag is chosen.
        key: 'tagMatch',
        label: 'Tag match',
        column: 'tags',
        type: 'select',
        default: 'all',
        options: [
          { value: 'all', label: 'Match all tags' },
          { value: 'any', label: 'Match any tag' },
        ],
        normalize: (v) => (v === 'any' || v === 'all' ? v : null),
        disabledReason: () => (this.filters.list('tags').length > 0 ? null : 'Choose tags first'),
      },
      {
        key: 'used',
        label: 'Used in',
        column: 'usedIn',
        type: 'triState',
        options: [
          { value: '', label: 'Any' },
          { value: 'true', label: 'Used in a workflow' },
          { value: 'false', label: 'Not used' },
        ],
      },
      statusDef(),
    ]),
  });

  /** The status filter alone: the tags are reloaded when it changes, not whenever the options (part of the definitions) do. */
  private readonly statusValue = computed(() => parseStatus(this.filters.text('status')));

  constructor() {
    super();
    AdminShellFilters.register({ filters: this.filters, controls: 'step-filter-row' });
    const report = AdminCounts.report('steps');
    effect(() => report(this.summary()?.active));
    // Back (or a breadcrumb) from a record puts focus on the name link of the row that was left (#354).
    restoreRowFocus(this.listId, () => this.state() === 'ready');
    // The tags to choose from follow the status filter.
    effect(() => {
      const status = this.statusValue();
      untracked(() => void this.loadTagOptions(status));
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

  private menuOf(s: StepDefinitionSummary): MenuAction[] {
    const busy = this.busy();
    return [
      {
        id: 'edit-inputs',
        label: 'Edit inputs',
        icon: 'pi-file-edit',
        run: () => {
          this.drill.leaveRow(this.listId, s.stepDefinitionId);
          void this.router.navigate(['/admin/steps', s.stepDefinitionId, 'form'], {
            state: this.leave.state(),
          });
        },
      },
      s.isActive
        ? {
            id: 'deactivate',
            label: 'Deactivate',
            icon: 'pi-ban',
            danger: true,
            separated: true,
            disabled: busy,
            run: () => {
              this.deactivateTarget.set(s);
              this.deactivateOpen.set(true);
            },
          }
        : {
            id: 'activate',
            label: 'Activate',
            icon: 'pi-check-circle',
            separated: true,
            disabled: busy,
            run: () => void this.setActive(s, true),
          },
    ];
  }

  protected menuFor(s: StepDefinitionSummary): readonly MenuAction[] {
    return this.menus().get(s.stepDefinitionId) ?? [];
  }

  protected async confirmDeactivate(): Promise<void> {
    const s = this.deactivateTarget();
    this.deactivateOpen.set(false);
    if (s) await this.setActive(s, false);
  }

  private async setActive(s: StepDefinitionSummary, isActive: boolean): Promise<void> {
    this.busy.set(true);
    this.failure.set('');
    try {
      const body = { rowVersion: s.rowVersion };
      await firstValueFrom(
        isActive
          ? this.api.activateStepDefinition(s.stepDefinitionId, body)
          : this.api.deactivateStepDefinition(s.stepDefinitionId, body),
      );
      this.announcement.set(`${s.title} ${isActive ? 'activated' : 'deactivated'}.`);
      this.notify.success('Saved.');
      await this.load();
    } catch (e) {
      if (e instanceof ApiError && e.code === 'CONCURRENCY_CONFLICT') {
        this.failure.set('Someone else changed this step. The list was reloaded; try again.');
        await this.load();
      } else {
        this.failure.set(e instanceof ApiError ? e.message : 'Couldn’t save. Try again.');
      }
    } finally {
      this.busy.set(false);
    }
  }

  /**
   * The state of a step's inputs (its form) for the Inputs column (#378): `draft` when an open draft has fields (the step cannot go into a
   * published workflow until they are published), `published` when a published form exists, else `none`. The number of fields of a
   * published form is not in the list answer, so it is not shown.
   */
  protected inputsState(s: StepDefinitionSummary): 'draft' | 'published' | 'none' {
    if (s.draftFormFieldCount > 0) return 'draft';
    return s.publishedFormVersionId ? 'published' : 'none';
  }

  protected draftTitle(s: StepDefinitionSummary): string {
    const n = s.draftFormFieldCount;
    return `The inputs are a draft with ${n === 1 ? '1 field' : `${n} fields`}: publish them before this step can be published in a workflow.`;
  }

  /** The "Used in" text of a card. */
  protected usedLabel(s: StepDefinitionSummary): string {
    return s.usedInWorkflows === 1
      ? 'Used in 1 workflow'
      : `Used in ${s.usedInWorkflows} workflows`;
  }

  /** The Workflows tab limited to a step (`?step=<id>`). */
  protected workflowsQuery(s: StepDefinitionSummary): Record<string, number> {
    return { step: s.stepDefinitionId };
  }

  private async loadTagOptions(status: ReturnType<typeof parseStatus>): Promise<void> {
    try {
      const tags = await firstValueFrom(
        this.api.listStepTags(undefined, isActiveParam(status), 200),
      );
      this.tagOptions.set(tags.map((t) => ({ value: t.name, label: t.name, count: t.stepCount })));
    } catch {
      this.tagOptions.set([]); // the list itself still works; the filter just has nothing to offer
    }
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

  /** The inactive steps the default Active hides, under the same filters (#369, one row, no API change). */
  protected override fetchHidden() {
    // A background request: its failure is no reason for a toast, the list shows its own message.
    return parseStatus(this.filters.text('status')) === 'active'
      ? this.quiet.run(() => this.list(false, 1, 1))
      : null;
  }

  private list(isActive: boolean | undefined, page: number, size: number) {
    const tags = this.filters.list('tags');
    return firstValueFrom(
      this.api.listStepDefinitions(
        this.sort() || undefined,
        undefined,
        this.filters.text('title') || undefined,
        this.filters.text('description') || undefined,
        triBool(this.filters.text('used')),
        tags.length > 0 ? [...tags] : undefined,
        tags.length > 0 && this.filters.text('tagMatch') === 'any' ? 'any' : undefined,
        isActive,
        page,
        size,
      ),
    );
  }
}
