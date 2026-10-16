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
import { ColumnFilterRow } from '../../../shared/filters/column-filter-row';
import { statusDef, triBool } from '../../../shared/filters/common-defs';
import { FilterDef, FilterOption } from '../../../shared/filters/filter-def';
import { FiltersBar } from '../../../shared/filters/filters-bar';
import { ListFilters } from '../../../shared/filters/list-filters';
import { ActiveBadge } from '../../../shared/ui/badge';
import { SortHeader } from '../../../shared/ui/data-table';
import { isActiveParam, parseStatus } from '../../../shared/ui/list-helpers';
import { ServerListPage } from '../../../shared/ui/list-query';
import { ScrollArea } from '../../../shared/ui/fixed-page';
import { GridBody } from '../../../shared/ui/grid-body';
import { Pager } from '../../../shared/ui/pager';
import { TagChips } from '../../../shared/ui/tag-chips';

/** The columns of the grid, in order; the keys the filter definitions point at. */
const COLUMNS = ['title', 'description', 'tags', 'usedIn', 'status'] as const;

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
    RouterLink,
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
    <mf-filters-bar [filters]="filters" controls="step-filter-row" [clearAlso]="['q']" />

    <div class="mf-table-wrap" mfScrollArea="Steps list" #scroll>
      <div class="mf-scroll">
        <table class="pg-table" data-steps>
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
              <th scope="col">Description</th>
              <th scope="col">Tags</th>
              <th
                mfSort="usedInWorkflows"
                [sort]="sort()"
                [defaultSort]="defaultSort"
                (sorted)="setSort($event)"
              >
                Used in
              </th>
              <th scope="col">Status</th>
            </tr>
            @if (filters.rowVisible()) {
              <tr
                mfColumnFilterRow
                id="step-filter-row"
                [filters]="filters"
                [columns]="columns"
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
            [columns]="5"
            (retry)="load()"
            (clear)="clear()"
          >
            <p-button mfEmptyAction label="New step" (onClick)="go('/admin/steps/new')" />
            @for (s of rows(); track s.stepDefinitionId) {
              <tr [attr.data-row]="s.title">
                <td>
                  <a class="pg-link" [routerLink]="['/admin/steps', s.stepDefinitionId]">{{
                    s.title
                  }}</a>
                </td>
                <td>{{ s.description }}</td>
                <td class="st-tags"><mf-tag-chips [tags]="s.tags" [max]="3" /></td>
                <td data-used-in>
                  @if (s.usedInWorkflows === 0) {
                    <span class="pg-muted">Not used</span>
                  } @else {
                    <a
                      class="pg-link"
                      data-used-in-link
                      [routerLink]="['/admin/workflows']"
                      [queryParams]="workflowsQuery(s)"
                      >Used in
                      {{
                        s.usedInWorkflows === 1 ? '1 workflow' : s.usedInWorkflows + ' workflows'
                      }}</a
                    >
                  }
                </td>
                <td>
                  <mf-active-badge [active]="s.isActive" />
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
  `,
})
export class StepsListPage extends ServerListPage<StepDefinitionSummary> {
  private readonly api = inject(StepDefinitionsClient);
  private readonly injector = inject(Injector);
  private readonly scroll = viewChild<ElementRef<HTMLElement>>('scroll');

  protected readonly defaultSort = 'title';
  protected readonly columns = COLUMNS;
  /** The tags to choose from, with how many steps of the chosen status carry each. */
  protected readonly tagOptions = signal<FilterOption[]>([]);

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
