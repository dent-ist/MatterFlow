import { toSignal } from '@angular/core/rxjs-interop';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  Injector,
  afterNextRender,
  computed,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { PageTitle } from '../../../core/title/page-title';
import { CreateTaskContext } from '../../../shared/layout/create-task-context';
import { AuthStore } from '../../../core/auth/auth.store';
import { OptionsMenu } from '../../../shared/ui/options-menu';
import { ErrorReference } from '../../../shared/ui/error-reference';
import { PageHeader } from '../../../shared/ui/page-header';
import { ScopeSwitch } from '../../../shared/scope/scope-switch';
import { phoneCards } from '../../../shared/ui/record-card-list';
import { MfTab, Tabs } from '../../../shared/ui/tabs';
import { MyMattersFocus } from '../focus';
import { FocusChip, FocusControl, ScopeChip } from '../focus-control';
import { MyMattersActiveFilters } from '../my-matters-active-filters';
import { MyMattersFilterBar } from '../my-matters-filter-bar';
import { ManagedMatters } from '../managed-matters';
import { NewTaskControl } from '../new-task-control';
import {
  DEFAULT_FILTERS,
  MmFilters,
  activeFilterCount,
  filtersToParams,
  parseFilters,
} from '../my-matters-filters';
import { LoadGroup } from '../panel-loader';
import { CalendarToggle } from '../calendar-toggle';
import { CalendarPanel } from '../panels/calendar-panel';
import { parseMonth } from '../calendar-month';
import { TaskGrid } from '../panels/task-grid';
import { SincePanel, SinceFeed } from '../panels/since-panel';
import { ActivityTab } from '../tabs/activity-tab';
import { BreakdownTab } from '../tabs/breakdown-tab';
import { DataTab } from '../tabs/data-tab';

/** The tabs (`?tab=`; Overview is the page as it was and is absent from the address). The Deadlines tab (issue #929) and the Trends tab (issue #947) are gone: `?tab=deadlines` and `?tab=trends` open the Overview. */
export const MM_TABS = ['overview', 'breakdown', 'data', 'activity'] as const;
export type MmTab = (typeof MM_TABS)[number];
const TAB_LABELS: Record<MmTab, string> = {
  overview: 'Overview',
  breakdown: 'Breakdown',
  data: 'Data',
  activity: 'Activity',
};

/** How long the page may hold its body back for the answers that decide its layout (a slow server never leaves it blank). */
const HOLD_MS = 1200;

const FILTER_KEYS = ['scope', 'role', 'clientId', 'matterId', 'managerId', 'show'] as const;

function same(a: MmFilters, b: MmFilters): boolean {
  return (
    a.scope === b.scope &&
    a.role === b.role &&
    a.clientId === b.clientId &&
    a.matterId === b.matterId &&
    a.managerId === b.managerId &&
    a.show === b.show
  );
}

function storage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

/**
 * My Matters (epic #667, README 6): the Project Manager's home. ONE grid of the open tasks (epic #893 issue #943) with a pre-filter dropdown that carries the counts
 * (issue #942), in the urgency order of #935, or the Calendar in its place. "Since your last visit" and the events are on the Activity tab, whose
 * badge carries the number of changes. Each part
 * loads and fails on its own. The matters are "mine" (primary or secondary manager) by default, a default view and not a limit on access; with `Matter.AssignManagers` the scope can be
 * All matters. The filters (client, role, dates, scope, project manager) live in the address, so Back restores them; the last filters are also remembered per person in the browser
 * as a convenience. One scrolling page, no nested scroll boxes. Different from the department Dashboard: it answers "what is on fire on my matters", not "how is the department
 * doing". Workload and capacity of technicians is not shown here (owner decision, #826).
 */
@Component({
  selector: 'mf-my-matters-page',
  imports: [
    CalendarPanel,
    CalendarToggle,
    ErrorReference,
    FocusChip,
    FocusControl,
    MyMattersActiveFilters,
    MyMattersFilterBar,
    NewTaskControl,
    OptionsMenu,
    PageHeader,
    RouterLink,
    ScopeChip,
    ScopeSwitch,
    SincePanel,
    TaskGrid,
    Tabs,
    ActivityTab,
    BreakdownTab,
    DataTab,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [ManagedMatters, LoadGroup, SinceFeed],
  styles: `
    :host {
      display: block;
    }
    /* One column (issue #903): the grid of tasks (issue #943), or the calendar in its place. */
    .mm__stack {
      display: grid;
      gap: var(--mf-s3);
      min-width: 0;
    }
    .mm__stack > * {
      min-width: 0;
    }
    .mm__since {
      margin-bottom: var(--mf-s1);
    }
    /* The calm Overview is tight above its first list (issue #903): 8 px, not 16, under the title row and under the tab strip. The page header's own
       numbers (22 px title, 36 px row, 12 px from the top) are untouched. */
    mf-page-header {
      margin-bottom: var(--mf-s2);
    }
    .mm__tabs {
      margin-bottom: var(--mf-s1);
    }
    .mm__none {
      display: grid;
      gap: var(--mf-s2);
      justify-items: start;
      margin: 0 0 var(--mf-s3);
    }
    .mm__none p {
      margin: 0;
    }
    .mm__muted {
      color: var(--mf-text-muted);
    }
    .mm__link {
      color: var(--mf-link);
    }
    @media (max-width: 639.98px) {
      .mm__none .mf-btn,
      .mm__link {
        display: inline-flex;
        align-items: center;
        min-height: 44px;
      }
    }
    /* Held, not removed: the body is laid out but not painted, so what changes while it is held (the bar, the lists) moves nothing the person sees,
       and showing it moves nothing either. */
    .mm__hold {
      visibility: hidden;
    }
    .mm__top {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      column-gap: var(--mf-s4);
    }
    .mm__top > * {
      min-width: 0;
    }
    .mm__banner {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: var(--mf-s2) var(--mf-s3);
      margin: 0 0 var(--mf-s2);
      padding: var(--mf-s2) var(--mf-s3);
      border: 1px solid var(--mf-danger);
      border-radius: var(--mf-radius);
      background: var(--mf-danger-bg);
    }
    .mm__banner-text {
      font-weight: 600;
    }
    .mm__banner mf-error-reference {
      margin: 0;
    }
    @media (max-width: 639.98px) {
      .mm__banner .mf-btn {
        min-height: 44px;
      }
    }
    .mm__loading {
      margin: 0;
      color: var(--mf-text-muted);
    }
    /* On a phone the tabs and the chevrons that page the strip are 44 px targets (the root font is 14 px, so 2.75rem falls short). */
    @media (max-width: 639.98px) {
      :host ::ng-deep .mm__tabs .tab {
        min-height: 44px;
      }
      :host ::ng-deep .mm__tabs .cue {
        bottom: 0;
      }
    }
    /* No sentence under the title (issue #904): the scope switch beside it says which matters these are, and its tooltip says what that means. The
       sentence stays in the page for screen readers only, at every width. */
    :host ::ng-deep [data-page-description] {
      position: absolute;
      width: 1px;
      height: 1px;
      margin: 0;
      overflow: hidden;
      clip-path: inset(50%);
      white-space: nowrap;
    }
  `,
  template: `
    <mf-page-header heading="My Matters" [description]="description()">
      <!-- ONE Options menu in the title row at every width (issues #900, #922): the scope switch and the Focus checklist live in it (and, on a phone, the
           matters for a new task), so the title row is the title, Options and New task. New task stays outside it, always in sight. A block projects into the
           header only with ONE root element, so each piece has its own condition. -->
      @if (phone()) {
        <mf-mm-filter-bar
          mfActions
          [filters]="filters()"
          [active]="barActive()"
          (filterChange)="update($event)"
          (clear)="clear()"
          (clientName)="clientName.set($event)"
          (managerName)="managerName.set($event)"
          (matterName)="matterName.set($event)"
        />
      }
      <mf-options-menu
        mfActions
        data-header-options
        label="My Matters"
        [wide]="true"
        [active]="headerActive()"
        (opened)="focusList.reset()"
      >
        @if (canAll()) {
          <div data-options-pick>
            <mf-scope-switch
              [scope]="filters().scope"
              [canAll]="canAll()"
              allLabel="All matters"
              [description]="scopeText()"
              (scopeChange)="
                update({ scope: $event, managerId: $event === 'mine' ? null : filters().managerId })
              "
            />
          </div>
        }
        <mf-mm-focus #focusList />
        @if (phone()) {
          <mf-mm-new-task [inline]="true" [matterId]="filters().matterId" />
        }
      </mf-options-menu>
      @if (!phone()) {
        <mf-mm-new-task mfActions [matterId]="filters().matterId" />
      }
    </mf-page-header>

    <!-- Everything under the title row waits for the two answers that decide whether something is drawn above it (the matters, for the Client / Role bar, and the
         lists), for at most HOLD_MS: the lists then appear in one step and nothing moves (issue #921, layout shift under 0.05). -->
    <div class="mm__body" [class.mm__hold]="hold()" data-mm-body>
      @if (phone()) {
        <mf-mm-active-filters
          [filters]="filters()"
          [clientName]="clientName()"
          [managerName]="managerName()"
          [matterName]="matterName()"
          (remove)="update($event)"
        />
      }

      @if (loads.many()) {
        <!-- Two or more requests failed (a dropped connection fails all of them): ONE message and ONE Retry for the page (issue #921). -->
        <div class="mm__banner" role="alert" data-page-error>
          <span class="mm__banner-text">Couldn't load My Matters.</span>
          <mf-error-reference />
          <button type="button" class="mf-btn" data-page-retry (click)="loads.retryAll()">
            Retry
          </button>
        </div>
      }

      <!-- The filters and the Focus chip share a line where the width allows (issue #899) and wrap to rows where it does not. -->
      <div class="mm__top">
        @if (!phone()) {
          <mf-mm-filter-bar
            [filters]="filters()"
            [active]="barActive()"
            (filterChange)="update($event)"
            (clear)="clear()"
            (clientName)="clientName.set($event)"
            (managerName)="managerName.set($event)"
          />
        }
        <mf-mm-focus-chip />
        <mf-mm-scope-chip
          [scope]="filters().scope"
          (back)="update({ scope: 'mine', managerId: null })"
        />
      </div>

      <mf-tabs
        class="mm__tabs"
        label="My Matters sections"
        idPrefix="mm"
        [tabs]="tabList()"
        [selected]="tab()"
        (tabChange)="selectTab($event)"
      />
      <div
        class="mm__panel"
        role="tabpanel"
        id="mm-panel"
        [attr.aria-labelledby]="'mm-tab-' + tab()"
        data-mm-tabpanel
      >
        @switch (tab()) {
          @case ('breakdown') {
            @defer (on immediate) {
              <mf-mm-breakdown-tab [filters]="filters()" />
            } @placeholder {
              <p class="mm__loading" role="status">Loading breakdown</p>
            }
          }
          @case ('data') {
            @defer (on immediate) {
              <mf-mm-data-tab
                [filters]="filters()"
                [canAll]="canAll()"
                (showAll)="update({ scope: 'all' })"
              />
            } @placeholder {
              <p class="mm__loading" role="status">Loading data</p>
            }
          }
          @case ('activity') {
            <!-- What changed since the last visit (owner decision of 2026-10-28): not drawn on the Overview any more, shown here, with Mark as read; its number
                 is the badge on this tab. -->
            <mf-mm-since class="mm__since" />
            @defer (on immediate) {
              <mf-mm-activity-tab [filters]="filters()" (marked)="since.loader.load()" />
            } @placeholder {
              <p class="mm__loading" role="status">Loading activity</p>
            }
          }
          @default {
            @if (noMatters() && !calendarShown()) {
              <!-- The Matters section is gone (issue #945), but a manager with no matter still gets this positive line and the way on. -->
              <div class="mm__none" data-empty data-empty-kind="none">
                <p data-no-matters>You are not the project manager of any matter yet.</p>
                @if (canAll()) {
                  <button
                    type="button"
                    class="mf-btn"
                    data-show-all
                    (click)="update({ scope: 'all' })"
                  >
                    Show all matters
                  </button>
                } @else {
                  <p class="mm__muted">Ask a director to assign you.</p>
                }
                @if (canMyWork()) {
                  <a class="mm__link" routerLink="/my-work" data-to-my-work>Go to My Work</a>
                }
              </div>
            } @else {
              <div class="mm__stack">
                @if (calendarShown()) {
                  <!-- The Calendar button of the task area (issues #929, #944): the calendar replaces the grid, "Show list" brings it back. It is its own lazy chunk. -->
                  @defer (on immediate) {
                    <mf-mm-calendar
                      [filters]="filters()"
                      [month]="calendarMonth()"
                      (monthChange)="setMonth($event)"
                      (closed)="setCalendar(false)"
                    />
                  } @placeholder {
                    <p class="mm__loading" role="status">Loading calendar</p>
                  }
                } @else {
                  <mf-mm-grid
                    [filters]="filters()"
                    [showMatter]="showMatter()"
                    [only]="oneMatter()"
                    (filterChange)="update($event)"
                  >
                    <mf-mm-calendar-toggle mfGridActions (flip)="setCalendar(true)" />
                  </mf-mm-grid>
                }
              </div>
            }
          }
        }
      </div>
    </div>
  `,
})
export class MyMattersPage {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly auth = inject(AuthStore);
  private readonly pageTitle = inject(PageTitle);
  private readonly managed = inject(ManagedMatters);
  private readonly focus = inject(MyMattersFocus);
  protected readonly since = inject(SinceFeed);
  protected readonly loads = inject(LoadGroup);
  private readonly createContext = inject(CreateTaskContext);

  private readonly params = toSignal(this.route.queryParamMap, {
    initialValue: this.route.snapshot.queryParamMap,
  });

  protected readonly phone = phoneCards();
  protected readonly canAll = computed(() => this.auth.has('Matter.AssignManagers'));
  protected readonly filters = computed(() => parseFilters(this.params(), this.canAll()), {
    equal: same,
  });
  protected readonly active = computed(() => activeFilterCount(this.filters()));
  /** The tab in the address (`?tab=`); Overview when absent or unknown. */
  protected readonly tab = computed<MmTab>(() => {
    const t = this.params().get('tab');
    return MM_TABS.includes(t as MmTab) && this.offered(t as MmTab) ? (t as MmTab) : 'overview';
  });
  /** The Data tab is for people who may see assets (the Data API needs `Asset.View`). */
  protected readonly tabList = computed<MfTab[]>(() =>
    MM_TABS.filter((key) => this.offered(key)).map((key) => {
      const tab: MfTab = { key, label: TAB_LABELS[key] };
      // The changes since the last visit are the small number on the Activity tab (the Overview does not draw them any more).
      const n = key === 'activity' ? this.since.total() : 0;
      if (n > 0) {
        tab.badge = n;
        tab.name = `${tab.label}, ${n} ${n === 1 ? 'change' : 'changes'} since your last visit`;
      }
      return tab;
    }),
  );
  /** The filters of the filter bar that are in force (the pre-filter of the grid is not one of them: the grid has its own Clear filter). */
  protected readonly barActive = computed(() => activeFilterCount(this.filters()));
  /** What is set in the phone's header menu: the Focus and the All matters scope (the number on its button). */
  protected readonly headerActive = computed(
    () => (this.focus.types().length > 0 ? 1 : 0) + (this.filters().scope === 'all' ? 1 : 0),
  );
  /** The Calendar is the task area (`?view=calendar`), remembered per person: the Overview shows the grids otherwise (issue #929). */
  protected readonly calendarShown = computed(
    () => this.tab() === 'overview' && this.params().get('view') === 'calendar',
  );
  /** The month the Calendar shows (`?month=yyyy-mm`); null is the month of today. */
  protected readonly calendarMonth = computed(() => parseMonth(this.params().get('month')));
  /** The person's one matter (scope Mine), named after the grid's heading on a wide screen. */
  protected readonly oneMatter = computed(() => {
    const m = this.filters().scope === 'mine' ? this.managed.only() : null;
    return m ? { matterId: m.matterId, matterRef: m.matterRef, name: m.name } : null;
  });
  /** The matter's name goes on a row only where several matters are in play (a person who manages one matter would read it on every row). */
  protected readonly showMatter = computed(
    () =>
      this.managed.state() !== 'loading' &&
      (this.filters().scope === 'all' || this.managed.only() === null),
  );
  /** The person manages no matter at all (scope Mine, no filter): the Overview says so and offers the way on. */
  protected readonly noMatters = computed(
    () =>
      this.filters().scope === 'mine' &&
      this.barActive() === 0 &&
      this.managed.complete() &&
      this.managed.items().length === 0,
  );
  protected readonly canMyWork = computed(() => this.auth.has('Task.View'));
  protected readonly clientName = signal<string | null>(null);
  protected readonly managerName = signal<string | null>(null);
  protected readonly matterName = signal<string | null>(null);

  /** What the scope means. No sentence is drawn under the title (issue #904): it is the tooltip of the scope switch and stays for screen readers. */
  protected readonly scopeText = computed(() =>
    this.filters().scope === 'all'
      ? 'All active matters, whoever manages them'
      : 'The matters you manage as primary or secondary project manager. This is your default view, not a limit on what you can open.',
  );
  protected readonly description = computed(() =>
    this.filters().scope === 'all' ? 'All active matters, whoever manages them.' : this.scopeText(),
  );

  /** The first answers are awaited only briefly. */
  private readonly waited = signal(false);
  /**
   * The body of the page is held back (laid out, not painted) while the first answers are on their way, for at most {@link HOLD_MS}: the matters (they decide
   * whether the Client / Role bar is drawn) and every request of the page (the lists, the strip, the Activity badge). Everything then appears in one step, and
   * nothing is drawn first and moved by a later answer (issue #921, layout shift under 0.05). A slow server shows the skeleton after the hold, as before.
   */
  protected readonly hold = computed(
    () =>
      !this.waited() &&
      ((this.managed.state() === 'loading' &&
        this.filters().scope !== 'all' &&
        this.barActive() === 0) ||
        this.loads.pending()),
  );

  private readonly injector = inject(Injector);
  /** The tab changed by the person's own click or key (focus is already on it); a change from the address (Back) puts focus on the tab. */
  private chose = false;
  private shown: MmTab | null = null;

  private offered(tab: MmTab): boolean {
    return tab !== 'data' || this.auth.has('Asset.View');
  }

  constructor() {
    this.restoreRemembered();
    // The Deadlines tab (issue #929) and the Trends tab (issue #947) are gone: their addresses open the Overview (a calendar link keeps its `view`).
    effect(() => {
      const t = this.params().get('tab');
      if (t === 'deadlines' || t === 'trends') untracked(() => this.go({ tab: null }, true));
    });
    effect(() => this.since.filters.set(this.filters()));
    const timer = setTimeout(() => this.waited.set(true), HOLD_MS);
    inject(DestroyRef).onDestroy(() => clearTimeout(timer));
    // The title rule `<Page>: <Tab> - <App name>`: the Overview is the page itself.
    effect(() => {
      const tab = this.tab();
      this.pageTitle.pin(tab === 'overview' ? 'My Matters' : `My Matters: ${TAB_LABELS[tab]}`);
    });
    inject(DestroyRef).onDestroy(() => {
      this.pageTitle.unpin();
      this.createContext.matterId.set(null);
    });
    // One matter, the person's only one or the one chosen in the Matter filter (issue #941): the shell's "Create task" is the one create button and opens Create task with that matter (issue #904).
    effect(() =>
      this.createContext.matterId.set(
        this.filters().matterId ??
          (this.filters().scope === 'mine' ? (this.managed.only()?.matterId ?? null) : null),
      ),
    );
    effect(() => {
      const tab = this.tab();
      untracked(() => {
        const first = this.shown === null;
        const changed = tab !== this.shown;
        this.shown = tab;
        if (first || !changed) return;
        if (this.chose) {
          this.chose = false;
          return;
        }
        afterNextRender(
          () => document.getElementById(`mm-tab-${tab}`)?.focus({ preventScroll: true }),
          { injector: this.injector },
        );
      });
    });
    // Remember the filters per person, as a convenience only (the address stays the source of truth).
    effect(() => {
      const f = this.filters();
      untracked(() => this.remember(f));
    });
  }

  private rememberKey(): string {
    return `mf-my-matters-filters-${this.auth.profile()?.userId ?? 0}`;
  }

  /**
   * A visit with no filters in the address starts from the filters the person last used, and a visit to the Overview with no `view` opens the Calendar if that is
   * what the person last used. One navigation for both, so neither is lost.
   */
  private restoreRemembered(): void {
    const q = this.route.snapshot.queryParamMap;
    const params: Record<string, string | number | null | undefined> = {};
    try {
      if (!FILTER_KEYS.some((k) => q.has(k))) {
        const raw = storage()?.getItem(this.rememberKey());
        if (raw) {
          const kept = parseFilters(new URLSearchParams(raw) as unknown as typeof q, this.canAll());
          if (!same(kept, DEFAULT_FILTERS)) Object.assign(params, filtersToParams(kept));
        }
      }
      if (
        !q.has('view') &&
        (q.get('tab') ?? 'overview') === 'overview' &&
        storage()?.getItem(this.calendarKey()) === 'calendar'
      )
        params['view'] = 'calendar';
    } catch {
      // Storage may be blocked; the page then starts from the defaults.
    }
    if (Object.keys(params).length === 0) return;
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: params,
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }

  private remember(f: MmFilters): void {
    try {
      const out = new URLSearchParams();
      for (const [k, v] of Object.entries(filtersToParams(f))) {
        if (v !== null && v !== undefined) out.set(k, String(v));
      }
      const s = storage();
      if (!s) return;
      if (out.size === 0) s.removeItem(this.rememberKey());
      else s.setItem(this.rememberKey(), out.toString());
    } catch {
      // Not remembering is fine.
    }
  }

  private go(queryParams: Record<string, string | number | null>, replaceUrl = false): void {
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams,
      queryParamsHandling: 'merge',
      replaceUrl,
    });
  }

  private calendarKey(): string {
    return `mf-my-matters-calendar-${this.auth.profile()?.userId ?? 0}`;
  }

  /** Switches the task area between the grids and the Calendar; the choice is remembered per person (a convenience, the address stays the source of truth). */
  protected setCalendar(on: boolean): void {
    this.go({ view: on ? 'calendar' : null, month: null }, true);
    try {
      const s = storage();
      if (on) s?.setItem(this.calendarKey(), 'calendar');
      else s?.removeItem(this.calendarKey());
    } catch {
      // Not remembering is fine.
    }
    // The button that was pressed is replaced by the other view's button: the focus goes to it.
    afterNextRender(
      () => {
        const next = document.querySelector<HTMLElement>('[data-calendar-toggle]');
        next?.focus({ preventScroll: true });
      },
      { injector: this.injector },
    );
  }

  /** Previous, Next or Today in the Calendar: the month is in the address (null leaves it, which is the current month); the history is not filled with months. */
  protected setMonth(month: string | null): void {
    this.go({ month }, true);
  }

  /** A filter changed: the address changes (a leftover `page` from an older link is dropped). */
  protected update(patch: Partial<MmFilters>): void {
    const next: MmFilters = { ...this.filters(), ...patch };
    if (patch.scope === 'mine') next.managerId = null;
    // A new Matter choice starts the Data tab's own matter selection (`dm`) from it: the tab keeps its multi-select, initialised from this choice (issue #941).
    const data: Record<string, string | null> =
      patch.matterId === undefined
        ? {}
        : { dm: patch.matterId === null ? null : String(patch.matterId) };
    this.go({ ...filtersToParams(next), ...data, page: null });
  }

  /** A tab was chosen: the address changes (Overview leaves it), the filters stay. */
  protected selectTab(tab: string): void {
    this.chose = true;
    this.go({ tab: tab === 'overview' ? null : tab, page: null });
  }

  protected clear(): void {
    this.go({
      ...filtersToParams({
        ...DEFAULT_FILTERS,
        scope: this.filters().scope === 'all' ? 'all' : 'mine',
      }),
      dm: null,
      page: null,
    });
  }
}
