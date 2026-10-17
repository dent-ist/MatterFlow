import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { ParamMap, RouterLink } from '@angular/router';
import { Observable } from 'rxjs';
import {
  MyWorkClient,
  MyWorkPage as MyWorkData,
  PodsClient,
} from '../../../api/generated/api-client';
import { FilterOption } from '../../../shared/filters/filter-def';
import { FiltersBar } from '../../../shared/filters/filters-bar';
import { ListFilters } from '../../../shared/filters/list-filters';
import { queueFilterDefs, withoutFilters } from '../../../shared/filters/queue-defs';
import { FixedPage } from '../../../shared/ui/fixed-page';
import { PageHeader } from '../../../shared/ui/page-header';
import { touchVisit, trackVisitActivity } from '../../../shared/work-queue/last-visit';
import { PodOption, loadPodChoices } from '../../../shared/work-queue/pod-options';
import { QueuePageBase } from '../../../shared/work-queue/queue-page';
import {
  CLOSED_STATUSES,
  OPEN_STATUSES,
  QueueState,
  dateDaysAgo,
  queueArgs,
} from '../../../shared/work-queue/queue-filters';
import { WorkList } from '../../../shared/work-queue/work-list';
import { WorkTab, WorkTabs } from '../../../shared/work-queue/work-tabs';
import { WorkViewControls } from '../../../shared/work-queue/work-view-controls';

type TabKey = 'active' | 'dueSoon' | 'completed' | 'createdByMe';

const TAB_LABELS: Readonly<Record<TabKey, string>> = {
  active: 'Active',
  dueSoon: 'Due soon',
  completed: 'Completed',
  createdByMe: 'Created by me',
};

/** The Completed tab shows tasks closed in the last 90 days unless the user asks for older ones (UX S02). */
const COMPLETED_WINDOW_DAYS = 90;

/**
 * The tab a plain visit opens: Active, unless it is empty (count 0) and another tab is not; then Created by me, then Closed. Due soon
 * is part of Active, so it never leads.
 */
export function firstNonEmptyTab(counts: Readonly<Record<TabKey, number>>): TabKey {
  if (counts.active > 0) return 'active';
  return (['createdByMe', 'completed'] as const).find((key) => counts[key] > 0) ?? 'active';
}

/**
 * Filters a tab decides itself (shown disabled with the reason): the tabs for my own tasks always mean "assigned to me", Created by me
 * always means "created by me", and Due soon is a window on the due date.
 */
const OWNED: Readonly<Record<TabKey, readonly string[]>> = {
  active: ['assignee'],
  dueSoon: ['assignee', 'due', 'asap', 'overdue'],
  completed: ['assignee'],
  createdByMe: ['creator'],
};

const OWNED_REASON: Readonly<Record<TabKey, string>> = {
  active: 'This tab lists the tasks assigned to you.',
  dueSoon: 'Set by the Due soon tab: tasks assigned to you that are due within 2 days or overdue.',
  completed: 'This tab lists the closed tasks assigned to you.',
  createdByMe: 'This tab lists the tasks you created.',
};

/** The statuses that mean something on a tab; the Status filter offers these and a tab change drops the others. */
const STATUSES: Readonly<Record<TabKey, readonly string[]>> = {
  active: OPEN_STATUSES,
  dueSoon: OPEN_STATUSES,
  completed: CLOSED_STATUSES,
  createdByMe: [...OPEN_STATUSES, ...CLOSED_STATUSES],
};

/**
 * My Work (UX S02, ticket 50): everything assigned to me from all my Pods, in the tabs Active, Due Soon, Completed and Created by Me,
 * most urgent first, with the shared inline column filters. Tab counts follow the filters. The tab and filters live in the URL. A filter
 * the current tab decides itself (Assignee on my own tabs, Creator on Created by me, Due on Due soon) shows disabled with the reason and
 * is not sent; changing tab drops the filters the new tab owns, so every count is worked out under the same filters.
 */
@Component({
  selector: 'mf-my-work-page',
  imports: [FixedPage, PageHeader, RouterLink, FiltersBar, WorkList, WorkTabs, WorkViewControls],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: '../../../shared/work-queue/work-page.scss',
  template: `
    <mf-fixed-page>
      <mf-page-header heading="My Work"> </mf-page-header>

      <div class="wp-tabrow" data-tab-row>
        <mf-work-tabs
          label="My Work views"
          idPrefix="mw"
          [tabs]="tabs()"
          [selected]="tab()"
          (selectedChange)="selectTab($event)"
        />
      </div>

      <div class="mf-fill" role="tabpanel" id="mw-panel" [attr.aria-labelledby]="'mw-tab-' + tab()">
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
                <button type="button" class="mf-btn mf-btn--text" (click)="showOlder()">
                  Show older
                </button>
              } @else {
                Completed and cancelled tasks, newest first.
              }
            </p>
          }
        }

        <mf-filters-bar
          [filters]="filters"
          controls="work-filter-row"
          (showColumn)="showColumn($event)"
        >
          <mf-work-view-controls
            [sort]="state().sort"
            [dir]="state().dir"
            [defaultOrder]="defaultOrder()"
            [defaultLabel]="tab() === 'completed' ? 'Closed date' : 'Priority'"
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
          caption="My Work"
          [newSince]="tab() === 'active' || tab() === 'dueSoon' ? lastVisit : null"
          [emptyText]="emptyText()"
          (sortChange)="sortBy($event)"
          (pageChange)="goToPage($event)"
          (pageSizeChange)="setPageSize($event)"
          (retry)="load()"
          (clearFilters)="clearFilters()"
          (rowChange)="replaceRow($event)"
          (columnsShown)="shownColumns.set($event)"
        >
          @if (tab() === 'active' && auth.has('Pod.View')) {
            <a empty-action class="wp-link" routerLink="/pods/work">Check Pod Work</a>
          }
          @if (tab() === 'active') {
            <p near-empty data-everything>
              That's everything on your plate.
              @if (auth.has('Pod.View')) {
                Look for more in <a class="wp-link" routerLink="/pods/work">Pod Work</a>
                or
              } @else {
                Look for more in
              }
              the <a class="wp-link" routerLink="/tasks">Task Queue</a>.
            </p>
          }
        </mf-work-list>
      </div>
    </mf-fixed-page>
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

  private readonly defs = computed(() => {
    const owned = OWNED[this.tab()];
    const reason = () => OWNED_REASON[this.tab()];
    const disabled = Object.fromEntries(
      [...new Set(owned)].map((key) => [key === 'asap' || key === 'overdue' ? 'due' : key, reason]),
    );
    const allowed = STATUSES[this.tab()];
    const lookups = this.queueLookups();
    return queueFilterDefs(lookups, {
      disabled,
      statuses: () => (lookups.statuses ?? []).filter((o) => allowed.includes(o.value)),
      names: {
        client: (id) => this.recordName('client', id),
        matter: (id) => this.recordName('matter', id),
        project: (id) => this.recordName('project', id),
      },
    });
  });

  protected readonly filters = new ListFilters({
    screen: 'my-work',
    noun: 'tasks',
    openByDefault: true,
    defs: this.defs,
    visibleColumns: this.shownColumns,
  });

  protected readonly defaultOrder = computed(() =>
    this.tab() === 'completed'
      ? 'Default order: Newest closed first'
      : 'Default order: Priority, ASAP first, Due date, Oldest',
  );

  protected readonly tabs = computed<WorkTab[]>(() => {
    const counts = this.data()?.counts;
    return (Object.keys(TAB_LABELS) as TabKey[]).map((key) => ({
      key,
      label: TAB_LABELS[key],
      count: counts ? counts[key] : null,
      emphasize: key === 'active' || key === 'dueSoon',
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

  /**
   * Where the current visit began (ms; a visit ends after more than 30 minutes without activity), read once on arrival: tasks assigned
   * after it show "New". Opening a task and pressing Back does not change it. Null on the first use.
   */
  protected readonly lastVisit: number | null;

  /** The remembered view is applied once, before anything loads. */
  private pendingRestore = false;
  /** A plain visit (no query string, nothing restored) opens the first tab that has something in it, once. */
  private landing = false;
  /** The tab the landing rule chose: it is not stored as the last view. */
  private skipRemember = false;

  constructor() {
    super('my-work');
    const now = () => this.clock.now().getTime();
    this.lastVisit = touchVisit(this.userId(), now());
    trackVisitActivity(this.userId(), now);
    const keys = this.route.snapshot?.queryParamMap?.keys ?? [];
    const remembered = keys.length === 0 ? this.lastView() : null;
    this.landing = keys.length === 0 && !remembered;
    if (remembered) {
      // Open on the tab and filters the user last used, and say so.
      this.pendingRestore = true;
      this.restore(remembered);
    }
    void loadPodChoices(this.podsApi, this.auth.has('Pod.View')).then((c) =>
      this.pods.set(c.options),
    );
  }

  /** Only Active and Due soon are restored as the landing view: Closed and Created by me are reference tabs reached on purpose. */
  protected override lastView(): QueueState | null {
    const view = super.lastView();
    return view && (view.view === null || view.view === 'active' || view.view === 'dueSoon')
      ? view
      : null;
  }

  protected override restoredLabel(view: QueueState): string | null {
    return TAB_LABELS[view.view && view.view in TAB_LABELS ? (view.view as TabKey) : 'active'];
  }

  protected override rememberView(): boolean {
    const remember = !this.skipRemember;
    this.skipRemember = false;
    return remember;
  }

  protected override loaded(data: MyWorkData): void {
    touchVisit(this.userId(), this.clock.now().getTime());
    if (!this.landing) return;
    this.landing = false;
    const next = firstNonEmptyTab(data.counts);
    if (next === 'active') return;
    this.skipRemember = true;
    this.filters.showNotice(`Nothing is assigned to you, so this opens ${TAB_LABELS[next]}.`);
    this.navigate({ ...this.state(), view: next, page: 1, sort: null, dir: null }, true);
  }

  protected override shouldLoad(params: ParamMap): boolean {
    if (this.pendingRestore) {
      if (params.keys.length === 0) return false;
      this.pendingRestore = false;
    }
    return true;
  }

  protected override podName(id: number): string | null {
    return this.pods().find((p) => p.id === id)?.name ?? null;
  }

  protected override podFilterOptions(): FilterOption[] {
    return this.pods().map((p) => ({ value: String(p.id), label: p.name }));
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
    if (this.filters.noticeMessage()) this.filters.dismissRestored();
    const next = (key in TAB_LABELS ? key : 'active') as TabKey;
    const s = this.state();
    // The new tab owns some columns and offers some statuses: what it cannot use is dropped, so the counts of all tabs agree.
    const kept = withoutFilters(s.filters, OWNED[next]);
    const status = kept.status.filter((code) => STATUSES[next].includes(code));
    this.navigate({
      ...s,
      view: next === 'active' ? null : next,
      page: 1,
      sort: null,
      dir: null,
      filters: { ...kept, status },
    });
  }

  protected showOlder(): void {
    const s = this.state();
    this.navigate({ ...s, filters: { ...s.filters, completedFrom: '2000-01-01' }, page: 1 });
  }
}
