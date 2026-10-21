import { isFinishedOnly } from '../../../shared/work-queue/closed-suggestion';
import { ColumnsNotice } from '../../../shared/work-queue/columns-notice';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import { ParamMap, RouterLink } from '@angular/router';
import { Observable } from 'rxjs';
import {
  PodWorkClient,
  PodWorkPage as PodWorkData,
  TaskQueueRow,
} from '../../../api/generated/api-client';
import { PageTitle } from '../../../core/title/page-title';
import { ColumnScope, loadLastPod, saveLastPod } from '../../../shared/work-queue/column-prefs';
import { ColumnWidthMap, pxToRem } from '../../../shared/work-queue/column-widths';
import { viewportAtLeast } from '../../../shared/ui/viewport';
import { FilterOption } from '../../../shared/filters/filter-def';
import { FiltersBar } from '../../../shared/filters/filters-bar';
import { ListFilters } from '../../../shared/filters/list-filters';
import { queueFilterDefs, withoutFilters } from '../../../shared/filters/queue-defs';
import { OPEN_STATUSES, QueueState, queueArgs } from '../../../shared/work-queue/queue-filters';
import { PodOption } from '../../../shared/work-queue/pod-options';
import { QueuePageBase } from '../../../shared/work-queue/queue-page';
import { WorkViewControls } from '../../../shared/work-queue/work-view-controls';
import { PhoneSort } from '../../../shared/work-queue/phone-sort';
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
    PhoneSort,
    RouterLink,
    WorkList,
    WorkStrip,
    WorkTabs,
    WorkViewControls,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: '../../../shared/work-queue/work-page.scss',
  styles: `
    /* The title never wraps (BUG-1, #548): it keeps its words together and the Pod select gives way, not the title. */
    .pw-title {
      white-space: nowrap;
    }
    /*
     * The Pod select is capped at 22rem with a definite width, so the header's column sizes itself from the cap and not from the longest
     * pod name in the system (a 76-character name made the actions 560 px wide and pushed the select out of the window at 768 px). The
     * extra class names beat the page header's own selector rule for a selector in the actions (same cap, but as a percentage, which a
     * grid cannot use to size a column).
     */
    .pw-pod.pw-pod.pw-pod {
      min-width: 0;
      max-width: 100%;
    }
    .pw-pod-select.pw-pod-select.pw-pod-select {
      flex: 0 1 auto;
      width: auto;
      min-width: 0;
      max-width: 22rem;
      text-overflow: ellipsis;
    }
    /* 640 to 899 px, Unassigned tab: the Assignee cell is the "Assign to me" link and the menu's chevron (#550). The accessible name of the
       menu button still says "Unassigned, change assignee of TSK-n". */
    /* An empty pod: one message with its action (BUG-6, #555). */
    .pw-empty {
      display: grid;
      gap: var(--mf-s2);
      justify-items: start;
      padding: var(--mf-s4) 0;
    }
    .pw-empty__text {
      margin: 0;
      color: var(--mf-text-muted);
    }
    .pw-linkonly ::ng-deep td[data-col='assignee'] .re-with-link .im-value {
      display: none;
    }
  `,
  template: `
    <mf-fixed-page>
      <mf-page-header heading="Pod Work">
        <span mfTitle class="pw-title">Pod Work</span>
        @if (pods().length > 0) {
          <div mfActions class="wp-field wp-field--inline pw-pod" data-ph-selector>
            <label for="pw-pod">Pod</label>
            <select
              id="pw-pod"
              class="mf-control mf-control--compact wp-select pw-pod-select"
              [attr.title]="data()?.pod?.name ?? null"
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
          [class.pw-linkonly]="linkOnly()"
          role="tabpanel"
          id="pw-panel"
          [attr.aria-labelledby]="'pw-tab-' + tab()"
        >
          @if (tab() === 'members') {
            @if (data(); as d) {
              @if (d.memberLoads.length === 0) {
                <div class="pw-empty" data-members-empty role="status" tabindex="-1">
                  <p class="pw-empty__text">No members yet.</p>
                  @if (canAddMembers() && d.pod) {
                    <a
                      class="wp-link"
                      data-add-members
                      routerLink="/admin/pods"
                      [queryParams]="{ pod: d.pod.podId }"
                      >Add members</a
                    >
                  }
                </div>
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

          @if (!emptyMembers()) {
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
                [finishedOnly]="finishedOnly()"
                [density]="prefs().density"
                (resetSort)="resetSort()"
                (columnsChange)="setColumns($event)"
                [defaultColumns]="columnDefaults()"
                [widthScope]="columnScope()"
                [widthUser]="userId()"
                [widthAssignLink]="canAssign()"
                (densityChange)="setDensity($event)"
              />
              <mf-phone-sort
                mfSheetSort
                [sort]="state().sort"
                [dir]="state().dir"
                (sortPick)="pickSort($event)"
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
              [colWidths]="gridWidths()"
              [skipLabel]="tab() === 'members' ? 'Skip to member table' : 'Skip to task list'"
              [skipFocus]="tab() === 'members' ? focusMembers : null"
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
              (columnResized)="onColumnResized($event)"
              (columnAction)="onColumnAction($event)"
            />
          }
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
      // The disabled Assignee cell says what the tab decides instead of being an empty grey box (as the My Work tabs do).
      fixed: this.tab() === 'queue' ? { assignee: () => 'Unassigned' } : {},
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
  /** Only finished tasks are listed: the Columns panel may suggest Closed instead of Due (#231). */
  protected readonly finishedOnly = computed(() => isFinishedOnly(this.state().filters.status));

  protected readonly canAssign = computed(
    () => this.auth.has('Task.Assign') && this.tab() !== 'members',
  );

  private readonly atLeast640 = viewportAtLeast(640);
  private readonly atLeast900 = viewportAtLeast(900);
  /** 640 to 899 px: the tablet band (below 640 px the list is cards, from 900 px the grid has room for everything). */
  private readonly tabletBand = computed(() => this.atLeast640() && !this.atLeast900());
  /** The Unassigned tab in the tablet band: the Assignee cell is the link only, so "Assign to me" is in the first view (#550). */
  protected readonly linkOnly = computed(
    () => this.tab() === 'queue' && this.canAssign() && this.tabletBand(),
  );

  /** An empty pod's By member tab is one message with its action: no workload table and no grid under it (BUG-6, #555). */
  protected readonly emptyMembers = computed(
    () =>
      this.tab() === 'members' &&
      this.loadState() === 'ready' &&
      (this.data()?.memberLoads.length ?? 1) === 0,
  );
  protected readonly canAddMembers = computed(() => this.auth.has('Pod.ManageMembers'));

  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  /**
   * "Skip to member table" on the By member tab (BUG-5, #553): focus goes to the first member row (its first control), or to the
   * "No members yet." message of an empty pod, not to the grid under the table. False lets the list take focus.
   */
  protected readonly focusMembers = (): boolean => {
    const root = this.host.nativeElement;
    const target =
      root.querySelector<HTMLElement>(
        '[data-members] tbody tr button, [data-members] tbody tr a',
      ) ?? root.querySelector<HTMLElement>('[data-members-empty]');
    target?.focus();
    return !!target;
  };

  /** The width of the Assignee column with the link only (the chevron, the link, the cell's padding); a width the person chose wins. */
  private static readonly LINK_ONLY_PX = 164;
  protected readonly gridWidths = computed<ColumnWidthMap>(() =>
    this.linkOnly()
      ? { assignee: pxToRem(PodWorkPage.LINK_ONLY_PX), ...this.colWidths() }
      : this.colWidths(),
  );

  /**
   * The Unassigned tab in the tablet band leaves Matter Number (and Matter Name) out of the default columns: they stay in the Columns
   * panel and in the card, and the Assignee cell, the one thing the tab is for, fits in the first view (#550). A column choice the person
   * made always wins over this default.
   */
  protected override defaultsFor(scope: ColumnScope): string[] {
    const base = super.defaultsFor(scope);
    return this.tab() === 'queue' && this.tabletBand()
      ? base.filter((k) => k !== 'matter' && k !== 'matterName')
      : base;
  }

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

  /** The tab counts, the header numbers and the member loads follow an assignment while the row is still on screen (BUG-3, #552). */
  protected override mergeCounts(current: PodWorkData, fresh: PodWorkData): PodWorkData {
    return {
      ...current,
      counts: fresh.counts,
      summary: fresh.summary,
      memberLoads: fresh.memberLoads,
    };
  }

  /**
   * The server's row (a new row version) is the moment the numbers are true: the counts read at the optimistic change race the write
   * and can show the old numbers (BUG-3, #552), so they are read again once the server has answered.
   */
  protected override replaceRow(row: TaskQueueRow): void {
    const before = this.data()?.items.find((r) => r.taskId === row.taskId)?.rowVersion;
    super.replaceRow(row);
    if (before !== undefined && row.rowVersion !== before) void this.refreshCounts();
  }

  /** A reassignment from the By member or the All tab changes the numbers too, not only the Unassigned tab's (BUG-3, #552). */
  protected override countsFollowEdits(): boolean {
    return true;
  }
}
