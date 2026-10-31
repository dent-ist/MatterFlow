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
  untracked,
  viewChild,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { AuthStore } from '../../../core/auth/auth.store';
import { PageTitle } from '../../../core/title/page-title';
import { CreateTaskContext } from '../../../shared/layout/create-task-context';
import { FixedPage } from '../../../shared/ui/fixed-page';
import { MfTab, Tabs } from '../../../shared/ui/tabs';
import { LoadGroup, panelLoader } from '../panel-loader';
import { MmActivityTab } from './activity-tab';
import { MmApi } from './mm-api';
import { GeneratedMmApi } from './mm-api-generated';
import { MmAssetsTab } from './assets-tab';
import { MmCalendarTab } from './calendar-tab';
import { MmLayout } from './mm-layout';
import { GRID_KEYS, MM_TABS, MmScopeStore, MmTab, TAB_LABELS } from './mm-scope';
import { MmMetricsTab } from './metrics-tab';
import { MmNewMenu } from './new-menu';
import { MmOverview } from './overview';
import { MmWorkflowBar } from './workflow-bar';
import { OptionsMenu } from '../../../shared/ui/options-menu';
import { ScopeSwitch } from '../../../shared/scope/scope-switch';
import { FocusChip, FocusControl } from '../focus-control';
import { MyMattersFocus } from '../focus';
import { MmScopeBar } from './scope-bar';
import { MmTreePanel, MmTreeRail } from './tree-panel';

/**
 * My Matters (epic #953, UI-11): the Project Manager's home, after the mockup `my-matters-v3-b-tree-r2.html`. A 19 px title with its icon; under it the Client and Matter
 * dropdowns, Browse, Clear and "+ New"; then the work area: the docked tree of clients and matters (or its rail) beside the tabs Overview, Calendar, Assets, Metrics and Activity.
 * On a desktop window the page never scrolls: the title, the dropdown row and the tabs stay, and the grids, the calendar and the side panel scroll inside frames that reach the
 * bottom (`mf-fixed-page`, `mf-grid-frame`). Up to 768 px the page scrolls as a whole and the lists are cards. Client, Matter, tab and filters live in the address
 * (`MmScopeStore`); the tree and the side panel keep their open states in the browser (`MmLayout`). The tree and the dropdowns choose the same thing, and a choice updates every part
 * at once with a polite announcement.
 */
@Component({
  selector: 'mf-my-matters-page',
  imports: [
    FixedPage,
    MmActivityTab,
    MmAssetsTab,
    MmCalendarTab,
    MmMetricsTab,
    MmNewMenu,
    MmOverview,
    MmScopeBar,
    MmWorkflowBar,
    FocusChip,
    FocusControl,
    OptionsMenu,
    ScopeSwitch,
    MmTreePanel,
    MmTreeRail,
    RouterLink,
    Tabs,
  ],
  providers: [MmScopeStore, MmLayout, LoadGroup, { provide: MmApi, useExisting: GeneratedMmApi }],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    :host {
      display: block;
    }
    .hdr {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: var(--mf-s2) var(--mf-s3);
      min-height: 30px;
      flex: none;
    }
    .chip-i {
      display: grid;
      place-items: center;
      width: 32px;
      height: 32px;
      border-radius: var(--mf-radius-lg);
      background: var(--mf-primary);
      color: var(--mf-surface);
    }
    h1 {
      margin: 0;
      font-size: var(--mf-fs-title-lg);
      font-weight: 600;
      line-height: 1.2;
    }
    mf-mm-scope-bar {
      flex: none;
      margin-top: var(--mf-s3);
    }
    .work {
      display: block;
      margin-top: var(--mf-s3);
      min-width: 0;
    }
    .dock {
      min-width: 0;
    }
    .main2 {
      min-width: 0;
    }
    .panel {
      margin-top: var(--mf-s3);
      min-width: 0;
    }
    .empty {
      display: flex;
      gap: var(--mf-s3);
      align-items: flex-start;
      padding: var(--mf-s5);
      border: 1px solid var(--mf-border);
      border-radius: var(--mf-radius-xl);
      background: var(--mf-surface);
    }
    .banner {
      margin-top: var(--mf-s3);
      padding: var(--mf-s2) var(--mf-s3);
      border: 1px solid var(--mf-danger);
      border-radius: var(--mf-radius-lg);
      background: var(--mf-sem-overdue-bg);
    }
    .sr {
      position: absolute;
      width: 1px;
      height: 1px;
      overflow: hidden;
      clip-path: inset(50%);
      white-space: nowrap;
    }
    .hold {
      visibility: hidden;
    }
    /* A desktop window: the page fits the window, only the frames scroll (mockup r2: shell > page > work > panel, all flex 1 1 0 with min-height 0). */
    @media (min-width: 768px) and (min-height: 561px) {
      :host {
        --mf-frame-min: 300px;
        display: flex;
        flex-direction: column;
        flex: 1 1 0;
        min-height: 0;
        height: 100%;
      }
      mf-fixed-page {
        padding-bottom: var(--mf-s2);
      }
      .work {
        display: flex;
        gap: var(--mf-s3);
        flex: 1 1 0;
        min-height: 0;
        align-items: stretch;
      }
      .dock {
        flex: none;
        min-height: 0;
      }
      .main2 {
        display: flex;
        flex-direction: column;
        flex: 1 1 0;
        min-height: 0;
      }
      .panel {
        display: flex;
        flex-direction: column;
        flex: 1 1 0;
        min-height: 0;
      }
      .panel > * {
        flex: 1 1 0;
        min-height: 0;
      }
    }
    @media (max-width: 767.98px) {
      .dock {
        display: none;
      }
    }
  `,
  template: `
    <mf-fixed-page>
      <div class="hdr">
        <span class="chip-i"><i class="pi pi-briefcase" aria-hidden="true"></i></span>
        <h1>My Matters</h1>
        <mf-mm-workflow-bar [filters]="scope.filters()" [scopeName]="scopeName()" />
      </div>

      <mf-mm-scope-bar
        [tree]="tree.data()"
        [clientId]="scope.clientId()"
        [matterId]="scope.matterId()"
        [docked]="layout.docked()"
        (pickedClient)="pickClient($event)"
        (pickedClientNode)="pickClientNode($event)"
        (pickedMatter)="pickMatter($event)"
        (clear)="clear()"
      >
        <mf-options-menu
          label="My Matters"
          [wide]="true"
          [active]="optionsActive()"
          (opened)="focusList.reset()"
          data-mm-options
        >
          @if (scope.canAll()) {
            <div data-options-pick>
              <mf-scope-switch
                [scope]="scope.filters().scope"
                [canAll]="scope.canAll()"
                allLabel="All matters"
                description="Mine: the matters you manage as primary or secondary project manager. All matters: every active matter, whoever manages it."
                (scopeChange)="setScope($event)"
              />
            </div>
          }
          <mf-mm-focus #focusList />
        </mf-options-menu>
        <mf-mm-new-menu
          [tab]="scope.tab()"
          [matterId]="scope.matterId()"
          [clientId]="scope.clientId()"
          [tree]="tree.data()"
          (created)="refresh.update((n) => n + 1)"
        />
      </mf-mm-scope-bar>
      <mf-mm-focus-chip />
      <div class="sr" role="status" aria-live="polite" data-live>{{ announce() }}</div>
      <div class="sr" role="status" aria-live="polite">{{ layout.announcement() }}</div>

      @if (loads.many()) {
        <div class="banner" role="alert" data-page-error>
          Couldn't load My Matters.
          <button type="button" class="mf-btn" (click)="loads.retryAll()">Retry</button>
        </div>
      }

      @if (noMatters()) {
        <div class="empty work" data-no-matters>
          <i class="pi pi-info-circle" aria-hidden="true"></i>
          <span
            ><b>No matters yet.</b> You are not the project manager of any matter yet. When a Pod
            Lead assigns you one, it will appear here.
            <a routerLink="/my-work" class="mf-link">Go to My Work</a></span
          >
        </div>
      } @else {
        <div class="work" #work [class.hold]="false">
          @if (layout.docked()) {
            <div class="dock" [style.width.px]="layout.treeOpen() ? 280 : 48">
              @if (layout.treeOpen()) {
                <mf-mm-tree-panel
                  [tree]="tree.data()"
                  [clientId]="scope.clientId()"
                  [matterId]="scope.matterId()"
                  [pinned]="layout.treePin()"
                  (pin)="layout.setPin($event)"
                  (collapse)="collapseTree()"
                  (chooseClient)="pickClientNode($event)"
                  (chooseMatter)="pickMatter($event)"
                />
              } @else {
                <mf-mm-tree-rail
                  [label]="railLabel()"
                  [hasChoice]="!!(scope.clientId() || scope.matterId())"
                  (expand)="expandTree()"
                  (clear)="clear()"
                />
              }
            </div>
          }
          <div class="main2">
            <mf-tabs
              label="My Matters sections"
              idPrefix="mm"
              [tabs]="tabList()"
              [selected]="scope.tab()"
              (tabChange)="selectTab($any($event))"
            />
            <div
              class="panel"
              role="tabpanel"
              id="mm-panel"
              [attr.aria-labelledby]="'mm-tab-' + scope.tab()"
            >
              @switch (scope.tab()) {
                @case ('calendar') {
                  <mf-mm-calendar-tab
                    [filters]="scope.filters()"
                    [month]="scope.month()"
                    [shows]="scope.calShows()"
                    [tree]="tree.data()"
                    [refreshKey]="refresh()"
                    (monthChange)="scope.go({ month: $event }, true)"
                    (showsChange)="scope.go({ shows: $event.join(',') }, true)"
                    (changed)="refresh.update((n) => n + 1)"
                  />
                }
                @case ('assets') {
                  <mf-mm-assets-tab
                    [filters]="scope.filters()"
                    [assetId]="scope.assetId()"
                    [page]="scope.page()"
                    (assetChange)="scope.go({ asset: $event })"
                    (pageChange)="scope.go({ page: $event === 1 ? null : $event }, true)"
                  />
                }
                @case ('metrics') {
                  <mf-mm-metrics-tab
                    [filters]="scope.filters()"
                    [view]="scope.metricsView()"
                    (viewChange)="scope.go({ mview: $event === 'data' ? 'data' : null }, true)"
                    (drill)="drillTo($event)"
                  />
                }
                @case ('activity') {
                  <mf-mm-activity-tab
                    [filters]="scope.filters()"
                    [kind]="scope.kind()"
                    [page]="scope.page()"
                    (kindChange)="scope.go({ kind: $event, page: null }, true)"
                    (pageChange)="scope.go({ page: $event === 1 ? null : $event }, true)"
                    (assetOpened)="openAsset($event)"
                    (marked)="feedBadge.load()"
                  />
                }
                @default {
                  <mf-mm-overview
                    [filters]="scope.filters()"
                    [statuses]="scope.statuses()"
                    [grid]="scope.grid()"
                    [show]="scope.show()"
                    [showMatter]="!scope.matterId()"
                    [resetKey]="resetKey()"
                    (paramsChange)="scope.go({ ...$event, page: null })"
                    (assetOpened)="openAsset($event)"
                    (viewCalendar)="viewCalendar($event)"
                    (viewActivity)="scope.go({ tab: 'activity', kind: $event, page: null })"
                  />
                }
              }
            </div>
          </div>
        </div>
      }
    </mf-fixed-page>
  `,
})
export class MyMattersPage {
  protected readonly scope = inject(MmScopeStore);
  protected readonly layout = inject(MmLayout);
  protected readonly loads = inject(LoadGroup);
  private readonly api = inject(MmApi);
  private readonly auth = inject(AuthStore);
  private readonly pageTitle = inject(PageTitle);
  private readonly createContext = inject(CreateTaskContext);
  private readonly injector = inject(Injector);
  private readonly work = viewChild<ElementRef<HTMLElement>>('work');

  protected readonly focus = inject(MyMattersFocus);
  protected readonly optionsActive = computed(
    () => (this.focus.types().length > 0 ? 1 : 0) + (this.scope.filters().scope === 'all' ? 1 : 0),
  );
  protected readonly refresh = signal(0);
  protected readonly announce = signal('');

  /** The tree depends on the scope (mine / all, role, manager) only, never on the chosen client or matter. */
  private readonly treeScope = computed(() => {
    const f = this.scope.filters();
    return `${f.scope}|${f.role}|${f.managerId}`;
  });
  protected readonly tree = panelLoader(
    () => [this.treeScope(), this.refresh()],
    () => this.api.tree(this.scope.filters()),
  );
  /** The unread count on the Activity tab. */
  protected readonly feedBadge = panelLoader(
    () => [this.scope.filters(), this.refresh()],
    () => this.api.feed(this.scope.filters(), { page: 1, pageSize: 1 }),
  );

  protected readonly noMatters = computed(
    () =>
      this.tree.state() === 'ready' &&
      (this.tree.data()?.matterCount ?? 0) === 0 &&
      this.scope.filters().scope === 'mine',
  );
  protected readonly tabList = computed<MfTab[]>(() =>
    MM_TABS.map((key) => {
      const tab: MfTab = { key, label: TAB_LABELS[key] };
      const n = key === 'activity' ? (this.feedBadge.data()?.unreadCount ?? 0) : 0;
      if (n > 0) {
        tab.badge = n;
        tab.name = `${tab.label}, ${n} unread`;
      }
      return tab;
    }),
  );
  protected readonly resetKey = computed(() => `${this.scope.clientId()}|${this.scope.matterId()}`);
  protected readonly scopeName = computed(() => {
    const t = this.tree.data();
    const c = t?.clients.find((x) => x.clientId === this.scope.clientId());
    const m = c?.matters.find((x) => x.matterId === this.scope.matterId());
    return m?.name ?? c?.name ?? 'All your matters';
  });
  protected readonly railLabel = computed(() => {
    const t = this.tree.data();
    const c = t?.clients.find((x) => x.clientId === this.scope.clientId());
    const m = c?.matters.find((x) => x.matterId === this.scope.matterId());
    if (m) return `${c!.name} › ${m.name}`;
    if (c) return `${c.name} › all matters`;
    return 'All clients and matters';
  });

  constructor() {
    this.focus.ensure();
    this.restoreGridFilters();
    // The matters of the tree decide whether there is anything to browse (none or one: no tree).
    effect(() => {
      const n = this.tree.data()?.matterCount;
      if (n === undefined) return;
      untracked(() => this.layout.setBrowsable(n > 1));
    });
    const destroyRef = inject(DestroyRef);
    afterNextRender(() => {
      const el = this.work()?.nativeElement;
      const measure = (): void =>
        this.layout.setWidths(window.innerWidth, this.work()?.nativeElement.clientWidth ?? 1000);
      measure();
      if (el && typeof ResizeObserver !== 'undefined') {
        const ro = new ResizeObserver(measure);
        ro.observe(el);
        destroyRef.onDestroy(() => ro.disconnect());
      }
      window.addEventListener('resize', measure);
      destroyRef.onDestroy(() => window.removeEventListener('resize', measure));
    });
    effect(() => {
      const tab = this.scope.tab();
      this.pageTitle.pin(tab === 'overview' ? 'My Matters' : `My Matters: ${TAB_LABELS[tab]}`);
    });
    inject(DestroyRef).onDestroy(() => {
      this.pageTitle.unpin();
      this.createContext.matterId.set(null);
    });
    effect(() => this.createContext.matterId.set(this.scope.matterId()));
    // The asset side panel needs room: below the width budget the docked tree goes to its rail (they take turns, like the tree and the side panel).
    effect(() => {
      const open = this.scope.tab() === 'assets' && this.scope.assetId() !== null;
      untracked(() => {
        if (open && this.layout.treeWide() && this.layout.workWidth() - 280 - 12 - 372 - 12 < 560)
          this.layout.collapseTree();
      });
    });
    // A polite message when the choice changes: what the page now shows.
    let first = true;
    effect(() => {
      const key = this.resetKey();
      const name = this.railLabel();
      untracked(() => {
        if (first) {
          first = false;
          return;
        }
        void key;
        this.announce.set(
          `Showing ${name === 'All clients and matters' ? 'all your matters' : name}.`,
        );
      });
    });
  }

  /** A client row of the tree (or of Browse) was chosen: the client is the scope and the matter is cleared, even when the chosen matter belongs to it. */
  protected pickClientNode(id: number): void {
    this.scope.setClient(id, null);
    this.layout.chosen();
  }

  protected pickClient(id: number | null): void {
    const t = this.tree.data();
    const matterClient =
      t?.clients.find((c) => c.matters.some((m) => m.matterId === this.scope.matterId()))
        ?.clientId ?? null;
    this.scope.setClient(id, matterClient);
    if (id !== null) this.layout.chosen();
  }

  protected pickMatter(e: { matterId: number | null; clientId: number | null }): void {
    this.scope.setMatter(e.matterId, e.clientId);
    if (e.matterId !== null) this.layout.chosen();
  }

  /** The grid's column filters are remembered per browser (the address stays the source of truth): a visit with none in the address starts from the last ones. */
  private restoreGridFilters(): void {
    const key = 'mf-mm-grid-params';
    try {
      const q = new URLSearchParams(location.search);
      if (!GRID_KEYS.some((k) => q.has(k))) {
        const saved = JSON.parse(localStorage.getItem(key) ?? 'null') as Record<
          string,
          string
        > | null;
        if (saved && Object.keys(saved).length > 0) this.scope.go({ ...saved }, true);
      }
    } catch {
      // Storage may be blocked; the grid then starts unfiltered.
    }
    effect(() => {
      const f = this.scope.filtersKey();
      untracked(() => {
        try {
          const q = new URLSearchParams(location.search);
          const out: Record<string, string> = {};
          for (const k of ['status', 'q', 'prio', 'asg', 'due', 'dfrom', 'dto'] as const) {
            const v = q.get(k);
            if (v) out[k] = v;
          }
          void f;
          localStorage.setItem(key, JSON.stringify(out));
        } catch {
          // Not remembering is fine.
        }
      });
    });
  }

  /** A number of the Metrics tab: the Overview, with the filters that number counts (the chosen client and matter stay). */
  protected drillTo(p: Record<string, string>): void {
    this.scope.go({
      tab: null,
      status: null,
      show: null,
      q: null,
      prio: null,
      asg: null,
      due: null,
      dfrom: null,
      dto: null,
      ttype: null,
      cfrom: null,
      cto: null,
      page: null,
      ...p,
    });
  }

  protected setScope(scope: 'mine' | 'all'): void {
    this.scope.go({ scope: scope === 'all' ? 'all' : null, managerId: null, page: null });
  }

  protected clear(): void {
    this.scope.clear();
  }

  protected expandTree(): void {
    this.layout.expandTree();
    afterNextRender(
      () =>
        (
          document.querySelector<HTMLElement>('mf-mm-tree-panel [aria-selected="true"]') ??
          document.querySelector<HTMLElement>('mf-mm-tree-panel [role=treeitem]')
        )?.focus(),
      { injector: this.injector },
    );
  }

  protected collapseTree(): void {
    this.layout.collapseTree();
    afterNextRender(() => document.querySelector<HTMLElement>('[data-tree-expand-rail]')?.focus(), {
      injector: this.injector,
    });
  }

  protected selectTab(tab: MmTab): void {
    this.scope.setTab(tab);
  }

  protected openAsset(assetId: number): void {
    this.scope.go({ tab: 'assets', asset: assetId, page: null, kind: null });
  }

  protected viewCalendar(date: string | null): void {
    this.scope.go({ tab: 'calendar', month: date ? date.slice(0, 7) : null });
  }
}
