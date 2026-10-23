import { toSignal } from '@angular/core/rxjs-interop';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { AuthStore } from '../../../core/auth/auth.store';
import { PageHeader } from '../../../shared/ui/page-header';
import { MyMattersFilterBar } from '../my-matters-filter-bar';
import {
  DEFAULT_FILTERS,
  MmFilters,
  MmRange,
  activeFilterCount,
  filtersToParams,
  parseFilters,
} from '../my-matters-filters';
import { MyMattersStrip } from '../my-matters-strip';
import { ActivityPanel } from '../panels/activity-panel';
import { AttentionPanel } from '../panels/attention-panel';
import { DeadlinesPanel } from '../panels/deadlines-panel';
import { HealthPanel, HealthSort } from '../panels/health-panel';
import { WorkloadPanel } from '../panels/workload-panel';

const SORTS: readonly HealthSort[] = [
  'nextDeadline',
  'client',
  'matter',
  'open',
  'overdue',
  'dueThisWeek',
  'unassigned',
  'flag',
];

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
 * My Matters (epic #667, README 6): the Project Manager's home. A count strip, Needs my attention, Upcoming deadlines, Matter health, Workload
 * and capacity and Recent activity, each loading and failing on its own. The matters are "mine" (primary or secondary manager) by default, a
 * default view and not a limit on access; with `Matter.AssignManagers` the scope can be All matters. The filters (client, role, dates,
 * scope, project manager) and the health table's sort and page live in the address, so Back restores them; the last filters are also
 * remembered per person in the browser as a convenience. One scrolling page, no tabs, no nested scroll boxes. Different from the
 * department Dashboard: it answers "what is on fire on my matters", not "how is the department doing".
 */
@Component({
  selector: 'mf-my-matters-page',
  imports: [
    ActivityPanel,
    AttentionPanel,
    DeadlinesPanel,
    HealthPanel,
    MyMattersFilterBar,
    MyMattersStrip,
    PageHeader,
    WorkloadPanel,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    :host {
      display: block;
    }
    .mm__scope {
      display: inline-flex;
    }
    .mm__scope .mf-btn[aria-pressed='true'] {
      border-color: var(--mf-primary);
      background: var(--mf-selected-bg);
      font-weight: 700;
    }
    .mm__grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      grid-template-areas:
        'attention deadlines'
        'health health'
        'workload activity';
      gap: var(--mf-s3);
      align-items: start;
    }
    .mm__attention {
      grid-area: attention;
    }
    .mm__deadlines {
      grid-area: deadlines;
    }
    .mm__health {
      grid-area: health;
    }
    .mm__workload {
      grid-area: workload;
    }
    .mm__activity {
      grid-area: activity;
    }
    .mm__grid > * {
      min-width: 0;
    }
    /* A phone: one column in the reading order of the plan (README 9): attention, health, deadlines, workload, activity. */
    @media (max-width: 639.98px) {
      .mm__grid {
        grid-template-columns: minmax(0, 1fr);
        grid-template-areas:
          'attention'
          'health'
          'deadlines'
          'workload'
          'activity';
      }
      .mm__scope .mf-btn {
        min-height: 44px;
      }
    }
  `,
  template: `
    <mf-page-header heading="My Matters" [description]="description()">
      @if (canAll()) {
        <div mfActions class="mm__scope" role="group" aria-label="Scope" data-ph-selector>
          <button
            type="button"
            class="mf-btn"
            data-scope="mine"
            [attr.aria-pressed]="filters().scope === 'mine'"
            (click)="update({ scope: 'mine', managerId: null })"
          >
            My matters
          </button>
          <button
            type="button"
            class="mf-btn"
            data-scope="all"
            [attr.aria-pressed]="filters().scope === 'all'"
            (click)="update({ scope: 'all' })"
          >
            All matters
          </button>
        </div>
      }
    </mf-page-header>

    <mf-mm-filter-bar
      [filters]="filters()"
      [active]="active()"
      (filterChange)="update($event)"
      (clear)="clear()"
      (clientName)="clientName.set($event)"
      (managerName)="managerName.set($event)"
    />

    <mf-mm-strip [filters]="filters()" [clientName]="clientName()" [managerName]="managerName()" />

    <div class="mm__grid">
      <mf-mm-attention class="mm__attention" [filters]="filters()" />
      <mf-mm-deadlines
        class="mm__deadlines"
        [filters]="filters()"
        (rangeChange)="setRange($event)"
      />
      <mf-mm-health
        class="mm__health"
        [filters]="filters()"
        [sort]="sort()"
        [dir]="dir()"
        [pageNumber]="page()"
        [filtered]="active() > 0"
        (sortChange)="setSort($event.sort, $event.dir)"
        (pageChange)="setPage($event)"
        (clearFilters)="clear()"
        (showAll)="update({ scope: 'all' })"
      />
      <mf-mm-workload class="mm__workload" [filters]="filters()" />
      <mf-mm-activity class="mm__activity" [filters]="filters()" />
    </div>
  `,
})
export class MyMattersPage {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly auth = inject(AuthStore);

  private readonly params = toSignal(this.route.queryParamMap, {
    initialValue: this.route.snapshot.queryParamMap,
  });

  protected readonly canAll = computed(() => this.auth.has('Matter.AssignManagers'));
  protected readonly filters = computed(() => parseFilters(this.params(), this.canAll()), {
    equal: same,
  });
  protected readonly active = computed(() => activeFilterCount(this.filters()));
  protected readonly sort = computed<HealthSort | null>(() => {
    const s = this.params().get('sort');
    return SORTS.includes(s as HealthSort) ? (s as HealthSort) : null;
  });
  protected readonly dir = computed<'asc' | 'desc'>(() =>
    this.params().get('dir') === 'desc' ? 'desc' : 'asc',
  );
  protected readonly page = computed(() => {
    const n = Number.parseInt(this.params().get('page') ?? '', 10);
    return Number.isFinite(n) && n > 0 ? n : 1;
  });
  protected readonly clientName = signal<string | null>(null);
  protected readonly managerName = signal<string | null>(null);

  protected readonly description = computed(() =>
    this.filters().scope === 'all'
      ? 'All active matters, whoever manages them. Each count opens the list it counts.'
      : 'The matters you manage as primary or secondary project manager. This is your default view, not a limit on what you can open.',
  );

  constructor() {
    this.restoreRemembered();
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

  /** A filter changed: the address changes, the health table goes back to its first page. */
  protected update(patch: Partial<MmFilters>): void {
    const next: MmFilters = { ...this.filters(), ...patch };
    if (patch.scope === 'mine') next.managerId = null;
    this.go({ ...filtersToParams(next), page: null });
  }

  protected setRange(range: MmRange): void {
    this.update(range === '2w' || range === '4w' ? { range, from: null, to: null } : { range });
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

  protected setSort(sort: HealthSort, dir: 'asc' | 'desc'): void {
    this.go({
      sort: sort === 'nextDeadline' && dir === 'asc' ? null : sort,
      dir: dir === 'asc' ? null : dir,
      page: null,
    });
  }

  protected setPage(page: number): void {
    this.go({ page: page > 1 ? page : null });
  }
}
