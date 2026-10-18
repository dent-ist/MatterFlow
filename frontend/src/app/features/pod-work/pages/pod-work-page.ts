import { ColumnsNotice } from '../../../shared/work-queue/columns-notice';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import { ParamMap } from '@angular/router';
import { Observable } from 'rxjs';
import {
  PodWorkClient,
  PodWorkPage as PodWorkData,
  TaskQueueRow,
} from '../../../api/generated/api-client';
import { PageTitle } from '../../../core/title/page-title';
import { loadLastPod, saveLastPod } from '../../../shared/work-queue/column-prefs';
import { FilterOption } from '../../../shared/filters/filter-def';
import { FiltersBar } from '../../../shared/filters/filters-bar';
import { ListFilters } from '../../../shared/filters/list-filters';
import { queueFilterDefs, withoutFilters } from '../../../shared/filters/queue-defs';
import { OPEN_STATUSES, QueueState, queueArgs } from '../../../shared/work-queue/queue-filters';
import { PodOption } from '../../../shared/work-queue/pod-options';
import { QueuePageBase } from '../../../shared/work-queue/queue-page';
import { WorkViewControls } from '../../../shared/work-queue/work-view-controls';
import { WorkList } from '../../../shared/work-queue/work-list';
import { WorkStrip, WorkStripItem } from '../../../shared/work-queue/work-strip';
import { WorkTab, WorkTabs } from '../../../shared/work-queue/work-tabs';
import { FixedPage, ScrollArea } from '../../../shared/ui/fixed-page';
import { PageHeader } from '../../../shared/ui/page-header';

type TabKey = 'queue' | 'members' | 'attention' | 'all';

/**
 * Pod Work (UX S04, ticket 50): the open work of one Pod. A filtered view, not a security boundary: everyone with Task.View can
 * see every Task in the Task Queue. Tabs: the Pod queue (assigned to the Pod but to nobody), By member (workload facts per person,
 * never a ranking), Overdue and On Hold, and All. Anyone with Task.Assign can take an unassigned task with "Assign to me".
 */
@Component({
  selector: 'mf-pod-work-page',
  imports: [
    ColumnsNotice,
    FixedPage,
    PageHeader,
    ScrollArea,
    FiltersBar,
    WorkList,
    WorkStrip,
    WorkTabs,
    WorkViewControls,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: '../../../shared/work-queue/work-page.scss',
  template: `
    <mf-fixed-page>
      <mf-page-header heading="Pod Work">
        @if (pods().length > 0) {
          <div mfActions class="wp-field wp-field--inline">
            <label for="pw-pod">Pod</label>
            <select
              id="pw-pod"
              class="mf-control wp-select"
              [value]="data()?.pod?.podId ?? ''"
              (change)="selectPod($any($event.target).value)"
            >
              @if (!data()?.pod) {
                <option value="" selected>Choose a Pod</option>
              }
              @if (yourPods().length > 0) {
                <optgroup label="Your pods">
                  @for (p of yourPods(); track p.podId) {
                    <option [value]="p.podId" [selected]="p.podId === data()?.pod?.podId">
                      {{ p.name }}{{ p.isPrimary ? ' (primary)' : '' }}
                    </option>
                  }
                </optgroup>
              }
              @if (otherPods().length > 0) {
                <optgroup label="Other pods">
                  @for (p of otherPods(); track p.podId) {
                    <option [value]="p.podId" [selected]="p.podId === data()?.pod?.podId">
                      {{ p.name }}
                    </option>
                  }
                </optgroup>
              }
            </select>
          </div>
        }
      </mf-page-header>

      @if (columnsNotice()) {
        <mf-columns-notice
          [offerMatter]="offerMatter()"
          (addMatter)="addMatterColumn()"
          (dismiss)="dismissNotice()"
        />
      }

      @if (loadState() === 'ready' && pods().length === 0) {
        <div class="wl-empty-note" data-empty="no-pod" role="status">
          You aren't in a pod yet. Ask an administrator.
        </div>
      } @else if (loadState() === 'ready' && !data()?.pod) {
        <div class="wl-empty-note" data-empty="choose" role="status">
          Choose a Pod to see its work.
        </div>
      } @else {
        <mf-work-strip label="Pod summary" [items]="summaryItems()" />

        <div class="wp-tabrow" data-tab-row>
          <mf-work-tabs
            label="Pod Work views"
            idPrefix="pw"
            [tabs]="tabs()"
            [selected]="tab()"
            (selectedChange)="selectTab($event)"
          />
        </div>

        <div
          class="mf-fill"
          role="tabpanel"
          id="pw-panel"
          [attr.aria-labelledby]="'pw-tab-' + tab()"
        >
          @if (tab() === 'members') {
            @if (data(); as d) {
              @if (d.memberLoads.length === 0) {
                <p class="wp-note" data-members-empty>No members yet.</p>
              } @else {
                <div class="mf-scroll wp-members-wrap" mfScrollArea="Pod members">
                  <table class="wp-members" data-members>
                    <caption class="wp-help">
                      Open work per person. These are workload facts, not a ranking.
                    </caption>
                    <thead>
                      <tr>
                        <th scope="col">Member</th>
                        <th scope="col">Open</th>
                        <th scope="col">Overdue</th>
                        <th scope="col">On Hold</th>
                        <th scope="col"><span class="wp-sr">Show tasks</span></th>
                      </tr>
                    </thead>
                    <tbody>
                      @for (m of d.memberLoads; track m.userId) {
                        <tr>
                          <th scope="row">
                            {{ m.displayName }}
                            @if (!m.isActive) {
                              <span class="wp-note">(inactive)</span>
                            }
                          </th>
                          <td>{{ m.open }}</td>
                          <td>{{ m.overdue }}</td>
                          <td>{{ m.onHold }}</td>
                          <td>
                            <button
                              type="button"
                              class="mf-btn"
                              [attr.aria-pressed]="state().filters.assignee.includes(m.userId)"
                              [attr.aria-label]="'Show tasks of ' + m.displayName"
                              (click)="toggleMember(m.userId)"
                            >
                              Show tasks
                            </button>
                          </td>
                        </tr>
                      }
                    </tbody>
                  </table>
                </div>
              }
            }
          }

          <mf-filters-bar
            [filters]="filters"
            controls="work-filter-row"
            [stacked]="true"
            (showColumn)="showColumn($event)"
          >
            <mf-work-view-controls
              [sort]="state().sort"
              [dir]="state().dir"
              [columns]="prefs().columns"
              [density]="prefs().density"
              (resetSort)="resetSort()"
              (columnsChange)="setColumns($event)"
              [defaultColumns]="columnDefaults()"
              (densityChange)="setDensity($event)"
            />
          </mf-filters-bar>
          <mf-work-list
            from="pod-work"
            [rows]="rows()"
            [total]="total()"
            [page]="state().page"
            [pageSize]="state().pageSize"
            [state]="loadState()"
            [columns]="prefs().columns"
            [density]="prefs().density"
            [sort]="tableSort()"
            [dir]="tableDir()"
            [filtered]="filtered()"
            [filters]="filters"
            [caption]="caption()"
            [scope]="tabLabel()"
            [emptyText]="emptyText()"
            [assignLink]="canAssign()"
            (sortChange)="sortBy($event)"
            (pageChange)="goToPage($event)"
            (pageSizeChange)="setPageSize($event)"
            (retry)="load()"
            (clearFilters)="clearFilters()"
            (rowChange)="replaceRow($event)"
            (columnsShown)="shownColumns.set($event)"
          />
        </div>
      }
    </mf-fixed-page>
  `,
})
export class PodWorkPage extends QueuePageBase<PodWorkData> {
  private readonly api = inject(PodWorkClient);

  protected readonly tab = computed<TabKey>(() => {
    const view = this.state().view;
    return view === 'members' || view === 'attention' || view === 'all' ? view : 'queue';
  });

  private readonly defs = computed(() => {
    const lookups = this.queueLookups();
    return queueFilterDefs(lookups, {
      // The Pod is the scope of the page (the picker in the header), not a filter.
      omit: ['pod'],
      disabled:
        this.tab() === 'queue'
          ? { assignee: () => 'This tab lists the tasks nobody holds yet.' }
          : {},
      // Pod Work lists open tasks only.
      statuses: () => (lookups.statuses ?? []).filter((o) => OPEN_STATUSES.includes(o.value)),
      names: {
        client: (id) => this.recordName('client', id),
        matter: (id) => this.recordName('matter', id),
        project: (id) => this.recordName('project', id),
      },
    });
  });

  protected readonly filters = new ListFilters({
    screen: 'pod-work',
    noun: 'tasks',
    // The work list announces the results (view, count and range) in one message.
    announceResults: false,
    openByDefault: true,
    defs: this.defs,
    visibleColumns: this.shownColumns,
  });

  protected readonly pods = computed(() => this.data()?.pods ?? []);
  protected readonly yourPods = computed(() => this.pods().filter((p) => p.isMember));
  protected readonly otherPods = computed(() => this.pods().filter((p) => !p.isMember));
  protected readonly podOptions = signal<PodOption[]>([]);
  protected readonly canAssign = computed(
    () => this.auth.has('Task.Assign') && this.tab() !== 'members',
  );

  /** The Pod's header numbers (counts equal the tab totals, UAT-S04-6): facts about the work, never a ranking. */
  protected readonly summaryItems = computed<WorkStripItem[]>(() => {
    const sum = this.data()?.summary;
    return [
      { key: 'unassigned', label: 'Unassigned', count: sum?.unassignedToPerson ?? null },
      { key: 'assigned', label: 'Assigned', count: sum?.assigned ?? null },
      { key: 'overdue', label: 'Overdue', count: sum?.overdue ?? null, alert: true },
      { key: 'onHold', label: 'On Hold', count: sum?.onHold ?? null },
    ];
  });

  protected readonly tabs = computed<WorkTab[]>(() => {
    const counts = this.data()?.counts;
    return [
      { key: 'queue', label: 'Unassigned', count: counts?.queue ?? null },
      { key: 'members', label: 'By member', count: counts?.members ?? null },
      { key: 'attention', label: 'Overdue and on hold', count: counts?.attention ?? null },
      { key: 'all', label: 'All pod tasks', count: counts?.all ?? null },
    ];
  });

  protected override columnTab(): string {
    return this.tab();
  }

  protected readonly tabLabel = computed(
    () => this.tabs().find((t) => t.key === this.tab())?.label ?? '',
  );

  /** "Pod Work: Unassigned (Pod A)": the page, the tab and, after it, the Pod (M8). */
  protected readonly caption = computed(() => {
    const pod = this.data()?.pod?.name;
    return `Pod Work: ${this.tabLabel()}${pod ? ` (${pod})` : ''}`;
  });

  protected readonly emptyText = computed(() => {
    const name = this.data()?.pod?.name ?? 'this Pod';
    switch (this.tab()) {
      case 'queue':
        return `Nothing waiting in ${name}.`;
      case 'members':
        return `Nobody in ${name} has open work.`;
      case 'attention':
        return `Nothing overdue or on hold in ${name}.`;
      default:
        return `No open tasks in ${name}.`;
    }
  });

  /** The remembered Pod is applied once, when the URL names none. */
  private pendingRemembered = false;

  private readonly pageTitle = inject(PageTitle);

  constructor() {
    super('pod-work');
    effect(() => this.pageTitle.pin(`Pod Work: ${this.tabLabel()}`));
    inject(DestroyRef).onDestroy(() => this.pageTitle.unpin());
    const keys = this.route.snapshot?.queryParamMap?.keys ?? [];
    const remembered = loadLastPod(this.userId());
    if (!keys.includes('podId') && remembered !== null) {
      this.pendingRemembered = true;
      this.navigate({ ...this.state(), podId: remembered }, true);
    }
  }

  protected override shouldLoad(params: ParamMap): boolean {
    if (this.pendingRemembered) {
      if (!params.has('podId')) return false;
      this.pendingRemembered = false;
    }
    return true;
  }

  protected override fetch(state: QueueState): Observable<PodWorkData> {
    return this.api.getPodWork(
      state.podId ?? undefined,
      this.tab(),
      ...queueArgs(state, { omitPod: true }),
    );
  }

  protected override loaded(data: PodWorkData): void {
    this.podOptions.set(data.pods.map((p) => ({ id: p.podId, name: p.name })));
    if (data.pod) saveLastPod(this.userId(), data.pod.podId);
    else if (this.state().podId === null) {
      // No Pod chosen or remembered: open the user's primary pod, or their only pod (UXR-30).
      const mine = data.pods.filter((p) => p.isMember);
      const pick = mine.find((p) => p.isPrimary) ?? (mine.length === 1 ? mine[0] : null);
      if (pick) this.navigate({ ...this.state(), podId: pick.podId }, true);
    }
  }

  protected override podName(id: number): string | null {
    return this.pods().find((p) => p.podId === id)?.name ?? null;
  }

  protected override podFilterOptions(): FilterOption[] {
    return [];
  }

  protected selectPod(value: string): void {
    const podId = Number(value);
    if (!Number.isInteger(podId) || podId <= 0) return;
    this.navigate({
      ...this.state(),
      podId,
      page: 1,
      filters: { ...this.state().filters, assignee: [] },
    });
  }

  protected selectTab(key: string): void {
    if (key === this.tab()) return;
    // The person filter starts again on every tab (By member sets it with "Show tasks"); the Unassigned tab owns it.
    this.navigate({
      ...this.state(),
      view: key === 'queue' ? null : key,
      page: 1,
      sort: null,
      dir: null,
      filters: withoutFilters(this.state().filters, ['assignee']),
    });
  }

  protected toggleMember(userId: number): void {
    const s = this.state();
    const assignee = s.filters.assignee.includes(userId) ? [] : [userId];
    this.navigate({ ...s, page: 1, filters: { ...s.filters, assignee } });
  }

  /** An assigned task no longer belongs in the Unassigned tab: its row shows the new assignee, then leaves (Undo keeps it). */
  protected override leavesView(row: TaskQueueRow): boolean {
    return this.tab() === 'queue' && !!row.assignedUser;
  }

  protected override leftText(row: TaskQueueRow): string {
    return `assigned to ${row.assignedUser?.displayName ?? 'someone'}. Removed from ${this.tabLabel()}.`;
  }

  /** The tab counts and the header numbers follow the assignment while the row is still on screen. */
  protected override mergeCounts(current: PodWorkData, fresh: PodWorkData): PodWorkData {
    return { ...current, counts: fresh.counts, summary: fresh.summary };
  }
}
