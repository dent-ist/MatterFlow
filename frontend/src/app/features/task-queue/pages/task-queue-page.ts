import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { ParamMap, Router } from '@angular/router';
import { Button } from 'primeng/button';
import { Observable } from 'rxjs';
import {
  PodsClient,
  TaskQueueClient,
  TaskQueuePage as TaskQueueData,
} from '../../../api/generated/api-client';
import { HasPermissionDirective } from '../../../shared/directives/has-permission.directive';
import { FilterOption } from '../../../shared/filters/filter-def';
import { FiltersBar } from '../../../shared/filters/filters-bar';
import { ListFilters } from '../../../shared/filters/list-filters';
import { filtersToValues, queueFilterDefs } from '../../../shared/filters/queue-defs';
import { FixedPage } from '../../../shared/ui/fixed-page';
import { PageHeader } from '../../../shared/ui/page-header';
import { PodOption, loadPodChoices } from '../../../shared/work-queue/pod-options';
import { QueuePageBase } from '../../../shared/work-queue/queue-page';
import { QuickViews } from '../../../shared/work-queue/quick-views';
import {
  BuiltInViewKey,
  OPEN_STATUSES,
  QueueState,
  builtInFilters,
  queueArgs,
} from '../../../shared/work-queue/queue-filters';
import { WorkList } from '../../../shared/work-queue/work-list';
import { WorkViewControls } from '../../../shared/work-queue/work-view-controls';

/**
 * Task Queue (UX S03, ticket 49): every Task for anyone with Task.View. Inline column filters under the headers (Title or Ref, Matter,
 * Client, Project, Task type, Workflow, Priority, Pod, Assignee, Creator, Requestor, Due, Status, Created, Updated; ASAP, Overdue and Closed
 * in More filters), quick views as presets, chips, sortable and configurable columns and server paging. All state lives in the URL, so a
 * dashboard link such as `/tasks?overdue=true&status=NEW` opens the same list. A plain `/tasks` starts on the open statuses (shown in the
 * Status cell, not counted) or on the view the user last used, with a "Restored your last view" notice. Rows are editable inline; the
 * title opens the Task.
 */
@Component({
  selector: 'mf-task-queue-page',
  imports: [
    FixedPage,
    PageHeader,
    Button,
    HasPermissionDirective,
    FiltersBar,
    QuickViews,
    WorkList,
    WorkViewControls,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: '../../../shared/work-queue/work-page.scss',
  template: `
    <mf-fixed-page>
      <mf-page-header heading="Task Queue"> </mf-page-header>

      <mf-filters-bar
        [filters]="filters"
        controls="work-filter-row"
        (showColumn)="showColumn($event)"
      >
        <mf-quick-views
          mfBarStart
          [filters]="state().filters"
          [context]="viewContext()"
          (viewSelect)="applyView($event)"
        />
        <mf-work-view-controls
          [sort]="state().sort"
          [dir]="state().dir"
          [columns]="prefs().columns"
          [density]="prefs().density"
          (resetSort)="resetSort()"
          (columnsChange)="setColumns($event)"
          (densityChange)="setDensity($event)"
        />
      </mf-filters-bar>
      <mf-work-list
        [rows]="rows()"
        [total]="total()"
        [page]="state().page"
        [pageSize]="state().pageSize"
        [state]="loadState()"
        [columns]="prefs().columns"
        [density]="prefs().density"
        [sort]="state().sort"
        [dir]="state().dir"
        [filtered]="filtered()"
        [filters]="filters"
        caption="Task Queue"
        emptyText="No open tasks."
        (sortChange)="sortBy($event)"
        (pageChange)="goToPage($event)"
        (pageSizeChange)="setPageSize($event)"
        (retry)="load()"
        (clearFilters)="clearFilters()"
        (rowChange)="replaceRow($event)"
        (columnsShown)="shownColumns.set($event)"
      >
        <p-button
          empty-action
          *mfHasPermission="'Task.Create'"
          label="Create task"
          icon="pi pi-plus"
          (onClick)="go('/tasks/new')"
        />
      </mf-work-list>
    </mf-fixed-page>
  `,
})
export class TaskQueuePage extends QueuePageBase<TaskQueueData> {
  private readonly api = inject(TaskQueueClient);
  private readonly podsApi = inject(PodsClient);
  private readonly navigator = inject(Router);

  protected readonly pods = signal<PodOption[]>([]);
  private readonly primary = signal<number | null>(null);

  private readonly defs = computed(() =>
    queueFilterDefs(this.queueLookups(), {
      defaultStatus: OPEN_STATUSES,
      names: {
        client: (id) => this.recordName('client', id),
        matter: (id) => this.recordName('matter', id),
        project: (id) => this.recordName('project', id),
      },
    }),
  );

  protected readonly filters = new ListFilters({
    screen: 'task-queue',
    noun: 'tasks',
    openByDefault: true,
    defs: this.defs,
    visibleColumns: this.shownColumns,
  });

  /** A bare `/tasks` is sent to the view the user last used before anything loads. */
  private pendingRestore = false;

  constructor() {
    super('queue');
    const keys = this.route.snapshot?.queryParamMap?.keys ?? [];
    if (keys.length === 0) {
      const last = this.lastView();
      if (last) {
        this.pendingRestore = true;
        this.restore(last);
      }
    }
    void this.loadPods();
  }

  protected override defaultStatus(): readonly string[] {
    return OPEN_STATUSES;
  }

  protected override shouldLoad(params: ParamMap): boolean {
    if (this.pendingRestore) {
      if (params.keys.length === 0) return false;
      this.pendingRestore = false;
    }
    return true;
  }

  protected override fetch(state: QueueState): Observable<TaskQueueData> {
    return this.api.getTaskQueue(...queueArgs(state));
  }

  protected override podFilterOptions(): FilterOption[] {
    return this.pods().map((p) => ({ value: String(p.id), label: p.name }));
  }

  protected override podName(id: number): string | null {
    return this.pods().find((p) => p.id === id)?.name ?? null;
  }

  protected override primaryPodId(): number | null {
    return this.primary();
  }

  /** A quick view is a preset: it writes its column filters (and only those) to the address. */
  protected applyView(key: BuiltInViewKey): void {
    this.filters.applyPreset(filtersToValues(builtInFilters(key, this.viewContext())));
  }

  protected go(path: string): void {
    void this.navigator.navigateByUrl(path);
  }

  private async loadPods(): Promise<void> {
    const choices = await loadPodChoices(this.podsApi, this.auth.has('Pod.View'));
    this.pods.set(choices.options);
    this.primary.set(choices.primaryPodId);
  }
}
