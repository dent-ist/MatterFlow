import { isFinishedOnly } from '../../../shared/work-queue/closed-suggestion';
import { ColumnsNotice } from '../../../shared/work-queue/columns-notice';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  Injector,
  afterNextRender,
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
import {
  OPEN_STATUSES,
  QueueState,
  dateDaysAgo,
  queueArgs,
} from '../../../shared/work-queue/queue-filters';
import { PodOption } from '../../../shared/work-queue/pod-options';
import { QueuePageBase } from '../../../shared/work-queue/queue-page';
import { WorkViewControls } from '../../../shared/work-queue/work-view-controls';
import { PhoneSort } from '../../../shared/work-queue/phone-sort';
import { WorkList } from '../../../shared/work-queue/work-list';
import { WorkTab, WorkTabs } from '../../../shared/work-queue/work-tabs';
import { FixedPage } from '../../../shared/ui/fixed-page';
import { PageHeader } from '../../../shared/ui/page-header';
import { PodMemberTable } from '../ui/pod-member-table';
import { PodPickerList, memberCountText } from '../ui/pod-picker-list';
import {
  PodStripKey,
  PodWorkStrip,
  activePodStripKey,
  podStripPatch,
  withoutStripFilters,
} from '../ui/pod-work-strip';

type TabKey = 'queue' | 'members' | 'all';

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
    PodMemberTable,
    PodPickerList,
    FiltersBar,
    PhoneSort,
    RouterLink,
    WorkList,
    PodWorkStrip,
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
    /*
     * By member (#566): the workload table grows with the page, so in the fixed layout the panel scrolls as a whole (the table, then the task
     * list under it) instead of the table getting a scroll box of its own. Below 768 px wide or 561 px high the page scrolls as it always does.
     */
    @media (min-width: 768px) and (min-height: 561px) {
      .pw-members-tab {
        overflow-y: auto;
        overscroll-behavior: contain;
      }
      .pw-members-tab > mf-work-list {
        min-height: 18rem;
      }
    }
    /*
     * The first screen of a phone (#570): the page's own rows are tight, so the title, the capped select, the context line, the chip row and
     * the three tabs leave the first card within 200 px of the title (it was 330 px). The tab row keeps the shared tabs component's own
     * overflow behaviour; with three tabs and a little less padding they fit at 375 px.
     */
    @media (max-width: 639.98px) {
      .pw-head {
        margin-bottom: var(--mf-s1);
      }
      .pw-head ::ng-deep .ph__row {
        row-gap: var(--mf-s1);
      }
      .wp-tabrow {
        margin-bottom: var(--mf-s1);
      }
      .wp-tabrow ::ng-deep .tabs {
        gap: 0;
      }
      .wp-tabrow ::ng-deep .tab {
        padding-inline: var(--mf-s1);
      }
      .wp-tabrow ::ng-deep .count {
        min-width: 2.2em;
      }
    }
    .pw-linkonly ::ng-deep td[data-col='assignee'] .re-with-link .im-value {
      display: none;
    }
  `,
  template: `
    <mf-fixed-page>
      <mf-page-header class="pw-head" heading="Pod Work" [description]="contextLine()">
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
      <span class="wp-sr" role="status" aria-live="polite" data-pod-announce>{{
        podAnnouncement()
      }}</span>

      @if (columnsNotice()) {
        <mf-columns-notice
          [offerMatter]="offerMatter()"
          (addMatter)="addMatterColumn()"
          (dismiss)="dismissNotice()"
        />
      }

      @if (loadState() === 'ready' && pods().length === 0) {
        <div class="pw-empty" data-empty="no-pods" role="status">
          <p class="pw-empty__text">There are no pods yet.</p>
          @if (canManagePods()) {
            <a
              class="wp-link"
              data-create-pod
              routerLink="/admin/pods"
              [queryParams]="{ pod: 'new' }"
              >Create a pod</a
            >
          } @else {
            <p class="pw-empty__text">Ask an administrator to create one.</p>
          }
        </div>
      } @else if (loadState() === 'ready' && !data()?.pod) {
        @if (!autoPick()) {
          <mf-pod-picker-list [pods]="pods()" (chosen)="chooseFromList($event)" />
        }
      } @else {
        <mf-pod-work-strip
          [summary]="data()?.summary ?? null"
          [active]="activeStrip()"
          (pick)="pickStrip($event)"
        />

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
          [class.pw-members-tab]="tab() === 'members' && !emptyMembers()"
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
                <mf-pod-member-table
                  [loads]="d.memberLoads"
                  [unassigned]="d.unassigned"
                  [selected]="state().filters.assignee"
                  (memberToggle)="toggleMember($event)"
                  (showUnassigned)="selectTab('queue')"
                />
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
    if (view === 'members') return 'members';
    // The retired Overdue and on hold tab (`view=attention`) opens All open (the page then adds the Overdue filter to the address).
    return view === 'all' || view === 'attention' ? 'all' : 'queue';
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
  /** The pod the page opens by itself (primary, else the only one): while it is about to be chosen the list of pods is not shown. */
  protected readonly autoPick = computed(() => {
    if (this.state().podId !== null) return false;
    const mine = this.yourPods();
    return mine.some((p) => p.isPrimary) || mine.length === 1;
  });
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
  /** "Create a pod" in the no-pods message is offered to people who may create one, and to nobody else (hidden, never disabled; #559). */
  protected readonly canManagePods = computed(() => this.auth.has('Pod.Manage'));

  /**
   * The one muted line under the title (W2, #557): "Demo Processing Pod . 23 members . you are a member (primary)". A part the page cannot
   * know is left out, never made up. Its whole text is the tooltip and the line stops at one row (the header clamps it).
   */
  protected readonly contextLine = computed(() => {
    const pod = this.data()?.pod;
    if (!pod) return '';
    const choice = this.pods().find((p) => p.podId === pod.podId);
    const parts = [pod.name];
    if (choice) {
      parts.push(memberCountText(choice.memberCount));
      parts.push(
        choice.isMember
          ? `you are a member${choice.isPrimary ? ' (primary)' : ''}`
          : 'you are not a member',
      );
    }
    return parts.join(' \u00b7 ');
  });

  /** The polite announcement of a pod change (no focus move): the live region's text changes only when the pod does. */
  protected readonly podAnnouncement = computed(() => {
    const name = this.data()?.pod?.name;
    return name ? `Showing the work of ${name}` : '';
  });

  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  /**
   * "Skip to member table" on the By member tab (BUG-5, #553): focus goes to the first member row (its first control), or to the
   * "No members yet." message of an empty pod, not to the grid under the table. False lets the list take focus.
   */
  protected readonly focusMembers = (): boolean => {
    const root = this.host.nativeElement;
    const target =
      root.querySelector<HTMLElement>(
        '[data-members] [data-member-row] button, [data-members] [data-member-row] a',
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

  /** Tabs (W6, #562): Unassigned (tasks), By member (people with open work) and All open (tasks); the strip opens the rest. */
  protected readonly tabs = computed<WorkTab[]>(() => {
    const counts = this.data()?.counts;
    return [
      { key: 'queue', label: 'Unassigned', count: counts?.queue ?? null },
      { key: 'members', label: 'By member', count: counts?.membersWithWork ?? null },
      { key: 'all', label: 'All open', count: counts?.all ?? null },
    ];
  });

  /** The strip item whose filter is on (All open tab only), so a second click can switch it off. */
  protected readonly activeStrip = computed<PodStripKey | null>(() =>
    this.tab() === 'all'
      ? activePodStripKey(this.state().filters, dateDaysAgo(this.clock.now(), 0, this.zone))
      : null,
  );

  protected override columnTab(): string {
    return this.tab();
  }

  protected readonly tabLabel = computed(
    () => this.tabs().find((t) => t.key === this.tab())?.label ?? '',
  );

  /** `Pod Work: Demo Processing Pod: By member` (the app name is added by the title service); `Pod Work` while no pod is shown (W2, #557). */
  protected readonly documentName = computed(() => {
    const pod = this.data()?.pod?.name;
    return pod ? `Pod Work: ${pod}: ${this.tabLabel()}` : 'Pod Work';
  });

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
      default:
        return `No open tasks in ${name}.`;
    }
  });

  /** The remembered Pod is applied once, when the URL names none. */
  private pendingRemembered = false;
  /** An old `view=attention` address is replaced once by All open with the Overdue filter (#562). */
  private pendingAttention = false;

  private readonly pageTitle = inject(PageTitle);
  private readonly injector = inject(Injector);
  /** A pod chosen from the list (#558): once its page is shown, focus goes to the title and the live region names the pod. */
  private focusTitleOnLoad = false;

  constructor() {
    super('pod-work');
    effect(() => this.pageTitle.pin(this.documentName()));
    inject(DestroyRef).onDestroy(() => this.pageTitle.unpin());
    const keys = this.route.snapshot?.queryParamMap?.keys ?? [];
    const remembered = loadLastPod(this.userId());
    let next = this.state();
    let replace = false;
    if (!keys.includes('podId') && remembered !== null) {
      this.pendingRemembered = true;
      next = { ...next, podId: remembered };
      replace = true;
    }
    if (this.route.snapshot?.queryParamMap?.get('view') === 'attention') {
      // The Overdue and on hold tab is retired: its address opens All open with the Overdue filter (the strip's Overdue item, #561).
      this.pendingAttention = true;
      next = { ...next, view: 'all', page: 1, filters: { ...next.filters, overdue: true } };
      replace = true;
    }
    if (replace) this.navigate(next, true);
  }

  protected override shouldLoad(params: ParamMap): boolean {
    if (this.pendingRemembered) {
      if (!params.has('podId')) return false;
      this.pendingRemembered = false;
    }
    if (this.pendingAttention) {
      if (params.get('view') === 'attention') return false;
      this.pendingAttention = false;
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
    if (data.pod && this.focusTitleOnLoad) {
      this.focusTitleOnLoad = false;
      afterNextRender(
        () => {
          const heading = this.host.nativeElement.querySelector<HTMLElement>('[data-page-title]');
          heading?.setAttribute('tabindex', '-1');
          heading?.focus();
        },
        { injector: this.injector },
      );
    }
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

  /** A pod chosen from the list of pods (#558): the same as the select, and focus goes to the title once its work is shown. */
  protected chooseFromList(podId: number): void {
    this.focusTitleOnLoad = true;
    this.selectPod(String(podId));
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

  /**
   * A strip item applies its filter on All open (switching to it, keeping the pod) and replaces any other strip item; the pressed one
   * switches off. The address carries the filter, so Back and bookmarks work (#561).
   */
  protected pickStrip(key: PodStripKey): void {
    const s = this.state();
    const base = withoutStripFilters(s.filters);
    const patch =
      key === this.activeStrip()
        ? {}
        : podStripPatch(key, dateDaysAgo(this.clock.now(), 0, this.zone));
    this.navigate({ ...s, view: 'all', page: 1, filters: { ...base, ...patch } });
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
