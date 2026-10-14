import { ChangeDetectionStrategy, Component, HostListener, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { Button } from 'primeng/button';
import { Observable } from 'rxjs';
import {
  PodsClient,
  TaskQueueClient,
  TaskQueuePage as TaskQueueData,
} from '../../../api/generated/api-client';
import { HasPermissionDirective } from '../../../shared/directives/has-permission.directive';
import {
  BuiltInViewKey,
  QueueState,
  builtInFilters,
  emptyState,
  queueArgs,
} from '../../../shared/work-queue/queue-filters';
import { loadPodChoices } from '../../../shared/work-queue/pod-options';
import { QueuePageBase } from '../../../shared/work-queue/queue-page';
import { PodOption, WorkFilterBar } from '../../../shared/work-queue/work-filter-bar';
import { WorkList } from '../../../shared/work-queue/work-list';

/**
 * Task Queue (UX S03, ticket 49): every Task for anyone with Task.View. Search, quick views, filters, chips, sortable columns,
 * configurable columns and server paging; all state lives in the URL, so a dashboard link such as `/tasks?overdue=true&status=NEW`
 * opens the same list. A bare `/tasks` starts on the "All open" view. Rows are read-only; the title opens the Task.
 */
@Component({
  selector: 'mf-task-queue-page',
  imports: [Button, HasPermissionDirective, WorkFilterBar, WorkList],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: '../../../shared/work-queue/work-page.scss',
  template: `
    <header class="wp-head">
      <h1 class="wp-title">Task Queue</h1>
      <p-button
        *mfHasPermission="'Task.Create'"
        label="Create Task"
        icon="pi pi-plus"
        (onClick)="go('/tasks/new')"
      />
    </header>

    <mf-work-filter-bar
      [filters]="state().filters"
      [names]="chipNames()"
      [pods]="pods()"
      [userId]="userId()"
      [viewContext]="viewContext()"
      [showViews]="true"
      (filtersChange)="setFilters($event)"
      (viewSelect)="applyView($event)"
      (clearAll)="clearFilters()"
    />

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
      caption="Task Queue"
      emptyText="No tasks yet."
      (sortChange)="sortBy($event)"
      (resetSort)="resetSort()"
      (pageChange)="goToPage($event)"
      (pageSizeChange)="setPageSize($event)"
      (columnsChange)="setColumns($event)"
      (densityChange)="setDensity($event)"
      (retry)="load()"
      (clearFilters)="clearFilters()"
      (rowChange)="replaceRow($event)"
    >
      <p-button
        empty-action
        *mfHasPermission="'Task.Create'"
        label="Create Task"
        icon="pi pi-plus"
        (onClick)="go('/tasks/new')"
      />
    </mf-work-list>
  `,
})
export class TaskQueuePage extends QueuePageBase<TaskQueueData> {
  private readonly api = inject(TaskQueueClient);
  private readonly podsApi = inject(PodsClient);
  private readonly navigator = inject(Router);

  protected readonly pods = signal<PodOption[]>([]);
  private readonly primary = signal<number | null>(null);

  /** A bare `/tasks` is sent to "All open" before anything loads. */
  private pendingDefault = false;

  constructor() {
    super('queue');
    const keys = this.route.snapshot?.queryParamMap?.keys ?? [];
    if (keys.length === 0) {
      this.pendingDefault = true;
      this.navigate(
        { ...emptyState(), filters: builtInFilters('allOpen', this.viewContext()) },
        true,
      );
    }
    void this.loadPods();
  }

  protected override shouldLoad(state: QueueState): boolean {
    if (this.pendingDefault) {
      if (state.filters.status.length === 0) return false;
      this.pendingDefault = false;
    }
    return true;
  }

  protected override fetch(state: QueueState): Observable<TaskQueueData> {
    return this.api.getTaskQueue(...queueArgs(state));
  }

  protected override podName(id: number): string | null {
    return this.pods().find((p) => p.id === id)?.name ?? null;
  }

  protected override primaryPodId(): number | null {
    return this.primary();
  }

  protected applyView(key: BuiltInViewKey): void {
    const s = this.state();
    this.navigate({
      ...emptyState(),
      pageSize: s.pageSize,
      filters: builtInFilters(key, this.viewContext()),
    });
  }

  protected go(path: string): void {
    void this.navigator.navigateByUrl(path);
  }

  /** `/` jumps to the search box (UX S03), unless the user is typing somewhere. */
  @HostListener('document:keydown', ['$event'])
  protected onKey(event: KeyboardEvent): void {
    if (event.key !== '/' || event.ctrlKey || event.metaKey || event.altKey) return;
    const target = event.target as HTMLElement | null;
    if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
    if (target?.isContentEditable) return;
    const box = document.getElementById('fb-q');
    if (box) {
      event.preventDefault();
      box.focus();
    }
  }

  private async loadPods(): Promise<void> {
    const choices = await loadPodChoices(this.podsApi, this.auth.has('Pod.View'));
    this.pods.set(choices.options);
    this.primary.set(choices.primaryPodId);
  }
}
