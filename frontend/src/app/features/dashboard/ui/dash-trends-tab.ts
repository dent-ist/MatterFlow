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
import { MeasureOption, TrendMeasure } from './trend-measure';
import {
  BACKLOG_CHOICE_LABEL,
  BacklogChoice,
  DEFAULT_CHOICE,
  FLOW_CHOICE_LABEL,
  FlowChoice,
  LIMIT_MESSAGE,
  MAX_TYPES,
  PanelView,
  TrendChoice,
  backlogOptions,
  buildView,
  choiceFromParams,
  choiceToParams,
  flowOptions,
  freeSlot,
  hasTrendParams,
  isFlowChoice,
  namesBacklog,
  normalizeChoice,
  sameChoice,
  toggleAllMode,
  totalMeasure,
  typeRows,
} from './trend-model';
import { TrendPrefs } from './trend-prefs';

type LoadState = 'loading' | 'ready' | 'error';

let nextId = 0;

/**
 * Dashboard > Trends tab: the daily lines of the whole department ("All task types") and of up to eight task types in two stacked panels
 * that share one x scale: flows (Created, Completed, On time, Completed late; 320 px) and backlog (Overdue at the end of the day; 200 px,
 * can be hidden). Each panel has its own segmented measure control; "Compare task types" is a list next to the chart that never disables
 * (picking a type turns a two-line measure into its first single measure and says so). The choices live in the address (`types`, `metric`,
 * `bmetric`, `all`; legacy `due`) so a link shares the view, and are remembered per user in this browser. The data is one request that
 * names the checked task types; checking a type already read needs no request. The period and the Refresh of the page drive it.
 * Operational counts only: no per-person figures.
 */
@Component({
  selector: 'mf-dash-trends-tab',
  imports: [TrendChart, TrendLegend, TrendMeasure, ErrorReference],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section
      class="card"
      [attr.aria-labelledby]="id + '-h'"
      [attr.aria-busy]="busy() ? 'true' : null"
    >
      <header>
        <h3 [id]="id + '-h'">{{ heading }}</h3>
        <span class="tools">
          @if (data() && !noActivity()) {
            <button
              type="button"
              class="toggle"
              data-backlog-toggle
              [attr.aria-pressed]="backlogShown()"
              (click)="toggleBacklog()"
            >
              {{ backlogShown() ? 'Hide backlog' : 'Show backlog' }}
            </button>
          }
          @if (hasLines() && !noActivity()) {
            <button
              type="button"
              class="toggle"
              [attr.aria-pressed]="asTable()"
              (click)="toggleTable()"
            >
              {{ asTable() ? 'View as chart' : 'View as table'
              }}<span class="sr-only"> for {{ heading }}</span>
            </button>
          }
        </span>
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
            <div class="sticky">
              <mf-trend-chart
                [heading]="heading"
                [dates]="dates()"
                [panels]="panels()"
                [asTable]="asTable()"
                [emptyText]="emptyText()"
                [controls]="measureTpl"
              />
            </div>
          </div>
          <mf-trend-legend
            class="side"
            [choice]="choice()"
            [slots]="slots()"
            [data]="d"
            [message]="message()"
            (allChange)="toggleAll()"
            (typeChange)="toggleType($event)"
            (selectTop)="selectTop()"
            (clear)="clearTypes()"
            (limit)="message.set(limitMessage)"
          />
        </div>
      } @else {
        <p class="note" role="status" data-trend-loading>Loading the trend.</p>
      }
      <ng-template #measureTpl let-key>
        @if (key === 'flows') {
          <mf-trend-measure
            panel="flows"
            label="Measure of the created and completed panel"
            [options]="flowChoices()"
            [value]="choice().metric"
            (valueChange)="setMetric($event)"
          />
        } @else {
          <mf-trend-measure
            panel="backlog"
            label="Measure of the backlog panel"
            [options]="backlogChoices"
            [value]="choice().bmetric"
            (valueChange)="setBacklogMetric($event)"
          />
        }
      </ng-template>
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
    .tools {
      display: inline-flex;
      flex-wrap: wrap;
      justify-content: flex-end;
      gap: var(--mf-s1) var(--mf-s4);
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
    /* Chart column and control panel side by side from 1000 px: the panel is 300 to 340 px, a fixed 360 px from 1600 px (the chart gets the
       rest). The chart column is as tall as the panel and the chart sticks under the tab row while the panel scrolls, so the chart stays
       in view while types are ticked. The sticky offset is the shared variable of the page header (--mf-dash-sticky-top) plus 16 px. */
    .layout {
      display: grid;
      grid-template-columns: minmax(0, 1fr);
      gap: var(--mf-s5);
      align-items: stretch;
    }
    .main {
      min-width: 0;
    }
    .side {
      padding: var(--mf-s4) 0 0;
      border-top: 1px solid var(--mf-border);
    }
    @media (min-width: 1000px) {
      .layout {
        grid-template-columns: minmax(0, 1fr) clamp(300px, 24vw, 340px);
      }
      .sticky {
        position: sticky;
        top: calc(var(--mf-dash-sticky-top, 0px) + var(--mf-s4));
      }
      .side {
        padding: 0 0 0 var(--mf-s4);
        border-top: 0;
        border-left: 1px solid var(--mf-border);
      }
    }
    @media (min-width: 1600px) {
      .layout {
        grid-template-columns: minmax(0, 1fr) 360px;
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

  protected readonly heading = 'Tasks over time';
  protected readonly backlogChoices: readonly MeasureOption<BacklogChoice>[] = backlogOptions().map(
    (value) => ({ value, label: BACKLOG_CHOICE_LABEL[value] }),
  );
  /** The user hid the backlog panel (remembered, not in the address). */
  protected readonly backlogHidden = signal(false);
  protected readonly backlogShown = computed(() => !this.backlogHidden());

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
  /** The panels the chart draws: flows, and backlog unless hidden. */
  protected readonly panels = computed<PanelView[]>(() => {
    const v = this.view();
    const none = this.noActivity();
    const strip = (p: PanelView): PanelView => (none ? { ...p, lines: [] } : p);
    return this.backlogHidden() ? [strip(v.flows)] : [strip(v.flows), strip(v.backlog)];
  });
  protected readonly hasLines = computed(() => this.panels().some((p) => p.lines.length > 0));
  protected readonly flowChoices = computed<MeasureOption<FlowChoice>[]>(() =>
    flowOptions(this.choice()).map((value) => ({ value, label: FLOW_CHOICE_LABEL[value] })),
  );
  protected readonly emptyText = computed(() =>
    this.noActivity()
      ? 'No tasks were created or completed in this period.'
      : 'Select a line in the list to draw it.',
  );

  private readonly params = toSignal(this.route.queryParamMap, {
    initialValue: this.route.snapshot.queryParamMap,
  });

  constructor() {
    // The address wins over what this browser remembers (a shared link), and the address is completed from what is remembered.
    const snapshot = this.route.snapshot.queryParamMap;
    // An address that asks for the backlog (legacy `due=overdue`, `metric=overdue`, `bmetric=`) shows it even if the user hid it.
    this.backlogHidden.set(this.prefs.backlogHidden() && !namesBacklog(snapshot));
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
    this.applyChoice(toggleAllMode(this.choice()), true);
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

  protected setMetric(value: string): void {
    if (isFlowChoice(value) && value !== this.choice().metric) {
      this.applyChoice({ ...this.choice(), metric: value }, true);
    }
  }

  protected setBacklogMetric(value: string): void {
    const bmetric = backlogOptions().find((m) => m === value);
    if (bmetric && bmetric !== this.choice().bmetric) {
      this.applyChoice({ ...this.choice(), bmetric }, true);
    }
  }

  protected toggleBacklog(): void {
    const hidden = !this.backlogHidden();
    this.backlogHidden.set(hidden);
    this.prefs.saveBacklogHidden(hidden);
    this.live.set(hidden ? 'Backlog hidden.' : 'Backlog shown.');
  }

  /** Select all: the task types with the highest totals for the shown measure, up to the limit. */
  protected selectTop(): void {
    const d = this.data();
    if (!d) return;
    const c = this.choice();
    const rows = typeRows(d.types, totalMeasure(c));
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
  private applyChoice(wanted: TrendChoice, userChange: boolean): void {
    const { choice: next, announcement } = normalizeChoice(wanted, this.choice());
    if (announcement && userChange) this.live.set(announcement);
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
