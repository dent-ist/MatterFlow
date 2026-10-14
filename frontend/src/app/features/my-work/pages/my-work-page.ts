import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Observable } from 'rxjs';
import {
  MyWorkClient,
  MyWorkPage as MyWorkData,
  PodsClient,
} from '../../../api/generated/api-client';
import { dateDaysAgo, QueueState, queueArgs } from '../../../shared/work-queue/queue-filters';
import { loadPodChoices } from '../../../shared/work-queue/pod-options';
import { QueuePageBase } from '../../../shared/work-queue/queue-page';
import { PodOption, WorkFilterBar } from '../../../shared/work-queue/work-filter-bar';
import { WorkList } from '../../../shared/work-queue/work-list';
import { WorkTab, WorkTabs } from '../../../shared/work-queue/work-tabs';

type TabKey = 'active' | 'dueSoon' | 'completed' | 'createdByMe';

const TAB_LABELS: Readonly<Record<TabKey, string>> = {
  active: 'Active',
  dueSoon: 'Due Soon',
  completed: 'Completed',
  createdByMe: 'Created by Me',
};

/** The Completed tab shows tasks closed in the last 90 days unless the user asks for older ones (UX S02). */
const COMPLETED_WINDOW_DAYS = 90;

/**
 * My Work (UX S02, ticket 50): everything assigned to me from all my Pods, in the tabs Active, Due Soon, Completed and Created by Me,
 * most urgent first. Tab counts follow the filters. The tab and filters live in the URL.
 */
@Component({
  selector: 'mf-my-work-page',
  imports: [RouterLink, WorkFilterBar, WorkList, WorkTabs],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: '../../../shared/work-queue/work-page.scss',
  template: `
    <header class="wp-head">
      <h1 class="wp-title">My Work</h1>
    </header>

    <mf-work-tabs
      label="My Work views"
      idPrefix="mw"
      [tabs]="tabs()"
      [selected]="tab()"
      (selectedChange)="selectTab($event)"
    />

    <mf-work-filter-bar
      [filters]="state().filters"
      [names]="chipNames()"
      [pods]="pods()"
      [userId]="userId()"
      [hidden]="['assignee']"
      (filtersChange)="setFilters($event)"
      (clearAll)="clearFilters()"
    />

    <div role="tabpanel" id="mw-panel" [attr.aria-labelledby]="'mw-tab-' + tab()">
      @switch (tab()) {
        @case ('dueSoon') {
          <p class="wp-help" data-help>
            Due Soon lists your open tasks with a due date in the next 2 days, plus overdue ones.
            ASAP tasks have no due date, so they are not included.
          </p>
        }
        @case ('completed') {
          <p class="wp-help" data-help>
            @if (windowed()) {
              Showing tasks completed or cancelled in the last 90 days, newest first.
              <button type="button" class="wp-link-button" (click)="showOlder()">Show older</button>
            } @else {
              Completed and cancelled tasks, newest first.
            }
          </p>
        }
      }

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
        caption="My Work"
        [defaultOrder]="
          tab() === 'completed'
            ? 'Default order: Newest closed first'
            : 'Default order: Priority, ASAP first, Due date, Oldest'
        "
        [emptyText]="emptyText()"
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
        @if (tab() === 'active' && auth.has('Pod.View')) {
          <a empty-action class="wp-link" routerLink="/pods/work">Check Pod Work</a>
        }
      </mf-work-list>
    </div>
  `,
})
export class MyWorkPage extends QueuePageBase<MyWorkData> {
  private readonly api = inject(MyWorkClient);
  private readonly podsApi = inject(PodsClient);

  protected readonly pods = signal<PodOption[]>([]);

  protected readonly tab = computed<TabKey>(() => {
    const view = this.state().view;
    return view && view in TAB_LABELS ? (view as TabKey) : 'active';
  });

  protected readonly tabs = computed<WorkTab[]>(() => {
    const counts = this.data()?.counts;
    return (Object.keys(TAB_LABELS) as TabKey[]).map((key) => ({
      key,
      label: TAB_LABELS[key],
      count: counts ? counts[key] : null,
    }));
  });

  /** True while the Completed tab applies its default 90-day window (no closed-date filter set). */
  protected readonly windowed = computed(() => {
    const f = this.state().filters;
    return this.tab() === 'completed' && !f.completedFrom && !f.completedTo;
  });

  protected readonly emptyText = computed(() =>
    this.tab() === 'active'
      ? 'Nothing assigned to you right now. Check Pod Work for unassigned tasks.'
      : this.tab() === 'dueSoon'
        ? 'Nothing is due soon.'
        : this.tab() === 'completed'
          ? 'No completed tasks in this period.'
          : 'You have not created any tasks.',
  );

  constructor() {
    super('my-work');
    void loadPodChoices(this.podsApi, this.auth.has('Pod.View')).then((c) =>
      this.pods.set(c.options),
    );
  }

  protected override podName(id: number): string | null {
    return this.pods().find((p) => p.id === id)?.name ?? null;
  }

  protected override fetch(state: QueueState): Observable<MyWorkData> {
    const view = this.tab();
    const effective =
      view === 'completed' && !state.filters.completedFrom && !state.filters.completedTo
        ? {
            ...state,
            filters: {
              ...state.filters,
              completedFrom: dateDaysAgo(this.clock.now(), COMPLETED_WINDOW_DAYS, this.zone),
            },
          }
        : state;
    return this.api.getMyWork(view, ...queueArgs(effective));
  }

  protected selectTab(key: string): void {
    if (key === this.tab()) return;
    this.navigate({
      ...this.state(),
      view: key === 'active' ? null : key,
      page: 1,
      sort: null,
      dir: null,
    });
  }

  protected showOlder(): void {
    const s = this.state();
    this.navigate({ ...s, filters: { ...s.filters, completedFrom: '2000-01-01' }, page: 1 });
  }
}
