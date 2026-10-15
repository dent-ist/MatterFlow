import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  signal,
  untracked,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { Button } from 'primeng/button';
import { firstValueFrom } from 'rxjs';
import { StepDefinitionSummary, StepDefinitionsClient } from '../../../api/generated/api-client';
import { ActiveBadge } from '../../../shared/ui/badge';
import { ListState, SortHeader, StatusFilter } from '../../../shared/ui/data-table';
import { StatusFilter as StatusValue, isActiveParam } from '../../../shared/ui/list-helpers';
import { ServerListPage } from '../../../shared/ui/list-query';
import { ScrollArea } from '../../../shared/ui/fixed-page';
import { Pager } from '../../../shared/ui/pager';
import { SearchBox } from '../../../shared/ui/search-box';
import { TagChips } from '../../../shared/ui/tag-chips';
import { TagFilter, TagMatch, TagOption } from '../../../shared/ui/tag-filter';

/**
 * Admin: the Workflow Steps tab of the Workflows page (UX S15), the step library list. Search by title, description or tag, a tag filter
 * (several tags match all of them or any of them), status filter (Active by default), sortable, server paged; state lives in the URL
 * (`q`, `tags`, `tagMatch`, `status`, `sort`, `page`, `size`, handed down by the page). Each row opens the step editor. Needs
 * `Workflow.Manage` (route guard).
 */
@Component({
  selector: 'mf-steps-list-page',
  imports: [
    ScrollArea,
    ActiveBadge,
    RouterLink,
    Button,
    Pager,
    SearchBox,
    StatusFilter,
    SortHeader,
    ListState,
    TagChips,
    TagFilter,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'mf-fill' },
  styleUrl: '../../../shared/ui/page.scss',
  template: `
    <div class="pg-filters" role="search">
      <mf-search-box
        inputId="step-search"
        label="Search steps"
        placeholder="Title, description or tag"
        [value]="q() ?? ''"
        (searchChange)="search($event)"
      />
      <mf-status-filter
        inputId="step-status"
        [value]="statusFilter()"
        (valueChange)="setStatus($event)"
      />
      <mf-tag-filter
        idPrefix="step-tags"
        label="Tags"
        [options]="tagOptions()"
        [selected]="selectedTags()"
        [match]="match()"
        (selectedChange)="setTags($event)"
        (matchChange)="setMatch($event)"
      />
    </div>

    <mf-list-state
      noun="steps"
      emptyText="No steps yet. Add the first reusable step."
      [state]="state()"
      [empty]="rows().length === 0"
      [filtered]="hasFilter()"
      [columns]="5"
      (retry)="load()"
      (clear)="clear()"
    >
      <p-button mfEmptyAction label="New step" (onClick)="go('/admin/steps/new')" />
      <div class="mf-table-wrap" mfScrollArea="Steps list">
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
            </thead>
            <tbody>
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
                        [queryParams]="{ step: s.stepDefinitionId }"
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
      <mf-pager
        [page]="pageNumber()"
        [pageSize]="pageSize()"
        [pageSizes]="pageSizes"
        [total]="total()"
        (pageChange)="goToPage($event)"
        (pageSizeChange)="setPageSize($event)"
      />
    </mf-list-state>
  `,
})
export class StepsListPage extends ServerListPage<StepDefinitionSummary> {
  private readonly api = inject(StepDefinitionsClient);

  /** `tags=a&tags=b` (one value arrives as a string, several as a list) and `tagMatch=all|any` (all when absent). */
  readonly tags = input<string | readonly string[] | null>();
  readonly tagMatch = input<string>();

  protected readonly defaultSort = 'title';
  protected readonly selectedTags = computed(() => {
    const raw = this.tags();
    const list = raw == null ? [] : typeof raw === 'string' ? [raw] : [...raw];
    return list.map((t) => t.trim()).filter((t) => t !== '');
  });
  protected readonly match = computed<TagMatch>(() => (this.tagMatch() === 'any' ? 'any' : 'all'));
  protected readonly tagOptions = signal<TagOption[]>([]);

  constructor() {
    super();
    // The tags to choose from, with how many steps of the chosen status carry each.
    effect(() => {
      const status = this.statusFilter();
      untracked(() => void this.loadTagOptions(status));
    });
  }

  protected override extraFilters(): Record<string, unknown> {
    return { tags: this.selectedTags().length > 0, tagMatch: false };
  }

  protected override watch(): void {
    this.selectedTags();
    this.match();
  }

  protected setTags(tags: string[]): void {
    this.navigate({ tags: tags.length > 0 ? tags : null, page: null });
  }

  protected setMatch(match: TagMatch): void {
    this.navigate({ tagMatch: match === 'all' ? null : match, page: null });
  }

  private async loadTagOptions(status: StatusValue): Promise<void> {
    try {
      const tags = await firstValueFrom(
        this.api.listStepTags(undefined, isActiveParam(status), 200),
      );
      this.tagOptions.set(tags.map((t) => ({ name: t.name, count: t.stepCount })));
    } catch {
      this.tagOptions.set([]); // the list itself still works; the filter just has nothing to offer
    }
  }

  protected override fetch() {
    return firstValueFrom(
      this.api.listStepDefinitions(
        this.sort() || undefined,
        this.q()?.trim() || undefined,
        this.selectedTags().length > 0 ? this.selectedTags() : undefined,
        this.match() === 'any' ? 'any' : undefined,
        isActiveParam(this.statusFilter()),
        this.pageNumber(),
        this.pageSize(),
      ),
    );
  }
}
