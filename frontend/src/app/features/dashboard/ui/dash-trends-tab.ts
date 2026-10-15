import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  input,
  signal,
  untracked,
} from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import { DashboardClient, DashboardTrend } from '../../../api/generated/api-client';
import { Clock, USER_TIME_ZONE } from '../../../core/time/clock';
import { ErrorReference } from '../../../shared/ui/error-reference';
import { PeriodKey, periodDays } from '../dashboard-period';
import { TrendChart } from './trend-chart';
import { TrendLegend } from './trend-legend';
import {
  DEFAULT_CHOICE,
  DueMeasure,
  LIMIT_MESSAGE,
  MAX_TYPES,
  MEASURE_INFO,
  Measure,
  TrendChoice,
  buildView,
  chartHeading,
  choiceFromParams,
  choiceToParams,
  freeSlot,
  hasTrendParams,
  sameChoice,
  typeRows,
} from './trend-model';
import { TrendPrefs } from './trend-prefs';

type LoadState = 'loading' | 'ready' | 'error';

let nextId = 0;

/**
 * Dashboard > Trends tab: the daily lines of the whole department ("All task types") and of up to eight task types, with the Overdue, On
 * time and Completed late lines of the Due dates group. The legend is the control (see `mf-trend-legend`). The choices live in the address
 * (`types`, `metric`, `all`, `due`) so a link shares the view, and are remembered per user in this browser. The data is one request that
 * names the checked task types; checking a type already read needs no request. The period and the Refresh of the page drive it.
 * Operational counts only: no per-person figures.
 */
@Component({
  selector: 'mf-dash-trends-tab',
  imports: [TrendChart, TrendLegend, ErrorReference],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section
      class="card"
      [attr.aria-labelledby]="id + '-h'"
      [attr.aria-busy]="busy() ? 'true' : null"
    >
      <header>
        <h3 [id]="id + '-h'">{{ heading() }}</h3>
        @if (view().lines.length > 0 && !noActivity()) {
          <button
            type="button"
            class="toggle"
            [attr.aria-pressed]="asTable()"
            (click)="toggleTable()"
          >
            {{ asTable() ? 'View as chart' : 'View as table'
            }}<span class="sr-only"> for {{ heading() }}</span>
          </button>
        }
      </header>
      @if (caption(); as c) {
        <p class="note">{{ c }}</p>
      }

      @if (state() === 'error') {
        <div class="alert" role="alert" data-trend-error>
          <span>The trend could not be loaded.</span>
          <mf-error-reference />
          <button type="button" class="mf-btn" data-trend-retry (click)="retry()">Retry</button>
        </div>
      } @else if (data(); as d) {
        <div class="layout">
          <div class="main">
            <mf-trend-chart
              [heading]="heading()"
              [dates]="dates()"
              [lines]="noActivity() ? [] : view().lines"
              [asTable]="asTable()"
              [measureNote]="measureNote()"
              [emptyText]="emptyText()"
            />
          </div>
          <mf-trend-legend
            class="side"
            [choice]="choice()"
            [slots]="slots()"
            [data]="d"
            [message]="message()"
            (allChange)="toggleAll()"
            (typeChange)="toggleType($event)"
            (dueChange)="toggleDue($event)"
            (metricChange)="setMetric($event)"
            (selectTop)="selectTop()"
            (clear)="clearTypes()"
            (limit)="message.set(limitMessage)"
          />
        </div>
      } @else {
        <p class="note" role="status" data-trend-loading>Loading the trend.</p>
      }
      <p class="sr-only" role="status" aria-live="polite" data-trend-live>{{ live() }}</p>
    </section>
  `,
  styles: `
    :host {
      display: block;
    }
    .card {
      box-sizing: border-box;
      padding: var(--mf-s4);
      background: var(--mf-surface);
      border: 1px solid var(--mf-border);
      border-radius: var(--mf-radius-lg);
    }
    header {
      display: flex;
      align-items: baseline;
      justify-content: space-between;
      gap: var(--mf-s3);
      margin-bottom: var(--mf-s3);
    }
    h3 {
      margin: 0;
      font-size: var(--mf-fs-lg);
    }
    .toggle {
      background: none;
      border: 0;
      padding: 0;
      min-height: var(--mf-target-min);
      color: var(--mf-link);
      font: inherit;
      font-size: var(--mf-fs-sm);
      cursor: pointer;
      text-decoration: underline;
      white-space: nowrap;
    }
    .note {
      margin: 0 0 var(--mf-s3);
      color: var(--mf-text-muted);
      font-size: var(--mf-fs-sm);
    }
    .layout {
      display: grid;
      grid-template-columns: minmax(0, 1fr) 21rem;
      gap: var(--mf-s5);
      align-items: start;
    }
    .main {
      min-width: 0;
    }
    .side {
      padding-left: var(--mf-s4);
      border-left: 1px solid var(--mf-border);
    }
    @media (max-width: 1000px) {
      .layout {
        grid-template-columns: minmax(0, 1fr);
      }
      .side {
        padding: var(--mf-s4) 0 0;
        border-left: 0;
        border-top: 1px solid var(--mf-border);
      }
    }
    .alert {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: var(--mf-s3);
      padding: var(--mf-s3) var(--mf-s4);
      color: var(--mf-danger);
      background: var(--mf-danger-bg);
      border: 1px solid var(--mf-danger);
      border-radius: var(--mf-radius);
    }
    .sr-only {
      position: absolute;
      width: 1px;
      height: 1px;
      overflow: hidden;
      clip-path: inset(50%);
      white-space: nowrap;
    }
  `,
})
export class DashTrendsTab {
  private readonly api = inject(DashboardClient);
  private readonly prefs = inject(TrendPrefs);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly clock = inject(Clock);
  private readonly zone = inject(USER_TIME_ZONE);
  private readonly destroyRef = inject(DestroyRef);

  /** The period preset of the page. */
  readonly period = input.required<PeriodKey>();
  readonly caption = input<string | null>(null);
  /** Changes whenever the page read its figures again (Refresh, the automatic refresh): the trend is read again with it. */
  readonly refreshKey = input<string | null>(null);

  protected readonly id = `mf-trends-${nextId++}`;
  protected readonly limitMessage = LIMIT_MESSAGE;
  protected readonly choice = signal<TrendChoice>(DEFAULT_CHOICE);
  protected readonly slots = signal<ReadonlyMap<number, number>>(new Map());
  protected readonly data = signal<DashboardTrend | null>(null);
  protected readonly state = signal<LoadState>('loading');
  protected readonly busy = signal(false);
  protected readonly message = signal('');
  protected readonly live = signal('');
  protected readonly asTable = signal(false);

  private requestId = 0;
  private loadedGen: string | null = null;
  private lastKey: string | null = null;
  private urlSeen = false;

  private readonly days = computed(() => periodDays(this.period(), this.clock.now(), this.zone));

  protected readonly view = computed(() => {
    const d = this.data();
    return buildView(this.choice(), d, this.slots(), d?.types ?? []);
  });
  protected readonly dates = computed(() => this.data()?.all.map((p) => p.date) ?? []);
  /** Nothing happened in the period (no created, completed, overdue or completed-with-due-date task at all). */
  protected readonly noActivity = computed(() => {
    const d = this.data();
    return (
      !!d &&
      this.choice().types.length === 0 &&
      d.all.every((p) => p.created + p.completed + p.overdue + p.onTime + p.late === 0)
    );
  });
  protected readonly heading = computed(() => {
    const view = this.view();
    return view.defaultMode &&
      !view.lines.some((l) => l.measure !== 'created' && l.measure !== 'completed')
      ? 'Tasks created and completed per day'
      : chartHeading(view.measures);
  });
  protected readonly measureNote = computed(() =>
    this.choice().types.length > 0 ? MEASURE_INFO[this.choice().metric].label : null,
  );
  protected readonly emptyText = computed(() =>
    this.noActivity()
      ? 'No tasks were created or completed in this period.'
      : 'Select a line in the legend to draw it.',
  );

  private readonly params = toSignal(this.route.queryParamMap, {
    initialValue: this.route.snapshot.queryParamMap,
  });

  constructor() {
    // The address wins over what this browser remembers (a shared link), and the address is completed from what is remembered.
    const snapshot = this.route.snapshot.queryParamMap;
    if (hasTrendParams(snapshot)) {
      this.applyChoice(choiceFromParams(snapshot), false);
    } else {
      const remembered = this.prefs.load();
      this.applyChoice(remembered, !sameChoice(remembered, DEFAULT_CHOICE));
    }

    // Back, Forward or a pasted link changed the address: follow it.
    effect(() => {
      const p = this.params();
      untracked(() => {
        if (!this.urlSeen) {
          this.urlSeen = true;
          return;
        }
        const named = hasTrendParams(p) ? choiceFromParams(p) : DEFAULT_CHOICE;
        if (!sameChoice(named, this.choice())) this.applyChoice(named, false);
      });
    });

    effect(() => {
      const days = this.days();
      const key = this.refreshKey();
      const ids = this.choice().types;
      untracked(() => this.ensure(days, key, ids));
    });
  }

  // ---- choices

  protected toggleAll(): void {
    this.message.set('');
    this.applyChoice({ ...this.choice(), showAll: !this.choice().showAll }, true);
  }

  protected toggleType(id: number): void {
    const c = this.choice();
    if (c.types.includes(id)) {
      this.message.set('');
      this.applyChoice({ ...c, types: c.types.filter((t) => t !== id) }, true);
    } else if (c.types.length >= MAX_TYPES) {
      this.message.set(LIMIT_MESSAGE);
    } else {
      this.message.set('');
      this.applyChoice({ ...c, types: [...c.types, id] }, true);
    }
  }

  protected toggleDue(m: DueMeasure): void {
    const c = this.choice();
    const due = c.due.includes(m) ? c.due.filter((x) => x !== m) : [...c.due, m];
    this.applyChoice(
      { ...c, due: (['overdue', 'onTime', 'late'] as const).filter((x) => due.includes(x)) },
      true,
    );
  }

  protected setMetric(metric: Measure): void {
    if (metric !== this.choice().metric) this.applyChoice({ ...this.choice(), metric }, true);
  }

  /** Select all: the task types with the highest totals for the shown measure, up to the limit. */
  protected selectTop(): void {
    const d = this.data();
    if (!d) return;
    const c = this.choice();
    const rows = typeRows(d.types, c.metric);
    const ids = rows.slice(0, MAX_TYPES).map((r) => r.id);
    this.message.set(
      rows.length > MAX_TYPES
        ? `Selected the ${MAX_TYPES} task types with the highest totals. ${LIMIT_MESSAGE}.`
        : '',
    );
    this.applyChoice({ ...c, types: ids }, true);
  }

  protected clearTypes(): void {
    this.message.set('');
    this.applyChoice({ ...this.choice(), types: [] }, true);
  }

  protected toggleTable(): void {
    this.asTable.update((v) => !v);
  }

  /** Makes the choices current: keeps the colours of types that stay checked, remembers them and (for a user's change) puts them in the address. */
  private applyChoice(next: TrendChoice, userChange: boolean): void {
    const slots = new Map<number, number>();
    for (const id of next.types) {
      const kept = this.slots().get(id);
      slots.set(
        id,
        kept !== undefined && ![...slots.values()].includes(kept) ? kept : freeSlot(slots),
      );
    }
    this.slots.set(slots);
    this.choice.set(next);
    this.prefs.save(next);
    if (userChange) {
      const current = hasTrendParams(this.route.snapshot.queryParamMap)
        ? choiceFromParams(this.route.snapshot.queryParamMap)
        : DEFAULT_CHOICE;
      if (!sameChoice(current, next)) {
        // Replace, not push: ticking boxes must not fill the history that Back walks through.
        void this.router.navigate([], {
          relativeTo: this.route,
          queryParams: choiceToParams(next),
          queryParamsHandling: 'merge',
          replaceUrl: true,
        });
      }
    }
  }

  // ---- data

  protected retry(): void {
    this.loadedGen = null;
    this.ensure(this.days(), this.refreshKey(), this.choice().types);
  }

  private ensure(days: number, key: string | null, ids: readonly number[]): void {
    const gen = `${days}|${key}`;
    const current = this.data();
    if (
      current &&
      this.loadedGen === gen &&
      ids.every((id) => current.byTaskType.some((s) => s.taskTypeId === id))
    ) {
      return;
    }
    // A later page refresh reads fresh figures; a first read, a new period or another task type may use the short server cache.
    const fresh = this.lastKey !== null && this.lastKey !== key;
    this.lastKey = key;
    this.fetch(gen, days, [...ids], fresh);
  }

  private fetch(gen: string, days: number, ids: number[], fresh: boolean): void {
    const id = ++this.requestId;
    if (this.data()) this.busy.set(true);
    else this.state.set('loading');
    this.api
      .getDashboardTrend(
        days,
        ids.length > 0 ? ids : undefined,
        undefined,
        fresh ? true : undefined,
      )
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (trend) => {
          if (id !== this.requestId) return;
          this.data.set(trend);
          this.loadedGen = gen;
          this.state.set('ready');
          this.busy.set(false);
          this.prune(trend);
        },
        error: (e: unknown) => {
          if (id !== this.requestId) return;
          this.busy.set(false);
          if ((e as { status?: number }).status === 400 && ids.length > 0) {
            // A remembered or shared task type that no longer exists: drop the selection and read the rest.
            this.applyChoice({ ...this.choice(), types: [] }, true);
            this.live.set('A selected task type no longer exists and was removed.');
            this.fetch(gen, days, [], fresh);
            return;
          }
          if (!this.data()) this.state.set('error');
        },
      });
  }

  /** A checked type the legend no longer lists (inactive and without tasks in this period) leaves the selection. */
  private prune(trend: DashboardTrend): void {
    const c = this.choice();
    const listed = new Set(trend.types.map((t) => t.id));
    const kept = c.types.filter((t) => listed.has(t));
    if (kept.length === c.types.length) return;
    const dropped = c.types
      .filter((t) => !listed.has(t))
      .map((t) => `Task type ${t}`)
      .join(', ');
    this.applyChoice({ ...c, types: kept }, true);
    this.live.set(`${dropped} has no tasks in this period and was removed from the chart.`);
  }
}
