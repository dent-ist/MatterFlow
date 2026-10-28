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
import { ActivatedRoute, Router } from '@angular/router';
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
import { FocusChip, FocusControl } from '../focus-control';
import { MyMattersActiveFilters } from '../my-matters-active-filters';
import { MyMattersFilterBar } from '../my-matters-filter-bar';
import { ManagedMatters } from '../managed-matters';
import { NewTaskControl } from '../new-task-control';
import { OverviewStates } from '../overview-states';
import {
  DEFAULT_FILTERS,
  MmFilters,
  activeFilterCount,
  filtersToParams,
  parseFilters,
} from '../my-matters-filters';
import { LoadGroup } from '../panel-loader';
import { MyMattersStrip } from '../my-matters-strip';
import { AttentionPanel } from '../panels/attention-panel';
import { DeadlinesPanel } from '../panels/deadlines-panel';
import { HealthPanel } from '../panels/health-panel';
import { SincePanel } from '../panels/since-panel';
import { SkipLinks } from '../skip-links';
import { ActivityTab } from '../tabs/activity-tab';
import { BreakdownTab } from '../tabs/breakdown-tab';
import { DataTab } from '../tabs/data-tab';
import { DeadlinesTab } from '../tabs/deadlines-tab';
import { TrendsTab } from '../tabs/trends-tab';

/** The five tabs (`?tab=`; Overview is the page as it was and is absent from the address). */
export const MM_TABS = [
  'overview',
  'deadlines',
  'breakdown',
  'data',
  'activity',
  'trends',
] as const;
export type MmTab = (typeof MM_TABS)[number];
const TAB_LABELS: Record<MmTab, string> = {
  overview: 'Overview',
  deadlines: 'Deadlines',
  breakdown: 'Breakdown',
  data: 'Data',
  trends: 'Trends',
  activity: 'Activity',
};

/** How long the page may hold its body back for the answers that decide its layout (a slow server never leaves it blank). */
const HOLD_MS = 1200;

const FILTER_KEYS = ['scope', 'role', 'clientId', 'range', 'from', 'to', 'managerId'] as const;

function same(a: MmFilters, b: MmFilters): boolean {
  return (
    a.scope === b.scope &&
    a.role === b.role &&
    a.clientId === b.clientId &&
    a.range === b.range &&
    a.from === b.from &&
    a.to === b.to &&
    a.managerId === b.managerId
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
 * My Matters (epic #667, README 6): the Project Manager's home. A strip of count chips, one "what changed" line (only when something that needs a decision changed), Needs my
 * attention (one ranked list of five), Upcoming deadlines and, for several matters, a compact list of the matters (epic #893). The events are on the Activity tab. Each part
 * loads and fails on its own. The matters are "mine" (primary or secondary manager) by default, a default view and not a limit on access; with `Matter.AssignManagers` the scope can be
 * All matters. The filters (client, role, dates, scope, project manager) live in the address, so Back restores them; the last filters are also remembered per person in the browser
 * as a convenience. One scrolling page, no nested scroll boxes. Different from the department Dashboard: it answers "what is on fire on my matters", not "how is the department
 * doing". Workload and capacity of technicians is not shown here (owner decision, #826).
 */
@Component({
  selector: 'mf-my-matters-page',
  imports: [
    AttentionPanel,
    DeadlinesPanel,
    ErrorReference,
    FocusChip,
    FocusControl,
    HealthPanel,
    MyMattersActiveFilters,
    MyMattersFilterBar,
    MyMattersStrip,
    NewTaskControl,
    OptionsMenu,
    PageHeader,
    ScopeSwitch,
    SincePanel,
    SkipLinks,
    Tabs,
    ActivityTab,
    BreakdownTab,
    DataTab,
    DeadlinesTab,
    TrendsTab,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [ManagedMatters, OverviewStates, LoadGroup],
  styles: `
    :host {
      display: block;
    }
    /* One column (issue #903): the sections follow each other in the order of what a project manager needs, the calm line of what changed, Needs my attention,
       Next 7 days and the matters. No two-column grid at any width, so no white hole under the shorter list. */
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
      margin-bottom: var(--mf-s2);
    }
    /* Everything is quiet (issue #920): the four sections that have nothing to show give way to one line. */
    .mm__off {
      display: none;
    }
    .mm__quiet {
      margin: 0 0 var(--mf-s3);
      color: var(--mf-text-muted);
    }
    /* Held, not removed: the body is laid out but not painted, so what changes while it is held (the bar, the "since" line, the lists) moves nothing the person sees,
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
      <!-- A phone (issue #922): the title row is the title, Filters (only when there is something to filter) and one Options menu holding the
           scope, the Focus and New task, so the first screen shows tasks. A block projects into the header only with ONE root element, so each
           piece has its own condition. -->
      @if (phone()) {
        <mf-mm-filter-bar
          mfActions
          [filters]="filters()"
          [active]="barActive()"
          (filterChange)="update($event)"
          (clear)="clear()"
          (clientName)="clientName.set($event)"
          (managerName)="managerName.set($event)"
        />
      }
      @if (phone()) {
        <mf-options-menu
          mfActions
          data-header-options
          label="My Matters"
          [wide]="true"
          [active]="headerActive()"
        >
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
          <mf-mm-focus [inline]="true" />
          <mf-mm-new-task [inline]="true" />
        </mf-options-menu>
      }
      @if (!phone()) {
        <mf-scope-switch
          mfActions
          [scope]="filters().scope"
          [canAll]="canAll()"
          allLabel="All matters"
          [description]="scopeText()"
          (scopeChange)="
            update({ scope: $event, managerId: $event === 'mine' ? null : filters().managerId })
          "
        />
      }
      @if (!phone()) {
        <mf-mm-focus mfActions />
      }
      @if (!phone()) {
        <mf-mm-new-task mfActions />
      }
    </mf-page-header>

    <!-- Everything under the title row waits for the two answers that decide whether something is drawn above it (the matters, for the Client / Role bar, and the
         "since" line), for at most HOLD_MS: the lists then appear in one step and nothing moves (issue #921, layout shift under 0.05). -->
    <div class="mm__body" [class.mm__hold]="hold()" data-mm-body>
      @if (phone()) {
        <mf-mm-active-filters
          [filters]="filters()"
          [clientName]="clientName()"
          [managerName]="managerName()"
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

      <!-- The filters, the Focus chip and the strip share a line where the width allows (issue #899) and wrap to rows where it does not. -->
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
        <mf-mm-strip
          [filters]="filters()"
          [clientName]="clientName()"
          [managerName]="managerName()"
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
          @case ('deadlines') {
            @defer (on immediate) {
              <mf-mm-deadlines-tab [filters]="filters()" (filterChange)="update($event)" />
            } @placeholder {
              <p class="mm__loading" role="status">Loading deadlines</p>
            }
          }
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
          @case ('trends') {
            @defer (on immediate) {
              <mf-mm-trends-tab [filters]="filters()" />
            } @placeholder {
              <p class="mm__loading" role="status">Loading trends</p>
            }
          }
          @case ('activity') {
            @defer (on immediate) {
              <mf-mm-activity-tab [filters]="filters()" />
            } @placeholder {
              <p class="mm__loading" role="status">Loading activity</p>
            }
          }
          @default {
            <mf-mm-skip-links [class.mm__off]="states.quiet()" />
            <mf-mm-since class="mm__since" [class.mm__off]="states.quiet()" [filters]="filters()" />
            @if (states.quiet() && !states.noMatters()) {
              <p class="mm__quiet" role="status" data-all-quiet>
                Nothing is late and nothing is due in the next 7 days.
              </p>
            }
            <div class="mm__stack">
              <mf-mm-attention
                [class.mm__off]="states.quiet()"
                [filters]="filters()"
                [showMatter]="showMatter()"
                (listed)="listed.set($event)"
              />
              <mf-mm-deadlines
                [class.mm__off]="states.quiet()"
                [filters]="filters()"
                [exclude]="listed()"
                [showMatter]="showMatter()"
              />
              <mf-mm-health
                [filters]="filters()"
                [filtered]="barActive() > 0"
                (showAll)="update({ scope: 'all' })"
              />
            </div>
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
  protected readonly states = inject(OverviewStates);
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
    MM_TABS.filter((key) => this.offered(key)).map((key) => ({ key, label: TAB_LABELS[key] })),
  );
  /** The filters of the filter bar that are in force. The date range is not one of them: its control is inside the Deadlines tab (issue #906). */
  protected readonly barActive = computed(() =>
    activeFilterCount({ ...this.filters(), range: DEFAULT_FILTERS.range }),
  );
  /** What is set in the phone's header menu: the Focus and the All matters scope (the number on its button). */
  protected readonly headerActive = computed(
    () => (this.focus.types().length > 0 ? 1 : 0) + (this.filters().scope === 'all' ? 1 : 0),
  );
  /** The tasks Needs my attention lists: Upcoming deadlines leaves them out (a task is listed once per screen). */
  protected readonly listed = signal<number[]>([]);
  /** The matter's name goes on a row only where several matters are in play (a person who manages one matter would read it on every row). */
  protected readonly showMatter = computed(
    () =>
      this.managed.state() !== 'loading' &&
      (this.filters().scope === 'all' || this.managed.only() === null),
  );
  protected readonly clientName = signal<string | null>(null);
  protected readonly managerName = signal<string | null>(null);

  /** What the scope means. No sentence is drawn under the title (issue #904): it is the tooltip of the scope switch and stays for screen readers. */
  protected readonly scopeText = computed(() =>
    this.filters().scope === 'all'
      ? 'All active matters, whoever manages them'
      : 'The matters you manage as primary or secondary project manager. This is your default view, not a limit on what you can open.',
  );
  protected readonly description = computed(() =>
    this.filters().scope === 'all'
      ? 'All active matters, whoever manages them. Each count opens the list it counts.'
      : this.scopeText(),
  );

  /** The first answers are awaited only briefly. */
  private readonly waited = signal(false);
  /**
   * The body of the page is held back (laid out, not painted) while the first answers are on their way, for at most {@link HOLD_MS}: the matters (they decide
   * whether the Client / Role bar is drawn) and every request of the page (the "since" line, the lists, the strip). Everything then appears in one step, and
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
    // One managed matter: the shell's "Create task" is the one create button and opens Create task with that matter (issue #904).
    effect(() =>
      this.createContext.matterId.set(
        this.filters().scope === 'mine' ? (this.managed.only()?.matterId ?? null) : null,
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

  /** A visit with no filters in the address starts from the filters the person last used. */
  private restoreRemembered(): void {
    const q = this.route.snapshot.queryParamMap;
    if (FILTER_KEYS.some((k) => q.has(k))) return;
    try {
      const raw = storage()?.getItem(this.rememberKey());
      if (!raw) return;
      const kept = parseFilters(new URLSearchParams(raw) as unknown as typeof q, this.canAll());
      if (same(kept, DEFAULT_FILTERS)) return;
      void this.router.navigate([], {
        relativeTo: this.route,
        queryParams: filtersToParams(kept),
        queryParamsHandling: 'merge',
        replaceUrl: true,
      });
    } catch {
      // Storage may be blocked; the page then starts from the defaults.
    }
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

  private go(queryParams: Record<string, string | number | null>): void {
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams,
      queryParamsHandling: 'merge',
    });
  }

  /** A filter changed: the address changes (a leftover `page` from an older link is dropped). */
  protected update(patch: Partial<MmFilters>): void {
    const next: MmFilters = { ...this.filters(), ...patch };
    if (patch.scope === 'mine') next.managerId = null;
    this.go({ ...filtersToParams(next), page: null });
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
      page: null,
    });
  }
}
