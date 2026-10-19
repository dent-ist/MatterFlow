import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  Injector,
  afterNextRender,
  computed,
  effect,
  inject,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { Button } from 'primeng/button';
import { firstValueFrom } from 'rxjs';
import { StepDefinitionSummary, StepDefinitionsClient } from '../../../api/generated/api-client';
import { ApiError } from '../../../core/http/api-error';
import { NotificationService } from '../../../core/notify/notification.service';
import { ColumnFilterRow } from '../../../shared/filters/column-filter-row';
import { statusDef, triBool } from '../../../shared/filters/common-defs';
import { FilterDef, FilterOption } from '../../../shared/filters/filter-def';
import { FiltersBar } from '../../../shared/filters/filters-bar';
import { ListFilters } from '../../../shared/filters/list-filters';
import { ActionMenu, MenuAction } from '../../../shared/ui/action-menu';
import { ActiveBadge } from '../../../shared/ui/badge';
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
import { viewportAtLeast } from '../../../shared/ui/viewport';
import { TagChips } from '../../../shared/ui/tag-chips';

/** The columns of the grid, in order; the keys the filter definitions point at. */
const COLUMNS = ['title', 'description', 'tags', 'usedIn', 'status', 'actions'] as const;

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
    ActionMenu,
    ConfirmDialog,
    RouterLink,
    RowLink,
    Button,
    Pager,
    SortHeader,
    GridBody,
    FiltersBar,
    ColumnFilterRow,
    TagChips,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'mf-fill' },
  styleUrl: '../../../shared/ui/page.scss',
  template: `
    <div class="pg-sr" role="status" aria-live="polite" data-announce>{{ announcement() }}</div>
    @if (failure()) {
      <p class="pg-alert" role="alert" data-failure>{{ failure() }}</p>
    }

    <mf-filters-bar [filters]="filters" controls="step-filter-row" [clearAlso]="['q']" />

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
              <th scope="col">Tags</th>
              <th
                class="pg-num"
                mfSort="usedInWorkflows"
                [sort]="sort()"
                [defaultSort]="defaultSort"
                (sorted)="setSort($event)"
              >
                Used in
              </th>
              <th scope="col">Status</th>
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
            emptyText="No steps yet. Add the first reusable step."
            [state]="state()"
            [empty]="rows().length === 0"
            [filtered]="filters.activeCount() > 0"
            [columns]="columns().length"
            (retry)="load()"
            (clear)="clear()"
          >
            <p-button mfEmptyAction label="New step" (onClick)="go('/admin/steps/new')" />
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
                <td class="st-tags ad-tags"><mf-tag-chips [tags]="s.tags" [max]="2" /></td>
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
                        (s.usedInWorkflows === 1 ? '1 workflow' : s.usedInWorkflows + ' workflows')
                      "
                      >{{ s.usedInWorkflows }}</a
                    >
                  }
                </td>
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
  private readonly drill = inject(DrillReturn);
  protected readonly leave = inject(AdminListLeave);
  protected readonly listId = ADMIN_LIST.steps.id;
  private readonly scroll = viewChild<ElementRef<HTMLElement>>('scroll');

  protected readonly defaultSort = 'title';
  /** The Description column is left out below 1200 px (its filter then sits under "Other filters"). */
  protected readonly showDescription = viewportAtLeast(1200);
  protected readonly columns = computed(() =>
    this.showDescription() ? [...COLUMNS] : COLUMNS.filter((c) => c !== 'description'),
  );
  /** The tags to choose from, with how many steps of the chosen status carry each. */
  protected readonly tagOptions = signal<FilterOption[]>([]);
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
    // Back (or a breadcrumb) from a record puts focus on the name link of the row that was left (#354).
    restoreRowFocus(this.listId, () => this.state() === 'ready');
    // The tags to choose from follow the status filter.
    effect(() => {
      const status = this.statusValue();
      untracked(() => void this.loadTagOptions(status));
    });
    // The controls move into the sheet while the grid scrolls sideways.
    afterNextRender(() => this.filters.watchOverflow(this.scroll()?.nativeElement), {
      injector: this.injector,
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

  protected override fetch() {
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
        isActiveParam(parseStatus(this.filters.text('status'))),
        this.pageNumber(),
        this.pageSize(),
      ),
    );
  }
}
